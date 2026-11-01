import { test, onTestFinished } from "vite-plus/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Directory } from "../server/directory.js";
import { createService } from "../server/service.js";
import type { SavedAccount, SavedRoom } from "../shared/directory.js";

const password = "a long test password";
const code = "1234567890abcdef1234567890abcdef";
test("accounts, encrypted room secrets, names and membership survive a service restart", async () => {
  const path = await mkdtemp(join(tmpdir(), "share-stream-directory-"));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  let directory = new Directory(path);
  try {
    const owner = await directory.authenticate({ username: "owner", password }, true);
    const guest = await directory.authenticate({ username: "guest", password }, true);
    const outsider = await directory.authenticate({ username: "outsider", password }, true);
    const id = directory.save(
      owner.user,
      { code, name: "Mixing room", host: "relay.example", port: 49000 },
      true,
    );
    directory.manage(owner.user, id, { username: "GUEST" }, true);
    assert.equal(directory.rooms(guest.user).length, 0);
    const invitation = directory.invitations(guest.user)[0];
    assert.equal(invitation.room.name, "Mixing room");
    assert.equal(JSON.stringify(invitation).includes(code), false);
    assert.throws(
      () => directory.respondToInvitation(outsider.user, invitation.id, true),
      /no longer/,
    );
    directory.manage(owner.user, id, { name: "Album sessions" }, false);
    assert.equal(directory.invitations(guest.user)[0].room.name, "Album sessions");
    directory.respondToInvitation(guest.user, invitation.id, true);
    assert.equal(directory.invitations(guest.user).length, 0);
    const first = directory.rooms(guest.user)[0];
    assert.equal(first.name, "Album sessions");
    assert.equal(first.code, code);
    assert.equal(first.owner, false);
    assert.equal(first.members.length, 2);
    assert.equal(first.host, "relay.example");
    assert.equal(directory.rooms(outsider.user).length, 0);
    assert.throws(() => directory.manage(guest.user, id, { name: "stolen" }, false), /creator/);
    assert.throws(
      () => directory.manage(outsider.user, id, { username: "outsider" }, true),
      /creator/,
    );
    assert.throws(
      () => directory.manage(owner.user, id, { username: "guest" }, true),
      /already joined/,
    );
    directory.save(guest.user, { code }, false);
    assert.equal(directory.rooms(guest.user)[0].participant, first.participant);
    directory.close();
    directory = new Directory(path);
    assert.equal(directory.user(owner.token).id, owner.user.id);
    const login = await directory.authenticate({ username: "GUEST", password }, false);
    const restored = directory.rooms(login.user)[0];
    assert.equal(restored.name, "Album sessions");
    assert.equal(restored.code, code);
    assert.equal(restored.participant, first.participant);
    assert.notEqual(restored.participant, directory.rooms(owner.user)[0].participant);
    directory.logout(guest.token);
    assert.throws(() => directory.user(guest.token), /expired/);
    assert.equal(directory.user(login.token).id, guest.user.id);
    assert.equal(directory.rooms(login.user).length, 1);
  } finally {
    directory.close();
  }
  const bytes = await readFile(join(path, "directory.sqlite"));
  for (const secret of [password, code]) assert.equal(bytes.includes(Buffer.from(secret)), false);
  await unlink(join(path, "rooms.key"));
  assert.throws(() => new Directory(path), /encryption key is missing/);
});

test("credentials are validated and failed login does not create an account", async () => {
  const directory = new Directory();
  try {
    await assert.rejects(directory.authenticate({ username: "a", password }, true), /3–32/);
    await assert.rejects(
      directory.authenticate({ username: "alice", password: "ab" }, true),
      /3–128/,
    );
    await assert.rejects(
      directory.authenticate({ username: "alice", password }, false),
      /Incorrect/,
    );
    const user = await directory.authenticate({ username: "alice", password }, true);
    await assert.rejects(
      directory.authenticate({ username: "ALICE", password }, true),
      /already registered/,
    );
    await assert.rejects(
      directory.authenticate({ username: "alice", password: "wrong password" }, false),
      /Incorrect/,
    );
    assert.throws(() => directory.user("invalid"), /Sign in/);
    assert.throws(() => directory.save(user.user, { code: "bad" }, true), /invitation/);
    assert.throws(() => directory.save(user.user, { code, host: "bad/host" }, true), /relay/);
    directory.save(user.user, { code }, true);
    assert.throws(() => directory.save(user.user, { code }, true), /already exists/);
  } finally {
    directory.close();
  }
});

test("HTTP directory requires a session, rejects foreign origins and shares invitations only with members", async () => {
  const service = createService({ origin: "https://test.invalid" });
  service.server.listen(0, "127.0.0.1");
  await once(service.server, "listening");
  onTestFinished(() => service.close());
  const base = `http://127.0.0.1:${(service.server.address() as AddressInfo).port}`;
  const request = (path: string, method = "GET", body?: unknown, token?: string, origin?: string) =>
    fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  assert.equal((await request("/api/rooms")).status, 401);
  assert.equal(
    (
      await request(
        "/api/accounts/register",
        "POST",
        { username: "alice", password },
        undefined,
        "https://foreign.invalid",
      )
    ).status,
    403,
  );
  const alice = (await (
    await request("/api/accounts/register", "POST", { username: "alice", password })
  ).json()) as SavedAccount;
  const bob = (await (
    await request("/api/accounts/register", "POST", { username: "bob", password })
  ).json()) as SavedAccount;
  const created = (await (
    await request("/api/rooms", "POST", { code, name: "Persistent" }, alice.token)
  ).json()) as { rooms: SavedRoom[]; selected: string };
  assert.equal(created.rooms.length, 1);
  assert.equal(created.selected, created.rooms[0].id);
  assert.equal(
    (await request(`/api/rooms/${created.selected}`, "PATCH", { name: "No" }, bob.token)).status,
    403,
  );
  await request(
    `/api/rooms/${created.selected}/invitations`,
    "POST",
    { username: "bob" },
    alice.token,
  );
  const pending = (await (await request("/api/rooms", "GET", undefined, bob.token)).json()) as {
    rooms: SavedRoom[];
    invitations: { id: string }[];
  };
  assert.equal(pending.rooms.length, 0);
  assert.equal(pending.invitations.length, 1);
  assert.equal(
    (await request(`/api/invitations/${pending.invitations[0].id}/accept`, "POST", {}, alice.token))
      .status,
    404,
  );
  const joined = (await (
    await request(`/api/invitations/${pending.invitations[0].id}/accept`, "POST", {}, bob.token)
  ).json()) as {
    rooms: SavedRoom[];
  };
  assert.equal(joined.rooms[0].code, code);
  assert.equal(joined.rooms[0].name, "Persistent");
  assert.equal((await request("/api/rooms/accept", "POST", { code }, bob.token)).status, 200);
  await request("/api/accounts/logout", "POST", {}, bob.token);
  assert.equal((await request("/api/rooms", "GET", undefined, bob.token)).status, 401);
  assert.equal((await request("/directory.sqlite")).status, 404);
});

test("three-character passwords accept spaces and Unicode; declined invitations survive restart without membership", async () => {
  const path = await mkdtemp(join(tmpdir(), "share-stream-pending-"));
  onTestFinished(() => rm(path, { recursive: true, force: true }));
  let directory = new Directory(path);
  try {
    const owner = await directory.authenticate({ username: "short_owner", password: "123" }, true);
    const guest = await directory.authenticate({ username: "short_guest", password: "   " }, true);
    const unicode = await directory.authenticate(
      { username: "unicode_guest", password: "🎹声🙂" },
      true,
    );
    assert.equal(
      (await directory.authenticate({ username: "unicode_guest", password: "🎹声🙂" }, false)).user
        .id,
      unicode.user.id,
    );
    const id = directory.save(owner.user, { code, name: "Pending mix" }, true);
    directory.manage(owner.user, id, { username: guest.user.username }, true);
    const invitation = directory.invitations(guest.user)[0];
    directory.close();
    directory = new Directory(path);
    assert.equal(directory.invitations(guest.user)[0].id, invitation.id);
    assert.equal(directory.rooms(guest.user).length, 0);
    directory.respondToInvitation(guest.user, invitation.id, false);
    assert.equal(directory.rooms(guest.user).length, 0);
    assert.equal(directory.invitations(guest.user).length, 0);
    assert.throws(
      () => directory.respondToInvitation(guest.user, invitation.id, true),
      /no longer/,
    );
  } finally {
    directory.close();
  }
});

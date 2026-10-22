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
    directory.manage(owner.user, id, { name: "Album sessions" }, false);
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
    directory.manage(owner.user, id, { username: "guest" }, true);
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
      directory.authenticate({ username: "alice", password: "short" }, true),
      /10–128/,
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
  const joined = (await (await request("/api/rooms", "GET", undefined, bob.token)).json()) as {
    rooms: SavedRoom[];
  };
  assert.equal(joined.rooms[0].code, code);
  assert.equal(joined.rooms[0].name, "Persistent");
  assert.equal((await request("/api/rooms/accept", "POST", { code }, bob.token)).status, 200);
  await request("/api/accounts/logout", "POST", {}, bob.token);
  assert.equal((await request("/api/rooms", "GET", undefined, bob.token)).status, 401);
  assert.equal((await request("/directory.sqlite")).status, 404);
});

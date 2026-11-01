import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesktopDirectory, permittedRequest, serverOrigin } from "../src/directory.js";

test("the desktop bridge only accepts account operations and HTTPS or local test servers", () => {
  assert.equal(
    serverOrigin("https://stream.whitesquirrel.digital/path"),
    "https://stream.whitesquirrel.digital",
  );
  assert.equal(serverOrigin("http://127.0.0.1:4000"), "http://127.0.0.1:4000");
  for (const origin of [
    "http://stream.whitesquirrel.digital",
    "file:///etc/passwd",
    "https://user:secret@server.invalid",
  ])
    assert.throws(() => serverOrigin(origin));
  assert.equal(permittedRequest("/api/rooms", "POST"), true);
  assert.equal(permittedRequest(`/api/invitations/${"a".repeat(32)}/accept`, "POST"), true);
  for (const path of [
    "https://other.invalid/api/rooms",
    "/api/rooms/../secret",
    "/api/rooms?token=secret",
    "/api/presence",
    "/directory.sqlite",
  ])
    assert.equal(permittedRequest(path, "GET"), false);
  assert.equal(permittedRequest("/api/rooms", "DELETE"), false);
});

test("live account switches redact credentials and discard replies from the previous account", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "share-stream-model-"));
  const file = join(temporary, "accounts.json");
  const originalFetch = globalThis.fetch;
  const alice = {
    user: { id: "a".repeat(32), username: "alice", name: "Alice" },
    token: "c".repeat(64),
  };
  const bob = { user: { id: "b".repeat(32), username: "bob", name: "Bob" }, token: "d".repeat(64) };
  const save = (active: string) =>
    writeFile(file, JSON.stringify({ accounts: [alice, bob], active }));
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  globalThis.fetch = async () => {
    requested();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return Response.json({ rooms: [{ id: "private-alice-room" }], invitations: [] });
  };
  try {
    await save(alice.user.id);
    const directory = new DesktopDirectory("https://server.invalid", file, async () => undefined);
    const pending = directory.poll(true);
    await started;
    assert.equal(directory.model.active, alice.user.id);
    assert.equal(JSON.stringify(directory.model).includes(alice.token), false);
    await save(bob.user.id);
    await directory.refreshLocal();
    assert.equal(directory.model.active, bob.user.id);
    release();
    await pending;
    assert.deepEqual(directory.model.rooms, []);
    assert.equal(JSON.stringify(directory.model).includes(bob.token), false);
    await assert.rejects(
      directory.request("/api/rooms", "POST", { name: "x".repeat(5000) }),
      /not available/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    await rm(temporary, { recursive: true, force: true });
  }
});

test("a native launch restores the same participant without exposing extra stored fields", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "share-stream-launch-"));
  const file = join(temporary, "accounts.json");
  const room = {
    code: "1".repeat(32),
    host: "stream.whitesquirrel.digital",
    port: 48100,
    participant: "2".repeat(32),
    roomName: "Mix",
  };
  try {
    await writeFile(
      file,
      JSON.stringify({ accounts: [], launch: { ...room, id: "once", private: "do-not-expose" } }),
    );
    const directory = new DesktopDirectory("https://server.invalid", file, async () => undefined);
    let launches = 0;
    directory.on("launch", () => launches++);
    await directory.poll();
    await directory.poll();
    assert.equal(directory.model.launch?.code, room.code);
    assert.equal(directory.model.launch?.participant, room.participant);
    assert.equal(JSON.stringify(directory.model).includes("do-not-expose"), false);
    assert.equal(launches, 1);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

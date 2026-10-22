import { createService } from "../web/dist/server/service.js";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "share-stream-native-directory-"));
const password = randomBytes(16).toString("hex");
const service = createService({ dataDir: join(data, "server") });
await new Promise(resolve => service.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${service.server.address().port}`;
const register = async username => {
  const response = await fetch(base + "/api/accounts/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return response.json();
};
try {
  await register("native_alice");
  const bob = await register("native_bob");
  const probe = spawn(process.argv[2] || "build-tests/processor_tests_artefacts/Release/processor_tests", ["--directory-probe", "native_alice", "native_bob"], {
    env: { ...process.env, SHARE_STREAM_DIRECTORY_URL: base, SHARE_STREAM_PRESENCE_URL: base + "/api/presence", SHARE_STREAM_ACCOUNT_FILE: join(data, "native", "accounts.json"), SHARE_STREAM_TEST_PASSWORD: password, SHARE_STREAM_TEST_SNAPSHOT: "/tmp/share-stream-native-rooms.png" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const status = await new Promise((resolve, reject) => { probe.once("error", reject); probe.once("exit", resolve); });
  assert.equal(status, 0, "native directory probe");
  const response = await fetch(base + "/api/rooms", { headers: { Authorization: `Bearer ${bob.token}` } });
  const { rooms } = await response.json();
  assert.equal(rooms.length, 1);
  assert.equal(rooms[0].name, "Native renamed");
  assert.equal(rooms[0].owner, false);
  console.log("PASS: native invitations remain available through the browser API after native logout");
} finally {
  await service.close();
  await rm(data, { recursive: true, force: true });
}

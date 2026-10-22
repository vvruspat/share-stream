import { createService } from "../web/dist/server/service.js";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const data = await mkdtemp(join(tmpdir(), "share-stream-native-directory-"));
const password = randomBytes(16).toString("hex");
const service = createService({ dataDir: join(data, "server") });
await new Promise(resolve => service.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${service.server.address().port}`;
const handoffFile = join(data, "handoff.json");
const handoffAck = join(data, "handoff-complete");
const origin = "http://localhost:48101";
async function checkHandoff() {
  let native;
  for (let attempt = 0; attempt < 600; ++attempt) {
    try {
      native = JSON.parse(await readFile(handoffFile, "utf8"));
      break;
    } catch (error) {
      if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  assert.ok(native, "native client produced a browser handoff");
  const url = new URL(native.url);
  assert.equal(url.pathname, "/connect");
  const fragment = new URLSearchParams(url.hash.slice(1));
  const ticket = fragment.get("handoff");
  assert.ok(/^[a-f0-9]{64}$/.test(ticket), "URL carries a short-lived handoff ticket");
  assert.equal([...fragment.keys()].join(","), "handoff", "no native account or participant token in URL");
  let cookie = "", csrf = "";
  async function browser(path, body, accountId) {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(csrf ? { "X-CSRF-Token": csrf } : {}),
        ...(accountId ? { "X-ShareStream-Account": accountId } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value = await response.json();
    assert.equal(response.status, 200, `browser request ${path} succeeds`);
    const nextCookie = response.headers.get("set-cookie");
    if (nextCookie) {
      assert.ok(nextCookie.includes("HttpOnly"), "browser credential is inaccessible to JavaScript");
      cookie = nextCookie.split(";")[0];
    }
    if (value.csrf) csrf = value.csrf;
    assert.equal("token" in value, false, "browser never receives an account bearer in JSON");
    return value;
  }
  assert.equal((await browser("/api/browser/session")).accounts.length, 0);
  const pending = await browser("/api/browser/handoffs/prepare", { ticket });
  assert.equal(pending.user.username, native.username);
  assert.equal(pending.confirmationRequired, true, "first browser link needs explicit identity confirmation");
  assert.equal((await browser("/api/browser/session")).accounts.length, 0, "preparation does not sign in");
  const signedIn = await browser("/api/browser/handoffs/confirm", { handoffId: pending.handoffId });
  assert.equal(signedIn.selected, native.roomId);
  const saved = signedIn.rooms.find(room => room.id === native.roomId);
  assert.ok(saved && saved.participant === native.participant, "native and browser share one participant identity");
  const listed = await browser("/api/rooms", undefined, signedIn.user.id);
  assert.ok(listed.rooms.some(room => room.id === native.roomId), "browser cookie can access the saved room");
  await writeFile(handoffAck, "verified");
  console.log("PASS: native one-use handoff signs browser into the same room and participant through HttpOnly cookie");
}
const register = async username => {
  const response = await fetch(base + "/api/accounts/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return response.json();
};
try {
  await register("native_alice");
  const bob = await register("native_bob");
  const probe = spawn(process.argv[2] || "build-tests/processor_tests_artefacts/Release/processor_tests", ["--directory-probe", "native_alice", "native_bob"], {
    env: { ...process.env, SHARE_STREAM_DIRECTORY_URL: base, SHARE_STREAM_PRESENCE_URL: base + "/api/presence", SHARE_STREAM_ACCOUNT_FILE: join(data, "native", "accounts.json"), SHARE_STREAM_TEST_PASSWORD: password, SHARE_STREAM_TEST_SNAPSHOT: "/tmp/share-stream-native-rooms.png", SHARE_STREAM_TEST_HANDOFF: handoffFile, SHARE_STREAM_TEST_HANDOFF_ACK: handoffAck },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const completion = new Promise((resolve, reject) => { probe.once("error", reject); probe.once("exit", resolve); });
  let status;
  try {
    [status] = await Promise.all([completion, checkHandoff()]);
  } catch (error) {
    probe.kill();
    await completion;
    throw error;
  }
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

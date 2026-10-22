import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { PresenceRegistry, participantId } from "../server/presence.js";
import type { PresenceUpdate } from "../shared/presence.js";
const token = "a".repeat(32),
  room = "b".repeat(64);
const plugin: PresenceUpdate = { room, token, source: "plugin", connected: true, music: "sending" };
test("plugin and browser share one stable participant identity, without leaking the credential", () => {
  const registry = new PresenceRegistry();
  registry.update(plugin);
  const people = registry.update({
    room,
    token,
    source: "browser",
    connected: true,
    mic: true,
    speaking: true,
    name: "Alex",
  });
  assert.equal(people.length, 1);
  assert.deepEqual(people[0], {
    id: participantId(token),
    name: "Alex",
    music: "sending",
    browser: true,
    mic: true,
    speaking: true,
  });
  assert.ok(!JSON.stringify(people).includes(token));
  const other = registry.update({ ...plugin, token: "c".repeat(32), music: "listening" });
  assert.equal(other.length, 2);
  for (let i = 1; i <= 6; i++)
    registry.update({ ...plugin, token: i.toString(16).padStart(32, "0") });
  assert.throws(() => registry.update({ ...plugin, token: "d".repeat(32) }), /eight participants/);
});
test("each source leaves independently; voice-only and expired participants reflect real presence", () => {
  let now = 100000;
  const registry = new PresenceRegistry(() => now);
  registry.update(plugin);
  registry.update({ room, token, source: "browser", connected: true, mic: true });
  let people = registry.update({ ...plugin, connected: false });
  assert.equal(people.length, 1);
  assert.equal(people[0].music, null);
  assert.equal(people[0].browser, true);
  now += 9000;
  people = registry.update({ ...plugin, token: "c".repeat(32), music: "listening" });
  assert.equal(people.length, 1);
  assert.equal(people[0].id, participantId("c".repeat(32)));
  assert.deepEqual(registry.update({ ...plugin, token: "c".repeat(32), connected: false }), []);
});
test("names never merge identities, muted people cannot be Speaking, rooms stay separate", () => {
  const registry = new PresenceRegistry();
  registry.update({
    room,
    token,
    source: "browser",
    connected: true,
    name: "Same",
    mic: false,
    speaking: true,
  });
  const people = registry.update({
    room,
    token: "c".repeat(32),
    source: "browser",
    connected: true,
    name: "Same",
  });
  assert.equal(people.length, 2);
  assert.notEqual(people[0].id, people[1].id);
  assert.equal(people[0].speaking, false);
  assert.deepEqual(registry.update({ ...plugin, room: "e".repeat(64), connected: false }), []);
});
test("invalid credentials, oversized names and malformed telemetry are rejected", () => {
  const registry = new PresenceRegistry();
  for (const patch of [
    { token: "short" },
    { room: "room" },
    { source: "other" },
    { mic: "yes" },
    { name: "n".repeat(61) },
    { music: "fake" },
  ])
    assert.throws(() => registry.update({ ...plugin, ...patch }));
});

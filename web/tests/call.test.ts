import { test, onTestFinished } from "vite-plus/test";
import type { IncomingSignal, RemoteMedia } from "../shared/protocol.js";
import assert from "node:assert/strict";
import { Call } from "../src/call/Call.js";
import { roomKeys, seal } from "../src/call/crypto.js";

test("leaving while room keys are derived cannot reopen the connection", async () => {
  const call = new Call({ url: "ws://unused" });
  let opened = false;
  call.open = () => {
    opened = true;
  };
  const pending = call.join("1".repeat(32));
  call.leave();
  await pending;
  assert.equal(opened, false);
  assert.equal(call.active, false);
});

test("client rejects replay and a forged high sequence cannot suppress a valid message", async () => {
  const call = new Call({ url: "ws://unused" });
  call.keys = await roomKeys("1".repeat(32));
  call.peer = "2".repeat(32);
  const events: Partial<RemoteMedia>[] = [];
  call.on("remoteState", (detail) => events.push(detail));
  const packet = async (seq: number): Promise<IncomingSignal> => ({
    ...(await seal(call.keys.key, call.keys.room, call.peer!, call.id, "control", seq, {
      type: "media",
      mic: true,
      screen: false,
    })),
    from: call.peer!,
  });
  const first = await packet(1);
  await call.message(first);
  await call.message(first);
  assert.equal(events.length, 1);
  await call.message({ ...(await packet(100)), data: "A".repeat(24) });
  await call.message(await packet(2));
  assert.equal(events.length, 2);
});

test("leaving during a pending microphone permission cannot restart capture", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let accept!: (stream: MediaStream) => void;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () =>
          new Promise<MediaStream>((resolve) => {
            accept = resolve;
          }),
        getSupportedConstraints: () => ({}),
      },
    },
  });
  onTestFinished(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  const call = new Call({ url: "ws://unused" });
  call.active = true;
  const pending = call.microphone();
  await new Promise((resolve) => setImmediate(resolve));
  call.leave();
  let stopped = false;
  accept({
    getTracks: () => [
      {
        stop: () => {
          stopped = true;
        },
      },
    ],
  } as unknown as MediaStream);
  await pending;
  assert.equal(stopped, true);
  assert.equal(call.micStream, null);
  assert.equal(call.micBusy, false);
});

test("headphone capture rejects processing-on settings and releases the stream", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let stopped = false;
  const track = {
    enabled: true,
    getSettings: () => ({ echoCancellation: true }),
    stop: () => {
      stopped = true;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }),
        getSupportedConstraints: () => ({}),
      },
    },
  });
  onTestFinished(() => {
    if (original) Object.defineProperty(globalThis, "navigator", original);
    else Reflect.deleteProperty(globalThis, "navigator");
  });
  const call = new Call({ url: "ws://unused" });
  call.active = true;
  await assert.rejects(call.microphone(), /kept voice processing enabled/);
  assert.equal(stopped, true);
  assert.equal(call.micStream, null);
  assert.equal(call.micBusy, false);
});

test("group replay protection is independent for each encrypted sender", async () => {
  const call = new Call({ url: "ws://unused" });
  call.keys = await roomKeys("1".repeat(32));
  const peers = ["2".repeat(32), "3".repeat(32)];
  peers.forEach((id) => call.members.add(id));
  const messages: string[] = [];
  call.on("remoteState", (state) => {
    if (state.peer) messages.push(state.peer);
  });
  const packet = async (peer: string, seq: number): Promise<IncomingSignal> => ({
    ...(await seal(call.keys.key, call.keys.room, peer, call.id, "control", seq, {
      type: "media",
      mic: true,
      screen: false,
    })),
    from: peer,
  });
  for (const peer of peers) await call.message(await packet(peer, 1));
  assert.deepEqual(messages, peers);
  await call.message(await packet(peers[0], 1));
  assert.equal(messages.length, 2);
  await call.message({ ...(await packet(peers[0], 20)), from: peers[1] });
  await call.message(await packet(peers[1], 2));
  assert.equal(messages.length, 3);
  call.dropPeer(peers[0]);
  assert.equal(call.members.has(peers[1]), true);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { Call } from '../public/call.js';
import { roomKeys, seal } from '../public/crypto.js';

test('client rejects replay and a forged high sequence cannot suppress a valid message', async () => {
  const call = new Call({ url: 'ws://unused' });
  call.keys = await roomKeys('1'.repeat(32)); call.peer = '2'.repeat(32);
  const events = []; call.addEventListener('remoteState', e => events.push(e.detail));
  const packet = async seq => ({ ...await seal(call.keys.key, call.keys.room, call.peer, call.id, 'control', seq, { type: 'media', mic: true, screen: false }), from: call.peer });
  const first = await packet(1); await call.message(first); await call.message(first);
  assert.equal(events.length, 1);
  await call.message({ ...await packet(100), data: 'A'.repeat(24) });
  await call.message(await packet(2)); assert.equal(events.length, 2);
});

test('leaving during a pending microphone permission cannot restart capture', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let accept;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: () => new Promise(resolve => { accept = resolve; }), getSupportedConstraints: () => ({})
  } } });
  t.after(() => Object.defineProperty(globalThis, 'navigator', original));
  const call = new Call({ url: 'ws://unused' }); call.active = true;
  const pending = call.microphone();
  await new Promise(resolve => setImmediate(resolve));
  call.leave();
  let stopped = false;
  accept({ getTracks: () => [{ stop: () => { stopped = true; } }] });
  await pending;
  assert.equal(stopped, true); assert.equal(call.micStream, null); assert.equal(call.micBusy, false);
});

test('headphone capture rejects processing-on settings and releases the stream', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let stopped = false;
  const track = { enabled: true, getSettings: () => ({ echoCancellation: true }), stop: () => { stopped = true; } };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
    getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }), getSupportedConstraints: () => ({})
  } } });
  t.after(() => Object.defineProperty(globalThis, 'navigator', original));
  const call = new Call({ url: 'ws://unused' }); call.active = true;
  await assert.rejects(call.microphone(), /kept voice processing enabled/);
  assert.equal(stopped, true); assert.equal(call.micStream, null); assert.equal(call.micBusy, false);
});

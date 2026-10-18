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

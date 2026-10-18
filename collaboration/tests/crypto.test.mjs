import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInvite, roomKeys, seal, unseal } from '../public/crypto.js';
const code = '0123456789abcdef0123456789abcdef';
test('native invitation, browser fragment and raw room code interoperate', () => {
  assert.equal(parseInvite(`sharestream://13.140.153.191:48100/${code}`), code);
  assert.equal(parseInvite(`https://stream.whitesquirrel.digital/#room=${code}`), code);
  assert.equal(parseInvite(code.toUpperCase()), code);
  assert.throws(() => parseInvite('short')); assert.throws(() => parseInvite('javascript:alert(1)'));
});
test('encrypted signaling binds the room, participants, stream and sequence', async () => {
  const a = await roomKeys(code), b = await roomKeys(code), other = await roomKeys('f'.repeat(32));
  const payload = { description: { type: 'offer', sdp: 'private DTLS fingerprint' } };
  const packet = { ...await seal(a.key, a.room, 'alice', 'bob', 'screen', 1, payload), from: 'alice' };
  assert.deepEqual(await unseal(b.key, b.room, packet), payload);
  assert.ok(!JSON.stringify(packet).includes('private'));
  for (const change of [{ from: 'mallory' }, { to: 'eve' }, { channel: 'voice' }, { seq: 2 }, { data: 'A'.repeat(packet.data.length) }]) await assert.rejects(unseal(b.key, b.room, { ...packet, ...change }));
  await assert.rejects(unseal(other.key, other.room, packet));
  assert.notEqual((await seal(a.key, a.room, 'alice', 'bob', 'screen', 2, payload)).nonce, packet.nonce);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { WebSocket } from 'ws';
import { createService, iceServers } from '../server.mjs';

const origin = 'https://test.invalid';
const id = n => n.toString(16).padStart(32, '0');
const room = n => n.toString(16).padStart(64, '0');
async function fixture(t) {
  const service = createService({ origin, turnSecret: 'test-secret' });
  service.server.listen(0, '127.0.0.1'); await once(service.server, 'listening');
  t.after(() => service.close());
  const url = `ws://127.0.0.1:${service.server.address().port}/signal`;
  async function peer(peerId, roomId = room(1), resume = id(99)) {
    const ws = new WebSocket(url, { origin });
    const messages = []; let waiter;
    ws.on('message', raw => { messages.push(JSON.parse(raw)); waiter?.(); });
    await once(ws, 'open');
    ws.send(JSON.stringify({ type: 'join', id: peerId, resume, room: roomId }));
    const next = async type => {
      const end = Date.now() + 2000;
      while (!messages.some(m => m.type === type)) {
        if (Date.now() > end) throw new Error(`Timeout waiting for ${type}`);
        await new Promise(resolve => { const timer = setTimeout(resolve, 30); waiter = () => { clearTimeout(timer); resolve(); }; });
      }
      return messages.splice(messages.findIndex(m => m.type === type), 1)[0];
    };
    return { ws, messages, next };
  }
  return { ...service, url, peer };
}
test('two-peer rooms relay opaque signals and isolate another room', async t => {
  const f = await fixture(t), a = await f.peer(id(1)), b = await f.peer(id(2)), c = await f.peer(id(3), room(2));
  const welcome = await b.next('welcome'); assert.deepEqual(welcome.peers, [id(1)]);
  assert.equal(welcome.iceServers.length, 2); assert.ok(!JSON.stringify(welcome).includes('test-secret'));
  assert.equal((await a.next('peer')).id, id(2)); await a.next('welcome'); await c.next('welcome');
  a.ws.send(JSON.stringify({ type: 'signal', to: id(2), channel: 'screen', seq: 1, nonce: 'AAAAAAAAAAAAAAAA', data: 'A'.repeat(24) }));
  assert.deepEqual(await b.next('signal'), { type: 'signal', from: id(1), to: id(2), channel: 'screen', seq: 1, nonce: 'AAAAAAAAAAAAAAAA', data: 'A'.repeat(24) });
  a.ws.send(JSON.stringify({ type: 'signal', to: id(3), channel: 'voice', seq: 2, nonce: 'AAAAAAAAAAAAAAAA', data: 'B'.repeat(24) }));
  await new Promise(resolve => setTimeout(resolve, 50)); assert.equal(c.messages.length, 0);
  b.ws.close(); assert.equal((await a.next('left')).id, id(2));
});
test('third peer rejected; resume replaces only the authenticated old session', async t => {
  const f = await fixture(t), a = await f.peer(id(1)), b = await f.peer(id(2));
  await a.next('welcome'); await a.next('peer'); await b.next('welcome');
  const c = await f.peer(id(3)); assert.match((await c.next('error')).message, /two people/);
  const close = once(a.ws, 'close'), replacement = await f.peer(id(1));
  await replacement.next('welcome'); assert.equal((await close)[0], 4001);
  await b.next('left'); await b.next('peer');
  assert.equal(f.rooms.get(room(1)).size, 2);
  const intruder = await f.peer(id(1), room(1), id(88));
  assert.equal((await once(intruder.ws, 'close'))[0], 1008);
  assert.equal(f.rooms.get(room(1)).size, 2);
});
test('wrong origins, malformed joins and signals are rejected', async t => {
  const f = await fixture(t);
  const bad = new WebSocket(f.url, { origin: 'https://evil.invalid' });
  await assert.rejects(once(bad, 'open'), /403/);
  const raw = new WebSocket(f.url, { origin }); await once(raw, 'open');
  raw.send('{'); assert.equal((await once(raw, 'close'))[0], 1008);
  const a = await f.peer(id(1)); await a.next('welcome');
  a.ws.send(JSON.stringify({ type: 'signal', channel: 'music', to: id(2) }));
  assert.equal((await once(a.ws, 'close'))[0], 1008);
});
test('TURN credentials are expiring HMACs and refreshed through joined websocket', async t => {
  const now = 1800000000000, config = iceServers('secret', 'turn.example', id(1), now)[1];
  assert.ok(config.username.startsWith(`${now / 1000 + 3600}:${id(1)}:`));
  assert.notEqual(config.username, iceServers('secret', 'turn.example', id(1), now)[1].username);
  assert.equal(config.credential, createHmac('sha1', 'secret').update(config.username).digest('base64'));
  const f = await fixture(t), a = await f.peer(id(1)); await a.next('welcome');
  a.ws.send('{"type":"refresh"}'); assert.equal((await a.next('ice')).iceServers.length, 2);
});
test('HTTP serves only explicit assets with private-room security headers', async t => {
  const f = await fixture(t), base = f.url.replace('ws:', 'http:').replace('/signal', '');
  const response = await fetch(base); assert.equal(response.status, 200); assert.match(await response.text(), /Voice & screen/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer'); assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/.env')).status, 404); assert.equal((await fetch(base + '/server.mjs')).status, 404);
  assert.deepEqual(await (await fetch(base + '/api/health')).json(), { ok: true, version: '0.2.1' });
});

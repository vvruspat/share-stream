import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const publicDir = new URL('./public/', import.meta.url);
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ...['app.js', 'call.js', 'crypto.js', 'styles.css'].map(name => ['/' + name, [name, name.endsWith('.css') ? 'text/css' : 'text/javascript']])
]);
export function iceServers(secret, host, peer, now = Date.now()) {
  // Distinct allocation identity on every join/renewal, including multiple
  // reconnects within one second. Old allocations must not consume its quota.
  const username = `${Math.floor(now / 1000) + 3600}:${peer}:${randomBytes(8).toString('hex')}`;
  return [{ urls: `stun:${host}:3478` }, ...(secret ? [{
    urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`],
    username, credential: createHmac('sha1', secret).update(username).digest('base64')
  }] : [])];
}
export function createService({ origin = 'http://localhost:48101', turnHost = 'stream.whitesquirrel.digital', turnSecret = '', maxRooms = 64 } = {}) {
  const rooms = new Map(), joins = new Map();
  const headers = {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(self), display-capture=(self)',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  };
  const server = createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, headers).end(); return; }
    if (req.url === '/api/health') { res.writeHead(200, { ...headers, 'Content-Type': 'application/json' }).end('{"ok":true,"version":"0.2.0"}'); return; }
    const file = files.get(req.url);
    if (!file) { res.writeHead(404, headers).end('Not found'); return; }
    try { const data = await readFile(new URL(file[0], publicDir)); res.writeHead(200, { ...headers, 'Content-Type': file[1] }); res.end(req.method === 'HEAD' ? undefined : data); }
    catch { res.writeHead(500, headers).end('Unavailable'); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const send = (ws, data) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data)); };
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/signal' || req.headers.origin !== origin || wss.clients.size >= 256) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    // The reverse proxy owns X-Forwarded-For; the container port is not published.
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    const now = Date.now(), rate = joins.get(ip);
    if (rate && now - rate.start < 60000 && rate.count >= 30) { socket.destroy(); return; }
    joins.set(ip, !rate || now - rate.start >= 60000 ? { start: now, count: 1 } : { ...rate, count: rate.count + 1 });
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    const deadline = setTimeout(() => ws.close(1008, 'Join required'), 10000);
    let room, id, resume, windowStart = Date.now(), count = 0;
    ws.on('message', raw => {
      try {
        if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; }
        if (++count > 120) throw new Error('Rate limit');
        const m = JSON.parse(raw.toString());
        if (!room) {
          if (m.type !== 'join' || !/^[a-f0-9]{64}$/.test(m.room) || !/^[a-f0-9]{32}$/.test(m.id) || !/^[a-f0-9]{32}$/.test(m.resume)) throw new Error('Invalid join');
          let members = rooms.get(m.room);
          if (!members && rooms.size >= maxRooms) { send(ws, { type: 'error', message: 'Service busy. Try again shortly.' }); ws.close(1013); return; }
          const previous = members?.get(m.id);
          if (previous && !timingSafeEqual(Buffer.from(previous.resume), Buffer.from(m.resume))) throw new Error('Invalid session');
          if (!previous && members?.size >= 2) { send(ws, { type: 'error', message: 'This room already has two people.' }); ws.close(4003); return; }
          room = m.room; id = m.id; resume = m.resume;
          if (!members) { members = new Map(); rooms.set(room, members); }
          // Notify before replacing: the remote side discards the old RTC generation.
          if (previous) { for (const [other, entry] of members) if (other !== id) send(entry.ws, { type: 'left', id }); previous.ws.close(4001, 'Session resumed'); }
          members.set(id, { ws, resume }); clearTimeout(deadline);
          send(ws, { type: 'welcome', peers: [...members.keys()].filter(p => p !== id), iceServers: iceServers(turnSecret, turnHost, id) });
          for (const [other, entry] of members) if (other !== id) send(entry.ws, { type: 'peer', id });
          return;
        }
        if (rooms.get(room)?.get(id)?.ws !== ws) return;
        if (m.type === 'refresh') { send(ws, { type: 'ice', iceServers: iceServers(turnSecret, turnHost, id) }); return; }
        if (m.type !== 'signal' || !['voice', 'screen', 'control'].includes(m.channel) || !Number.isSafeInteger(m.seq) || m.seq < 1 || !/^[a-f0-9]{32}$/.test(m.to) || typeof m.nonce !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(m.nonce) || typeof m.data !== 'string' || m.data.length < 24 || m.data.length > 58000 || !/^[A-Za-z0-9+/]+=*$/.test(m.data)) throw new Error('Invalid signal');
        const target = rooms.get(room)?.get(m.to);
        if (target && m.to !== id) send(target.ws, { type: 'signal', from: id, to: m.to, channel: m.channel, seq: m.seq, nonce: m.nonce, data: m.data });
      } catch { ws.close(1008, 'Invalid message'); }
    });
    ws.on('close', () => {
      clearTimeout(deadline);
      const members = rooms.get(room);
      if (members?.get(id)?.ws !== ws) return;
      members.delete(id);
      for (const entry of members.values()) send(entry.ws, { type: 'left', id });
      if (!members.size) rooms.delete(room);
    });
    ws.on('error', () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
    for (const [ip, rate] of joins) if (Date.now() - rate.start > 60000) joins.delete(ip);
  }, 15000);
  return { server, rooms, async close() { clearInterval(heartbeat); for (const ws of wss.clients) ws.terminate(); await new Promise(resolve => wss.close(resolve)); await new Promise(resolve => server.close(resolve)); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const secret = process.env.TURN_SECRET_FILE ? readFileSync(process.env.TURN_SECRET_FILE, 'utf8').trim() : process.env.TURN_SECRET;
  if (process.env.NODE_ENV === 'production' && (!process.env.PUBLIC_ORIGIN?.startsWith('https://') || !secret)) throw new Error('Production requires HTTPS origin and TURN secret');
  const service = createService({ origin: process.env.PUBLIC_ORIGIN, turnSecret: secret, turnHost: process.env.TURN_HOST });
  service.server.listen(Number(process.env.PORT || 48101), '0.0.0.0', () => console.log('Share Stream collaboration listening'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await service.close(); process.exit(0); });
}

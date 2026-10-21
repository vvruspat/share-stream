import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { PresenceRegistry } from "./presence.js";
import {
  WEB_VERSION,
  SIGNAL_VERSION,
  type IceServer,
  type JoinFrame,
  type EncryptedSignal,
  type ServerFrame,
} from "../shared/protocol.js";

export function iceServers(
  secret: string,
  host: string,
  peer: string,
  now = Date.now(),
): IceServer[] {
  const username = `${Math.floor(now / 1000) + 3600}:${peer}:${randomBytes(8).toString("hex")}`;
  return [
    { urls: `stun:${host}:3478` },
    ...(secret
      ? [
          {
            urls: [`turn:${host}:3478?transport=udp`, `turn:${host}:3478?transport=tcp`],
            username,
            credential: createHmac("sha1", secret).update(username).digest("base64"),
          },
        ]
      : []),
  ];
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
function isJoin(m: unknown): m is JoinFrame {
  return (
    record(m) &&
    m.type === "join" &&
    m.version === SIGNAL_VERSION &&
    typeof m.room === "string" &&
    /^[a-f0-9]{64}$/.test(m.room) &&
    typeof m.id === "string" &&
    /^[a-f0-9]{32}$/.test(m.id) &&
    typeof m.resume === "string" &&
    /^[a-f0-9]{32}$/.test(m.resume)
  );
}
function isSignal(m: unknown): m is EncryptedSignal {
  return (
    record(m) &&
    m.type === "signal" &&
    typeof m.channel === "string" &&
    ["voice", "screen", "control"].includes(m.channel) &&
    typeof m.seq === "number" &&
    Number.isSafeInteger(m.seq) &&
    m.seq >= 1 &&
    typeof m.to === "string" &&
    /^[a-f0-9]{32}$/.test(m.to) &&
    typeof m.nonce === "string" &&
    /^[A-Za-z0-9+/]{16}$/.test(m.nonce) &&
    typeof m.data === "string" &&
    m.data.length >= 24 &&
    m.data.length <= 58000 &&
    /^[A-Za-z0-9+/]+=*$/.test(m.data)
  );
}
interface ServiceOptions {
  origin?: string | readonly string[];
  turnHost?: string;
  turnSecret?: string;
  maxRooms?: number;
  clientDir?: string;
}
interface Member {
  ws: WebSocket;
  resume: string;
}
export function createService({
  origin = "http://localhost:48101",
  turnHost = "stream.whitesquirrel.digital",
  turnSecret = "",
  maxRooms = 64,
  clientDir = resolve("dist/client"),
}: ServiceOptions = {}) {
  const rooms = new Map<string, Map<string, Member>>(),
    joins = new Map<string, { start: number; count: number }>();
  const presence = new PresenceRegistry(Date.now, maxRooms);
  const presenceRates = new Map<string, { start: number; count: number }>();
  const headers = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(self), display-capture=(self)",
    "Content-Security-Policy":
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  };
  const server = createServer(async (req, res) => {
    if (req.url === "/api/presence" && req.method === "POST") {
      const allowed = typeof origin === "string" ? [origin] : origin;
      if (req.headers.origin && !allowed.includes(req.headers.origin)) {
        res.writeHead(403, headers).end();
        return;
      }
      const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
        .split(",")[0]
        .trim();
      const now = Date.now(),
        previous = presenceRates.get(ip);
      const rate = !previous || now - previous.start > 10000 ? { start: now, count: 0 } : previous;
      presenceRates.set(ip, rate);
      if (++rate.count > 100) {
        res.writeHead(429, headers).end();
        return;
      }
      try {
        req.setEncoding("utf8");
        let body = "";
        for await (const chunk of req) {
          body += String(chunk);
          if (body.length > 2048) throw new Error("Request too large");
        }
        const participants = presence.update(JSON.parse(body));
        res
          .writeHead(200, { ...headers, "Content-Type": "application/json" })
          .end(JSON.stringify({ participants }));
      } catch {
        res.writeHead(400, headers).end("Participant information unavailable");
      }
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, headers).end();
      return;
    }
    if (req.url === "/api/health") {
      res.writeHead(200, { ...headers, "Content-Type": "application/json" }).end(
        JSON.stringify({
          ok: true,
          version: WEB_VERSION,
          ...(process.env.SHARE_STREAM_REVISION
            ? { revision: process.env.SHARE_STREAM_REVISION }
            : {}),
        }),
      );
      return;
    }
    // Only built frontend assets are public. Source, configuration, credentials,
    // and arbitrary filesystem paths never fall through to the SPA document.
    const path = req.url?.split("?")[0] || "/";
    const isAsset = /^\/assets\/[A-Za-z0-9_.-]+\.(js|css|svg|woff2?)$/.test(path);
    if (path !== "/" && !isAsset) {
      res.writeHead(404, headers).end("Not found");
      return;
    }
    const filename = path === "/" ? "index.html" : path.slice(1);
    const contentType = filename.endsWith(".js")
      ? "text/javascript"
      : filename.endsWith(".css")
        ? "text/css"
        : filename.endsWith(".svg")
          ? "image/svg+xml"
          : filename.endsWith(".woff2")
            ? "font/woff2"
            : "text/html; charset=utf-8";
    try {
      const data = await readFile(join(clientDir, filename));
      res.writeHead(200, {
        ...headers,
        "Content-Type": contentType,
        ...(isAsset ? { "Cache-Control": "public, max-age=31536000, immutable" } : {}),
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      res.writeHead(404, headers).end("Not found");
    }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const alive = new WeakSet<WebSocket>();
  const send = (ws: WebSocket, data: ServerFrame) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  };
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/signal" ||
      !(typeof origin === "string" ? [origin] : origin).includes(req.headers.origin || "") ||
      wss.clients.size >= 256
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress)
      .split(",")[0]
      .trim();
    const now = Date.now(),
      rate = joins.get(ip);
    if (rate && now - rate.start < 60000 && rate.count >= 30) {
      socket.destroy();
      return;
    }
    joins.set(
      ip,
      !rate || now - rate.start >= 60000
        ? { start: now, count: 1 }
        : { ...rate, count: rate.count + 1 },
    );
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws: WebSocket) => {
    alive.add(ws);
    ws.on("pong", () => {
      alive.add(ws);
    });
    const deadline = setTimeout(() => ws.close(1008, "Join required"), 10000);
    let room: string | undefined,
      id: string | undefined,
      windowStart = Date.now(),
      count = 0;
    ws.on("message", (raw) => {
      try {
        if (Date.now() - windowStart > 1000) {
          windowStart = Date.now();
          count = 0;
        }
        if (++count > 120) throw new Error("Rate limit");
        const m: unknown = JSON.parse(
          (Buffer.isBuffer(raw)
            ? raw
            : Array.isArray(raw)
              ? Buffer.concat(raw)
              : Buffer.from(raw)
          ).toString("utf8"),
        );
        if (!room) {
          if (record(m) && m.type === "join" && m.version !== SIGNAL_VERSION) {
            send(ws, {
              type: "error",
              message: "Chat has been updated. Reload this page to reconnect.",
            });
            ws.close(1008, "Chat update required");
            return;
          }
          if (!isJoin(m)) throw new Error("Invalid join");
          let members = rooms.get(m.room);
          if (!members && rooms.size >= maxRooms) {
            send(ws, { type: "error", message: "Service busy. Try again shortly." });
            ws.close(1013);
            return;
          }
          const sameCredential = (entry: Member) =>
            timingSafeEqual(Buffer.from(entry.resume), Buffer.from(m.resume));
          if (members?.has(m.id) && !sameCredential(members.get(m.id)!))
            throw new Error("Invalid session");
          // A fresh tab has a fresh signaling ID (and encryption sequence), but
          // authenticates with the same private participant credential. Replace
          // its old transport rather than consuming the partner's room slot.
          const previous = members && [...members].find(([, entry]) => sameCredential(entry));
          if (!previous && members && members.size >= 2) {
            send(ws, { type: "error", message: "This room already has two people." });
            ws.close(4003);
            return;
          }
          room = m.room;
          id = m.id;
          if (!members) {
            members = new Map();
            rooms.set(room, members);
          }
          if (previous) {
            const [previousId, entry] = previous;
            for (const [other, entry] of members)
              if (other !== previousId) send(entry.ws, { type: "left", id: previousId });
            members.delete(previousId);
            entry.ws.close(4001, "Session resumed");
          }
          members.set(id, { ws, resume: m.resume });
          clearTimeout(deadline);
          send(ws, {
            type: "welcome",
            peers: [...members.keys()].filter((p) => p !== id),
            iceServers: iceServers(turnSecret, turnHost, id),
          });
          for (const [other, entry] of members)
            if (other !== id) send(entry.ws, { type: "peer", id });
          return;
        }
        if (!id || rooms.get(room)?.get(id)?.ws !== ws) return;
        if (record(m) && m.type === "refresh") {
          send(ws, { type: "ice", iceServers: iceServers(turnSecret, turnHost, id) });
          return;
        }
        if (!isSignal(m)) throw new Error("Invalid signal");
        const target = rooms.get(room)?.get(m.to);
        if (target && m.to !== id)
          send(target.ws, {
            type: "signal",
            from: id,
            to: m.to,
            channel: m.channel,
            seq: m.seq,
            nonce: m.nonce,
            data: m.data,
          });
      } catch {
        ws.close(1008, "Invalid message");
      }
    });
    ws.on("close", () => {
      clearTimeout(deadline);
      if (!room || !id) return;
      const members = rooms.get(room);
      if (members?.get(id)?.ws !== ws) return;
      members.delete(id);
      for (const entry of members.values()) send(entry.ws, { type: "left", id });
      if (!members.size) rooms.delete(room);
    });
    ws.on("error", () => {});
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) ws.terminate();
      else {
        alive.delete(ws);
        ws.ping();
      }
    }
    for (const [ip, rate] of joins) if (Date.now() - rate.start > 60000) joins.delete(ip);
    for (const [ip, rate] of presenceRates)
      if (Date.now() - rate.start > 10000) presenceRates.delete(ip);
    presence.prune();
  }, 15000);
  return {
    server,
    rooms,
    async close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

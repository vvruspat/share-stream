import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  randomBytes,
  createHash,
  scrypt as derive,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { promisify } from "node:util";
import type { Account, SavedRoom } from "../shared/directory.js";

const scrypt = promisify(derive);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const random = () => randomBytes(16).toString("hex");
export class DirectoryError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new DirectoryError("Check the required fields.");
  return value.trim();
}
function credentials(body: Record<string, unknown>) {
  const username = text(body.username, 32).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username))
    throw new DirectoryError(
      "Use 3–32 letters, numbers, dots, underscores or hyphens for the username.",
    );
  if (typeof body.password !== "string" || body.password.length < 10 || body.password.length > 128)
    throw new DirectoryError("Use a password of 10–128 characters.");
  return { username, password: body.password };
}
type Row = Record<string, string | number | null | Uint8Array>;
const account = (row: Row): Account => ({
  id: String(row.id),
  username: String(row.username),
  name: String(row.name),
});

// Transport sessions remain ephemeral. Accounts and room membership have their
// own lifetime and survive an empty room, process restart and container rebuild.
export class Directory {
  private db: DatabaseSync;
  private key: Buffer;
  private hashing = 0;
  constructor(directory?: string) {
    if (directory) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      const keyPath = join(directory, "rooms.key");
      if (!existsSync(keyPath)) {
        if (existsSync(join(directory, "directory.sqlite")))
          throw new Error(
            "Room encryption key is missing. Restore rooms.key from the same backup as directory.sqlite.",
          );
        try {
          writeFileSync(keyPath, randomBytes(32), { flag: "wx", mode: 0o600 });
        } catch (error) {
          if (!existsSync(keyPath)) throw error;
        }
      }
      this.key = readFileSync(keyPath);
    } else this.key = randomBytes(32);
    if (this.key.length !== 32) throw new Error("Invalid room encryption key");
    this.db = new DatabaseSync(directory ? join(directory, "directory.sqlite") : ":memory:");
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, salt TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS saved_rooms (id TEXT PRIMARY KEY, name TEXT NOT NULL, secret TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL, owner_id TEXT NOT NULL REFERENCES users(id));
      CREATE TABLE IF NOT EXISTS members (room_id TEXT NOT NULL REFERENCES saved_rooms(id), user_id TEXT NOT NULL REFERENCES users(id), participant TEXT NOT NULL, PRIMARY KEY(room_id, user_id));
    `);
  }
  private seal(code: string) {
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    const data = Buffer.concat([cipher.update(code, "utf8"), cipher.final()]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
  }
  private open(secret: string) {
    const bytes = Buffer.from(secret, "base64"),
      decipher = createDecipheriv("aes-256-gcm", this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
  }
  async authenticate(body: Record<string, unknown>, register: boolean) {
    const { username, password } = credentials(body);
    if (this.hashing >= 4) throw new DirectoryError("Sign-in is busy. Try again shortly.", 429);
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as
      | Row
      | undefined;
    const salt = register ? random() : String(row?.salt || "missing-account");
    this.hashing++;
    let derived: Buffer;
    try {
      derived = (await scrypt(password, salt, 64)) as Buffer;
    } finally {
      this.hashing--;
    }
    let user: Account;
    if (register) {
      if (row) throw new DirectoryError("That username is already registered.", 409);
      if (Number(this.db.prepare("SELECT count(*) AS n FROM users").get()!.n) >= 10000)
        throw new DirectoryError("Account registration is full.", 503);
      user = { id: random(), username, name: text(body.name || username, 60) };
      try {
        this.db
          .prepare("INSERT INTO users VALUES (?, ?, ?, ?, ?)")
          .run(user.id, username, user.name, salt, derived.toString("hex"));
      } catch (error) {
        if (this.db.prepare("SELECT id FROM users WHERE username = ?").get(username))
          throw new DirectoryError("That username is already registered.", 409);
        throw error;
      }
    } else {
      if (!row || !timingSafeEqual(derived, Buffer.from(String(row.password), "hex")))
        throw new DirectoryError("Incorrect username or password.", 401);
      user = account(row);
    }
    this.db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
    const token = randomBytes(32).toString("hex");
    this.db
      .prepare("INSERT INTO sessions VALUES (?, ?, ?)")
      .run(hash(token), user.id, Date.now() + 30 * 86400000);
    return { user, token };
  }
  user(token: string): Account {
    if (!/^[a-f0-9]{64}$/.test(token)) throw new DirectoryError("Sign in to your account.", 401);
    const row = this.db
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.token = ? AND s.expires > ?",
      )
      .get(hash(token), Date.now()) as Row | undefined;
    if (!row) throw new DirectoryError("Your session has expired. Sign in again.", 401);
    return account(row);
  }
  logout(token: string) {
    this.db.prepare("DELETE FROM sessions WHERE token = ?").run(hash(token));
  }
  rooms(user: Account): SavedRoom[] {
    const rows = this.db
      .prepare(
        "SELECT r.*, m.participant FROM saved_rooms r JOIN members m ON m.room_id = r.id WHERE m.user_id = ? ORDER BY r.name COLLATE NOCASE, r.id",
      )
      .all(user.id) as Row[];
    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      code: this.open(String(row.secret)),
      host: String(row.host),
      port: Number(row.port),
      owner: row.owner_id === user.id,
      participant: String(row.participant),
      members: (
        this.db
          .prepare(
            "SELECT u.id, u.username, u.name FROM users u JOIN members m ON m.user_id = u.id WHERE m.room_id = ? ORDER BY u.username",
          )
          .all(row.id) as Row[]
      ).map(account),
    }));
  }
  save(user: Account, body: Record<string, unknown>, create: boolean) {
    const code = text(body.code, 32).toLowerCase();
    if (!/^[a-f0-9]{32}$/.test(code)) throw new DirectoryError("Invalid room invitation.");
    const id = hash(`ShareStream-call-room-v1:${code}`);
    const existing = this.db.prepare("SELECT id FROM saved_rooms WHERE id = ?").get(id);
    if (existing && create)
      throw new DirectoryError("This room already exists. Save its invitation instead.", 409);
    if (!existing) {
      if (Number(this.db.prepare("SELECT count(*) AS n FROM saved_rooms").get()!.n) >= 10000)
        throw new DirectoryError("The saved room service is full.", 503);
      this.checkUserLimit(user.id);
      const host = text(body.host || "stream.whitesquirrel.digital", 253);
      const port = Number(body.port ?? 48100);
      if (!/^[a-z\d.-]{1,253}$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)
        throw new DirectoryError("Invalid relay address.");
      this.db
        .prepare("INSERT INTO saved_rooms VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, text(body.name || "Music room", 60), this.seal(code), host, port, user.id);
    }
    this.addMember(id, user.id);
    return id;
  }
  private addMember(room: string, user: string) {
    const existing = this.db
      .prepare("SELECT 1 FROM members WHERE room_id = ? AND user_id = ?")
      .get(room, user);
    if (existing) return;
    this.checkUserLimit(user);
    const size = this.db.prepare("SELECT count(*) AS n FROM members WHERE room_id = ?").get(room)!;
    if (Number(size.n) >= 64)
      throw new DirectoryError("This room has reached its saved member limit.", 409);
    this.db.prepare("INSERT INTO members VALUES (?, ?, ?)").run(room, user, random());
  }
  private checkUserLimit(user: string) {
    if (
      Number(this.db.prepare("SELECT count(*) AS n FROM members WHERE user_id = ?").get(user)!.n) >=
      100
    )
      throw new DirectoryError("This account has reached its limit of 100 saved rooms.", 409);
  }
  manage(user: Account, room: string, body: Record<string, unknown>, invite: boolean) {
    const row = this.db.prepare("SELECT owner_id FROM saved_rooms WHERE id = ?").get(room);
    if (!row || row.owner_id !== user.id)
      throw new DirectoryError("Only the room creator can manage this room.", 403);
    if (invite) {
      const target = this.db
        .prepare("SELECT id FROM users WHERE username = ?")
        .get(text(body.username, 32).toLowerCase());
      if (!target) throw new DirectoryError("No account has that username.", 404);
      this.addMember(room, String(target.id));
    } else
      this.db
        .prepare("UPDATE saved_rooms SET name = ? WHERE id = ?")
        .run(text(body.name, 60), room);
  }
  close() {
    this.db.close();
  }
}

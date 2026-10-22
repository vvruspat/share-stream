import { MAX_PARTICIPANTS } from "../shared/protocol.js";
import { createHash } from "node:crypto";
import type { Participant, PresenceUpdate } from "../shared/presence.js";

export const participantId = (token: string) =>
  createHash("sha256").update(token).digest("hex").slice(0, 32);
interface Entry extends Participant {
  pluginAt: number;
  browserAt: number;
}
// Presence is a separate, short-lived control plane. No audio, room keys, or
// participant credentials are returned to other participants.
export class PresenceRegistry {
  private rooms = new Map<string, Map<string, Entry>>();
  constructor(
    private now = Date.now,
    private maxRooms = 64,
  ) {}
  prune() {
    const cutoff = this.now() - 8000;
    for (const [room, entries] of this.rooms) {
      for (const [id, entry] of entries) {
        if (entry.pluginAt < cutoff) entry.music = null;
        if (entry.browserAt < cutoff) {
          entry.browser = entry.mic = entry.speaking = false;
        }
        if (!entry.music && !entry.browser) entries.delete(id);
      }
      if (!entries.size) this.rooms.delete(room);
    }
  }
  update(value: unknown): Participant[] {
    const m = value as PresenceUpdate;
    if (
      !m ||
      !/^[a-f0-9]{64}$/.test(m.room) ||
      !/^[a-f0-9]{32}$/.test(m.token) ||
      !["plugin", "browser"].includes(m.source) ||
      typeof m.connected !== "boolean" ||
      (m.music !== undefined && ![null, "sending", "listening", "connecting"].includes(m.music)) ||
      (m.name !== undefined && (typeof m.name !== "string" || m.name.length > 60)) ||
      (m.mic !== undefined && typeof m.mic !== "boolean") ||
      (m.speaking !== undefined && typeof m.speaking !== "boolean")
    )
      throw new Error("Invalid presence update");
    this.prune();
    let entries = this.rooms.get(m.room);
    if (!entries) {
      if (!m.connected) return [];
      if (this.rooms.size >= this.maxRooms) throw new Error("Presence service busy");
      entries = new Map();
      this.rooms.set(m.room, entries);
    }
    const id = participantId(m.token);
    let entry = entries.get(id);
    if (!entry && m.connected) {
      if (entries.size >= MAX_PARTICIPANTS)
        throw new Error("This room supports eight participants");
      entry = {
        id,
        name: `Participant ${id.slice(0, 4)}`,
        music: null,
        browser: false,
        mic: false,
        speaking: false,
        pluginAt: 0,
        browserAt: 0,
      };
      entries.set(id, entry);
    }
    if (entry) {
      if (m.source === "plugin") {
        entry.pluginAt = this.now();
        entry.music = m.connected ? m.music || "connecting" : null;
      } else {
        entry.browserAt = this.now();
        entry.browser = m.connected;
        entry.mic = m.connected && !!m.mic;
        entry.speaking = entry.mic && !!m.speaking;
      }
      if (m.name !== undefined) {
        const clean = Array.from(m.name)
          .filter((c) => c.charCodeAt(0) > 31 && c.charCodeAt(0) !== 127)
          .join("")
          .trim();
        entry.name = clean || `Participant ${id.slice(0, 4)}`;
      }
      if (!entry.music && !entry.browser) entries.delete(id);
    }
    return [...entries.values()].map(
      ({ pluginAt: _p, browserAt: _b, ...publicEntry }) => publicEntry,
    );
  }
}

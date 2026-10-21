import { useCallback, useEffect, useRef, useState } from "react";
import { randomId, roomKeys } from "./crypto.js";
import { invitationParameters } from "./invitation.js";
import type { Participant, PresenceUpdate } from "../../shared/presence.js";

export function participantToken(room: string | null): string {
  const supplied = room ? invitationParameters(location.hash).get("participant") : null;
  const key = `sharestream:participant:${room}`;
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(key);
  } catch {
    /* Private browsing. */
  }
  const token =
    supplied && /^[a-f0-9]{32}$/.test(supplied)
      ? supplied
      : saved && /^[a-f0-9]{32}$/.test(saved)
        ? saved
        : randomId();
  try {
    sessionStorage.setItem(key, token);
  } catch {
    /* Keep this page's identity. */
  }
  return token;
}

export function useParticipants(
  code: string | null,
  token: string,
  active: boolean,
  mic: boolean,
  speaking: boolean,
) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [id, setId] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const pendingName = useRef<string | undefined>(undefined);
  const latest = useRef({ mic, speaking });
  latest.current = { mic, speaking };
  const rename = useCallback((name: string) => {
    pendingName.current = name;
  }, []);
  useEffect(() => {
    if (!crypto.subtle) return;
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then((hash) =>
      setId(
        Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, "0"))
          .join("")
          .slice(0, 32),
      ),
    );
  }, [token]);
  useEffect(() => {
    if (!code || !active) {
      setParticipants([]);
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    let room = "";
    const update = async () => {
      try {
        room ||= (await roomKeys(code)).room;
        const name = pendingName.current;
        const payload: PresenceUpdate = {
          room,
          token,
          source: "browser",
          connected: true,
          ...latest.current,
          ...(name !== undefined ? { name } : {}),
        };
        const response = await fetch("/api/presence", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(4000)]),
        });
        if (!response.ok) throw new Error("Presence unavailable");
        const data = (await response.json()) as { participants: Participant[] };
        if (!disposed) {
          setParticipants(data.participants);
          setUnavailable(false);
          if (pendingName.current === name) pendingName.current = undefined;
        }
      } catch {
        if (!disposed) {
          setUnavailable(true);
          setParticipants([]);
        }
      } finally {
        if (!disposed) timer = setTimeout(() => void update(), 1000);
      }
    };
    void update();
    const leave = () => {
      if (room)
        navigator.sendBeacon(
          "/api/presence",
          new Blob([JSON.stringify({ room, token, source: "browser", connected: false })], {
            type: "application/json",
          }),
        );
    };
    window.addEventListener("pagehide", leave);
    return () => {
      disposed = true;
      clearTimeout(timer);
      abort.abort();
      leave();
      window.removeEventListener("pagehide", leave);
    };
  }, [code, token, active]);
  return { participants, id, rename, unavailable };
}

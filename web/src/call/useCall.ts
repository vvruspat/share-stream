import { useCallback, useEffect, useState } from "react";
import { Call } from "./Call.js";
import type { RemoteMedia } from "../../shared/protocol.js";

export function explainError(error: unknown): string {
  const names: Record<string, string> = {
    NotAllowedError:
      "Permission was not granted. Allow access in the browser and macOS Privacy & Security settings, then try again.",
    NotFoundError: "No microphone was found. Connect a microphone and try again.",
    NotReadableError: "The selected device is unavailable. Check your audio settings.",
  };
  return error instanceof Error ? names[error.name] || error.message : String(error);
}

export function useCall(token: string) {
  const [call] = useState(() => new Call({ resume: token }));
  const [state, setState] = useState(() => call.snapshot);
  const [peers, setPeers] = useState<
    Record<
      string,
      { voice: MediaStream | null; screen: MediaStream | null; media: Partial<RemoteMedia> }
    >
  >({});
  const [localScreen, setLocalScreen] = useState<MediaStream | null>(null);
  const [error, setError] = useState("");
  const run = useCallback(async (action: () => Promise<unknown> | void) => {
    setError("");
    try {
      await action();
    } catch (failure) {
      setError(explainError(failure));
    }
  }, []);

  useEffect(() => {
    const subscriptions = [
      call.on("state", setState),
      call.on("remoteState", ({ peer, ...media }) => {
        if (!peer) {
          setPeers({});
          return;
        }
        setPeers((previous) => ({
          ...previous,
          [peer]: {
            voice: previous[peer]?.voice || null,
            screen: previous[peer]?.screen || null,
            media,
          },
        }));
      }),
      call.on("error", setError),
      call.on("localScreen", setLocalScreen),
      call.on("track", ({ peer, channel, stream }) => {
        if (!peer) return;
        setPeers((previous) => ({
          ...previous,
          [peer]: {
            ...(previous[peer] || { voice: null, screen: null, media: {} }),
            [channel]: stream,
          },
        }));
      }),
    ];
    const leave = () => call.leave();
    window.addEventListener("pagehide", leave);
    return () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      window.removeEventListener("pagehide", leave);
      call.leave();
    };
  }, [call]);
  const remotes = Object.entries(peers).map(([id, peer]) => ({ id, ...peer }));
  const remote = {
    mic: remotes.some((p) => p.media.mic),
    screen: remotes.some((p) => p.media.screen),
  };
  return { call, state, remote, remotes, localScreen, error, run };
}

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
  const [remote, setRemote] = useState<Partial<RemoteMedia>>({ mic: false, screen: false });
  const [voiceStream, setVoiceStream] = useState<MediaStream | null>(null);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
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
      call.on("remoteState", setRemote),
      call.on("error", setError),
      call.on("localScreen", setLocalScreen),
      call.on("track", ({ channel, stream }) => {
        if (channel === "voice") setVoiceStream(stream);
        else setScreenStream(stream);
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
  return { call, state, remote, voiceStream, screenStream, localScreen, error, run };
}

import { useEffect, useRef, useState } from "react";
import { ArrowsPointingOutIcon, ComputerDesktopIcon, PlayIcon } from "@heroicons/react/24/outline";
import { Button, Tooltip } from "./ui/index.js";

export function VoicePlayer({
  stream,
  volume,
  output,
  onError,
}: {
  stream: MediaStream | null;
  volume: number;
  output: string;
  onError: (error: unknown) => void;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const [needsPlay, setNeedsPlay] = useState(false);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    let live = true;
    audio.srcObject = stream;
    if (stream)
      void audio.play().then(
        () => {
          if (live) setNeedsPlay(false);
        },
        () => {
          if (live) setNeedsPlay(true);
        },
      );
    else setNeedsPlay(false);
    return () => {
      live = false;
      audio.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    if (ref.current) ref.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    if (ref.current?.setSinkId) void ref.current.setSinkId(output).catch(onError);
  }, [output, onError]);
  return (
    <>
      <audio id="voice" ref={ref} autoPlay />
      {needsPlay && (
        <Button
          id="play"
          onClick={() => {
            void ref.current
              ?.play()
              .then(() => setNeedsPlay(false))
              .catch(onError);
          }}
        >
          <PlayIcon />
          Play partner’s voice
        </Button>
      )}
    </>
  );
}

function Video({
  id,
  stream,
  visible = true,
  label,
}: {
  id: string;
  stream: MediaStream | null;
  visible?: boolean;
  label: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (video) video.srcObject = stream;
    return () => {
      if (video) video.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      id={id}
      ref={ref}
      autoPlay
      playsInline
      muted
      hidden={!stream || !visible}
      aria-label={label}
    />
  );
}

export function ScreenStage({
  stream,
  local,
  sharing,
  remoteMic,
  onError,
  children,
}: {
  stream: MediaStream | null;
  local: MediaStream | null;
  sharing: boolean;
  remoteMic: string;
  onError: (error: unknown) => void;
  children: React.ReactNode;
}) {
  const fullscreen = async () => {
    const video = document.getElementById("remote-screen") as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
    };
    try {
      if (video.requestFullscreen) await video.requestFullscreen();
      else video.webkitEnterFullscreen?.();
    } catch (error) {
      onError(error);
    }
  };
  return (
    <section className="panel stage" aria-label="Screen sharing">
      <div className="stage-heading">
        <span className="eyebrow">PARTNER’S SCREEN</span>
        <div className="stage-tools">
          <span id="remote-mic">{remoteMic}</span>
          <Tooltip content="Open partner’s screen in full screen">
            <Button
              id="fullscreen"
              variant="ghost"
              disabled={!stream || !sharing}
              onClick={() => {
                void fullscreen();
              }}
              aria-label="Full screen"
            >
              <ArrowsPointingOutIcon />
            </Button>
          </Tooltip>
        </div>
      </div>
      <div className="screen-area">
        <Video
          id="remote-screen"
          stream={stream}
          visible={sharing}
          label="Partner’s shared screen"
        />
        <div id="placeholder" className="placeholder" hidden={!!stream && sharing}>
          <div className="screen-symbol">
            <ComputerDesktopIcon />
          </div>
          <h2>A shared view of the mix</h2>
          <p>
            Bring your session into the room.
            <br />
            Your partner’s screen will appear here.
          </p>
          <span className="capture-note">Screen sharing starts only when you choose.</span>
        </div>
        <Video id="local-screen" stream={local} label="Your screen preview" />
      </div>
      {children}
    </section>
  );
}

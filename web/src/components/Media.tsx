import { useEffect, useRef, useState } from "react";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ComputerDesktopIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";
import { Button, Tooltip, TooltipContainer } from "./ui/index.js";

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
  error,
  onError,
  children,
}: {
  stream: MediaStream | null;
  local: MediaStream | null;
  sharing: boolean;
  error: string;
  onError: (error: unknown) => void;
  children: React.ReactNode;
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement === container);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [container]);
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement === container) await document.exitFullscreen();
      else if (container?.requestFullscreen) await container.requestFullscreen();
      else
        throw new Error(
          "Fullscreen is unavailable in this browser. Try Chrome, Edge, Firefox or desktop Safari.",
        );
    } catch (error) {
      onError(error);
    }
  };
  return (
    <section ref={setContainer} className="panel stage" aria-label="Screen sharing">
      <TooltipContainer.Provider value={container}>
        <div className={`screen-area ${stream && sharing ? "has-remote" : ""}`}>
          <div id="error" className="error-banner" role="alert" hidden={!error}>
            {error}
          </div>
          <Video
            id="remote-screen"
            stream={stream}
            visible={sharing}
            label="Partner’s shared screen"
          />
          <div id="placeholder" className="placeholder" hidden={(!!stream && sharing) || !!local}>
            <div className="screen-symbol">
              <ComputerDesktopIcon />
            </div>
            <h2>A little closer to the mix.</h2>
            <p>A participant’s shared screen will appear here.</p>
          </div>
          <Video id="local-screen" stream={local} label="Your screen preview" />
          <div className="stream-toolbar" role="toolbar" aria-label="Call controls">
            {children}
            <span className="toolbar-divider" />
            <Tooltip content={full ? "Exit full screen" : "Enter full screen"}>
              <Button
                id="fullscreen"
                variant="ghost"
                className="icon-button"
                aria-label={full ? "Exit full screen" : "Enter full screen"}
                aria-pressed={full}
                onClick={() => void fullscreen()}
              >
                {full ? <ArrowsPointingInIcon /> : <ArrowsPointingOutIcon />}
              </Button>
            </Tooltip>
          </div>
        </div>
      </TooltipContainer.Provider>
    </section>
  );
}

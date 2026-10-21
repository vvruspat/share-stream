import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  ComputerDesktopIcon,
  PlayIcon,
} from "@heroicons/react/24/outline";
import { Button, Tooltip, TooltipContainer } from "./ui/index.js";
import { VoicePlayback } from "../audio/VoicePlayback.js";
import type { StereoPeaks } from "../audio/monitor.js";

export function VoicePlayer({
  stream,
  gainDb,
  output,
  onPeaks,
  onError,
}: {
  stream: MediaStream | null;
  gainDb: number;
  output: string;
  onPeaks: (peaks: StereoPeaks) => void;
  onError: (error: unknown) => void;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  const sourceRef = useRef<HTMLAudioElement | null>(null);
  const playback = useRef<VoicePlayback | null>(null);
  const latestGain = useRef(gainDb);
  latestGain.current = gainDb;
  const [needsPlay, setNeedsPlay] = useState(false);
  const play = useCallback(async () => {
    const player = playback.current;
    const audio = ref.current;
    const source = sourceRef.current;
    if (!player || !audio || !source) return;
    // Both calls must start inside the user gesture when autoplay is blocked.
    try {
      await Promise.all([player.context.resume(), source.play(), audio.play()]);
    } catch (error) {
      if (playback.current === player) throw error;
      return;
    }
    if (playback.current === player) setNeedsPlay(player.context.state !== "running");
  }, []);
  useEffect(() => {
    const audio = ref.current;
    if (!audio) return;
    onPeaks([0, 0]);
    setNeedsPlay(false);
    if (!stream) return;
    let player: VoicePlayback;
    try {
      player = new VoicePlayback(stream, latestGain.current);
    } catch (error) {
      onError(error);
      return;
    }
    let live = true;
    playback.current = player;
    const source = sourceRef.current;
    // Chromium needs an attached media renderer to start decoding remote RTP.
    // This element is always muted; only the processed stream can be heard.
    if (source) {
      source.muted = true;
      source.srcObject = stream;
    }
    audio.volume = 1;
    audio.srcObject = player.output;
    const changed = () => {
      if (live) setNeedsPlay(player.context.state !== "running" || audio.paused);
    };
    player.context.addEventListener("statechange", changed);
    changed();
    void play().catch(() => {
      if (live) setNeedsPlay(true);
    });
    const timer = setInterval(() => onPeaks(player.peaks()), 50);
    return () => {
      live = false;
      clearInterval(timer);
      player.context.removeEventListener("statechange", changed);
      if (playback.current === player) playback.current = null;
      audio.pause();
      audio.srcObject = null;
      if (source) {
        source.pause();
        source.srcObject = null;
      }
      player.close();
      onPeaks([0, 0]);
    };
  }, [stream, onPeaks, onError, play]);
  useEffect(() => {
    playback.current?.setGainDb(gainDb);
  }, [gainDb]);
  useEffect(() => {
    if (ref.current?.setSinkId) void ref.current.setSinkId(output).catch(onError);
  }, [output, onError]);
  return (
    <>
      <audio id="voice-source" ref={sourceRef} autoPlay muted />
      <audio id="voice" ref={ref} autoPlay />
      {needsPlay && (
        <Button
          id="play"
          onClick={() => {
            void play().catch(onError);
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

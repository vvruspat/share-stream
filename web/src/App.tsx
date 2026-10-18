import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ComputerDesktopIcon,
  ExclamationTriangleIcon,
  LinkIcon,
  LockClosedIcon,
  MicrophoneIcon,
  MusicalNoteIcon,
  PhoneXMarkIcon,
  SignalIcon,
  SpeakerWaveIcon,
} from "@heroicons/react/24/outline";
import {
  Button,
  Select,
  Slider,
  TooltipProvider,
  type SelectOption,
} from "./components/ui/index.js";
import { ScreenStage, VoicePlayer } from "./components/Media.js";
import { useCall } from "./call/useCall.js";
import { parseInvite, randomId } from "./call/crypto.js";
import type { VoiceMode } from "./call/Call.js";

const supported =
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  typeof window.RTCPeerConnection === "function" &&
  !!crypto.subtle;
const outputSupported = "setSinkId" in HTMLMediaElement.prototype;
function initialRoom() {
  try {
    return parseInvite(location.href);
  } catch {
    return randomId();
  }
}
const defaultDevice = [{ value: "", label: "System default" }];
const modes: SelectOption[] = [
  { value: "headphones", label: "Headphones · unprocessed" },
  { value: "speakers", label: "Speakers · echo cancellation" },
];

export function App() {
  const { call, state, remote, voiceStream, screenStream, localScreen, error, run } = useCall();
  const [initialCode] = useState(initialRoom);
  const [room, setRoom] = useState(initialCode);
  const [joining, setJoining] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [inputs, setInputs] = useState<SelectOption[]>(defaultDevice);
  const [outputs, setOutputs] = useState<SelectOption[]>(defaultDevice);
  const [volume, setVolume] = useState(0.8);
  const reportError = useCallback(
    (failure: unknown) => {
      void run(() => {
        throw failure;
      });
    },
    [run],
  );

  useEffect(() => {
    history.replaceState(null, "", `/#room=${initialCode}`);
  }, [initialCode]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const devices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    const options = (kind: MediaDeviceKind) => [
      ...defaultDevice,
      ...list
        .filter((d) => d.kind === kind && d.deviceId && d.deviceId !== "default")
        .map((d, i) => ({
          value: d.deviceId,
          label: d.label || `${kind === "audioinput" ? "Microphone" : "Output"} ${i + 1}`,
        })),
    ];
    const nextInputs = options("audioinput"),
      nextOutputs = options("audiooutput");
    setInputs(nextInputs);
    setOutputs(nextOutputs);
    setInput((previous) => (nextInputs.some((d) => d.value === previous) ? previous : ""));
    setOutput((previous) => (nextOutputs.some((d) => d.value === previous) ? previous : ""));
  }, []);
  useEffect(() => {
    const changed = () => {
      void devices().catch(() => {});
    };
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", changed);
  }, [devices]);

  const join = () =>
    run(async () => {
      setJoining(true);
      try {
        const code = parseInvite(room);
        setRoom(code);
        history.replaceState(null, "", `/#room=${code}`);
        await call.join(code);
        await devices();
      } finally {
        setJoining(false);
      }
    });
  const copy = () =>
    run(async () => {
      await navigator.clipboard.writeText(`${location.origin}/#room=${parseInvite(room)}`);
      setCopied(true);
    });
  const micLabel = state.micBusy
    ? "Opening microphone…"
    : state.mic
      ? "Mute microphone"
      : call.micStream
        ? "Unmute microphone"
        : "Enable microphone";
  const remoteMic = remote.voicePaused
    ? "Partner’s voice paused · update their page"
    : remote.mic
      ? "Partner’s mic on"
      : "Partner’s mic off";
  const modeNote =
    state.voiceMode === "headphones"
      ? "Use headphones. Echo cancellation and automatic microphone processing are off for mixing."
      : "For speakers: echo cancellation is on. macOS voice processing may lower other apps’ audio.";
  const mediaStatus = state.voiceLimited
    ? "Voice quality reduced · microphone stays connected"
    : `${state.mic ? "Microphone on" : "Microphone off"} · ${state.screen ? "Screen on" : "Screen off"}`;

  return (
    <TooltipProvider delayDuration={350}>
      <main>
        <header className="page-header">
          <div>
            <p className="eyebrow brand-kicker">AUDIO, ACROSS THE DISTANCE</p>
            <h1>
              Share Stream<span>Voice & screen</span>
            </h1>
          </div>
          <span
            id="status"
            className={`status-badge ${state.peer ? "is-connected" : ""}`}
            role="status"
          >
            <span className="status-dot" />
            {state.state}
          </span>
        </header>

        <section className="panel room-panel" aria-label="Room">
          <div className="room-field">
            <label htmlFor="room">
              <LockClosedIcon />
              PRIVATE ROOM
            </label>
            <input
              id="room"
              value={room}
              onChange={(event) => setRoom(event.target.value)}
              disabled={state.active || joining}
              autoComplete="off"
              spellCheck={false}
              placeholder="Paste your plugin invite or room code"
            />
            <p className="small">The same room as your plugin. Two people, one private session.</p>
          </div>
          <div className="room-buttons">
            {state.active ? (
              <Button id="leave" variant="danger" onClick={() => call.leave()}>
                <PhoneXMarkIcon />
                Leave
              </Button>
            ) : (
              <Button
                id="join"
                variant="primary"
                disabled={!supported || joining}
                onClick={() => {
                  void join();
                }}
              >
                <LinkIcon />
                {joining ? "Joining…" : "Join room"}
              </Button>
            )}
            <Button
              id="copy"
              onClick={() => {
                void copy();
              }}
            >
              {copied ? <CheckIcon /> : <ClipboardDocumentIcon />}
              {copied ? "Copied" : "Copy call invite"}
            </Button>
          </div>
        </section>
        <div id="error" className="error-banner" role="alert" hidden={!error && supported}>
          <ExclamationTriangleIcon />
          <span>
            {error ||
              (!supported
                ? "Open this page over HTTPS in a recent Chrome, Edge, Firefox or Safari browser."
                : "")}
          </span>
        </div>

        <ScreenStage
          stream={screenStream}
          local={localScreen}
          sharing={!!remote.screen}
          remoteMic={remoteMic}
          onError={reportError}
        >
          <div className="controls">
            <div className="control-buttons">
              <Button
                id="mic"
                active={state.mic}
                aria-pressed={state.mic}
                disabled={!state.active || state.micBusy}
                onClick={() => {
                  void run(async () => {
                    await call.toggleMic();
                    await devices();
                  });
                }}
              >
                <MicrophoneIcon />
                {micLabel}
              </Button>
              <Button
                id="share"
                active={state.screen}
                aria-pressed={state.screen}
                disabled={!state.active || sharing}
                onClick={() => {
                  void run(async () => {
                    setSharing(true);
                    try {
                      await call.shareScreen();
                    } finally {
                      setSharing(false);
                    }
                  });
                }}
              >
                <ComputerDesktopIcon />
                {state.screen ? "Stop sharing" : "Share screen"}
              </Button>
            </div>
            <span id="media-status" className="small">
              {mediaStatus}
            </span>
          </div>
        </ScreenStage>

        <section className="bottom-grid">
          <section className="panel devices" aria-labelledby="devices-heading">
            <div className="section-heading">
              <SpeakerWaveIcon />
              <h2 id="devices-heading">Voice devices</h2>
            </div>
            <Select
              id="voice-mode"
              label="Voice mode"
              value={state.voiceMode}
              options={modes}
              disabled={state.micBusy}
              describedBy="voice-mode-note"
              onValueChange={(mode) => {
                void run(() => call.setVoiceMode(mode as VoiceMode, input));
              }}
            />
            <p id="voice-mode-note" className="small mode-note">
              {modeNote}
            </p>
            <div className="device-grid">
              <Select
                id="input"
                label="Microphone"
                value={input}
                options={inputs}
                disabled={!call.micStream || state.micBusy}
                onValueChange={(device) => {
                  setInput(device);
                  void run(() => call.microphone(device));
                }}
              />
              <Select
                id="output"
                label="Voice output"
                value={output}
                options={
                  outputSupported ? outputs : [{ value: "", label: "Use system audio settings" }]
                }
                disabled={!outputSupported}
                onValueChange={setOutput}
              />
            </div>
            <Slider
              id="volume"
              label="Partner’s voice volume"
              value={volume}
              onValueChange={setVolume}
            />
            <VoicePlayer
              stream={voiceStream}
              volume={volume}
              output={output}
              onError={reportError}
            />
          </section>

          <section className="panel priority" aria-labelledby="streams-heading">
            <div className="section-heading">
              <SignalIcon />
              <h2 id="streams-heading">Three independent streams</h2>
              <span className="mini-badge">PRIORITY</span>
            </div>
            <div className="stream-row">
              <span className="stream-order">01</span>
              <div className="stream-icon music">
                <MusicalNoteIcon />
              </div>
              <div className="stream-info">
                <h3>Music audio</h3>
                <p>Highest · native plugin / receiver</p>
              </div>
              <strong>~3.5 Mbps</strong>
            </div>
            <div className="stream-row">
              <span className="stream-order">02</span>
              <div className="stream-icon">
                <ComputerDesktopIcon />
              </div>
              <div className="stream-info">
                <h3>Screen</h3>
                <p>Adaptive · up to 1080p / 15 fps</p>
              </div>
              <strong id="screen-budget">≤{(state.screenBitrate / 1000000).toFixed(1)} Mbps</strong>
            </div>
            <div className="stream-row">
              <span className="stream-order">03</span>
              <div className="stream-icon">
                <MicrophoneIcon />
              </div>
              <div className="stream-info">
                <h3>Voice</h3>
                <p>Mono Opus · 80 ms receive buffer target</p>
              </div>
              <strong id="voice-budget">≤{state.voiceBitrate / 1000} kbps</strong>
            </div>
            <p id="priority-note" className="small priority-note">
              <ArrowRightIcon />
              On congestion, voice bitrate drops first, then screen quality. Voice stays connected;
              music continues through Share Stream.
            </p>
          </section>
        </section>
        <footer>
          <span>
            <LockClosedIcon />
            Encrypted media · direct connection with private TURN fallback
          </span>
          <span>Web {__APP_VERSION__} · No recording</span>
        </footer>
      </main>
    </TooltipProvider>
  );
}

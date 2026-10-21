import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpTrayIcon,
  ComputerDesktopIcon,
  LockClosedIcon,
  MicrophoneIcon,
} from "@heroicons/react/24/outline";
import {
  Button,
  Disclosure,
  Select,
  MonitorSlider,
  Tooltip,
  TooltipProvider,
  type SelectOption,
} from "./components/ui/index.js";
import { ScreenStage, VoicePlayer } from "./components/Media.js";
import { useCall } from "./call/useCall.js";
import { participantToken, useParticipants } from "./call/useParticipants.js";
import { loadDisplayName, saveDisplayName } from "./call/profile.js";
import { parseInvitation, invitationLink, type Invitation } from "./call/invitation.js";
import type { VoiceMode } from "./call/Call.js";
import type { StereoPeaks } from "./audio/monitor.js";

const supported =
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  typeof window.RTCPeerConnection === "function" &&
  typeof window.AudioContext === "function" &&
  !!crypto.subtle;
const outputSupported = "setSinkId" in HTMLMediaElement.prototype;
function initialRoom(): Invitation | null {
  try {
    return parseInvitation(location.href);
  } catch {
    return null;
  }
}
const defaultDevice = [{ value: "", label: "System default" }];
const modes: SelectOption[] = [
  { value: "headphones", label: "Headphones · unprocessed" },
  { value: "speakers", label: "Speakers · echo cancellation" },
];

export function App() {
  const [invite] = useState(initialRoom);
  const [token] = useState(() => participantToken(invite?.code || null));
  const { call, state, remote, voiceStream, screenStream, localScreen, error, run } =
    useCall(token);
  const [joining, setJoining] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [inputs, setInputs] = useState<SelectOption[]>(defaultDevice);
  const [outputs, setOutputs] = useState<SelectOption[]>(defaultDevice);
  const [volumeDb, setVolumeDb] = useState(0);
  const [voicePeaks, setVoicePeaks] = useState<StereoPeaks>([0, 0]);
  const [name, setName] = useState(loadDisplayName);
  const roster = useParticipants(
    invite?.code || null,
    token,
    state.active,
    state.mic,
    state.speaking,
  );
  useEffect(() => {
    if (name) roster.rename(name);
  }, [name, roster.rename]);
  const reportError = useCallback(
    (failure: unknown) => {
      void run(() => {
        throw failure;
      });
    },
    [run],
  );

  useEffect(() => {
    // Keep the private browser/plugin binding in local browser storage,
    // never in a shareable invitation or an HTTP request URL.
    if (invite) history.replaceState(null, "", invitationLink(invite, location.origin, false));
  }, [invite]);
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
  useEffect(() => {
    if (!supported || !invite?.autoJoin) return;
    let live = true;
    setJoining(true);
    void run(async () => {
      try {
        await call.join(invite.code);
        await devices();
      } finally {
        if (live) setJoining(false);
      }
    });
    return () => {
      live = false;
    };
  }, [call, invite, run, devices]);
  const join = () =>
    run(async () => {
      if (!invite) return;
      setJoining(true);
      try {
        await call.join(invite.code);
        await devices();
      } finally {
        setJoining(false);
      }
    });
  const micLabel = state.micBusy
    ? "Opening microphone…"
    : state.mic
      ? "Mute microphone"
      : call.micStream
        ? "Unmute microphone"
        : "Enable microphone";
  const modeNote =
    state.voiceMode === "headphones"
      ? "Use headphones. Echo cancellation and automatic microphone processing are off for mixing."
      : "For speakers: echo cancellation is on. macOS voice processing may lower other apps’ audio.";
  const own = roster.participants.find((p) => p.id === roster.id);

  return (
    <TooltipProvider delayDuration={250}>
      <main>
        <header className="page-header">
          <h1>
            Share Stream <span>/ Voice & screen</span>
          </h1>
          <div className="connection-controls">
            <span
              id="status"
              className={`status-badge ${state.state.startsWith("Connected") ? "is-connected" : ""}`}
              role="status"
            >
              <span className="status-dot" />
              {state.state.startsWith("Connected") ? "Connected" : state.state}
            </span>
            {invite &&
              (state.active ? (
                <Button id="leave" variant="ghost" onClick={() => call.leave()}>
                  Leave
                </Button>
              ) : (
                <Button id="join" disabled={!supported || joining} onClick={() => void join()}>
                  {joining ? "Joining…" : "Join session"}
                </Button>
              ))}
          </div>
        </header>
        {!invite && (
          <div className="session-message" role="status">
            Open Voice & screen from your Share Stream plugin to join its session.
          </div>
        )}
        <ScreenStage
          stream={screenStream}
          local={localScreen}
          sharing={!!remote.screen}
          error={
            error ||
            (!supported
              ? "Open this page over HTTPS in a recent Chrome, Edge, Firefox or Safari browser."
              : "")
          }
          onError={reportError}
        >
          <Tooltip content={micLabel}>
            <Button
              id="mic"
              variant="ghost"
              className="icon-button"
              aria-label={micLabel}
              active={state.mic}
              aria-pressed={state.mic}
              disabled={!state.active || state.micBusy}
              onClick={() =>
                void run(async () => {
                  await call.toggleMic();
                  await devices();
                })
              }
            >
              <span className={`media-icon ${!state.mic ? "is-off" : ""}`}>
                <MicrophoneIcon />
              </span>
            </Button>
          </Tooltip>
          <Tooltip content={state.screen ? "Stop sharing" : "Share screen"}>
            <Button
              id="share"
              variant="ghost"
              className="icon-button"
              aria-label={state.screen ? "Stop sharing" : "Share screen"}
              active={state.screen}
              aria-pressed={state.screen}
              disabled={!state.active || sharing}
              onClick={() =>
                void run(async () => {
                  setSharing(true);
                  try {
                    await call.shareScreen();
                  } catch (failure) {
                    // Dismissing the browser's source picker is a neutral action.
                    if (!(failure instanceof DOMException && failure.name === "NotAllowedError"))
                      throw failure;
                  } finally {
                    setSharing(false);
                  }
                })
              }
            >
              <span className={`media-icon ${state.screen ? "is-off" : "screen-upload"}`}>
                <ComputerDesktopIcon />
                {!state.screen && <ArrowUpTrayIcon className="upload-arrow" />}
              </span>
            </Button>
          </Tooltip>
        </ScreenStage>
        <MonitorSlider
          id="volume"
          value={volumeDb}
          peaks={voicePeaks}
          onValueChange={setVolumeDb}
        />
        <Disclosure title="Voice settings" id="voice-settings">
          <div className="voice-settings-grid">
            <div>
              <Select
                id="voice-mode"
                label="Voice mode"
                value={state.voiceMode}
                options={modes}
                disabled={state.micBusy}
                describedBy="voice-mode-note"
                onValueChange={(mode) =>
                  void run(() => call.setVoiceMode(mode as VoiceMode, input))
                }
              />
              <p id="voice-mode-note" className="small mode-note">
                {modeNote}
              </p>
            </div>
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
            <div className="field">
              <label htmlFor="display-name">Your name</label>
              <input
                id="display-name"
                maxLength={60}
                value={name}
                placeholder={own?.name || "Display name"}
                onChange={(e) => {
                  setName(e.target.value);
                  saveDisplayName(e.target.value);
                  roster.rename(e.target.value);
                }}
              />
            </div>
          </div>
          {state.voiceLimited && (
            <p className="small">Voice quality reduced to keep the call connected.</p>
          )}
        </Disclosure>
        <Disclosure
          title={
            <>
              Participants <span className="participant-count">· {roster.participants.length}</span>
            </>
          }
          id="participants"
        >
          {roster.unavailable && (
            <p className="small" role="status">
              Participant information is temporarily unavailable. Your media connection is
              unchanged.
            </p>
          )}
          {!state.active && <p className="small">Join the session to see who is here.</p>}
          <ul className="participant-list">
            {roster.participants.map((p) => {
              const self = p.id === roster.id;
              const mic = self ? state.mic : p.mic;
              const speaking = mic && (self ? state.speaking : state.remoteSpeaking || p.speaking);
              return (
                <li key={p.id} className="participant" data-participant-id={p.id}>
                  <span className="avatar" aria-hidden="true">
                    {Array.from(p.name)[0]?.toUpperCase()}
                  </span>
                  <div className="participant-info">
                    <span className="participant-name">
                      {p.name} {self && <span className="small">(you)</span>}
                    </span>
                    <span className="small">
                      {p.music === "sending"
                        ? "Sending music"
                        : p.music === "listening"
                          ? "Listening to music"
                          : p.music === "connecting"
                            ? "Connecting music…"
                            : "Voice only · Plugin not connected"}
                    </span>
                  </div>
                  <span className={`participant-mic ${speaking ? "is-speaking" : ""}`}>
                    {!p.browser
                      ? "Voice not joined"
                      : speaking
                        ? "Speaking"
                        : mic
                          ? "Mic on"
                          : "Mic off"}
                  </span>
                </li>
              );
            })}
          </ul>
        </Disclosure>
        <VoicePlayer
          stream={voiceStream}
          gainDb={volumeDb}
          output={output}
          onPeaks={setVoicePeaks}
          onError={reportError}
        />
        <footer>
          <span>Music streams through the plugin</span>
          <span>
            <LockClosedIcon />
            Private session · No recording
          </span>
        </footer>
      </main>
    </TooltipProvider>
  );
}

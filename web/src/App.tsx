import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  ArrowUpTrayIcon,
  ComputerDesktopIcon,
  LockClosedIcon,
  MicrophoneIcon,
  SpeakerWaveIcon,
  PhoneXMarkIcon,
  UserGroupIcon,
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
import { ScreenStage, RoomVoices } from "./components/Media.js";
import { useCall } from "./call/useCall.js";
import { useParticipants } from "./call/useParticipants.js";
import { loadDisplayName, saveDisplayName } from "./call/profile.js";
import { invitationLink, type Invitation } from "./call/invitation.js";
import type { VoiceMode } from "./call/Call.js";
import { RoomDirectory } from "./components/RoomDirectory.js";
import type { StereoPeaks } from "./audio/monitor.js";

const supported =
  typeof navigator.mediaDevices?.getUserMedia === "function" &&
  typeof window.RTCPeerConnection === "function" &&
  typeof window.AudioContext === "function" &&
  !!crypto.subtle;
const outputSupported = "setSinkId" in HTMLMediaElement.prototype;
const defaultDevice = [{ value: "", label: "System default" }];
const modes: SelectOption[] = [
  { value: "headphones", label: "Headphones · unprocessed" },
  { value: "speakers", label: "Speakers · echo cancellation" },
];

export function App() {
  return (
    <RoomDirectory>
      {(selection) => (
        <Session key={`${selection.token}:${selection.invite?.code || ""}`} {...selection} />
      )}
    </RoomDirectory>
  );
}

function Session({
  invite,
  token,
  name: accountName,
  roomName,
  actions,
}: {
  invite: Invitation | null;
  token: string;
  name?: string;
  roomName?: string;
  actions?: ReactNode;
}) {
  const { call, state, remotes, localScreen, error, run } = useCall(token);
  const [watching, setWatching] = useState("");
  const screens = remotes.filter((p) => p.screen && p.media.screen);
  const viewed = screens.find((p) => p.id === watching) || screens[0];
  const [joining, setJoining] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  useEffect(() => {
    if (!audioOpen) return;
    const dismiss = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!target.closest("#audio-panel, #audio-settings, [role=listbox]")) setAudioOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAudioOpen(false);
        document.getElementById("audio-settings")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [audioOpen]);
  const [sharing, setSharing] = useState(false);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [inputs, setInputs] = useState<SelectOption[]>(defaultDevice);
  const [outputs, setOutputs] = useState<SelectOption[]>(defaultDevice);
  const [volumeDb, setVolumeDb] = useState(0);
  const [voicePeaks, setVoicePeaks] = useState<StereoPeaks>([0, 0]);
  const [name, setName] = useState(() => accountName || loadDisplayName());
  const roster = useParticipants(
    invite?.code || null,
    token,
    state.active,
    state.mic,
    state.speaking,
  );
  useEffect(() => {
    if (name) roster.rename(name);
  }, [name, roster.rename, state.active]);
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

  const participants = (
    <section id="participants" aria-label="Participants">
      <h2 id="participant-heading">Participants · {roster.participants.length}</h2>
      {roster.unavailable && (
        <p className="small" role="status">
          Participant information is temporarily unavailable. Your media connection is unchanged.
        </p>
      )}
      {!state.active && <p className="small">Join the session to see who is here.</p>}
      <ul className="participant-list">
        {roster.participants.map((p) => {
          const self = p.id === roster.id;
          const mic = self ? state.mic : p.mic;
          const speaking = mic && (self ? state.speaking : p.speaking);
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
    </section>
  );
  return (
    <TooltipProvider delayDuration={250}>
      <main>
        <header className="page-header">
          <div>
            <h1>{roomName || (invite ? "Voice & screen" : "Your rooms")}</h1>
            <span
              id="status"
              className={`status-badge ${state.state.startsWith("Connected") ? "is-connected" : ""}`}
              role="status"
            >
              <span className="status-dot" />
              {state.state.startsWith("Connected") ? "Connected" : state.state}
            </span>
          </div>
          {actions}
        </header>
        <div className="music-context">
          <span>Music streams through the plugin</span>
          <span className="small">
            {roster.participants.find((p) => p.music === "sending")?.name
              ? `${roster.participants.find((p) => p.music === "sending")!.name} is sending music`
              : "Voice & screen"}
          </span>
        </div>
        {screens.length > 1 && (
          <Select
            id="screen-select"
            label="View screen"
            value={viewed?.id || ""}
            options={screens.map((p, i) => ({ value: p.id, label: `Screen ${i + 1}` }))}
            onValueChange={setWatching}
          />
        )}
        <ScreenStage
          stream={viewed?.screen || null}
          local={localScreen}
          sharing={!!viewed}
          error={
            error ||
            (!supported
              ? "Open this page over HTTPS in a recent Chrome, Edge, Firefox or Safari browser."
              : "")
          }
          onError={reportError}
          placeholder={
            state.active ? (
              viewed || localScreen ? null : (
                participants
              )
            ) : (
              <div className="room-preview">
                <UserGroupIcon />
                <h2>{invite ? roomName || "Ready when you are" : "Make room for the mix."}</h2>
                <p className="small">
                  {invite
                    ? "Join to talk and watch. Your microphone and screen stay off."
                    : "Choose a room or open an invitation to get started."}
                </p>
                {invite && (
                  <Button
                    id="join"
                    variant="primary"
                    disabled={!supported || joining}
                    onClick={() => void join()}
                  >
                    {joining ? "Joining…" : "Join room"}
                  </Button>
                )}
              </div>
            )
          }
          afterControls={
            state.active && (
              <Button
                id="leave"
                variant="danger"
                aria-label="Leave voice & screen"
                onClick={() => call.leave()}
              >
                <PhoneXMarkIcon />
                <span className="action-label">Leave</span>
              </Button>
            )
          }
        >
          <Tooltip content={micLabel}>
            <Button
              id="mic"
              variant="ghost"
              className="call-action"
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
              <span className="control-label">{state.mic ? "Mute" : "Microphone"}</span>
            </Button>
          </Tooltip>
          <Tooltip content={state.screen ? "Stop sharing" : "Share screen"}>
            <Button
              id="share"
              variant="ghost"
              className="call-action"
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
              <span className="control-label">
                {state.screen ? "Stop sharing" : "Share screen"}
              </span>
            </Button>
          </Tooltip>
          <div className="audio-control">
            <Button
              id="audio-settings"
              variant="ghost"
              className="call-action"
              aria-label="Audio settings"
              aria-expanded={audioOpen}
              aria-controls="audio-panel"
              onClick={() => setAudioOpen(!audioOpen)}
            >
              <SpeakerWaveIcon />
              <span className="control-label">Audio</span>
            </Button>
            <div
              id="audio-panel"
              className="audio-panel"
              hidden={!audioOpen}
              role="region"
              aria-label="Audio settings"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setAudioOpen(false);
                  document.getElementById("audio-settings")?.focus();
                }
              }}
            >
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
                        outputSupported
                          ? outputs
                          : [{ value: "", label: "Use system audio settings" }]
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
            </div>
          </div>
        </ScreenStage>
        {(viewed || localScreen) && <div className="screen-participants">{participants}</div>}
        <RoomVoices
          peers={remotes}
          gainDb={volumeDb}
          output={output}
          onPeaks={setVoicePeaks}
          onError={reportError}
        />
        <footer>
          <span>
            <LockClosedIcon />
            Private room · No recording
          </span>
        </footer>
      </main>
    </TooltipProvider>
  );
}

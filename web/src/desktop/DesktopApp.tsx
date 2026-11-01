import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  BellIcon,
  Cog6ToothIcon,
  UserCircleIcon,
  UserGroupIcon,
  MusicalNoteIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { Session } from "../App.js";
import { Button, Select, MonitorSlider, TooltipProvider } from "../components/ui/index.js";
import { parseInvitation } from "../call/invitation.js";
import { randomId } from "../call/crypto.js";
import type { DesktopModel, DesktopVoiceSettings, DesktopWindow } from "../../shared/desktop.js";
import type { Participant } from "../../shared/presence.js";

const bridge = window.shareStreamDesktop!;
const initial: DesktopModel = {
  accounts: [],
  active: "",
  rooms: [],
  invitations: [],
  launch: null,
  error: "",
};
const defaults: DesktopVoiceSettings = {
  volumeDb: 0,
  peaks: [0, 0],
  voiceMode: "headphones",
  input: "",
  output: "",
  name: "",
  micBusy: false,
  micOpen: false,
  outputSupported: true,
  inputs: [{ value: "", label: "System default" }],
  outputs: [{ value: "", label: "System default" }],
};
const titles: Record<DesktopWindow, string> = {
  rooms: "Your rooms",
  account: "Account",
  create: "Create room",
  join: "Open invitation",
  rename: "Rename room",
  invite: "Invite people",
  notifications: "Invitations",
  settings: "Audio settings",
  participants: "Participants",
};
function useModel() {
  const [model, setModel] = useState(initial);
  useEffect(() => {
    const stop = bridge.onModel(setModel);
    void bridge.model().then(setModel);
    return stop;
  }, []);
  return model;
}
export function DesktopApp() {
  const model = useModel();
  const invite = useMemo(
    () =>
      model.launch
        ? {
            code: model.launch.code,
            relay: { host: model.launch.host, port: model.launch.port },
            autoJoin: true,
          }
        : null,
    [model.launch?.code, model.launch?.host, model.launch?.port],
  );
  if (bridge.window !== "main") return <DesktopPanel model={model} kind={bridge.window} />;
  const user = model.accounts.find((a) => a.id === model.active);
  const open = (kind: DesktopWindow) => void bridge.openWindow(kind);
  const actions = (
    <div className="room-header-actions">
      <Button onClick={() => open("rooms")}>
        <MusicalNoteIcon /> Rooms
      </Button>
      {model.launch && (
        <Button onClick={() => open("invite")}>
          <UserPlusIcon /> Invite
        </Button>
      )}
      <Button aria-label="Invitations" onClick={() => open("notifications")}>
        <BellIcon />
        {model.invitations.length || ""}
      </Button>
      <Button aria-label="Participants window" onClick={() => open("participants")}>
        <UserGroupIcon />
      </Button>
      <Button aria-label="Audio settings window" onClick={() => open("settings")}>
        <Cog6ToothIcon />
      </Button>
      <Button onClick={() => open("account")}>
        <UserCircleIcon />
        {user?.username || "Sign in"}
      </Button>
    </div>
  );
  const launch = model.launch;
  return (
    <div className="desktop-main">
      {model.error && (
        <p className="directory-banner directory-error" role="alert">
          {model.error}
        </p>
      )}
      {launch ? (
        <Session
          key={`${model.active}:${launch.code}:${launch.participant}`}
          invite={invite}
          token={launch.participant}
          name={launch.name}
          roomName={launch.roomName}
          actions={actions}
        />
      ) : (
        <main>
          <header className="page-header">
            <h1>
              Share Stream <span>/ Chat</span>
            </h1>
            {actions}
          </header>
          <section className="desktop-welcome">
            <MusicalNoteIcon />
            <h2>A little closer to the mix.</h2>
            <p>Open Voice & screen from your plugin, or choose a room here.</p>
            <Button onClick={() => open(user ? "rooms" : "account")}>
              {user ? "Choose a room" : "Sign in"}
            </Button>
            <Button variant="ghost" onClick={() => open("join")}>
              Enter invitation code
            </Button>
          </section>
        </main>
      )}
    </div>
  );
}
function DesktopPanel({ model, kind }: { model: DesktopModel; kind: DesktopWindow }) {
  const [value, setValue] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState(defaults);
  const [people, setPeople] = useState<Participant[]>([]);
  const user = model.accounts.find((a) => a.id === model.active);
  const room = model.rooms.find((r) => r.code === model.launch?.code);
  useEffect(() => {
    if (kind === "rename") setValue(room?.name || "");
  }, [kind, room?.id]);
  useEffect(() => {
    const apply = (name: string, value: unknown) => {
      if (name === "settings" && value) setVoice(value as DesktopVoiceSettings);
      if (name === "participants" && value) setPeople((value as { people: Participant[] }).people);
    };
    void bridge.snapshot("settings").then((value) => apply("settings", value));
    void bridge.snapshot("participants").then((value) => apply("participants", value));
    return bridge.onPublish(apply);
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError(
        (failure as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ""),
      );
    } finally {
      setBusy(false);
    }
  };
  const open = (window: DesktopWindow) => void bridge.openWindow(window);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      if (kind === "account") {
        await bridge.request(`/api/accounts/${register ? "register" : "login"}`, "POST", {
          username,
          password,
        });
        setPassword("");
        bridge.closeWindow();
      } else if (kind === "create") {
        await bridge.request("/api/rooms", "POST", {
          name: value || "Music room",
          code: randomId(),
          host: "stream.whitesquirrel.digital",
          port: 48100,
        });
        bridge.closeWindow();
      } else if (kind === "join") {
        const invite = parseInvitation(value);
        await bridge.request("/api/rooms/accept", "POST", { code: invite.code, ...invite.relay });
        bridge.closeWindow();
      } else if (kind === "rename" && room) {
        await bridge.request(`/api/rooms/${room.id}`, "PATCH", { name: value });
        bridge.closeWindow();
      } else if (kind === "invite" && room) {
        await bridge.request(`/api/rooms/${room.id}/invitations`, "POST", { username: value });
        setNotice("Invitation sent. They can accept it in the app.");
        setValue("");
      }
    });
  };
  const field = (
    <div className="field">
      <label htmlFor="panel-value">
        {kind === "invite" ? "Username" : kind === "join" ? "Invitation code or link" : "Room name"}
      </label>
      <input
        id="panel-value"
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        maxLength={kind === "join" ? 2048 : 60}
        required={kind !== "create"}
      />
    </div>
  );
  return (
    <TooltipProvider>
      <main className="desktop-panel">
        <header>
          <h1>{titles[kind]}</h1>
          <Button variant="ghost" onClick={() => bridge.closeWindow()}>
            Close
          </Button>
        </header>
        {error && (
          <p role="alert" className="directory-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {kind === "account" && (
          <>
            {model.accounts.map((account) => (
              <div className="desktop-list-item" key={account.id}>
                <span>
                  {account.name} <small>@{account.username}</small>
                </span>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await bridge.selectAccount(account.id);
                      bridge.closeWindow();
                    })
                  }
                >
                  {model.active === account.id ? "Signed in" : "Use account"}
                </Button>
              </div>
            ))}
            <form onSubmit={submit}>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  minLength={3}
                  maxLength={32}
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  autoComplete={register ? "new-password" : "current-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={3}
                  maxLength={128}
                />
              </div>
              <Button type="submit" disabled={busy}>
                {register ? "Create account" : "Sign in"}
              </Button>
              <Button variant="ghost" onClick={() => setRegister(!register)}>
                {register ? "I have an account" : "Create a new account"}
              </Button>
            </form>
            {user && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => bridge.request("/api/accounts/logout", "POST", {}))}
              >
                Sign out
              </Button>
            )}
          </>
        )}
        {kind === "rooms" && (
          <>
            <div className="desktop-actions">
              <Button onClick={() => open(user ? "create" : "account")}>Create room</Button>
              <Button onClick={() => open(user ? "join" : "account")}>Enter invitation code</Button>
            </div>
            {model.rooms.map((saved) => (
              <div className="desktop-list-item" key={saved.id}>
                <span>{saved.name}</span>
                <Button
                  onClick={() =>
                    void run(async () => {
                      await bridge.selectRoom(saved.code);
                      bridge.closeWindow();
                    })
                  }
                >
                  Join room
                </Button>
              </div>
            ))}
            {!model.rooms.length && <p>Create a room or open an invitation to get started.</p>}
            {room?.owner && (
              <Button variant="ghost" onClick={() => open("rename")}>
                Rename current room
              </Button>
            )}
          </>
        )}
        {["create", "join", "rename"].includes(kind) && (
          <form onSubmit={submit}>
            {field}
            <Button type="submit" disabled={busy}>
              {" "}
              {kind === "create" ? "Create and join" : kind === "join" ? "Join room" : "Save name"}
            </Button>
          </form>
        )}
        {kind === "invite" && model.launch && (
          <>
            <p>Send a code, or invite an account directly.</p>
            <code className="desktop-code">{model.launch.code}</code>
            <div className="desktop-actions">
              <Button
                onClick={() =>
                  void run(async () => {
                    await bridge.copyInvite();
                    setNotice("Room code copied.");
                  })
                }
              >
                Copy code
              </Button>
              <Button variant="ghost" onClick={() => void run(() => bridge.copyInvite(true))}>
                Copy link
              </Button>
            </div>
            {room?.owner ? (
              <form onSubmit={submit}>
                {field}
                <Button type="submit" disabled={busy}>
                  Send invitation
                </Button>
              </form>
            ) : (
              <p>The room owner can also send an invitation to a username.</p>
            )}
          </>
        )}
        {kind === "notifications" && (
          <>
            {!model.invitations.length && <p>No pending invitations.</p>}
            {model.invitations.map((invitation) => (
              <section className="desktop-invitation" key={invitation.id}>
                <h2>{invitation.room.name}</h2>
                <p>
                  {invitation.from.name} (@{invitation.from.username}) invited you.
                </p>
                <div className="desktop-actions">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await bridge.request(
                          `/api/invitations/${invitation.id}/accept`,
                          "POST",
                          {},
                        );
                        bridge.closeWindow();
                      })
                    }
                  >
                    Accept and join
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        bridge.request(`/api/invitations/${invitation.id}/decline`, "POST", {}),
                      )
                    }
                  >
                    Decline
                  </Button>
                </div>
              </section>
            ))}
          </>
        )}
        {kind === "settings" && (
          <>
            <MonitorSlider
              id="desktop-monitor"
              value={voice.volumeDb}
              peaks={voice.peaks}
              onValueChange={(value) => bridge.command("volumeDb", value)}
            />
            <Select
              id="desktop-voice-mode"
              label="Voice mode"
              value={voice.voiceMode}
              disabled={voice.micBusy}
              options={[
                { value: "headphones", label: "Headphones · unprocessed" },
                { value: "speakers", label: "Speakers · echo cancellation" },
              ]}
              onValueChange={(value) => bridge.command("voiceMode", value)}
            />
            <p className="small">
              Microphone and screen capture start only from the call controls.
            </p>
            <Select
              id="desktop-input"
              label="Microphone"
              value={voice.input}
              options={voice.inputs}
              disabled={voice.micBusy}
              onValueChange={(value) => bridge.command("input", value)}
            />
            <Select
              id="desktop-output"
              label="Voice output"
              value={voice.output}
              options={voice.outputs}
              disabled={!voice.outputSupported}
              onValueChange={(value) => bridge.command("output", value)}
            />
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                value={voice.name}
                maxLength={60}
                onChange={(event) => bridge.command("name", event.target.value)}
              />
            </div>
          </>
        )}
        {kind === "participants" && (
          <ul className="participant-list">
            {people.map((person) => (
              <li className="participant" key={person.id}>
                <div>
                  <strong>{person.name}</strong>
                  <p>
                    {person.music ? `Music: ${person.music}` : "Voice only"} ·{" "}
                    {person.speaking ? "Speaking" : person.mic ? "Mic on" : "Mic off"}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </TooltipProvider>
  );
}

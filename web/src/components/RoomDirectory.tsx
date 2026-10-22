import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronDownIcon,
  EllipsisHorizontalIcon,
  MusicalNoteIcon,
  PlusIcon,
  SpeakerWaveIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { Button, Menu, MenuItem, Modal } from "./ui/index.js";
import { randomId } from "../call/crypto.js";
import {
  parseInvitation,
  invitationLink,
  invitationParameters,
  type Invitation,
} from "../call/invitation.js";
import { participantToken } from "../call/useParticipants.js";
import {
  activeBrowserAccount,
  rememberBrowserAccount,
  refreshBrowserSession,
  migrateBrowserAccounts,
  browserRequest,
  BrowserRequestError,
  type BrowserSession,
  type Handoff,
  type DirectoryResponse,
} from "../call/browserSession.js";
import type { Account, SavedRoom } from "../../shared/directory.js";

type Selection = {
  invite: Invitation | null;
  token: string;
  name?: string;
  roomName?: string;
  actions?: ReactNode;
  guestBinding?: boolean;
};
type DialogKind = "account" | "create" | "accept" | "rename" | "invite" | "handoff" | null;
const guestBindingKey = "sharestream:guest-binding:v1";
function clearGuestBinding() {
  try {
    sessionStorage.removeItem(guestBindingKey);
  } catch {
    /* Storage is optional. */
  }
}
const pendingHandoffKey = "sharestream:pending-handoff:v1";
function markPendingHandoff(pending: boolean) {
  try {
    if (pending) sessionStorage.setItem(pendingHandoffKey, "1");
    else sessionStorage.removeItem(pendingHandoffKey);
  } catch {
    /* Storage is optional. */
  }
}
// Capture before StrictMode initializes twice. Handoffs never reach invite parsing.
const launch = (() => {
  let ticket = "",
    suppliedParticipant = "",
    invite: Invitation | null = null;
  try {
    const parameters = invitationParameters(location.hash);
    ticket = parameters.get("handoff") || "";
    suppliedParticipant = parameters.get("participant") || "";
  } catch {
    /* Invalid invitation. */
  }
  if (ticket) history.replaceState(null, "", "/connect");
  else {
    try {
      invite = parseInvitation(location.href);
    } catch {
      /* Directory landing page. */
    }
  }
  let token = ticket ? randomId() : participantToken(invite?.code || null);
  let guestBinding = !!invite && /^[a-f0-9]{32}$/.test(suppliedParticipant);
  try {
    if (guestBinding)
      sessionStorage.setItem(guestBindingKey, JSON.stringify({ code: invite!.code, token }));
    else if (!ticket && invite) {
      const previous = JSON.parse(sessionStorage.getItem(guestBindingKey) || "null") as {
        code?: string;
        token?: string;
      } | null;
      if (previous?.code === invite.code && /^[a-f0-9]{32}$/.test(previous.token || "")) {
        token = previous.token!;
        guestBinding = true;
      }
    }
  } catch {
    /* Guest invitations work without storage. */
  }
  if (invite) history.replaceState(null, "", invitationLink(invite, location.origin, false));
  let interrupted = false;
  try {
    interrupted = !ticket && !!sessionStorage.getItem(pendingHandoffKey);
  } catch {
    /* Storage is optional. */
  }
  markPendingHandoff(false);
  return { ticket, invite, token, interrupted, guestBinding };
})();

export function RoomDirectory({ children }: { children: (selection: Selection) => ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [active, setActive] = useState(activeBrowserAccount);
  const activeRef = useRef(active);
  activeRef.current = active;
  const current = accounts.find((a) => a.id === active);
  const [selection, setSelection] = useState<Selection>({
    invite: launch.invite,
    token: launch.token,
    guestBinding: launch.guestBinding,
  });
  const [ready, setReady] = useState(false);
  const [rooms, setRooms] = useState<SavedRoom[]>([]);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expired, setExpired] = useState(false);
  const selected = rooms.find((r) => r.code === selection.invite?.code);
  const bootstrap = useRef<Promise<{
    session: BrowserSession;
    active: string;
    handoff?: Handoff;
    rooms: SavedRoom[];
  }> | null>(null);
  const setAccount = useCallback((id: string) => {
    activeRef.current = id;
    setActive(id);
    rememberBrowserAccount(id);
  }, []);
  const reset = useCallback(() => {
    clearGuestBinding();
    history.replaceState(null, "", "/");
    setSelection({ invite: null, token: randomId() });
    setRooms([]);
    setError("");
    setNotice("");
  }, []);
  const applySession = useCallback(
    (session: BrowserSession) => {
      setAccounts(session.accounts);
      if (activeRef.current && !session.accounts.some((a) => a.id === activeRef.current)) {
        reset();
        setAccount("");
      }
    },
    [reset, setAccount],
  );
  const open = useCallback((room: SavedRoom, user: Account | undefined, autoJoin = false) => {
    clearGuestBinding();
    const invite = { code: room.code, relay: { host: room.host, port: room.port }, autoJoin };
    history.replaceState(null, "", invitationLink(invite, location.origin, false));
    setSelection({ invite, token: room.participant, name: user?.name, roomName: room.name });
  }, []);
  const finishHandoff = useCallback(
    async (pending: Handoff) => {
      const data = await browserRequest<DirectoryResponse & BrowserSession>(
        "/api/browser/handoffs/confirm",
        "POST",
        { handoffId: pending.handoffId },
      );
      const room = data.rooms?.find((r) => r.id === data.selected);
      if (!data.user || !room)
        throw new Error("The room could not be opened. Open it again from the app.");
      reset();
      setAccounts(data.accounts);
      setAccount(data.user.id);
      setRooms(data.rooms || []);
      open(room, data.user, true);
      markPendingHandoff(false);
      setHandoff(null);
      setDialog(null);
      setReady(true);
    },
    [open, reset, setAccount],
  );
  useEffect(() => {
    let live = true;
    bootstrap.current ||= (async () => {
      const session = await migrateBrowserAccounts(await refreshBrowserSession());
      const remembered = activeBrowserAccount();
      const id = session.accounts.some((a) => a.id === remembered)
        ? remembered
        : session.accounts.length === 1
          ? session.accounts[0].id
          : "";
      const pending = launch.ticket
        ? await browserRequest<Handoff>("/api/browser/handoffs/prepare", "POST", {
            ticket: launch.ticket,
            ...(id ? { accountId: id } : {}),
          })
        : undefined;
      const data =
        id && !pending ? await browserRequest("/api/rooms", "GET", undefined, id) : undefined;
      return { session, active: id, handoff: pending, rooms: data?.rooms || [] };
    })();
    void bootstrap.current
      .then(async (result) => {
        if (!live) return;
        setAccounts(result.session.accounts);
        setAccount(result.active);
        setRooms(result.rooms);
        if (result.handoff) {
          markPendingHandoff(true);
          setHandoff(result.handoff);
          if (result.handoff.confirmationRequired) {
            setDialog("handoff");
            setReady(false);
          } else await finishHandoff(result.handoff);
        } else {
          setReady(true);
          if (launch.interrupted)
            setError("The app connection was interrupted. Open Voice & screen again from the app.");
        }
      })
      .catch((failure) => {
        if (live) {
          setExpired(failure instanceof BrowserRequestError && failure.status === 401);
          setError(
            launch.ticket
              ? `${(failure as Error).message} Open Voice & screen again from the app.`
              : (failure as Error).message,
          );
          // Never mount a known account invitation with a guest identity after a directory failure.
          setReady(!activeRef.current || !!launch.ticket);
        }
      });
    return () => {
      live = false;
    };
  }, [setAccount, finishHandoff]);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    const refresh = () =>
      void refreshBrowserSession()
        .then((data) => {
          if (live) applySession(data);
        })
        .catch((failure) => {
          if (live && failure instanceof BrowserRequestError && failure.status === 401)
            setExpired(true);
        });
    const timer = setInterval(refresh, 5000);
    const channel =
      typeof BroadcastChannel === "function" ? new BroadcastChannel("sharestream:accounts") : null;
    if (channel) channel.onmessage = refresh;
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      clearInterval(timer);
      channel?.close();
      window.removeEventListener("focus", refresh);
    };
  }, [applySession, ready]);
  useEffect(() => {
    if (!ready || !current) return;
    let live = true;
    const refresh = () =>
      void browserRequest("/api/rooms", "GET", undefined, current.id)
        .then((data) => {
          if (live) setRooms(data.rooms || []);
        })
        .catch(async (failure) => {
          if (!live) return;
          if (failure instanceof BrowserRequestError && failure.status === 401) {
            // Only a successful current-cookie lookup can prove this account was
            // revoked. An old in-flight cookie must not stop another tab's call.
            try {
              const session = await refreshBrowserSession();
              if (live) applySession(session);
            } catch {
              if (live) setExpired(true);
            }
          }
          setError((failure as Error).message);
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [current?.id, ready, applySession]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const show = (kind: DialogKind) => {
    setError("");
    setNotice("");
    setValue(kind === "rename" ? selected?.name || "" : "");
    setDialog(kind);
  };
  const switchAccount = (id: string) => {
    reset();
    setAccount(id);
    setDialog(null);
  };
  const requireAccount = (kind: DialogKind) => {
    if (current) show(kind);
    else show("account");
  };
  const notifyAccounts = () => {
    if (typeof BroadcastChannel === "function") {
      const channel = new BroadcastChannel("sharestream:accounts");
      channel.postMessage("changed");
      channel.close();
    }
  };
  const saveInvite = async () => {
    const invite = parseInvitation(value);
    if (!current) {
      clearGuestBinding();
      history.replaceState(null, "", invitationLink(invite, location.origin, false));
      setSelection({
        invite: { ...invite, autoJoin: false },
        token: participantToken(invite.code),
      });
      setDialog(null);
      return;
    }
    const data = await browserRequest(
      "/api/rooms/accept",
      "POST",
      { code: invite.code, ...invite.relay },
      current.id,
    );
    setRooms(data.rooms || []);
    const room = data.rooms?.find((r) => r.id === data.selected);
    if (room) open(room, current);
    setDialog(null);
  };
  const actions = (
    <div className="room-header-actions">
      {selection.invite && (
        <Button aria-label="Invite people" onClick={() => show("invite")}>
          <UserPlusIcon />
          <span className="action-label">Invite</span>
        </Button>
      )}
      <Menu
        label="Room actions"
        trigger={
          <Button variant="ghost" className="icon-button" aria-label="Room actions" disabled={busy}>
            <EllipsisHorizontalIcon />
          </Button>
        }
      >
        {selected?.owner && <MenuItem onSelect={() => show("rename")}>Rename room</MenuItem>}
        {selection.invite && <MenuItem onSelect={() => show("invite")}>Invite people</MenuItem>}
        {selection.invite && !selected && current && (
          <MenuItem
            onSelect={() =>
              void run(async () => {
                const invite = selection.invite!;
                const data = await browserRequest(
                  "/api/rooms/accept",
                  "POST",
                  { code: invite.code, ...invite.relay },
                  current.id,
                );
                setRooms(data.rooms || []);
                setNotice("Room added to your list.");
              })
            }
          >
            Save this room
          </MenuItem>
        )}
        <MenuItem onSelect={() => show("accept")}>Open invitation</MenuItem>
      </Menu>
    </div>
  );
  return (
    <div className="app-shell">
      <aside className="room-sidebar">
        <div className="brand">
          <MusicalNoteIcon />
          <span>Share Stream</span>
        </div>
        <div className="room-list-heading">
          <span>Rooms</span>
          <Menu
            label="Add room"
            trigger={
              <Button variant="ghost" className="icon-button" aria-label="Add room" disabled={busy}>
                <PlusIcon />
              </Button>
            }
          >
            <MenuItem onSelect={() => requireAccount("create")}>Create room</MenuItem>
            <MenuItem onSelect={() => show("accept")}>Open invitation</MenuItem>
          </Menu>
        </div>
        <nav className="room-list" aria-label="Saved rooms">
          {rooms.map((room) => (
            <Button
              key={room.id}
              variant="ghost"
              className="room-item"
              aria-current={selected?.id === room.id ? "page" : undefined}
              disabled={busy}
              onClick={() => open(room, current)}
            >
              <SpeakerWaveIcon />
              <span>{room.name}</span>
            </Button>
          ))}
          {!rooms.length && (
            <p className="small room-empty">
              {current
                ? "Create a room or open an invitation."
                : "Sign in to keep your rooms, or open an invitation."}
            </p>
          )}
        </nav>
        <div className="profile-area">
          <Menu
            label="Accounts"
            trigger={
              <Button
                variant="ghost"
                className="profile-button"
                aria-label={`Account: ${current?.username || "Guest"}`}
                disabled={busy}
              >
                <span className="avatar">{current?.name[0]?.toUpperCase() || "G"}</span>
                <span>
                  <strong>{current?.username || "Guest"}</strong>
                  <small>{current ? "Your account" : "Not signed in"}</small>
                </span>
                <ChevronDownIcon />
              </Button>
            }
          >
            {accounts.map((account) => (
              <MenuItem key={account.id} onSelect={() => switchAccount(account.id)}>
                {account.username}
                {account.id === active ? " · current" : ""}
              </MenuItem>
            ))}
            <MenuItem onSelect={() => show("account")}>
              {current ? "Add account" : "Sign in"}
            </MenuItem>
            {current && (
              <MenuItem
                onSelect={() =>
                  void run(async () => {
                    const data = await browserRequest<BrowserSession>(
                      "/api/browser/logout",
                      "POST",
                      { accountId: current.id },
                    );
                    reset();
                    setAccount("");
                    setAccounts(data.accounts);
                    notifyAccounts();
                  })
                }
              >
                Sign out
              </MenuItem>
            )}
          </Menu>
        </div>
      </aside>
      <div className="room-workspace">
        {expired && (
          <div className="directory-banner">
            <p className="small">
              Your browser session expired. Reconnect to sign in or continue from the app.
            </p>
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const session = await browserRequest<BrowserSession>(
                    "/api/browser/reset",
                    "POST",
                    {},
                  );
                  applySession(session);
                  setExpired(false);
                  if (launch.ticket && !handoff) {
                    const pending = await browserRequest<Handoff>(
                      "/api/browser/handoffs/prepare",
                      "POST",
                      { ticket: launch.ticket, accountId: activeRef.current },
                    );
                    setHandoff(pending);
                    setDialog("handoff");
                    setReady(false);
                  }
                })
              }
            >
              Reconnect
            </Button>
          </div>
        )}
        {!dialog && error && (
          <p role="alert" className="directory-error directory-banner">
            {error}
          </p>
        )}
        {!dialog && notice && (
          <p role="status" className="directory-banner small">
            {notice}
          </p>
        )}
        {ready ? (
          children({
            ...selection,
            name: selection.guestBinding ? selection.name : current?.name || selection.name,
            roomName: selected?.name || selection.roomName,
            token: selection.guestBinding
              ? selection.token
              : selected?.participant || selection.token,
            actions,
          })
        ) : (
          <div className="loading-room" role="status">
            {handoff
              ? "Confirm your account to open the room."
              : error
                ? "Your rooms could not be opened."
                : "Opening your rooms…"}
            {error && !handoff && <Button onClick={() => location.reload()}>Retry</Button>}
          </div>
        )}
      </div>
      <Modal
        open={dialog !== null}
        onOpenChange={(next) => {
          if (!next) {
            setDialog(null);
            setPassword("");
            if (handoff) {
              markPendingHandoff(false);
              setHandoff(null);
              setReady(true);
            }
          }
        }}
        title={
          dialog === "account"
            ? register
              ? "Create account"
              : "Sign in"
            : dialog === "create"
              ? "Create room"
              : dialog === "accept"
                ? "Open invitation"
                : dialog === "rename"
                  ? "Rename room"
                  : dialog === "handoff"
                    ? "Continue from the app"
                    : "Invite people"
        }
      >
        {dialog === "account" && (
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const data = await browserRequest<BrowserSession & { user: Account }>(
                  `/api/browser/${register ? "register" : "login"}`,
                  "POST",
                  { username, password },
                );
                reset();
                setAccounts(data.accounts);
                setAccount(data.user.id);
                setPassword("");
                setUsername("");
                setRegister(false);
                setDialog(null);
                notifyAccounts();
              });
            }}
          >
            <label>
              Username
              <input
                aria-label="Username"
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Password
              <input
                aria-label="Password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              {register ? "Create account" : "Sign in"}
            </Button>
            <Button variant="ghost" onClick={() => setRegister(!register)}>
              {register ? "Use existing account" : "Register"}
            </Button>
          </form>
        )}
        {(dialog === "create" || dialog === "rename") && (
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (!current) return;
                const data = await browserRequest(
                  dialog === "create" ? "/api/rooms" : `/api/rooms/${selected!.id}`,
                  dialog === "create" ? "POST" : "PATCH",
                  dialog === "create" ? { code: randomId(), name: value } : { name: value },
                  current.id,
                );
                setRooms(data.rooms || []);
                const room = data.rooms?.find((r) => r.id === data.selected);
                if (room) open(room, current);
                setDialog(null);
              });
            }}
          >
            <label>
              {dialog === "create" ? "New room name" : "Room name"}
              <input
                aria-label={dialog === "create" ? "New room name" : "Room name"}
                required
                maxLength={60}
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              {dialog === "create" ? "Create room" : "Save name"}
            </Button>
          </form>
        )}
        {dialog === "accept" && (
          <form
            className="dialog-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(saveInvite);
            }}
          >
            <label>
              Room invitation
              <input
                aria-label="Room invitation"
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            <Button type="submit" variant="primary" disabled={busy}>
              Open room
            </Button>
          </form>
        )}
        {dialog === "invite" && selection.invite && (
          <div className="dialog-form">
            <p className="small">
              {selected?.name || "Anyone with this invitation can join the room."}
            </p>
            {selected?.owner && (
              <form
                className="dialog-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    const data = await browserRequest(
                      `/api/rooms/${selected.id}/invitations`,
                      "POST",
                      { username: value },
                      current!.id,
                    );
                    setRooms(data.rooms || []);
                    setValue("");
                    setNotice("Room added to that user's list.");
                  });
                }}
              >
                <label>
                  Invite username
                  <input
                    aria-label="Invite username"
                    required
                    maxLength={32}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  Invite user
                </Button>
              </form>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await navigator.clipboard.writeText(
                    invitationLink(selection.invite!, location.origin),
                  );
                  setNotice("Invitation copied. Anyone with this link can join.");
                })
              }
            >
              Copy room invite
            </Button>
            {selected && (
              <details>
                <summary>Room members · {selected.members.length}</summary>
                <p className="small">{selected.members.map((m) => `@${m.username}`).join(", ")}</p>
              </details>
            )}
          </div>
        )}
        {dialog === "handoff" && handoff && (
          <div className="dialog-form">
            <p>
              Open <strong>{handoff.room.name}</strong> as <strong>@{handoff.user.username}</strong>
              .
            </p>
            <p className="small">
              Your microphone and screen stay off. Your other browser tabs keep their accounts.
            </p>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(() => finishHandoff(handoff))}
            >
              Continue as @{handoff.user.username}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="directory-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="small">
            {notice}
          </p>
        )}
      </Modal>
    </div>
  );
}

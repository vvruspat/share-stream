import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, Select } from "./ui/index.js";
import { randomId } from "../call/crypto.js";
import { parseInvitation, invitationLink, type Invitation } from "../call/invitation.js";
import { participantToken } from "../call/useParticipants.js";
import type { SavedAccount, SavedRoom } from "../../shared/directory.js";

type Selection = { invite: Invitation | null; token: string; name?: string; roomName?: string };
const storageKey = "sharestream:accounts:v1";
function stored(): { accounts: SavedAccount[]; active: string } {
  try {
    const data = JSON.parse(localStorage.getItem(storageKey) || "null") as {
      accounts?: SavedAccount[];
      active?: string;
    } | null;
    return {
      accounts: Array.isArray(data?.accounts)
        ? data.accounts.filter((a) => a?.user?.id && /^[a-f0-9]{64}$/.test(a.token))
        : [],
      active: data?.active || "",
    };
  } catch {
    return { accounts: [], active: "" };
  }
}
function initialSelection(): Selection {
  let invite: Invitation | null = null;
  try {
    invite = parseInvitation(location.href);
  } catch {
    /* Room directory landing page. */
  }
  return { invite, token: participantToken(invite?.code || null) };
}
export function RoomDirectory({ children }: { children: (selection: Selection) => ReactNode }) {
  const [saved, setSaved] = useState(stored);
  const current = saved.accounts.find((a) => a.user.id === saved.active);
  const [selection, setSelection] = useState(initialSelection);
  const [directoryReady, setDirectoryReady] = useState(!current);
  const [rooms, setRooms] = useState<SavedRoom[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [register, setRegister] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [inviteText, setInviteText] = useState("");
  const [inviteUser, setInviteUser] = useState("");
  const [rename, setRename] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selected = rooms.find((r) => r.code === selection.invite?.code);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      setError("Account switching cannot be remembered in this browser.");
    }
  }, [saved]);
  const request = useCallback(
    async (path: string, method = "GET", body?: unknown, token = current?.token) => {
      const response = await fetch(path, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      const data = (await response.json()) as {
        rooms?: SavedRoom[];
        selected?: string;
        error?: string;
      } & Partial<SavedAccount>;
      if (!response.ok) throw new Error(data.error || "The room service is unavailable.");
      return data;
    },
    [current?.token],
  );
  useEffect(() => {
    let live = true;
    setRooms([]);
    if (!current) {
      setDirectoryReady(true);
      return;
    }
    setDirectoryReady(false);
    const refresh = () =>
      void request("/api/rooms")
        .then((data) => {
          if (live) {
            setRooms(data.rooms || []);
            setDirectoryReady(true);
          }
        })
        .catch((failure) => {
          if (live) {
            setError(String((failure as Error).message));
            setDirectoryReady(true);
          }
        });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [request, current]);
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
  const open = (room: SavedRoom, autoJoin = true) => {
    const invite = { code: room.code, relay: { host: room.host, port: room.port }, autoJoin };
    history.replaceState(null, "", invitationLink(invite, location.origin, false));
    setSelection({
      invite,
      token: room.participant,
      name: current?.user.name,
      roomName: room.name,
    });
    setRename(room.name);
    setInviteUser("");
  };
  const reset = () => {
    history.replaceState(null, "", "/");
    setSelection({ invite: null, token: randomId() });
    setRooms([]);
    setError("");
    setNotice("");
  };
  // Account membership supplies the same private participant binding on native
  // and web clients. A legacy invitation still works without an account.
  useEffect(() => {
    setRename(selected?.name || "");
  }, [selected?.id, selected?.name]);
  const saveInvite = async (value: string) => {
    const invite = parseInvitation(value);
    const data = await request("/api/rooms/accept", "POST", { code: invite.code, ...invite.relay });
    setRooms(data.rooms || []);
    const room = data.rooms?.find((r) => r.id === data.selected);
    if (room) open(room, false);
    setInviteText("");
  };
  return (
    <>
      <section className="directory panel" aria-label="Accounts and rooms">
        <div className="directory-account">
          <div>
            <h2>Your rooms</h2>
            <p className="small">
              Rooms stay here when everyone leaves. Music, voice and screen support two people at a
              time.
            </p>
          </div>
          {!!saved.accounts.length && (
            <Select
              id="account-switch"
              label="Account"
              value={current?.user.id || ""}
              disabled={busy}
              options={[
                { value: "", label: "Choose an account" },
                ...saved.accounts.map((a) => ({
                  value: a.user.id,
                  label: `${a.user.name} (@${a.user.username})`,
                })),
              ]}
              onValueChange={(id) => {
                reset();
                setSaved((previous) => ({ ...previous, active: id }));
                setAddingAccount(false);
              }}
            />
          )}
          {current && (
            <>
              <Button disabled={busy} onClick={() => setAddingAccount(!addingAccount)}>
                Add account
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    try {
                      await request("/api/accounts/logout", "POST", {});
                    } finally {
                      reset();
                      setSaved((previous) => ({
                        accounts: previous.accounts.filter((a) => a.user.id !== current.user.id),
                        active: "",
                      }));
                    }
                  })
                }
              >
                Sign out
              </Button>
            </>
          )}
        </div>
        {(!current || addingAccount) && (
          <form
            className="directory-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const data = await request(
                  `/api/accounts/${register ? "register" : "login"}`,
                  "POST",
                  { username, password },
                );
                if (!data.user || !data.token) throw new Error("Invalid account response.");
                const next = { user: data.user, token: data.token };
                if (current) reset();
                setSaved((previous) => ({
                  accounts: [...previous.accounts.filter((a) => a.user.id !== next.user.id), next],
                  active: next.user.id,
                }));
                setPassword("");
                setUsername("");
                setRegister(false);
                setAddingAccount(false);
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
            <Button disabled={busy} onClick={() => setRegister(!register)}>
              {register ? "Use existing account" : "Register"}
            </Button>
            <p className="small">
              Accounts stay signed in on this device for 30 days. Passwords are never saved here.
            </p>
          </form>
        )}
        {current && (
          <div className="directory-body">
            <nav className="room-list" aria-label="Saved rooms">
              {!rooms.length && (
                <p className="small">
                  Create a room or save an invitation. Invitations sent to your username appear here
                  automatically.
                </p>
              )}
              {rooms.map((room) => (
                <Button
                  key={room.id}
                  active={selected?.id === room.id}
                  disabled={busy}
                  onClick={() => open(room)}
                >
                  <span>{room.name}</span>
                  <span className="small">
                    {room.members.length} members · {room.owner ? "Owner" : "Member"}
                  </span>
                </Button>
              ))}
            </nav>
            <div className="room-actions">
              <form
                className="directory-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const data = await request("/api/rooms", "POST", {
                      code: randomId(),
                      name: roomName,
                    });
                    setRooms(data.rooms || []);
                    const room = data.rooms?.find((r) => r.id === data.selected);
                    if (room) open(room, false);
                    setRoomName("");
                  });
                }}
              >
                <label>
                  New room name
                  <input
                    aria-label="New room name"
                    required
                    maxLength={60}
                    value={roomName}
                    onChange={(e) => setRoomName(e.target.value)}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  Create room
                </Button>
              </form>
              <form
                className="directory-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(() => saveInvite(inviteText));
                }}
              >
                <label>
                  Room invitation
                  <input
                    aria-label="Room invitation"
                    required
                    value={inviteText}
                    onChange={(e) => setInviteText(e.target.value)}
                  />
                </label>
                <Button type="submit" disabled={busy}>
                  Save invitation
                </Button>
              </form>
              {selection.invite && !selected && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      saveInvite(invitationLink(selection.invite!, location.origin, false)),
                    )
                  }
                >
                  Save current room
                </Button>
              )}
              {selected && (
                <>
                  <div className="directory-form">
                    <strong>{selected.name}</strong>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await navigator.clipboard.writeText(
                            invitationLink(
                              {
                                code: selected.code,
                                relay: { host: selected.host, port: selected.port },
                              },
                              location.origin,
                              false,
                            ),
                          );
                          setNotice(
                            "Invitation copied. Anyone with this link can save and join the room.",
                          );
                        })
                      }
                    >
                      Copy room invite
                    </Button>
                  </div>
                  <p className="small">
                    {selected.members.map((m) => `@${m.username}`).join(", ")}
                  </p>
                  {selected.owner && (
                    <>
                      <form
                        className="directory-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            const data = await request(`/api/rooms/${selected.id}`, "PATCH", {
                              name: rename,
                            });
                            setRooms(data.rooms || []);
                          });
                        }}
                      >
                        <label>
                          Room name
                          <input
                            aria-label="Room name"
                            required
                            maxLength={60}
                            value={rename}
                            onChange={(e) => setRename(e.target.value)}
                          />
                        </label>
                        <Button type="submit" disabled={busy}>
                          Rename room
                        </Button>
                      </form>
                      <form
                        className="directory-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void run(async () => {
                            const data = await request(
                              `/api/rooms/${selected.id}/invitations`,
                              "POST",
                              { username: inviteUser },
                            );
                            setRooms(data.rooms || []);
                            setInviteUser("");
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
                            value={inviteUser}
                            onChange={(e) => setInviteUser(e.target.value)}
                          />
                        </label>
                        <Button type="submit" disabled={busy}>
                          Invite user
                        </Button>
                      </form>
                    </>
                  )}
                </>
              )}
            </div>
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
      </section>
      {directoryReady &&
        children({
          ...selection,
          token: selected?.participant || selection.token,
          name: selected ? current?.user.name : selection.name,
          roomName: selected?.name || selection.roomName,
        })}
    </>
  );
}

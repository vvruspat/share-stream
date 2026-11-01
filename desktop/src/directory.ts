import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import type {
  Account,
  SavedAccount,
  SavedRoom,
  RoomInvitation,
} from "../../web/shared/directory.js" with { "resolution-mode": "import" };
import type { DesktopModel, DesktopLaunch } from "../../web/shared/desktop.js" with {
  "resolution-mode": "import",
};

export type NativeState = {
  accounts: SavedAccount[];
  active?: string;
  room?: DesktopLaunch;
  launch?: DesktopLaunch & { id: string; panel?: string };
};
export type Helper = (command: Record<string, unknown>) => Promise<unknown>;
export function serverOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("The account server must use HTTPS.");
  return url.origin;
}
export function permittedRequest(path: string, method: string): boolean {
  return (
    (method === "GET" && ["/api/rooms", "/api/invitations"].includes(path)) ||
    (method === "POST" && /^\/api\/accounts\/(login|register|logout)$/.test(path)) ||
    (method === "POST" && ["/api/rooms", "/api/rooms/accept"].includes(path)) ||
    (method === "PATCH" && /^\/api\/rooms\/[a-f0-9]{64}$/.test(path)) ||
    (method === "POST" && /^\/api\/rooms\/[a-f0-9]{64}\/invitations$/.test(path)) ||
    (method === "POST" && /^\/api\/invitations\/[a-f0-9]{32}\/(accept|decline)$/.test(path))
  );
}
export class DesktopDirectory extends EventEmitter {
  model: DesktopModel = {
    accounts: [],
    active: "",
    rooms: [],
    invitations: [],
    launch: null,
    error: "",
  };
  private state: NativeState = { accounts: [] };
  private snapshot = "";
  private lastLaunch = "";
  private refreshed = 0;
  private polling = false;
  constructor(
    readonly origin: string,
    private readonly file: string,
    private readonly helper: Helper,
  ) {
    super();
  }
  private changed() {
    this.emit("model", this.model);
  }
  private async api(path: string, method = "GET", body?: unknown, credential = this.credential()) {
    const response = await fetch(this.origin + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(credential ? { Authorization: `Bearer ${credential}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    const data = (await response.json()) as {
      error?: string;
      user?: Account;
      token?: string;
      rooms?: SavedRoom[];
      invitations?: RoomInvitation[];
      selected?: string;
    };
    if (!response.ok) throw new Error(data.error || "Account service unavailable.");
    return data;
  }
  private credential() {
    return this.state.accounts.find((a) => a.user.id === this.model.active)?.token || "";
  }
  async refreshLocal() {
    try {
      await this.syncLocal();
    } catch (error) {
      this.model = { ...this.model, error: (error as Error).message };
      this.changed();
    }
  }
  private async syncLocal(): Promise<NativeState> {
    let state: NativeState = { accounts: [] };
    try {
      const bytes = await readFile(this.file, "utf8");
      if (bytes.length > 262144) throw new Error("Account store is too large.");
      state = JSON.parse(bytes) as NativeState;
      if (!Array.isArray(state.accounts)) throw new Error("Invalid account store.");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const snapshot = JSON.stringify([state.accounts, state.active]);
    const changed = this.model.active !== (state.active || "");
    this.state = state;
    if (snapshot !== this.snapshot) {
      this.snapshot = snapshot;
      this.refreshed = 0;
      this.model = {
        ...this.model,
        accounts: state.accounts.map((a) => ({
          id: a.user.id,
          username: a.user.username,
          name: a.user.name,
        })),
        active: state.active || "",
        error: "",
        ...(changed ? { rooms: [], invitations: [], launch: null } : {}),
      };
      this.changed();
    }
    return state;
  }
  async poll(force = false) {
    if (this.polling) return;
    this.polling = true;
    try {
      const state = await this.syncLocal();
      if (this.credential() && (force || Date.now() - this.refreshed > 5000)) {
        this.refreshed = Date.now();
        const active = this.model.active,
          data = await this.api("/api/rooms");
        if (active === this.model.active) {
          this.model = {
            ...this.model,
            rooms: data.rooms || [],
            invitations: data.invitations || [],
            error: "",
          };
          const selected = this.model.rooms.find((r) => r.code === this.model.launch?.code);
          if (selected && this.model.launch)
            this.model.launch = {
              ...this.model.launch,
              roomName: selected.name,
              participant: selected.participant,
            };
          this.changed();
        }
      }
      if (
        state.launch?.id &&
        state.launch.id !== this.lastLaunch &&
        (!state.launch.accountId || state.launch.accountId === this.model.active)
      ) {
        this.lastLaunch = state.launch.id;
        await this.openRoom(state.launch);
        this.emit("launch", state.launch.panel);
      } else if (
        !this.model.launch &&
        state.room &&
        (!state.room.accountId || state.room.accountId === this.model.active)
      ) {
        await this.openRoom(state.room);
      }
    } catch (error) {
      this.model = { ...this.model, error: (error as Error).message };
      this.changed();
    } finally {
      this.polling = false;
    }
  }
  async request(path: string, method = "GET", body?: unknown): Promise<DesktopModel> {
    if (!permittedRequest(path, method) || JSON.stringify(body ?? {}).length > 4096)
      throw new Error("This account operation is not available.");
    if (/^\/api\/accounts\/(login|register)$/.test(path)) {
      const data = await this.api(path, method, body, "");
      await this.helper({ operation: "put", user: data.user, token: data.token });
      await this.syncLocal();
      await this.poll(true);
    } else if (path === "/api/accounts/logout") {
      const id = this.model.active;
      try {
        await this.api(path, method, {});
      } finally {
        await this.helper({ operation: "remove", id });
        await this.syncLocal();
        await this.poll(true);
      }
    } else {
      if (!this.credential()) throw new Error("Sign in to your account.");
      const actingAccount = this.model.active;
      const data = await this.api(path, method, body);
      await this.syncLocal();
      if (actingAccount !== this.model.active)
        throw new Error("The active account changed. Try again.");
      this.model = {
        ...this.model,
        rooms: data.rooms || [],
        invitations: data.invitations || [],
        error: "",
      };
      const room = this.model.rooms.find((r) => r.id === data.selected);
      if (room) await this.chooseRoom(room.code);
      else if (this.model.launch) {
        const selected = this.model.rooms.find((r) => r.code === this.model.launch!.code);
        if (selected) this.model.launch = { ...this.model.launch, roomName: selected.name };
      }
      this.changed();
    }
    return this.model;
  }
  async selectAccount(id: string) {
    if (id === this.model.active) return;
    await this.helper({ operation: "select", id });
    await this.syncLocal();
    await this.poll(true);
  }
  async chooseRoom(code: string) {
    const room = this.model.rooms.find((r) => r.code === code);
    if (!room) throw new Error("Choose a room from your account.");
    const launch: DesktopLaunch = {
      code: room.code,
      host: room.host,
      port: room.port,
      participant: room.participant,
      roomName: room.name,
      accountId: this.model.active,
    };
    await this.helper({ operation: "room", room: launch });
    await this.openRoom(launch);
    this.emit("launch");
  }
  private async openRoom(launch: DesktopLaunch) {
    const actingAccount = this.model.active;
    if (launch.accountId && launch.accountId !== actingAccount)
      throw new Error("The active account changed. Open the room again.");
    if (
      !/^[a-f0-9]{32}$/.test(launch.code) ||
      !/^[a-f0-9]{32}$/.test(launch.participant || "") ||
      !/^[a-z\d.-]{1,253}$/i.test(launch.host) ||
      !Number.isInteger(launch.port) ||
      launch.port < 1 ||
      launch.port > 65535
    )
      throw new Error("The application received an invalid room.");
    let saved = this.model.rooms.find((r) => r.code === launch.code);
    if (this.credential() && !saved) {
      const data = await this.api("/api/rooms/accept", "POST", {
        code: launch.code,
        host: launch.host,
        port: launch.port,
      });
      await this.syncLocal();
      if (actingAccount !== this.model.active)
        throw new Error("The active account changed. Open the room again.");
      this.model.rooms = data.rooms || [];
      saved = this.model.rooms.find((r) => r.code === launch.code);
    }
    if (
      saved &&
      (this.state.room?.participant !== saved.participant ||
        this.state.room?.accountId !== this.model.active)
    )
      await this.helper({
        operation: "room",
        room: {
          ...launch,
          participant: saved.participant,
          roomName: saved.name,
          accountId: this.model.active,
        },
      });
    await this.syncLocal();
    if (actingAccount !== this.model.active)
      throw new Error("The active account changed. Open the room again.");
    this.model = {
      ...this.model,
      launch: {
        code: launch.code,
        host: launch.host,
        port: launch.port,
        participant: saved?.participant || launch.participant,
        roomName: saved?.name || launch.roomName,
        accountId: this.model.active,
        name: this.model.accounts.find((a) => a.id === this.model.active)?.name,
      },
      error: "",
    };
    this.changed();
  }
}

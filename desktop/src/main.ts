import {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  dialog,
  ipcMain,
  net,
  Notification,
  protocol,
  session,
} from "electron";
import type { IpcMainInvokeEvent, IpcMainEvent } from "electron";
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DesktopDirectory, serverOrigin } from "./directory.js";
import type { DesktopWindow } from "../../web/shared/desktop.js" with {
  "resolution-mode": "import",
};

const origin = serverOrigin(
  process.env.SHARE_STREAM_DIRECTORY_URL || "https://stream.whitesquirrel.digital",
);
const appOrigin = "sharestream-desktop://app";
const development = !app.isPackaged ? process.env.SHARE_STREAM_DESKTOP_RENDERER_URL : undefined;
if (development && !/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(development))
  throw new Error("The development renderer must use loopback.");
const rendererOrigin = development || appOrigin;
const project = resolve(__dirname, "../../../..");
if (process.env.SHARE_STREAM_DESKTOP_USER_DATA)
  app.setPath("userData", process.env.SHARE_STREAM_DESKTOP_USER_DATA);
app.setName("Share Stream Chat");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "sharestream-desktop",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);
const windows = new Map<string, BrowserWindow>();
const snapshots = new Map<string, unknown>();
const panels = new Set<DesktopWindow>([
  "rooms",
  "account",
  "create",
  "join",
  "rename",
  "invite",
  "notifications",
  "settings",
  "participants",
]);
let directory: DesktopDirectory;
let timer: ReturnType<typeof setInterval>;
let quitting = false;

function helper(command?: Record<string, unknown>): Promise<any> {
  const binary =
    process.env.SHARE_STREAM_SESSION_HELPER ||
    (app.isPackaged
      ? join(process.resourcesPath, "bin", "session_helper")
      : join(project, "build", "session_helper"));
  return new Promise((accept, reject) => {
    const child = spawn(binary, command ? [] : ["--paths"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    const timeout = setTimeout(() => child.kill(), 5000);
    child.stdout.on("data", (data) => {
      output += String(data);
      if (output.length > 1048576) child.kill();
    });
    child.on("error", () => {
      clearTimeout(timeout);
      reject(new Error("The shared session helper is unavailable. Reinstall Share Stream Chat."));
    });
    child.stdin.on("error", () =>
      reject(new Error("The shared session helper could not receive the change.")),
    );
    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(output);
        if (code !== 0) throw new Error(response.error || "Could not update the shared session.");
        accept(response);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(command ? JSON.stringify(command) + "\n" : undefined);
  });
}
function trusted(event: IpcMainInvokeEvent | IpcMainEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (
    !window ||
    event.senderFrame !== event.sender.mainFrame ||
    !event.senderFrame.url.startsWith(rendererOrigin + "/") ||
    ![...windows.values()].includes(window)
  )
    throw new Error("Untrusted application frame.");
  return window;
}
function sender(event: IpcMainEvent) {
  try {
    return trusted(event);
  } catch {
    return null;
  }
}
function show(kind: "main" | DesktopWindow): BrowserWindow {
  const existing = windows.get(kind);
  if (existing && !existing.isDestroyed()) {
    if (!process.env.SHARE_STREAM_DESKTOP_TEST) {
      existing.show();
      existing.focus();
    }
    return existing;
  }
  const window = new BrowserWindow({
    title: kind === "main" ? "Share Stream / Voice & screen" : `Share Stream / ${kind}`,
    width: kind === "main" ? 1180 : 560,
    height: kind === "main" ? 820 : 650,
    minWidth: kind === "main" ? 640 : 420,
    minHeight: 420,
    backgroundColor: "#101615",
    show: !process.env.SHARE_STREAM_DESKTOP_TEST,
    parent: kind === "main" ? undefined : windows.get("main"),
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      additionalArguments: [
        `--sharestream-server=${encodeURIComponent(origin)}`,
        `--sharestream-window=${kind}`,
      ],
    },
  });
  windows.set(kind, window);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(rendererOrigin + "/")) event.preventDefault();
  });
  window.on("closed", () => {
    windows.delete(kind);
    if (kind === "main") for (const child of windows.values()) child.close();
  });
  void window.loadURL(`${rendererOrigin}/${development ? "" : "index.html"}?window=${kind}`);
  return window;
}
function notifyModels() {
  for (const window of windows.values())
    if (!window.isDestroyed() && !window.webContents.isDestroyed())
      window.webContents.send("sharestream:model", directory.model);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    show("main");
    void directory?.poll(true);
  });
  app.on("activate", () => {
    if (app.isReady()) show("main");
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    quitting = true;
    clearInterval(timer);
  });
  void app
    .whenReady()
    .then(async () => {
      const paths = await helper();
      directory = new DesktopDirectory(origin, paths.accounts, helper);
      const notified = new Set<string>();
      directory.on("model", () => {
        notifyModels();
        for (const invitation of directory.model.invitations)
          if (!notified.has(invitation.id)) {
            notified.add(invitation.id);
            if (Notification.isSupported() && !process.env.SHARE_STREAM_DESKTOP_TEST) {
              const notification = new Notification({
                title: `Invitation to ${invitation.room.name}`,
                body: `${invitation.from.name} invites you. Open to accept or decline.`,
              });
              notification.on("click", () => {
                show("main");
                show("notifications");
              });
              notification.show();
            }
          }
        if (process.platform === "darwin")
          app.dock?.setBadge(
            directory.model.invitations.length ? String(directory.model.invitations.length) : "",
          );
      });
      directory.on("launch", (panel?: string) => {
        if (!quitting) {
          const main = show("main");
          main.webContents.send("sharestream:command", "join", true);
          if (panels.has(panel as DesktopWindow)) show(panel as DesktopWindow);
        }
      });
      protocol.handle("sharestream-desktop", async (request) => {
        const url = new URL(request.url);
        if (url.host !== "app") return new Response(null, { status: 403 });
        if (url.pathname === "/api/presence" && request.method === "POST") {
          const body = await request.text();
          if (body.length > 2048) return new Response(null, { status: 413 });
          return fetch(origin + "/api/presence", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body,
            signal: AbortSignal.timeout(5000),
            redirect: "error",
          });
        }
        if (
          request.method !== "GET" ||
          !(url.pathname === "/index.html" || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(url.pathname))
        )
          return new Response(null, { status: 404 });
        const client = app.isPackaged
          ? join(process.resourcesPath, "client")
          : join(project, "web", "dist", "client");
        const response = await net.fetch(
          pathToFileURL(join(client, url.pathname.slice(1))).toString(),
        );
        const headers = new Headers(response.headers);
        headers.set(
          "Content-Security-Policy",
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ${origin} ${origin.replace(/^http/, "ws")}; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; base-uri 'none'`,
        );
        return new Response(response.body, { status: response.status, headers });
      });
      const isMain = (contents: Electron.WebContents) =>
        contents === windows.get("main")?.webContents;
      session.defaultSession.setPermissionCheckHandler(
        (contents, permission, requestingOrigin) =>
          !!contents &&
          isMain(contents) &&
          requestingOrigin === rendererOrigin &&
          ["media", "display-capture"].includes(permission),
      );
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, callback, details) =>
          callback(
            isMain(contents) &&
              contents.getURL().startsWith(rendererOrigin + "/") &&
              (permission === "display-capture" ||
                (permission === "media" &&
                  !("mediaTypes" in details && details.mediaTypes?.includes("video")))),
          ),
      );
      session.defaultSession.setDisplayMediaRequestHandler(
        async (request, callback) => {
          if (request.frame !== windows.get("main")?.webContents.mainFrame) {
            callback({});
            return;
          }
          try {
            const sources = await desktopCapturer.getSources({ types: ["screen", "window"] });
            const selection = await dialog.showMessageBox(show("main"), {
              title: "Share screen",
              message: "Choose the screen or window to share",
              buttons: ["Cancel", ...sources.slice(0, 20).map((source) => source.name)],
              cancelId: 0,
              defaultId: 0,
            });
            const source = sources[selection.response - 1];
            if (selection.response > 0 && source) callback({ video: source });
            else callback({});
          } catch {
            callback({});
          }
        },
        { useSystemPicker: true },
      );
      ipcMain.handle("sharestream:model", async (event) => {
        trusted(event);
        await directory.refreshLocal();
        return directory.model;
      });
      ipcMain.handle("sharestream:request", async (event, path, method, body) => {
        trusted(event);
        return directory.request(path, method, body);
      });
      ipcMain.handle("sharestream:account", async (event, id) => {
        trusted(event);
        await directory.selectAccount(id);
      });
      ipcMain.handle("sharestream:room", async (event, code) => {
        trusted(event);
        await directory.chooseRoom(code);
      });
      ipcMain.handle("sharestream:window", (event, kind) => {
        trusted(event);
        if (!panels.has(kind)) throw new Error("Unknown application window.");
        show(kind);
      });
      ipcMain.on("sharestream:close", (event) => {
        sender(event)?.close();
      });
      ipcMain.handle("sharestream:copy-invite", (event, link) => {
        trusted(event);
        const room = directory.model.launch;
        if (!room) throw new Error("Choose a room first.");
        clipboard.writeText(
          link
            ? `${origin}/#${new URLSearchParams({ room: room.code, relay: room.host, port: String(room.port), join: "1" })}`
            : room.code,
        );
      });
      const presenceWrites = new Map<string, Promise<unknown>>();
      const writePresence = (payload: {
        room: string;
        token: string;
        connected: boolean;
        [key: string]: unknown;
      }) => {
        if (
          !/^[a-f0-9]{64}$/.test(payload.room) ||
          !/^[a-f0-9]{32}$/.test(payload.token) ||
          JSON.stringify(payload).length > 2048
        )
          throw new Error("Invalid presence.");
        const key = payload.room + payload.token;
        const result = (presenceWrites.get(key) || Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const response = await fetch(origin + "/api/presence", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ...payload, source: "browser" }),
              signal: AbortSignal.timeout(4000),
            });
            if (!response.ok) throw new Error("Participant service unavailable.");
            return ((await response.json()) as { participants: unknown }).participants;
          });
        presenceWrites.set(key, result);
        void result
          .finally(() => {
            if (presenceWrites.get(key) === result) presenceWrites.delete(key);
          })
          .catch(() => {});
        return result;
      };
      ipcMain.handle("sharestream:presence", (event, payload) => {
        trusted(event);
        return writePresence(payload);
      });
      ipcMain.on("sharestream:leave-presence", (event, room, token) => {
        try {
          trusted(event);
        } catch {
          return;
        }
        if (!/^[a-f0-9]{64}$/.test(room) || !/^[a-f0-9]{32}$/.test(token)) return;
        void writePresence({ room, token, connected: false }).catch(() => {});
      });
      ipcMain.on("sharestream:publish", (event, name, value) => {
        if (sender(event) !== windows.get("main") || !["settings", "participants"].includes(name))
          return;
        snapshots.set(name, value);
        for (const window of windows.values())
          if (window !== windows.get("main"))
            window.webContents.send("sharestream:publish", name, value);
      });
      ipcMain.handle("sharestream:snapshot", (event, name) => {
        trusted(event);
        return snapshots.get(name);
      });
      ipcMain.on("sharestream:command", (event, name, value) => {
        if (sender(event) && ["volumeDb", "voiceMode", "input", "output", "name"].includes(name))
          windows.get("main")?.webContents.send("sharestream:command", name, value);
      });
      show("main");
      await directory.poll(true);
      timer = setInterval(() => void directory.refreshLocal().then(() => directory.poll()), 500);
    })
    .catch(() => {
      process.stderr.write("Share Stream Chat could not start. Check the installation.\n");
      app.exit(1);
    });
}

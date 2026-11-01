import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopWindow } from "../../web/shared/desktop.js" with {
  "resolution-mode": "import",
};
const argument = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.split("=")
    .slice(1)
    .join("=") || "";
const listen = (channel: string, callback: (...values: any[]) => void) => {
  const listener = (_event: unknown, ...values: unknown[]) => callback(...values);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const bridge: DesktopBridge = {
  serverOrigin: decodeURIComponent(argument("sharestream-server")),
  window: (argument("sharestream-window") || "main") as "main" | DesktopWindow,
  model: () => ipcRenderer.invoke("sharestream:model"),
  request: (path, method = "GET", body) =>
    ipcRenderer.invoke("sharestream:request", path, method, body),
  selectAccount: (id) => ipcRenderer.invoke("sharestream:account", id),
  selectRoom: (code) => ipcRenderer.invoke("sharestream:room", code),
  openWindow: (kind) => ipcRenderer.invoke("sharestream:window", kind),
  closeWindow: () => ipcRenderer.send("sharestream:close"),
  copyInvite: (link) => ipcRenderer.invoke("sharestream:copy-invite", !!link),
  leavePresence: (room, token) => ipcRenderer.send("sharestream:leave-presence", room, token),
  updatePresence: (payload) => ipcRenderer.invoke("sharestream:presence", payload),
  publish: (name, value) => ipcRenderer.send("sharestream:publish", name, value),
  command: (name, value) => ipcRenderer.send("sharestream:command", name, value),
  onModel: (callback) => listen("sharestream:model", callback),
  onPublish: (callback) => listen("sharestream:publish", callback),
  onCommand: (callback) => listen("sharestream:command", callback),
  snapshot: (name) => ipcRenderer.invoke("sharestream:snapshot", name),
};
contextBridge.exposeInMainWorld("shareStreamDesktop", bridge);

import type { Account, SavedRoom, RoomInvitation } from "./directory.js";
import type { Participant, PresenceUpdate } from "./presence.js";
export type DesktopWindow =
  | "rooms"
  | "account"
  | "create"
  | "join"
  | "rename"
  | "invite"
  | "notifications"
  | "settings"
  | "participants";
export interface DesktopLaunch {
  code: string;
  host: string;
  port: number;
  participant: string;
  name?: string;
  roomName?: string;
  accountId?: string;
}
export interface DesktopModel {
  accounts: Account[];
  active: string;
  rooms: SavedRoom[];
  invitations: RoomInvitation[];
  launch: DesktopLaunch | null;
  error: string;
}
export interface DesktopBridge {
  readonly serverOrigin: string;
  readonly window: "main" | DesktopWindow;
  model(): Promise<DesktopModel>;
  request(path: string, method?: string, body?: unknown): Promise<DesktopModel>;
  selectAccount(id: string): Promise<void>;
  selectRoom(code: string): Promise<void>;
  openWindow(kind: DesktopWindow): Promise<void>;
  closeWindow(): void;
  copyInvite(link?: boolean): Promise<void>;
  leavePresence(room: string, token: string): void;
  updatePresence(payload: PresenceUpdate): Promise<Participant[]>;
  publish(name: "settings" | "participants", value: unknown): void;
  command(name: string, value: unknown): void;
  onModel(callback: (model: DesktopModel) => void): () => void;
  onPublish(callback: (name: string, value: unknown) => void): () => void;
  onCommand(callback: (name: string, value: unknown) => void): () => void;
  snapshot(name: "settings" | "participants"): Promise<unknown>;
}
export interface DesktopVoiceSettings {
  volumeDb: number;
  peaks: readonly [number, number];
  voiceMode: "headphones" | "speakers";
  input: string;
  output: string;
  name: string;
  micBusy: boolean;
  micOpen: boolean;
  outputSupported: boolean;
  inputs: { value: string; label: string }[];
  outputs: { value: string; label: string }[];
}

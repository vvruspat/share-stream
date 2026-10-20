export type MusicState = "sending" | "listening" | "connecting" | null;
export interface Participant {
  id: string;
  name: string;
  music: MusicState;
  browser: boolean;
  mic: boolean;
  speaking: boolean;
}
export interface PresenceUpdate {
  room: string;
  token: string;
  source: "plugin" | "browser";
  connected: boolean;
  music?: MusicState;
  mic?: boolean;
  speaking?: boolean;
  name?: string;
}

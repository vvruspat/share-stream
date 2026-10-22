export type MediaChannel = "voice" | "screen";
export type Channel = MediaChannel | "control";
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}
export interface EncryptedSignal {
  type: "signal";
  to: string;
  channel: Channel;
  seq: number;
  nonce: string;
  data: string;
}
export interface IncomingSignal extends EncryptedSignal {
  from: string;
}
export interface JoinFrame {
  type: "join";
  version: typeof SIGNAL_VERSION;
  room: string;
  id: string;
  resume: string;
}
export type ServerFrame =
  | { type: "welcome"; peers: string[]; iceServers: IceServer[] }
  | { type: "ice"; iceServers: IceServer[] }
  | { type: "peer"; id: string }
  | { type: "left"; id: string }
  | { type: "error"; message: string }
  | IncomingSignal;
export interface RemoteMedia {
  type: "media";
  mic: boolean;
  screen: boolean;
  voiceLimited?: boolean;
  voicePaused?: boolean;
}
export type SignalPayload =
  | { type: "ready" }
  | { type: "restart"; channel: MediaChannel }
  | RemoteMedia
  | { description: RTCSessionDescriptionInit }
  | { candidate: RTCIceCandidateInit };
export const WEB_VERSION = "0.4.5";
// v3 supports independent peer links in group calls.
export const SIGNAL_VERSION = 3;
export const MAX_PARTICIPANTS = 8;

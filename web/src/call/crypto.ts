import type {
  Channel,
  IncomingSignal,
  EncryptedSignal,
  SignalPayload,
} from "../../shared/protocol.js";
const encoder = new TextEncoder(),
  decoder = new TextDecoder();
export const randomId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
export function parseInvite(value: string): string {
  const text = value.trim();
  if (/^[a-f\d]{32}$/i.test(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    const code =
      url.protocol === "sharestream:"
        ? url.pathname.slice(1)
        : url.protocol === "https:" || url.protocol === "http:"
          ? new URLSearchParams(url.hash.slice(1)).get("room")
          : "";
    if (/^[a-f\d]{32}$/i.test(code || "")) return code!.toLowerCase();
  } catch {
    /* Invalid invitation. */
  }
  throw new Error("Paste a Share Stream invite or a 32-character room code.");
}
const base64 = (value: ArrayBuffer | Uint8Array<ArrayBuffer>): string =>
  btoa(String.fromCharCode(...(value instanceof Uint8Array ? value : new Uint8Array(value))));
const bytes = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
export interface RoomKeys {
  room: string;
  key: CryptoKey;
}
export async function roomKeys(code: string): Promise<RoomKeys> {
  const digest = async (label: string) =>
    crypto.subtle.digest("SHA-256", encoder.encode(label + ":" + parseInvite(code)));
  const hash = await digest("ShareStream-call-room-v1");
  return {
    room: Array.from(new Uint8Array(hash), (x) => x.toString(16).padStart(2, "0")).join(""),
    key: await crypto.subtle.importKey(
      "raw",
      await digest("ShareStream-call-key-v1"),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"],
    ),
  };
}
const aad = (room: string, from: string, to: string, channel: Channel, seq: number) =>
  encoder.encode(JSON.stringify(["ShareStream-call-v1", room, from, to, channel, seq]));
export async function seal(
  key: CryptoKey,
  room: string,
  from: string,
  to: string,
  channel: Channel,
  seq: number,
  payload: SignalPayload,
): Promise<EncryptedSignal> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: aad(room, from, to, channel, seq) },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return { type: "signal", to, channel, seq, nonce: base64(nonce), data: base64(data) };
}
export async function unseal(
  key: CryptoKey,
  room: string,
  packet: IncomingSignal,
): Promise<SignalPayload> {
  const plain = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: bytes(packet.nonce),
      additionalData: aad(room, packet.from, packet.to, packet.channel, packet.seq),
    },
    key,
    bytes(packet.data),
  );
  return JSON.parse(decoder.decode(plain)) as SignalPayload;
}

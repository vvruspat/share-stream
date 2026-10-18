const encoder = new TextEncoder(), decoder = new TextDecoder();
export const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), x => x.toString(16).padStart(2, '0')).join('');
export function parseInvite(value) {
  const text = value.trim();
  if (/^[a-f\d]{32}$/i.test(text)) return text.toLowerCase();
  try {
    const url = new URL(text);
    const code = url.protocol === 'sharestream:' ? url.pathname.slice(1) : url.protocol === 'https:' || url.protocol === 'http:' ? new URLSearchParams(url.hash.slice(1)).get('room') : '';
    if (/^[a-f\d]{32}$/i.test(code || '')) return code.toLowerCase();
  } catch { /* Invalid invitation. */ }
  throw new Error('Paste a Share Stream invite or a 32-character room code.');
}
const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const bytes = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export async function roomKeys(code) {
  const digest = async label => crypto.subtle.digest('SHA-256', encoder.encode(label + ':' + parseInvite(code)));
  const hash = await digest('ShareStream-call-room-v1');
  return {
    room: Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join(''),
    key: await crypto.subtle.importKey('raw', await digest('ShareStream-call-key-v1'), 'AES-GCM', false, ['encrypt', 'decrypt'])
  };
}
const aad = (room, from, to, channel, seq) => encoder.encode(JSON.stringify(['ShareStream-call-v1', room, from, to, channel, seq]));
export async function seal(key, room, from, to, channel, seq, payload) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad(room, from, to, channel, seq) }, key, encoder.encode(JSON.stringify(payload)));
  return { type: 'signal', to, channel, seq, nonce: base64(nonce), data: base64(data) };
}
export async function unseal(key, room, packet) {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(packet.nonce), additionalData: aad(room, packet.from, packet.to, packet.channel, packet.seq) }, key, bytes(packet.data));
  return JSON.parse(decoder.decode(plain));
}

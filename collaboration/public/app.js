import { Call } from './call.js';
import { parseInvite, randomId } from './crypto.js';
const $ = id => document.getElementById(id);
const call = new Call();
let code;
try { code = parseInvite(location.href); } catch { code = randomId(); }
$('room').value = code;
history.replaceState(null, '', `/#room=${code}`);
function error(message) { $('error').textContent = message; $('error').hidden = !message; }
function run(fn) { return async () => { error(''); try { await fn(); } catch (e) { const names = { NotAllowedError: 'Permission was not granted. Allow access in the browser and macOS Privacy & Security settings, then try again.', NotFoundError: 'No microphone was found. Connect a microphone and try again.', NotReadableError: 'The selected device is unavailable. Check your audio settings.' }; error(names[e.name] || e.message); } }; }
$('join').onclick = run(async () => { code = parseInvite($('room').value); $('room').value = code; history.replaceState(null, '', `/#room=${code}`); $('join').disabled = true; try { await call.join(code); } finally { if (!call.active) $('join').disabled = false; } });
$('leave').onclick = () => call.leave();
$('copy').onclick = run(async () => { const invite = `${location.origin}/#room=${parseInvite($('room').value)}`; await navigator.clipboard.writeText(invite); $('copy').textContent = 'Copied'; setTimeout(() => { $('copy').textContent = 'Copy call invite'; }, 1500); });
$('mic').onclick = run(async () => { await call.toggleMic(); await devices(); });
$('share').onclick = run(() => call.shareScreen());
$('input').onchange = run(() => call.microphone($('input').value));
$('voice-mode').onchange = run(() => call.setVoiceMode($('voice-mode').value, $('input').value));
$('volume').oninput = () => { $('voice').volume = Number($('volume').value); };
$('voice').volume = 0.8;
$('output').onchange = run(() => $('voice').setSinkId($('output').value));
if (!('setSinkId' in HTMLMediaElement.prototype)) { $('output').disabled = true; $('output').options[0].textContent = 'Use system audio settings'; }
$('fullscreen').onclick = run(async () => { const element = $('remote-screen'); if (element.requestFullscreen) await element.requestFullscreen(); else if (element.webkitEnterFullscreen) element.webkitEnterFullscreen(); });
$('play').onclick = run(async () => { await $('voice').play(); $('play').hidden = true; });
async function devices() {
  const list = await navigator.mediaDevices.enumerateDevices();
  for (const [id, kind] of [['input', 'audioinput'], ['output', 'audiooutput']]) {
    const select = $(id), selected = select.value;
    select.replaceChildren(new Option('System default', ''));
    for (const device of list.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default')) select.add(new Option(device.label || `${kind === 'audioinput' ? 'Microphone' : 'Output'} ${select.options.length}`, device.deviceId));
    if ([...select.options].some(o => o.value === selected)) select.value = selected;
  }
}
call.addEventListener('state', ({ detail: s }) => {
  $('status').textContent = s.state; $('join').hidden = s.active; $('join').disabled = s.active; $('leave').hidden = !s.active; $('room').disabled = s.active;
  $('share').disabled = !s.active; $('mic').disabled = !s.active || s.micBusy; $('input').disabled = !call.micStream || s.micBusy;
  $('voice-mode').value = s.voiceMode; $('voice-mode').disabled = s.micBusy;
  $('voice-mode-note').textContent = s.voiceMode === 'headphones'
    ? 'Use headphones. Microphone echo cancellation and automatic processing are off for mixing.'
    : 'For speakers: echo cancellation is on. macOS voice processing may lower other apps’ audio.';
  $('mic').textContent = s.micBusy ? 'Opening microphone…' : s.mic ? 'Mute microphone' : call.micStream ? 'Unmute microphone' : 'Enable microphone';
  $('share').textContent = s.screen ? 'Stop sharing' : 'Share screen';
  $('mic').classList.toggle('active', s.mic); $('share').classList.toggle('active', s.screen);
  $('media-status').textContent = s.voiceLimited ? 'Voice quality reduced · microphone stays connected' : [s.mic ? 'Microphone on' : 'Microphone off', s.screen ? 'Screen on' : 'Screen off'].join(' · ');
  $('voice-budget').textContent = `≤${s.voiceBitrate / 1000} kbps`;
  $('screen-budget').textContent = `≤${(s.screenBitrate / 1000000).toFixed(1)} Mbps`;
});
let remoteScreen = false;
call.addEventListener('track', async ({ detail: { channel, stream } }) => {
  if (channel === 'voice') { $('voice').srcObject = stream; if (stream) { try { await $('voice').play(); $('play').hidden = true; } catch { $('play').hidden = false; } } else $('play').hidden = true; }
  else { $('remote-screen').srcObject = stream; $('remote-screen').hidden = !stream || !remoteScreen; $('placeholder').hidden = !!stream && remoteScreen; }
});
call.addEventListener('remoteState', ({ detail: s }) => { remoteScreen = s.screen; $('remote-mic').textContent = s.voicePaused ? 'Partner’s voice paused · update their page' : s.mic ? 'Partner’s mic on' : 'Partner’s mic off'; $('remote-screen').hidden = !s.screen || !$('remote-screen').srcObject; $('placeholder').hidden = s.screen && !!$('remote-screen').srcObject; });
call.addEventListener('localScreen', ({ detail: stream }) => { $('local-screen').srcObject = stream; $('local-screen').hidden = !stream; });
call.addEventListener('error', ({ detail }) => error(detail));
window.addEventListener('pagehide', () => call.leave());
navigator.mediaDevices?.addEventListener('devicechange', () => devices().catch(() => {}));
if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !crypto.subtle) { $('join').disabled = true; error('Open this page over HTTPS in a recent Chrome, Edge, Firefox or Safari browser.'); }

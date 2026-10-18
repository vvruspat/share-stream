import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

async function synthetic(context) {
  await context.addInitScript(({ relay, tcp }) => {
    window.mediaRequests = { audio: 0, display: 0 }; window.testPCs = []; window.captureTracks = []; window.iceErrors = [];
    const NativePC = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends NativePC {
      constructor(config) {
        if (tcp) config.iceServers = config.iceServers.filter(s => s.username).map(s => ({ ...s, urls: s.urls.filter(u => u.includes('transport=tcp')) }));
        super({ ...config, ...(relay ? { iceTransportPolicy: 'relay' } : {}) }); window.testPCs.push(this);
        this.addEventListener('icecandidateerror', e => window.iceErrors.push({ code: e.errorCode, text: e.errorText, url: e.url }));
        const getStats = this.getStats.bind(this);
        this.getStats = async (...args) => window.forcePressure ? new Map([['test', { type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.6 }]]) : getStats(...args);
      }
    };
    const NativeSocket = window.WebSocket;
    window.WebSocket = class extends NativeSocket { constructor(...args) { super(...args); window.testSocket = this; } };
    navigator.mediaDevices.getUserMedia = async constraints => {
      if (constraints.video !== false) throw new Error('Unexpected camera capture');
      window.mediaRequests.audio++;
      const context = new AudioContext(), oscillator = context.createOscillator(), target = context.createMediaStreamDestination();
      oscillator.frequency.value = 440; oscillator.connect(target); oscillator.start(); await context.resume();
      window.captureTracks.push(...target.stream.getTracks());
      return target.stream;
    };
    navigator.mediaDevices.getDisplayMedia = async constraints => {
      if (constraints.audio !== false) throw new Error('Screen audio must stay off');
      window.mediaRequests.display++;
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
      const paint = canvas.getContext('2d'); let frame = 0;
      const draw = () => { paint.fillStyle = '#1a5030'; paint.fillRect(0, 0, 640, 360); paint.fillStyle = 'white'; paint.font = '32px sans-serif'; paint.fillText(`Synthetic screen ${frame++}`, 40, 160); };
      draw(); const timer = setInterval(draw, 66); const stream = canvas.captureStream(15);
      stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
      window.captureTracks.push(...stream.getTracks()); return stream;
    };
  }, { relay: process.env.TEST_RELAY === '1', tcp: process.env.TEST_TURN_TCP === '1' });
}
async function pair(browser, baseURL) {
  const a = await browser.newContext(), b = await browser.newContext();
  await synthetic(a); await synthetic(b);
  const pa = await a.newPage(), pb = await b.newPage(), code = randomBytes(16).toString('hex');
  await pa.goto(`${baseURL}/#room=${code}`); await pb.goto(`${baseURL}/#room=${code}`);
  return { a, b, pa, pb, code };
}
const stats = async (page, kind, field) => page.evaluate(async ({ kind, field }) => {
  let total = 0;
  for (const pc of window.testPCs) if (pc.connectionState !== 'closed') for (const s of (await pc.getStats()).values()) if (s.type === 'inbound-rtp' && s.kind === kind) total += s[field] || 0;
  return total;
}, { kind, field });

test('explicit capture, two independent media transports, stop, mute and reconnect', async ({ browser, baseURL }) => {
  const { a, b, pa, pb } = await pair(browser, baseURL);
  try {
    if (!process.env.TEST_BASE_URL) await pa.screenshot({ path: '../build/collaboration-desktop.png', fullPage: true });
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await pa.getByRole('button', { name: 'Join room', exact: true }).click(); await pb.getByRole('button', { name: 'Join room', exact: true }).click();
    await expect(pa.locator('#status')).toContainText('Connected', { timeout: 25000 }); await expect(pb.locator('#status')).toContainText('Connected');
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await pa.locator('#mic').click(); await pb.locator('#mic').click(); await pa.locator('#share').click();
    await expect.poll(() => stats(pb, 'audio', 'bytesReceived'), { timeout: 20000 }).toBeGreaterThan(100);
    await expect.poll(() => stats(pa, 'audio', 'bytesReceived'), { timeout: 20000 }).toBeGreaterThan(100);
    await expect.poll(() => stats(pb, 'video', 'framesDecoded'), { timeout: 20000 }).toBeGreaterThan(5);
    await expect(pb.locator('#remote-screen')).toBeVisible();
    const transports = await pa.evaluate(() => window.testPCs.filter(p => p.connectionState !== 'closed').map(p => ({ kind: p.getTransceivers()[0].receiver.track.kind, count: p.getTransceivers().length, cap: p.getSenders()[0].getParameters().encodings[0].maxBitrate, priority: p.getSenders()[0].getParameters().encodings[0].networkPriority })));
    expect(transports).toHaveLength(2); expect(transports.every(p => p.count === 1)).toBe(true);
    expect(transports.find(p => p.kind === 'audio').cap).toBe(24000); expect(transports.find(p => p.kind === 'video').cap).toBe(1200000);
    expect(transports.find(p => p.kind === 'audio').priority).toBe('very-low'); expect(transports.find(p => p.kind === 'video').priority).toBe('low');
    if (process.env.TEST_TURN_TCP === '1') {
      const protocols = await pa.evaluate(async () => { const values = []; for (const p of window.testPCs) { const report = await p.getStats(); for (const s of report.values()) if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) values.push(report.get(s.localCandidateId)?.relayProtocol); } return values; });
      expect(protocols).toEqual(['tcp', 'tcp']);
    }
    const previousUfrag = await pa.evaluate(() => window.testPCs.filter(p => p.connectionState !== 'closed').map(p => p.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1]));
    await pa.evaluate(() => window.testSocket.send('{"type":"refresh"}'));
    await expect.poll(() => pa.evaluate(() => window.testPCs.filter(p => p.connectionState !== 'closed').map(p => p.localDescription.sdp.match(/a=ice-ufrag:(.*)/)[1]))).not.toEqual(previousUfrag);
    await expect(pa.locator('#error')).toBeHidden();
    await expect(pa.locator('#status')).toContainText('Connected', { timeout: 20000 });
    if (process.env.TEST_RELAY === '1') {
      const candidateTypes = await pa.evaluate(async () => { const types = []; for (const p of window.testPCs) { const report = await p.getStats(); for (const s of report.values()) if (s.type === 'candidate-pair' && s.state === 'succeeded' && s.nominated) types.push(report.get(s.localCandidateId)?.candidateType); } return types; });
      expect(candidateTypes).toEqual(['relay', 'relay']);
    }
    await pb.locator('#share').click(); await expect.poll(() => stats(pa, 'video', 'framesDecoded')).toBeGreaterThan(5);
    // A transient signaling disconnect must rebuild both transports and retain
    // only media the user already enabled, without a new permission request.
    await pa.evaluate(() => window.testSocket.close(4000, 'Synthetic network interruption'));
    await expect.poll(() => pa.evaluate(() => window.testPCs.length)).toBeGreaterThan(2);
    await expect(pa.locator('#status')).toContainText('Connected', { timeout: 20000 });
    await expect.poll(() => stats(pb, 'audio', 'bytesReceived')).toBeGreaterThan(100);
    await expect.poll(() => stats(pb, 'video', 'framesDecoded')).toBeGreaterThan(5);
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 1, display: 1 });
    await pa.locator('#mic').click(); await expect(pb.locator('#remote-mic')).toHaveText('Partner’s mic off');
    await pa.locator('#share').click(); await expect(pb.locator('#remote-screen')).toBeHidden();
    // Rejoining is a fresh pair of ICE transports; old media tracks are released.
    await pa.locator('#leave').click(); await expect(pb.locator('#status')).toContainText('waiting');
    expect(await pa.evaluate(() => window.captureTracks.every(t => t.readyState === 'ended'))).toBe(true);
    await pa.locator('#join').click(); await expect(pa.locator('#status')).toContainText('Connected', { timeout: 20000 });
    await expect.poll(() => stats(pa, 'video', 'framesDecoded')).toBeGreaterThan(5);
  } catch (error) {
    for (const page of [pa, pb]) console.log(JSON.stringify(await page.evaluate(async () => ({ error: document.getElementById('error').textContent, iceErrors: window.iceErrors, requests: window.mediaRequests, pcs: await Promise.all(window.testPCs.map(async p => ({ state: p.connectionState, signaling: p.signalingState, senders: p.getSenders().map(s => ({ track: s.track?.kind, enabled: s.track?.enabled })), stats: [...(await p.getStats()).values()].filter(s => ['inbound-rtp', 'outbound-rtp'].includes(s.type)) }))) })), null, 2));
    throw error;
  } finally { await a.close(); await b.close(); }
});

test('mobile page fits its viewport and opens with capture off', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  try {
    const page = await context.newPage(); await page.goto(baseURL);
    await expect(page.locator('#join')).toBeEnabled(); await expect(page.locator('#mic')).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (!process.env.TEST_BASE_URL) await page.screenshot({ path: '../build/collaboration-mobile.png', fullPage: true });
  } finally { await context.close(); }
});
test('congestion pauses voice before lowering the screen budget, then recovers', async ({ browser, baseURL }) => {
  const { a, b, pa, pb } = await pair(browser, baseURL);
  try {
    await pa.locator('#join').click(); await pb.locator('#join').click(); await expect(pa.locator('#status')).toContainText('Connected', { timeout: 25000 });
    await pa.locator('#mic').click(); await pa.locator('#share').click();
    await expect.poll(() => stats(pb, 'video', 'framesDecoded')).toBeGreaterThan(5);
    await pa.evaluate(() => { window.forcePressure = true; });
    await expect(pa.locator('#media-status')).toContainText('Voice paused', { timeout: 6500 });
    expect(await pa.evaluate(() => window.testPCs.filter(p => p.connectionState !== 'closed').find(p => p.getTransceivers()[0].receiver.track.kind === 'audio').getSenders()[0].track)).toBeNull();
    expect(await pa.evaluate(() => window.testPCs.filter(p => p.connectionState !== 'closed').find(p => p.getTransceivers()[0].receiver.track.kind === 'video').getSenders()[0].track.kind)).toBe('video');
    await expect(pa.locator('#screen-budget')).not.toHaveText('≤1.2 Mbps', { timeout: 5000 });
    await pa.evaluate(() => { window.forcePressure = false; });
    await expect(pa.locator('#media-status')).toContainText('Microphone on', { timeout: 15000 });
  } finally { await a.close(); await b.close(); }
});

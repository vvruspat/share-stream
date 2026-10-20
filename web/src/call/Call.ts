import { randomId, roomKeys, seal, unseal, type RoomKeys } from "./crypto.js";
import type {
  Channel,
  MediaChannel,
  ServerFrame,
  SignalPayload,
  RemoteMedia,
  IceServer,
} from "../../shared/protocol.js";

export interface CallState {
  state: string;
  active: boolean;
  peer: boolean;
  mic: boolean;
  micBusy: boolean;
  voiceMode: VoiceMode;
  screen: boolean;
  voiceLimited: boolean;
  voiceBitrate: number;
  screenBitrate: number;
  speaking: boolean;
  remoteSpeaking: boolean;
}
export type VoiceMode = "headphones" | "speakers";
interface PeerConnection {
  pc: RTCPeerConnection;
  sender?: RTCRtpSender;
  candidates: RTCIceCandidateInit[];
  offering: boolean;
  previous: Map<string, { lost: number; received: number }>;
}
interface CallEvents {
  state: CallState;
  error: string;
  remoteState: Partial<RemoteMedia>;
  track: { channel: MediaChannel; stream: MediaStream | null };
  localScreen: MediaStream | null;
  network: { rtt: number; pressure: boolean };
}
const mediaChannels: MediaChannel[] = ["voice", "screen"];

// Music stays in the native UDP transport. These two peer connections deliberately
// have separate ICE/DTLS transports and congestion controllers (no audio/video BUNDLE).
export class Call extends EventTarget {
  readonly url: string;
  readonly id: string;
  readonly resume: string;
  active: boolean;
  state: string;
  pcs: Map<MediaChannel, PeerConnection>;
  seen: Map<string, number>;
  seq: number;
  sendChain: Promise<void>;
  receiveChain: Promise<void>;
  screenBitrate: number;
  voiceBitrate: number;
  voiceLimited: boolean;
  bad: number;
  good: number;
  generation: number;
  retry: number;
  voiceMode: VoiceMode;
  micRequest: number;
  micBusy: boolean;
  keys!: RoomKeys;
  iceServers: IceServer[] = [];
  peer: string | null = null;
  ws: WebSocket | null = null;
  micStream: MediaStream | null = null;
  screenStream: MediaStream | null = null;
  private monitor?: ReturnType<typeof setInterval>;
  private refresh?: ReturnType<typeof setInterval>;
  private reconnect?: ReturnType<typeof setTimeout>;
  private joinRequest = 0;
  private activity?: ReturnType<typeof setInterval>;
  private activityBusy = false;
  private speaking = false;
  private remoteSpeaking = false;
  on<K extends keyof CallEvents>(type: K, callback: (detail: CallEvents[K]) => void): () => void {
    const listener = (event: Event) => callback((event as CustomEvent<CallEvents[K]>).detail);
    this.addEventListener(type, listener);
    return () => this.removeEventListener(type, listener);
  }
  constructor({
    url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/signal`,
  } = {}) {
    super();
    this.url = url;
    this.id = randomId();
    this.resume = randomId();
    this.active = false;
    this.pcs = new Map();
    this.seen = new Map();
    this.seq = 0;
    this.sendChain = Promise.resolve();
    this.receiveChain = Promise.resolve();
    this.screenBitrate = 1200000;
    this.voiceBitrate = 64000;
    this.voiceLimited = false;
    this.bad = 0;
    this.good = 0;
    this.generation = 0;
    this.retry = 0;
    this.state = "Ready";
    this.voiceMode = "headphones";
    this.micRequest = 0;
    this.micBusy = false;
  }
  emit<K extends keyof CallEvents>(type: K, detail: CallEvents[K]) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  get snapshot(): CallState {
    return {
      state: this.state,
      active: this.active,
      peer: !!this.peer,
      mic: !!this.micStream?.getAudioTracks().some((t) => t.enabled),
      micBusy: this.micBusy,
      voiceMode: this.voiceMode,
      screen: !!this.screenStream,
      voiceLimited: this.voiceLimited,
      voiceBitrate: this.voiceBitrate,
      screenBitrate: this.screenBitrate,
      speaking: this.speaking && !!this.localTrack("voice")?.enabled,
      remoteSpeaking: this.remoteSpeaking,
    };
  }
  changed() {
    this.emit("state", this.snapshot);
  }
  async join(code: string) {
    if (this.active) return;
    const request = ++this.joinRequest;
    const keys = await roomKeys(code);
    if (request !== this.joinRequest || this.active) return;
    this.keys = keys;
    this.active = true;
    this.state = "Connecting…";
    this.changed();
    this.open();
    this.monitor = setInterval(() => this.measure().catch(() => {}), 2000);
    this.activity = setInterval(() => void this.measureActivity(), 160);
    this.refresh = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('{"type":"refresh"}');
    }, 900000);
  }
  open() {
    if (!this.active) return;
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () =>
      ws.send(
        JSON.stringify({ type: "join", id: this.id, resume: this.resume, room: this.keys.room }),
      );
    ws.onmessage = (event) => {
      this.receiveChain = this.receiveChain
        .then(async () => {
          if (this.ws === ws && this.active)
            await this.message(JSON.parse(String(event.data)) as ServerFrame);
        })
        .catch((error) =>
          this.emit("error", error instanceof Error ? error.message : String(error)),
        );
    };
    ws.onclose = (event) => {
      if (ws !== this.ws || !this.active) return;
      this.dropPeer();
      if ([1008, 4001, 4003].includes(event.code)) {
        this.leave();
        this.state = event.code === 4001 ? "Session opened in another tab" : "Session ended";
        this.changed();
        return;
      }
      this.state = "Reconnecting…";
      this.changed();
      this.reconnect = setTimeout(() => this.open(), Math.min(10000, 500 * 2 ** this.retry++));
    };
    ws.onerror = () => {}; // onclose owns recovery; never log invitation/SDP.
  }
  async message(m: ServerFrame) {
    if (m.type === "error") {
      this.emit("error", m.message);
      return;
    }
    if (m.type === "welcome") {
      this.retry = 0;
      this.iceServers = m.iceServers;
      this.state = "Room open · waiting for your partner";
      this.changed();
      if (m.peers[0]) await this.addPeer(m.peers[0]);
    } else if (m.type === "peer") await this.addPeer(m.id);
    else if (m.type === "left" && this.peer === m.id) {
      this.dropPeer();
      this.state = "Partner left · waiting";
      this.changed();
    } else if (m.type === "ice") {
      this.iceServers = m.iceServers;
      for (const entry of this.pcs.values())
        entry.pc.setConfiguration({ ...entry.pc.getConfiguration(), iceServers: m.iceServers });
      // Renew allocations before the old one-hour TURN username expires. ICE
      // restarts keep the existing media path while checking the new candidates.
      for (const channel of mediaChannels) {
        if (this.id < (this.peer || "")) await this.offer(channel, true);
        else if (this.peer) await this.signal("control", { type: "restart", channel });
      }
    } else if (m.type === "signal" && m.from === this.peer && m.to === this.id) {
      const generation = this.generation,
        replayKey = m.from + ":" + m.channel;
      if (m.seq <= (this.seen.get(replayKey) || 0)) return;
      let data;
      try {
        data = await unseal(this.keys.key, this.keys.room, m);
      } catch {
        this.emit("error", "Invitation does not match. Reopen the same room on both sides.");
        return;
      }
      if (generation !== this.generation) return;
      this.seen.set(replayKey, m.seq);
      if (m.channel === "control") {
        if ("type" in data && data.type === "ready" && this.id < (this.peer || ""))
          for (const channel of mediaChannels) await this.offer(channel);
        else if ("type" in data && data.type === "restart" && this.id < (this.peer || ""))
          await this.offer(data.channel, true);
        else if ("type" in data && data.type === "media") this.emit("remoteState", data);
      } else await this.rtcMessage(m.channel, data);
    }
  }
  signal(channel: Channel, payload: SignalPayload) {
    const peer = this.peer,
      generation = this.generation,
      ws = this.ws;
    this.sendChain = this.sendChain
      .then(async () => {
        if (
          !peer ||
          generation !== this.generation ||
          ws !== this.ws ||
          ws?.readyState !== WebSocket.OPEN
        )
          return;
        const packet = await seal(
          this.keys.key,
          this.keys.room,
          this.id,
          peer,
          channel,
          ++this.seq,
          payload,
        );
        if (generation === this.generation && ws.readyState === WebSocket.OPEN)
          ws.send(JSON.stringify(packet));
      })
      .catch((error) => this.emit("error", error instanceof Error ? error.message : String(error)));
    return this.sendChain;
  }
  async addPeer(id: string) {
    if (this.peer === id) return;
    this.dropPeer();
    this.peer = id;
    this.state = "Connecting to partner…";
    const generation = this.generation;
    for (const channel of mediaChannels) {
      const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: "max-compat" });
      // The answerer uses the transceiver created by setRemoteDescription. A
      // pre-created addTransceiver here would be a second, unassociated m-line.
      const transceiver =
        this.id < id
          ? pc.addTransceiver(channel === "voice" ? "audio" : "video", { direction: "sendrecv" })
          : null;
      if (channel === "voice") {
        const opus = RTCRtpSender.getCapabilities?.("audio")?.codecs.filter(
          (c) => c.mimeType.toLowerCase() === "audio/opus",
        );
        if (opus?.length && transceiver?.setCodecPreferences) transceiver.setCodecPreferences(opus);
      }
      const entry: PeerConnection = {
        pc,
        sender: transceiver?.sender,
        candidates: [],
        offering: false,
        previous: new Map(),
      };
      this.pcs.set(channel, entry);
      pc.onicecandidate = ({ candidate }) => {
        if (candidate && generation === this.generation)
          void this.signal(channel, { candidate: candidate.toJSON() });
      };
      pc.ontrack = ({ track, receiver }) => {
        if (channel === "voice" && "jitterBufferTarget" in receiver) {
          try {
            receiver.jitterBufferTarget = 80;
          } catch {
            /* Keep the browser's adaptive buffer if unsupported. */
          }
        }
        if (generation === this.generation)
          this.emit("track", { channel, stream: new MediaStream([track]) });
      };
      pc.onconnectionstatechange = () => {
        if (generation !== this.generation) return;
        const connected = [...this.pcs.values()].every((e) => e.pc.connectionState === "connected");
        this.state = connected
          ? "Connected · encrypted P2P / TURN fallback"
          : "Connecting to partner…";
        this.changed();
        if (pc.connectionState === "failed") {
          if (this.id < (this.peer || ""))
            this.offer(channel, true).catch((error) =>
              this.emit("error", error instanceof Error ? error.message : String(error)),
            );
          else void this.signal("control", { type: "restart", channel });
        }
      };
      await entry.sender?.replaceTrack(this.localTrack(channel));
    }
    this.changed();
    await this.signal("control", { type: "ready" });
    void this.sendMediaState();
  }
  localTrack(channel: MediaChannel): MediaStreamTrack | null {
    if (channel === "voice") return this.micStream?.getAudioTracks()[0] || null;
    return this.screenStream?.getVideoTracks()[0] || null;
  }
  async offer(channel: MediaChannel, restart = false) {
    const e = this.pcs.get(channel);
    if (!e || e.offering || e.pc.signalingState !== "stable") return;
    e.offering = true;
    try {
      await e.pc.setLocalDescription(await e.pc.createOffer({ iceRestart: restart }));
      await this.signal(channel, { description: e.pc.localDescription!.toJSON() });
    } finally {
      e.offering = false;
    }
  }
  async rtcMessage(channel: MediaChannel, data: SignalPayload) {
    const e = this.pcs.get(channel);
    if (!e) return;
    if ("description" in data) {
      if (!["offer", "answer"].includes(data.description.type)) return;
      // Only the lexicographically smaller peer offers; media toggles use replaceTrack.
      if (data.description.type === "offer" && this.id < (this.peer || "")) return;
      await e.pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        const transceiver = e.pc.getTransceivers()[0];
        transceiver.direction = "sendrecv";
        e.sender = transceiver.sender;
        await e.sender.replaceTrack(this.localTrack(channel));
      }
      for (const candidate of e.candidates.splice(0)) await e.pc.addIceCandidate(candidate);
      if (data.description.type === "offer") {
        await e.pc.setLocalDescription(await e.pc.createAnswer());
        await this.signal(channel, { description: e.pc.localDescription!.toJSON() });
      }
      await this.configureSender(channel);
    } else if ("candidate" in data) {
      if (e.pc.remoteDescription) await e.pc.addIceCandidate(data.candidate);
      else e.candidates.push(data.candidate);
    }
  }
  async configureSender(channel: MediaChannel) {
    const e = this.pcs.get(channel);
    if (!e?.sender || e.pc.signalingState !== "stable") return;
    // Browsers without the priority extension still receive the hard bitrate cap.
    const p = e.sender.getParameters();
    if (!p.encodings?.length) return;
    Object.assign(
      p.encodings[0],
      channel === "voice"
        ? { maxBitrate: this.voiceBitrate, priority: "low", networkPriority: "low" }
        : {
            maxBitrate: this.screenBitrate,
            maxFramerate: 15,
            priority: "medium",
            networkPriority: "medium",
          },
    );
    try {
      await e.sender.setParameters(p);
    } catch {
      const fallback = e.sender.getParameters();
      if (!fallback.encodings?.length) return;
      fallback.encodings[0].maxBitrate =
        channel === "voice" ? this.voiceBitrate : this.screenBitrate;
      if (channel === "screen") fallback.encodings[0].maxFramerate = 15;
      await e.sender.setParameters(fallback);
    }
  }
  async microphone(deviceId?: string) {
    if (!this.active) throw new Error("Join the room first.");
    const request = ++this.micRequest,
      wasEnabled = this.micStream?.getAudioTracks()[0]?.enabled ?? true;
    this.micBusy = true;
    // A concurrent processed stream can keep the OS voice-processing audio unit
    // alive. Fully release it before opening the unprocessed capture path.
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    void this.sendMediaState();
    this.changed();
    let stream: MediaStream | undefined;
    try {
      await this.pcs.get("voice")?.sender?.replaceTrack(null);
      if (!this.active || request !== this.micRequest) return;
      const processed = this.voiceMode === "speakers";
      const audio: MediaTrackConstraints = {
        channelCount: 1,
        echoCancellation: processed ? true : { exact: false },
        noiseSuppression: processed ? true : { exact: false },
        autoGainControl: processed ? true : { exact: false },
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      };
      if (!processed && navigator.mediaDevices.getSupportedConstraints?.().voiceIsolation)
        audio.voiceIsolation = { exact: false };
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: false, audio });
      } catch (error) {
        // Some browsers advertise voiceIsolation before implementing this
        // constraint for every device. Keep all three raw-audio requirements.
        if (
          !processed &&
          audio.voiceIsolation &&
          error instanceof DOMException &&
          (error.name === "NotSupportedError" ||
            (error.name === "OverconstrainedError" &&
              "constraint" in error &&
              error.constraint === "voiceIsolation"))
        ) {
          if (!this.active || request !== this.micRequest) return;
          delete audio.voiceIsolation;
          stream = await navigator.mediaDevices.getUserMedia({ video: false, audio });
        } else throw error;
      }
      if (!this.active || request !== this.micRequest) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      const settings = track.getSettings();
      if (
        !processed &&
        (
          ["echoCancellation", "noiseSuppression", "autoGainControl", "voiceIsolation"] as const
        ).some((key) => settings[key] === true)
      )
        throw new Error(
          "The browser kept voice processing enabled. Select Standard microphone mode in macOS or try another microphone.",
        );
      track.enabled = wasEnabled;
      this.micStream = stream;
      track.onended = () => {
        if (this.micStream === stream) this.stopMic();
      };
      await this.pcs.get("voice")?.sender?.replaceTrack(this.localTrack("voice"));
      await this.configureSender("voice");
      void this.sendMediaState();
    } catch (error) {
      stream?.getTracks().forEach((t) => t.stop());
      if (request === this.micRequest) this.micStream = null;
      throw error;
    } finally {
      if (request === this.micRequest) {
        this.micBusy = false;
        this.changed();
      }
    }
  }
  async setVoiceMode(mode: VoiceMode, deviceId?: string) {
    if (!["headphones", "speakers"].includes(mode)) throw new Error("Invalid voice mode.");
    if (mode === this.voiceMode) return;
    this.voiceMode = mode;
    this.changed();
    if (this.micStream || this.micBusy) await this.microphone(deviceId);
  }
  async toggleMic() {
    const track = this.micStream?.getAudioTracks()[0];
    if (!track) return this.microphone();
    track.enabled = !track.enabled;
    void this.sendMediaState();
    this.changed();
  }
  stopMic() {
    ++this.micRequest;
    this.micBusy = false;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    this.pcs
      .get("voice")
      ?.sender?.replaceTrack(null)
      .catch(() => {});
    void this.sendMediaState();
    this.changed();
  }
  async shareScreen() {
    if (!this.active) throw new Error("Join the room first.");
    if (this.screenStream) {
      this.stopScreen();
      return;
    }
    const generation = this.generation;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 15, max: 15 },
      },
      audio: false,
    });
    if (!this.active || generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    this.screenStream = stream;
    const track = stream.getVideoTracks()[0];
    track.contentHint = "detail";
    track.onended = () => {
      if (this.screenStream === stream) this.stopScreen();
    };
    try {
      await this.pcs.get("screen")?.sender?.replaceTrack(track);
      await this.configureSender("screen");
    } catch (error) {
      this.stopScreen();
      throw error;
    }
    this.emit("localScreen", stream);
    void this.sendMediaState();
    this.changed();
  }
  stopScreen() {
    this.screenStream?.getTracks().forEach((t) => t.stop());
    this.screenStream = null;
    this.pcs
      .get("screen")
      ?.sender?.replaceTrack(null)
      .catch(() => {});
    this.emit("localScreen", null);
    void this.sendMediaState();
    this.changed();
  }
  sendMediaState() {
    return this.signal("control", {
      type: "media",
      mic: !!this.localTrack("voice")?.enabled,
      screen: !!this.screenStream,
      voiceLimited: this.voiceLimited,
    });
  }
  async measure() {
    const e = this.pcs.get("screen") || this.pcs.get("voice");
    if (!e || e.pc.connectionState !== "connected") return;
    const generation = this.generation,
      report = await e.pc.getStats();
    let pressure = false,
      rtt = 0;
    for (const s of report.values()) {
      if (s.type === "candidate-pair" && s.state === "succeeded" && s.nominated) {
        rtt = s.currentRoundTripTime || 0;
        pressure ||= rtt > 0.3;
      }
      if (s.type === "remote-inbound-rtp") {
        const previous = e.previous.get(s.id);
        if (previous) {
          const lost = s.packetsLost - previous.lost,
            received = s.packetsReceived - previous.received;
          if (lost > 0 && received >= 0) pressure ||= lost / Math.max(1, lost + received) > 0.08;
        }
        e.previous.set(s.id, { lost: s.packetsLost || 0, received: s.packetsReceived || 0 });
        pressure ||= (s.fractionLost || 0) > 0.08;
      }
    }
    if (generation !== this.generation) return;
    await this.applyPressure(pressure);
    this.emit("network", { rtt, pressure });
  }
  async measureActivity() {
    const entry = this.pcs.get("voice"),
      generation = this.generation;
    if (!entry || this.activityBusy) return;
    this.activityBusy = true;
    try {
      const report = await entry.pc.getStats();
      if (generation !== this.generation) return;
      let local = false,
        remote = false;
      for (const stat of report.values()) {
        if (stat.kind !== "audio") continue;
        if (stat.type === "media-source") local ||= (stat.audioLevel || 0) > 0.015;
        if (stat.type === "inbound-rtp") remote ||= (stat.audioLevel || 0) > 0.015;
      }
      local &&= !!this.localTrack("voice")?.enabled;
      if (local !== this.speaking || remote !== this.remoteSpeaking) {
        this.speaking = local;
        this.remoteSpeaking = remote;
        this.changed();
      }
    } catch {
      /* No audio-level telemetry means no Speaking indicator. */
    } finally {
      this.activityBusy = false;
    }
  }
  async applyPressure(pressure: boolean) {
    if (pressure) {
      this.bad++;
      this.good = 0;
    } else {
      this.good++;
      this.bad = 0;
    }
    if (this.bad === 2 && !this.voiceLimited) {
      this.voiceLimited = true;
      this.voiceBitrate = 32000;
      await this.configureSender("voice");
      void this.sendMediaState();
    } else if (this.bad >= 3) {
      this.screenBitrate = Math.max(200000, Math.floor(this.screenBitrate * 0.65));
      await this.configureSender("screen");
    } else if (this.good >= 5) {
      if (this.voiceLimited) {
        this.voiceLimited = false;
        this.voiceBitrate = 64000;
        await this.configureSender("voice");
        void this.sendMediaState();
      }
      this.screenBitrate = Math.min(1200000, this.screenBitrate + 100000);
      await this.configureSender("screen");
    }
    this.changed();
  }
  dropPeer() {
    this.generation++;
    for (const e of this.pcs.values()) e.pc.close();
    this.pcs.clear();
    this.peer = null;
    this.speaking = this.remoteSpeaking = false;
    this.bad = this.good = 0;
    this.voiceLimited = false;
    this.voiceBitrate = 64000;
    this.screenBitrate = 1200000;
    this.emit("remoteState", { mic: false, screen: false });
    this.emit("track", { channel: "voice", stream: null });
    this.emit("track", { channel: "screen", stream: null });
  }
  leave() {
    ++this.joinRequest;
    this.active = false;
    clearTimeout(this.reconnect);
    clearInterval(this.monitor);
    clearInterval(this.activity);
    clearInterval(this.refresh);
    this.ws?.close();
    this.ws = null;
    this.dropPeer();
    this.stopMic();
    this.stopScreen();
    this.state = "Ready";
    this.changed();
  }
}

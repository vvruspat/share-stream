import { monitorGain, type StereoPeaks } from "./monitor.js";

// The only audible route is remote PCM -> smoothed gain -> output stream ->
// HTMLAudioElement. Keeping device selection on that element also supports
// browsers with setSinkId on media elements but not on AudioContext.
export class VoicePlayback {
  readonly context: AudioContext;
  readonly output: MediaStream;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly gain: GainNode;
  private readonly splitter: ChannelSplitterNode;
  private readonly analysers: [AnalyserNode, AnalyserNode];
  private readonly samples = [new Float32Array(256), new Float32Array(256)];
  private closed = false;

  constructor(
    private readonly input: MediaStream,
    db: number,
  ) {
    this.context = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    try {
      this.source = this.context.createMediaStreamSource(input);
      this.gain = this.context.createGain();
      this.gain.channelCount = 2;
      this.gain.channelCountMode = "explicit";
      this.gain.gain.value = monitorGain(db);
      const destination = this.context.createMediaStreamDestination();
      this.output = destination.stream;
      this.source.connect(this.gain);
      this.gain.connect(destination);
      this.splitter = this.context.createChannelSplitter(2);
      this.gain.connect(this.splitter);
      this.analysers = [this.context.createAnalyser(), this.context.createAnalyser()];
      this.analysers.forEach((analyser, channel) => {
        analyser.fftSize = 256;
        this.splitter.connect(analyser, channel);
      });
    } catch (error) {
      void this.context.close().catch(() => {});
      throw error;
    }
  }

  setGainDb(db: number): void {
    if (this.closed) return;
    const now = this.context.currentTime;
    const parameter = this.gain.gain;
    if (typeof parameter.cancelAndHoldAtTime === "function") parameter.cancelAndHoldAtTime(now);
    else {
      parameter.cancelScheduledValues(now);
      parameter.setValueAtTime(parameter.value, now);
    }
    parameter.linearRampToValueAtTime(monitorGain(db), now + 0.02);
  }

  peaks(): StereoPeaks {
    if (this.closed || this.context.state !== "running" || !this.input.active) return [0, 0];
    const read = (channel: number) => {
      const data = this.samples[channel];
      this.analysers[channel].getFloatTimeDomainData(data);
      let peak = 0;
      for (const sample of data) peak = Math.max(peak, Math.abs(sample));
      return peak;
    };
    return [read(0), read(1)];
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.source.disconnect();
    this.gain.disconnect();
    this.splitter.disconnect();
    this.analysers.forEach((analyser) => analyser.disconnect());
    this.output.getTracks().forEach((track) => track.stop());
    // The remote/input track belongs to WebRTC and must survive local playback
    // replacement, output changes and closing the browser voice settings.
    void this.context.close().catch(() => {});
  }
}

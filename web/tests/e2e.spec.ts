import { test, expect, type BrowserContext, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

async function openAudio(page: Page) {
  if ((await page.locator("#audio-settings").getAttribute("aria-expanded")) !== "true")
    await page.locator("#audio-settings").click();
}

async function joinRoom(page: Page) {
  const wasOpen = (await page.locator("#audio-settings").getAttribute("aria-expanded")) === "true";
  if (wasOpen) await page.locator("#audio-settings").click();
  await page.locator("#join").click();
  if (wasOpen) await openAudio(page);
}

async function synthetic(context: BrowserContext, voiceAmplitude = 1) {
  await context.addInitScript(
    ({ relay, tcp, voiceAmplitude }) => {
      window.mediaRequests = { audio: 0, display: 0 };
      window.testPCs = [];
      window.captureTracks = [];
      window.iceErrors = [];
      window.micConstraints = [];
      window.testAudioContexts = [];
      const NativeAudioContext = window.AudioContext;
      window.AudioContext = class extends NativeAudioContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          window.testAudioContexts.push(this);
        }
      };
      const NativePC = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends NativePC {
        constructor(config: RTCConfiguration = {}) {
          if (tcp)
            config.iceServers = config.iceServers
              ?.filter((s) => s.username)
              .map((s) => ({
                ...s,
                urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) =>
                  u.includes("transport=tcp"),
                ),
              }));
          super({ ...config, ...(relay ? { iceTransportPolicy: "relay" } : {}) });
          window.testPCs.push(this);
          this.addEventListener("icecandidateerror", (e) =>
            window.iceErrors.push({ code: e.errorCode, text: e.errorText, url: e.url }),
          );
          const getStats = this.getStats.bind(this);
          this.getStats = async (...args) =>
            window.forcePressure
              ? (new Map([
                  [
                    "test",
                    {
                      type: "candidate-pair",
                      state: "succeeded",
                      nominated: true,
                      currentRoundTripTime: 0.6,
                    },
                  ],
                ]) as unknown as RTCStatsReport)
              : getStats(...args);
        }
      };
      const NativeSocket = window.WebSocket;
      window.WebSocket = class extends NativeSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols);
          window.testSocket = this;
        }
      };
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints?.video !== false) throw new Error("Unexpected camera capture");
        if (window.captureTracks.some((t) => t.kind === "audio" && t.readyState !== "ended"))
          throw new Error("Previous microphone was not fully closed");
        window.mediaRequests.audio++;
        window.micConstraints.push(constraints.audio as MediaTrackConstraints);
        const context = new AudioContext(),
          oscillator = context.createOscillator(),
          target = context.createMediaStreamDestination();
        oscillator.frequency.value = 440;
        const gain = context.createGain();
        gain.gain.value = voiceAmplitude;
        oscillator.connect(gain).connect(target);
        oscillator.start();
        await context.resume();
        window.captureTracks.push(...target.stream.getTracks());
        return target.stream;
      };
      navigator.mediaDevices.getDisplayMedia = async (constraints) => {
        if (constraints?.audio !== false) throw new Error("Screen audio must stay off");
        window.mediaRequests.display++;
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const paint = canvas.getContext("2d")!;
        let frame = 0;
        const draw = () => {
          paint.fillStyle = "#1a5030";
          paint.fillRect(0, 0, 640, 360);
          paint.fillStyle = "white";
          paint.font = "32px sans-serif";
          paint.fillText(`Synthetic screen ${frame++}`, 40, 160);
        };
        draw();
        const timer = setInterval(draw, 66);
        const stream = canvas.captureStream(15);
        stream.getTracks()[0].addEventListener("ended", () => clearInterval(timer));
        window.captureTracks.push(...stream.getTracks());
        return stream;
      };
    },
    {
      relay: process.env.TEST_RELAY === "1",
      tcp: process.env.TEST_TURN_TCP === "1",
      voiceAmplitude,
    },
  );
}
async function pair(browser: Browser, baseURL = "http://localhost:48101", voiceAmplitude = 1) {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await synthetic(a, voiceAmplitude);
  await synthetic(b, voiceAmplitude);
  const pa = await a.newPage(),
    pb = await b.newPage(),
    code = randomBytes(16).toString("hex");
  await pa.goto(`${baseURL}/#room=${code}`);
  await pb.goto(`${baseURL}/#room=${code}`);
  await expect(pa.locator("#voice")).toBeAttached();
  await expect(pb.locator("#voice")).toBeAttached();
  return { a, b, pa, pb, code };
}
const stats = async (page: Page, kind: string, field: string) =>
  page.evaluate(
    async ({ kind, field }) => {
      let total = 0;
      for (const pc of window.testPCs)
        if (pc.connectionState !== "closed")
          for (const s of (await pc.getStats()).values())
            if (s.type === "inbound-rtp" && s.kind === kind) total += s[field] || 0;
      return total;
    },
    { kind, field },
  );

// Inspect the actual PCM stream handed to the output element. Element.volume
// alone says nothing about a gain stage, and captureStream() ignores that property.
async function voiceRms(page: Page): Promise<number> {
  return page.locator("#voice").evaluate(async (element) => {
    const stream = (element as HTMLAudioElement).srcObject as MediaStream | null;
    if (!stream?.active) return 0;
    const context = new AudioContext({ sampleRate: 48000 });
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      const silent = context.createGain();
      silent.gain.value = 0;
      source.connect(analyser).connect(silent).connect(context.destination);
      await context.resume();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const samples = new Float32Array(2048);
      let squared = 0;
      for (let window = 0; window < 8; window++) {
        analyser.getFloatTimeDomainData(samples);
        for (const sample of samples) squared += sample * sample;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return Math.sqrt(squared / (samples.length * 8));
    } finally {
      await context.close();
    }
  });
}

test("voice monitor changes rendered PCM, meters and mute without altering the transmitted voice", async ({
  browser,
  baseURL,
}) => {
  const { a, b, pa, pb } = await pair(browser, baseURL, 0.125);
  try {
    await joinRoom(pa);
    await joinRoom(pb);
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await expect(pb.locator("#status")).toContainText("Connected");
    await pa.locator("#mic").click();
    await pb.locator("#mic").click();
    await expect
      .poll(() => stats(pb, "audio", "bytesReceived"), { timeout: 20000 })
      .toBeGreaterThan(500);
    await expect.poll(() => voiceRms(pb), { timeout: 10000 }).toBeGreaterThan(0.02);
    await expect.poll(() => voiceRms(pa), { timeout: 10000 }).toBeGreaterThan(0.02);
    const baseline = await voiceRms(pb);
    const outgoingBaseline = await voiceRms(pa);
    await openAudio(pb);
    const volume = pb.getByRole("slider", { name: "Local monitor" });
    const initialOutput = await pb
      .locator("#voice")
      .evaluate((element) => ((element as HTMLAudioElement).srcObject as MediaStream).id);
    const peak = async () =>
      Number(
        (await pb.locator(".monitor-readout output").innerText()).match(/Peak (-?[\d.]+)/)?.[1],
      );
    await expect.poll(peak).toBeGreaterThan(-40);
    const initialPeak = await peak();
    for (const signal of await pb.locator(".monitor-signal").all())
      await expect
        .poll(() => signal.evaluate((element) => parseFloat((element as HTMLElement).style.width)))
        .toBeGreaterThan(0);
    await expect(pb.locator("#voice-source")).toHaveJSProperty("muted", true);
    await pb.locator("#audio-settings").click();
    await expect(volume).toBeHidden();
    expect(await voiceRms(pb)).toBeGreaterThan(baseline * 0.85);
    expect(
      await pb
        .locator("#voice")
        .evaluate((element) => ((element as HTMLAudioElement).srcObject as MediaStream).id),
    ).toBe(initialOutput);
    await openAudio(pb);
    for (const db of [-6, -20, 6, -60, 0]) {
      await openAudio(pb);
      await volume.dblclick();
      if (db === -60) await volume.press("Home");
      else if (db === 6) await volume.press("End");
      else for (let step = 0; step < -db; step++) await volume.press("PageDown");
      await expect(volume).toHaveAttribute("aria-valuenow", String(db));
      const expected = db === -60 ? 0 : 10 ** (db / 20);
      await expect
        .poll(async () => Math.abs((await voiceRms(pb)) / baseline - expected))
        .toBeLessThan(expected * 0.08 + 0.003);
      if (db === -60) {
        expect(await voiceRms(pb)).toBeLessThan(1e-6);
        await expect(pb.locator(".monitor-readout output")).toHaveText("Peak -inf dBFS");
        for (const signal of await pb.locator(".monitor-signal").all())
          await expect(signal).toHaveCSS("width", "0px");
        expect(await voiceRms(pa)).toBeGreaterThan(outgoingBaseline * 0.85);
      } else
        await expect.poll(async () => Math.abs((await peak()) - initialPeak - db)).toBeLessThan(1);
      expect(
        await pb.locator("#voice").evaluate((element) => {
          const audio = element as HTMLAudioElement;
          return {
            id: (audio.srcObject as MediaStream).id,
            volume: audio.volume,
            muted: audio.muted,
            paused: audio.paused,
          };
        }),
      ).toEqual({ id: initialOutput, volume: 1, muted: false, paused: false });
    }
    await pb.locator("#voice").evaluate((element) => {
      window.voiceOutputTrack = (
        (element as HTMLAudioElement).srcObject as MediaStream
      ).getAudioTracks()[0];
    });
    await pb.locator("#leave").click();
    await expect.poll(() => pb.evaluate(() => window.voiceOutputTrack?.readyState)).toBe("ended");
    await expect(pb.locator(".monitor-readout output")).toHaveText("Peak -inf dBFS");
    expect(
      await pb.locator("#voice").evaluate((element) => (element as HTMLAudioElement).srcObject),
    ).toBeNull();
    // A new incoming track must retain the local fader value and retire the old
    // output stream, rather than restarting at unity or keeping duplicate audio.
    await openAudio(pb);
    await volume.dblclick();
    for (let step = 0; step < 6; step++) await volume.press("PageDown");
    await joinRoom(pb);
    await expect(pb.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await expect(volume).toHaveAttribute("aria-valuenow", "-6");
    await expect
      .poll(async () => Math.abs((await voiceRms(pb)) / baseline - 10 ** (-6 / 20)))
      .toBeLessThan(0.05);
    expect(
      await pb
        .locator("#voice")
        .evaluate((element) => ((element as HTMLAudioElement).srcObject as MediaStream).id),
    ).not.toBe(initialOutput);
  } catch (error) {
    console.log(
      await pb.evaluate(async () => ({
        error: document.querySelector("#error")?.textContent,
        peak: document.querySelector(".monitor-readout")?.textContent,
        contexts: window.testAudioContexts.map((c) => ({
          state: c.state,
          time: c.currentTime,
          rate: c.sampleRate,
        })),
        audio: [...document.querySelectorAll("audio")].map((a) => ({
          paused: a.paused,
          volume: a.volume,
          stream: (a.srcObject as MediaStream | null)
            ?.getTracks()
            .map((t) => ({ state: t.readyState, muted: t.muted, enabled: t.enabled })),
        })),
        stats: (await Promise.all(window.testPCs.map((p) => p.getStats()))).flatMap((s) =>
          [...s.values()].filter((v) => v.type === "inbound-rtp" || v.type === "media-source"),
        ),
      })),
    );
    throw error;
  } finally {
    await a.close();
    await b.close();
  }
});
test("voice monitor keeps mute and output selection through autoplay recovery and releases playback on leave", async ({
  browser,
  baseURL,
}) => {
  const { a, b, pa, pb } = await pair(browser, baseURL, 0.125);
  try {
    await pb.evaluate(() => {
      const play = HTMLMediaElement.prototype.play;
      let blocked = false;
      HTMLMediaElement.prototype.play = function () {
        if (this.id === "voice" && !blocked) {
          blocked = true;
          return Promise.reject(new DOMException("Autoplay blocked", "NotAllowedError"));
        }
        return play.call(this);
      };
      window.outputSinkRequests = [];
      (document.querySelector("#voice") as HTMLAudioElement).setSinkId = async (id: string) => {
        window.outputSinkRequests.push(id);
      };
      navigator.mediaDevices.enumerateDevices = async () => [
        {
          deviceId: "headphones",
          groupId: "test",
          kind: "audiooutput",
          label: "Test headphones",
          toJSON: () => ({}),
        },
      ];
    });
    await openAudio(pb);
    const volume = pb.getByRole("slider", { name: "Local monitor" });
    await volume.press("Home");
    await joinRoom(pa);
    await joinRoom(pb);
    await expect(pb.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await pa.locator("#mic").click();
    await expect(pb.locator("#play")).toBeVisible();
    await openAudio(pb);
    await pb.locator("#voice-settings > button").click();
    await pb.getByRole("combobox", { name: "Voice output", exact: true }).click();
    await pb.getByRole("option", { name: "Test headphones" }).click();
    await expect.poll(() => pb.evaluate(() => window.outputSinkRequests)).toEqual(["headphones"]);
    await openAudio(pb);
    await pb.locator("#voice-settings > button").click();
    const output = await pb
      .locator("#voice")
      .evaluate((element) => ((element as HTMLAudioElement).srcObject as MediaStream).id);
    await pb.locator("#play").click();
    await expect(pb.locator("#play")).toBeHidden();
    expect(await voiceRms(pb)).toBeLessThan(1e-6);
    await openAudio(pb);
    await volume.dblclick();
    await expect.poll(() => voiceRms(pb)).toBeGreaterThan(0.02);
    expect(
      await pb
        .locator("#voice")
        .evaluate((element) => ((element as HTMLAudioElement).srcObject as MediaStream).id),
    ).toBe(output);
    await expect.poll(() => pb.evaluate(() => window.outputSinkRequests)).toEqual(["headphones"]);
    if (!process.env.TEST_BASE_URL)
      await pb
        .locator(".monitor-field")
        .screenshot({ path: "../build/screenshots/web-monitor.png" });
    await pb.locator("#leave").click();
    await expect
      .poll(() =>
        pb.evaluate(
          () => window.testAudioContexts.filter((context) => context.state !== "closed").length,
        ),
      )
      .toBe(0);
    await expect(pb.locator("#voice-source")).toHaveJSProperty("srcObject", null);
    await expect(pb.locator("#voice")).toHaveJSProperty("srcObject", null);
    await expect(pb.locator(".monitor-readout output")).toHaveText("Peak -inf dBFS");
  } finally {
    await a.close();
    await b.close();
  }
});
const selectedCandidates = async (page: Page, field: string) =>
  page.evaluate(async (field) => {
    const result = [];
    for (const pc of window.testPCs.filter((p) => p.connectionState !== "closed")) {
      const report = await pc.getStats();
      const transport = [...report.values()].find(
        (s) => s.type === "transport" && s.selectedCandidatePairId,
      );
      const pair = report.get(transport?.selectedCandidatePairId);
      const candidate = report.get(pair?.localCandidateId);
      if (candidate) result.push(candidate[field]);
    }
    return result;
  }, field);

test("explicit capture, two independent media transports, stop, mute and reconnect", async ({
  browser,
  baseURL,
}) => {
  const { a, b, pa, pb } = await pair(browser, baseURL);
  try {
    if (!process.env.TEST_BASE_URL)
      await pa.screenshot({ path: "../build/web-desktop.png", fullPage: true });
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await pa.getByRole("button", { name: "Join room", exact: true }).click();
    await pb.getByRole("button", { name: "Join room", exact: true }).click();
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await expect(pb.locator("#status")).toContainText("Connected");
    await expect(pa.locator("#participant-heading")).toHaveText("Participants · 2");
    if (!process.env.TEST_BASE_URL)
      await pa.screenshot({ path: "../build/screenshots/web-ui-final.png", fullPage: true });
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await pa.locator("#mic").click();
    await pb.locator("#mic").click();
    await pa.locator("#share").click();
    await expect
      .poll(() => stats(pb, "audio", "bytesReceived"), { timeout: 20000 })
      .toBeGreaterThan(100);
    await expect
      .poll(() => stats(pa, "audio", "bytesReceived"), { timeout: 20000 })
      .toBeGreaterThan(100);
    await expect
      .poll(() => stats(pb, "video", "framesDecoded"), { timeout: 20000 })
      .toBeGreaterThan(5);
    await expect(pb.locator("#remote-screen")).toBeVisible();
    const transports = await pa.evaluate(() =>
      window.testPCs
        .filter((p) => p.connectionState !== "closed")
        .map((p) => ({
          kind: p.getTransceivers()[0].receiver.track.kind,
          count: p.getTransceivers().length,
          cap: p.getSenders()[0].getParameters().encodings[0].maxBitrate,
          priority: p.getSenders()[0].getParameters().encodings[0].networkPriority,
        })),
    );
    expect(transports).toHaveLength(2);
    expect(transports.every((p) => p.count === 1)).toBe(true);
    expect(transports.find((p) => p.kind === "audio")!.cap).toBe(64000);
    expect(transports.find((p) => p.kind === "video")!.cap).toBe(1200000);
    expect(transports.find((p) => p.kind === "audio")!.priority).toBe("low");
    expect(transports.find((p) => p.kind === "video")!.priority).toBe("medium");
    expect(
      await pb.evaluate(
        () =>
          window.testPCs
            .filter((p) => p.connectionState !== "closed")
            .find((p) => p.getReceivers()[0]?.track.kind === "audio")!
            .getReceivers()[0].jitterBufferTarget,
      ),
    ).toBe(80);
    if (process.env.TEST_TURN_TCP === "1") {
      await expect.poll(() => selectedCandidates(pa, "relayProtocol")).toEqual(["tcp", "tcp"]);
    }
    const previousUfrag = await pa.evaluate(() =>
      window.testPCs
        .filter((p) => p.connectionState !== "closed")
        .map((p) => p.localDescription!.sdp.match(/a=ice-ufrag:(.*)/)![1]),
    );
    await pa.evaluate(() => window.testSocket.send('{"type":"refresh"}'));
    await expect
      .poll(() =>
        pa.evaluate(() =>
          window.testPCs
            .filter((p) => p.connectionState !== "closed")
            .map((p) => p.localDescription!.sdp.match(/a=ice-ufrag:(.*)/)![1]),
        ),
      )
      .not.toEqual(previousUfrag);
    await expect(pa.locator("#error")).toBeHidden();
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 20000 });
    if (process.env.TEST_RELAY === "1") {
      await expect.poll(() => selectedCandidates(pa, "candidateType")).toEqual(["relay", "relay"]);
    }
    await pb.locator("#share").click();
    await expect.poll(() => stats(pa, "video", "framesDecoded")).toBeGreaterThan(5);
    // A transient signaling disconnect must rebuild both transports and retain
    // only media the user already enabled, without a new permission request.
    await pa.evaluate(() => window.testSocket.close(4000, "Synthetic network interruption"));
    await expect.poll(() => pa.evaluate(() => window.testPCs.length)).toBeGreaterThan(2);
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 20000 });
    await expect.poll(() => stats(pb, "audio", "bytesReceived")).toBeGreaterThan(100);
    await expect.poll(() => stats(pb, "video", "framesDecoded")).toBeGreaterThan(5);
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 1, display: 1 });
    await pa.locator("#mic").click();

    await expect(pb.locator(".participant-mic").filter({ hasText: "Mic off" })).toHaveCount(1);
    await pa.locator("#share").click();
    await expect(pb.locator("#remote-screen")).toBeHidden();
    // Rejoining is a fresh pair of ICE transports; old media tracks are released.
    await pa.locator("#leave").click();
    await expect(pb.locator("#status")).toContainText("waiting");
    expect(
      await pa.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")),
    ).toBe(true);
    await joinRoom(pa);
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 20000 });
    await expect.poll(() => stats(pa, "video", "framesDecoded")).toBeGreaterThan(5);
  } catch (error) {
    for (const page of [pa, pb])
      console.log(
        JSON.stringify(
          await page.evaluate(async () => ({
            error: document.getElementById("error")!.textContent,
            iceErrors: window.iceErrors,
            requests: window.mediaRequests,
            pcs: await Promise.all(
              window.testPCs.map(async (p) => ({
                state: p.connectionState,
                signaling: p.signalingState,
                senders: p
                  .getSenders()
                  .map((s) => ({ track: s.track?.kind, enabled: s.track?.enabled })),
                stats: [...(await p.getStats()).values()].filter((s) =>
                  ["inbound-rtp", "outbound-rtp"].includes(s.type),
                ),
              })),
            ),
          })),
          null,
          2,
        ),
      );
    throw error;
  } finally {
    await a.close();
    await b.close();
  }
});

test("headphone mode releases the old capture before switching and preserves mute", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  await synthetic(context);
  try {
    const page = await context.newPage();
    await page.goto(`${baseURL}/#room=${randomBytes(16).toString("hex")}`);
    await openAudio(page);
    await page.locator("#voice-settings > button").click();
    await expect(page.locator("#voice-mode")).toHaveText("Headphones · unprocessed");
    await joinRoom(page);
    await page.locator("#mic").click();
    await expect(page.locator("#mic")).toHaveAttribute("aria-label", "Mute microphone");
    const constraints = await page.evaluate(() => window.micConstraints[0]);
    expect(constraints.echoCancellation).toEqual({ exact: false });
    expect(constraints.noiseSuppression).toEqual({ exact: false });
    expect(constraints.autoGainControl).toEqual({ exact: false });
    await page.locator("#mic").click();
    await expect(page.locator("#mic")).toHaveAttribute("aria-label", "Unmute microphone");
    await openAudio(page);
    await page.locator("#voice-mode").click();
    await page.getByRole("option", { name: "Speakers · echo cancellation" }).click();
    await expect(page.locator("#voice-mode")).toBeEnabled();
    await openAudio(page);
    await page.locator("#voice-mode").click();
    await page.getByRole("option", { name: "Headphones · unprocessed" }).click();
    await expect(page.locator("#voice-mode")).toBeEnabled();
    expect(await page.evaluate(() => window.captureTracks.length)).toBe(3);
    expect(
      await page.evaluate(() =>
        window.captureTracks.slice(0, 2).every((t) => t.readyState === "ended"),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => window.captureTracks[2].enabled)).toBe(false);
    const history = await page.evaluate(() => window.micConstraints);
    expect(history[1].echoCancellation).toBe(true);
    expect(history[2].echoCancellation).toEqual({ exact: false });
    await expect(page.locator("#error")).toBeHidden();
    await page.locator("#leave").click();
    expect(
      await page.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")),
    ).toBe(true);
  } finally {
    await context.close();
  }
});

test("one native invite opens the same chat automatically without capturing media", async ({
  browser,
  baseURL,
}) => {
  const { a, b, pa, pb, code } = await pair(browser, baseURL);
  try {
    await a.grantPermissions(["clipboard-read", "clipboard-write"]);
    const requests: string[] = [];
    pa.on("request", (request) => requests.push(request.url()));
    const link = `${baseURL}/#room=${code}&relay=relay.example.com&port=48123&join=1`;
    // Native launch opens a document. Changing only the hash on the fixture's
    // already-rendered page would be an unrelated same-document navigation.
    await pa.goto("about:blank");
    await pb.goto("about:blank");
    await pa.goto(link);
    await pb.goto(link);
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await expect(pb.locator("#status")).toContainText("Connected");
    await expect(pa.locator("#room")).toHaveCount(0);
    await expect(pa.getByRole("button", { name: "Copy invite", exact: true })).toHaveCount(0);
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    expect(await pb.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    expect(requests.every((url) => !url.includes(code))).toBe(true);
    expect(await pa.evaluate(() => new URLSearchParams(location.hash.slice(1)).has("join"))).toBe(
      false,
    );
    await pa.locator("#leave").click();
    await expect(pa.locator("#status")).toHaveText("Ready");
    await expect(pa.locator("#join")).toBeEnabled();
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
  } finally {
    await a.close();
    await b.close();
  }
});

test("mobile page fits its viewport and opens with capture off", async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  try {
    const page = await context.newPage();
    await page.goto(baseURL || "http://localhost:48101");
    await expect(page.locator("#join")).toHaveCount(0);
    await expect(page.locator("#mic")).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const stage = (await page.locator(".stage").boundingBox())!;
      const toolbar = (await page.locator(".stream-toolbar").boundingBox())!;
      expect(toolbar.x).toBeGreaterThan(stage.x);
      expect(toolbar.x + toolbar.width).toBeLessThan(stage.x + stage.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
    if (!process.env.TEST_BASE_URL)
      await page.screenshot({ path: "../build/web-mobile.png", fullPage: true });
  } finally {
    await context.close();
  }
});

test("Radix controls support the keyboard and the native monitor range and reset", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  await synthetic(context);
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon.ico"))
        errors.push(message.text());
    });
    await page.goto(`${baseURL}/#room=${randomBytes(16).toString("hex")}`);
    await openAudio(page);
    await page.locator("#voice-settings > button").click();
    const mode = page.getByRole("combobox", { name: "Voice mode" });
    await mode.focus();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("listbox")).toBeVisible();
    await expect(page.getByRole("option", { name: "Headphones · unprocessed" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("option", { name: "Speakers · echo cancellation" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mode).toHaveText("Speakers · echo cancellation");
    await expect(mode).toBeFocused();
    await expect(page.locator("#voice-mode-note")).toContainText("may lower other apps");
    await openAudio(page);
    const volume = page.getByRole("slider", { name: "Local monitor" });
    await volume.focus();
    await expect(volume).toHaveAttribute("aria-valuemin", "-60");
    await expect(volume).toHaveAttribute("aria-valuemax", "6");
    await volume.press("Home");
    await expect(volume).toHaveAttribute("aria-valuenow", "-60");
    await expect(volume).toHaveAttribute("aria-valuetext", "Mute");
    await volume.press("End");
    await expect(volume).toHaveAttribute("aria-valuenow", "6");
    await volume.press("ArrowLeft");
    await expect(volume).toHaveAttribute("aria-valuenow", "5.9");
    await volume.dblclick();
    await expect(volume).toHaveAttribute("aria-valuenow", "0");
    await expect(page.locator("#volume-value")).toHaveText("0.0 dB");
    await openAudio(page);
    await page.locator("#voice-settings > button").click();
    await expect(volume).toBeVisible();
    await expect(page.locator(".monitor-channel")).toHaveCount(2);
    expect(await page.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("congestion lowers voice bitrate without stopping speech, then screen budget, and recovers", async ({
  browser,
  baseURL,
}) => {
  const { a, b, pa, pb } = await pair(browser, baseURL);
  try {
    await joinRoom(pa);
    await joinRoom(pb);
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await pa.locator("#mic").click();
    await pa.locator("#share").click();
    await expect.poll(() => stats(pb, "video", "framesDecoded")).toBeGreaterThan(5);
    await pa.evaluate(() => {
      window.forcePressure = true;
    });
    const cap = (page: Page, kind: string) =>
      page.evaluate(
        (kind) =>
          window.testPCs
            .find(
              (pc) => pc.connectionState !== "closed" && pc.getSenders()[0]?.track?.kind === kind,
            )
            ?.getSenders()[0]
            .getParameters().encodings[0].maxBitrate,
        kind,
      );
    await expect.poll(() => cap(pa, "audio"), { timeout: 6500 }).toBe(32000);
    expect(
      await pa.evaluate(
        () =>
          window.testPCs
            .filter((p) => p.connectionState !== "closed")
            .find((p) => p.getTransceivers()[0].receiver.track.kind === "audio")!
            .getSenders()[0].track!.readyState,
      ),
    ).toBe("live");
    const before = await stats(pb, "audio", "bytesReceived");
    await expect.poll(() => stats(pb, "audio", "bytesReceived")).toBeGreaterThan(before + 100);
    expect(
      await pa.evaluate(
        () =>
          window.testPCs
            .filter((p) => p.connectionState !== "closed")
            .find((p) => p.getTransceivers()[0].receiver.track.kind === "video")!
            .getSenders()[0].track!.kind,
      ),
    ).toBe("video");
    await expect.poll(() => cap(pa, "video"), { timeout: 5000 }).toBeLessThan(1200000);
    await pa.evaluate(() => {
      window.forcePressure = false;
    });
    await expect.poll(() => cap(pa, "audio"), { timeout: 15000 }).toBe(64000);
  } finally {
    await a.close();
    await b.close();
  }
});

test("native sender and listener join chat after the sender reopens its browser tab", async ({
  browser,
  baseURL,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await synthetic(a, 0.125);
  await synthetic(b, 0.125);
  const old = await a.newPage(),
    sender = await a.newPage(),
    listener = await b.newPage(),
    code = randomBytes(16).toString("hex"),
    senderToken = randomBytes(16).toString("hex"),
    listenerToken = randomBytes(16).toString("hex");
  const { createHash } = await import("node:crypto");
  const room = createHash("sha256").update(`ShareStream-call-room-v1:${code}`).digest("hex");
  const launch = (token: string) => `${baseURL}/#room=${code}&join=1&participant=${token}`;
  try {
    for (const [token, music] of [
      [senderToken, "sending"],
      [listenerToken, "listening"],
    ]) {
      const response = await sender.request.post(`${baseURL}/api/presence`, {
        data: { room, token, source: "plugin", connected: true, music },
      });
      expect(response.ok()).toBe(true);
    }
    await old.addInitScript(({ key, token }) => localStorage.setItem(key, token), {
      key: `sharestream:participant:${code}`,
      token: randomBytes(16).toString("hex"),
    });
    await old.goto(launch(senderToken));
    await expect(old.locator("#leave")).toBeVisible();
    expect(
      await old.evaluate((key) => localStorage.getItem(key), `sharestream:participant:${code}`),
    ).toBe(senderToken);
    await sender.goto(launch(senderToken));
    await listener.goto(launch(listenerToken));
    await expect(sender.locator("#status")).toContainText("Connected", { timeout: 20000 });
    await expect(listener.locator("#status")).toContainText("Connected", { timeout: 20000 });
    await expect(old.locator("#status")).toHaveText("Session opened in another tab");
    for (const page of [sender, listener]) {
      await expect(page.locator("#error")).toBeHidden();
      await expect(page.locator("#participant-heading")).toHaveText("Participants · 2");
      expect(await page.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    }
    await old.close();
    await sender.locator("#mic").click();
    await listener.locator("#mic").click();
    await sender.locator("#share").click();
    await expect.poll(() => voiceRms(listener)).toBeGreaterThan(0.02);
    await expect.poll(() => voiceRms(sender)).toBeGreaterThan(0.02);
    await expect.poll(() => stats(listener, "video", "framesDecoded")).toBeGreaterThan(0);

    // A fresh plain invite in another tab must recover this installation's room
    // binding even after the private launch fragment has been removed.
    const replacement = await a.newPage();
    await replacement.goto(`${baseURL}/#room=${code}&join=1`);
    await expect(replacement.locator("#status")).toContainText("Connected", { timeout: 20000 });
    await expect(sender.locator("#status")).toHaveText("Session opened in another tab");
    await expect(replacement.locator("#participant-heading")).toHaveText("Participants · 2");
    await replacement.locator("#mic").click();
    await expect.poll(() => voiceRms(listener)).toBeGreaterThan(0.02);
    await expect.poll(() => voiceRms(replacement)).toBeGreaterThan(0.02);
    await expect
      .poll(() =>
        sender.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")),
      )
      .toBe(true);
  } finally {
    await a.close();
    await b.close();
  }
});

for (const layers of [0, 1, 2]) {
  test(`plugin presence merges after ${layers} fragment escapes and survives media failure`, async ({
    browser,
    baseURL,
  }) => {
    const context = await browser.newContext({ viewport: { width: 320, height: 780 } });
    await synthetic(context);
    const page = await context.newPage();
    const code = randomBytes(16).toString("hex"),
      token = randomBytes(16).toString("hex");
    const { createHash } = await import("node:crypto");
    const room = createHash("sha256").update(`ShareStream-call-room-v1:${code}`).digest("hex");
    const identity = createHash("sha256").update(token).digest("hex").slice(0, 32);
    try {
      const seeded = await page.request.post(`${baseURL}/api/presence`, {
        data: { room, token, source: "plugin", connected: true, music: "sending" },
      });
      expect(seeded.ok()).toBe(true);
      let fragment = `room=${code}&relay=stream.whitesquirrel.digital&port=48100&join=1&participant=${token}`;
      for (let i = 0; i < layers; i++) fragment = encodeURIComponent(fragment);
      await page.goto(`${baseURL}/#${fragment}`);
      await expect(page.locator("#join")).toHaveCount(0);
      await expect(page.locator("#leave")).toBeEnabled();
      expect(await page.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
      await expect(page.locator("#participant-heading")).toHaveText("Participants · 1");
      await expect(page.locator("#participant-heading")).toBeVisible();

      await expect(page.locator(".participant")).toHaveCount(1);
      await expect(page.locator(".participant")).toHaveAttribute("data-participant-id", identity);
      await expect(page.locator(".participant")).toContainText("Sending music");
      expect(await page.evaluate(() => location.hash.includes("participant"))).toBe(false);
      await openAudio(page);
      await page.locator("#voice-settings > button").click();
      await page
        .locator("#display-name")
        .fill("A very long participant name without spaces abcdefghijklmnopq");
      await expect(page.locator(".participant-name")).toContainText("A very long participant");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.evaluate(() => {
        navigator.mediaDevices.getUserMedia = async () => {
          throw new DOMException("Denied", "NotAllowedError");
        };
      });
      await page.locator("#mic").click();
      await expect(page.locator("#error")).toContainText("Permission was not granted");
      await expect(page.locator("#mic")).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".participant")).toHaveCount(1);
      await expect(page.locator(".participant")).toContainText("Sending music");

      await expect(page.locator(".participant-name")).toContainText("A very long participant");
      await page.locator("#leave").click();
      const remaining = await page.request.post(`${baseURL}/api/presence`, {
        data: { room, token, source: "plugin", connected: true, music: "listening" },
      });
      const participants = (await remaining.json()).participants;
      expect(participants).toHaveLength(1);
      expect(participants[0].music).toBe("listening");
    } finally {
      await context.close();
    }
  });
}

test("overlay toolbar uses real fullscreen and handles cancelled and externally stopped capture", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  await synthetic(context);
  const page = await context.newPage();
  try {
    await page.goto(`${baseURL}/#room=${randomBytes(16).toString("hex")}&join=1`);
    await expect(page.locator("#share")).toBeEnabled();
    await page.evaluate(() => {
      const capture = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async () => {
        navigator.mediaDevices.getDisplayMedia = capture;
        throw new DOMException("Cancelled", "NotAllowedError");
      };
    });
    await page.locator("#share").click();
    await expect(page.locator("#share")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#error")).toBeHidden();
    await page.locator("#share").click();
    await expect(page.locator("#share")).toHaveAttribute("aria-label", "Stop sharing");
    await page.evaluate(() => {
      const track = window.captureTracks.find((t) => t.kind === "video")!;
      track.stop();
      track.dispatchEvent(new Event("ended"));
    });
    await expect(page.locator("#share")).toHaveAttribute("aria-pressed", "false");
    const stage = page.getByRole("region", { name: "Screen sharing" });
    const toolbar = page.getByRole("toolbar", { name: "Call controls" });
    const assertInside = async () => {
      const outer = (await stage.boundingBox())!,
        inner = (await toolbar.boundingBox())!;
      expect(inner.x + inner.width).toBeLessThanOrEqual(outer.x + outer.width);
      expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height);
      expect(inner.x).toBeGreaterThan(outer.x);
      expect(inner.y).toBeGreaterThan(outer.y);
    };
    await assertInside();
    const full = page.locator("#fullscreen");
    await full.focus();
    await full.press("Enter");
    await expect(full).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.fullscreenElement?.getAttribute("aria-label"))).toBe(
      "Screen sharing",
    );
    await assertInside();
    await full.click();
    await expect(full).toHaveAttribute("aria-pressed", "false");
    await full.click();
    await expect(full).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => document.exitFullscreen());
    await expect(full).toHaveAttribute("aria-label", "Enter full screen");
    await page.evaluate(() => {
      Object.defineProperty(Element.prototype, "requestFullscreen", {
        value: undefined,
        configurable: true,
      });
    });
    await full.click();
    await expect(page.locator("#error")).toContainText("Fullscreen is unavailable");
    for (const button of ["#mic", "#share", "#fullscreen"]) {
      const box = (await page.locator(button).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  } finally {
    await context.close();
  }
});

test("display name persists after reload and joins a different room from localStorage", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext();
  await synthetic(context);
  const page = await context.newPage();
  const name = "Studio partner";
  try {
    await page.goto(`${baseURL}/#room=${randomBytes(16).toString("hex")}&join=1`);
    await expect(page.locator("#leave")).toBeVisible();
    await openAudio(page);
    await page.locator("#voice-settings > button").click();

    await page.locator("#display-name").fill(name);
    await expect(page.locator(".participant-name")).toContainText(name);
    await page.locator("#leave").click();
    await page.reload();
    await openAudio(page);
    await page.locator("#voice-settings > button").click();
    await expect(page.locator("#display-name")).toHaveValue(name);
    await joinRoom(page);

    await expect(page.locator(".participant-name")).toContainText(name);
    await page.locator("#leave").click();
    await page.goto("about:blank");
    await page.goto(`${baseURL}/#room=${randomBytes(16).toString("hex")}&join=1`);

    await expect(page.locator(".participant-name")).toContainText(name);
    await openAudio(page);
    await page.locator("#voice-settings > button").click();
    await page.locator("#display-name").fill("");
    await expect(page.locator(".participant-name")).toContainText("Participant ");
    expect(await page.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await page.locator("#leave").click();
    await page.reload();
    await openAudio(page);
    await page.locator("#voice-settings > button").click();
    await expect(page.locator("#display-name")).toHaveValue("");
  } finally {
    await context.close();
  }
});

test("saved rooms use contextual dialogs and survive leave, reload and account switching", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await synthetic(a);
  await synthetic(b);
  const pa = await a.newPage(),
    pb = await b.newPage();
  const suffix = randomBytes(5).toString("hex"),
    alice = `alice_${suffix}`,
    bob = `bob_${suffix}`,
    password = "test room password";
  const accountMenu = (page: Page) => page.getByRole("button", { name: /^Account:/ }).click();
  const register = async (page: Page, username: string) => {
    await page.goto("/");
    await expect(page.locator("input:visible")).toHaveCount(0);
    await accountMenu(page);
    await page.getByRole("menuitem", { name: "Sign in", exact: true }).click();
    await page.getByRole("button", { name: "Register", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Account: ${username}`, exact: true }),
    ).toBeVisible();
    await expect(page.locator("input:visible")).toHaveCount(0);
  };
  const room = (page: Page, name: string) =>
    page
      .getByRole("navigation", { name: "Saved rooms" })
      .getByRole("button", { name, exact: true });
  try {
    await register(pa, alice);
    await register(pb, bob);
    await pa.getByRole("button", { name: "Add room", exact: true }).click();
    await pa.getByRole("menuitem", { name: "Create room", exact: true }).click();
    await pa.getByLabel("New room name", { exact: true }).fill("Album mix");
    await pa.getByRole("button", { name: "Create room", exact: true }).click();
    await expect(room(pa, "Album mix")).toBeVisible();
    await pa.getByRole("button", { name: "Invite people", exact: true }).click();
    await pa.getByLabel("Invite username", { exact: true }).fill(bob);
    await pa.getByRole("button", { name: "Invite user", exact: true }).click();
    await expect(room(pb, "Album mix")).toBeVisible({ timeout: 10000 });
    await pa.getByRole("button", { name: "Close", exact: true }).click();
    await pa.getByRole("button", { name: "Room actions", exact: true }).click();
    await pa.getByRole("menuitem", { name: "Rename room", exact: true }).click();
    await pa.getByLabel("Room name", { exact: true }).fill("Friday session");
    await pa.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(room(pb, "Friday session")).toBeVisible({ timeout: 10000 });
    for (const page of [pa, pb]) {
      await room(page, "Friday session").click();
      await expect(page.locator("#status")).toHaveText("Ready");
      await joinRoom(page);
    }
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    for (const page of [pa, pb]) {
      await page.locator("#leave").click();
      await page.reload();
      await expect(room(page, "Friday session")).toBeVisible();
      await expect(page.locator("#status")).toHaveText("Ready");
      await joinRoom(page);
    }
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await pa.locator("#mic").click();
    await expect
      .poll(() =>
        pa.evaluate(() => window.captureTracks.filter((t) => t.readyState === "live").length),
      )
      .toBe(1);
    await accountMenu(pa);
    await pa.getByRole("menuitem", { name: "Add account", exact: true }).click();
    await pa.getByLabel("Username", { exact: true }).fill(bob);
    await pa.getByLabel("Password", { exact: true }).fill(password);
    await pa.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect
      .poll(() => pa.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")))
      .toBe(true);
    await expect(pa.getByRole("button", { name: `Account: ${bob}`, exact: true })).toBeVisible();
    await expect(pa.locator("#status")).toHaveText("Ready");
    await accountMenu(pa);
    await pa.getByRole("menuitem", { name: alice, exact: true }).click();
    await room(pa, "Friday session").click();
    await pa.getByRole("button", { name: "Room actions", exact: true }).click();
    await expect(pa.getByRole("menuitem", { name: "Rename room", exact: true })).toBeVisible();
    await pa.keyboard.press("Escape");
    expect(await pa.evaluate(() => localStorage.getItem("sharestream:accounts:v1"))).toBeNull();
    await pa.screenshot({ path: "/tmp/share-stream-rooms.png", fullPage: true });
    for (const width of [390, 320]) {
      await pa.setViewportSize({ width, height: 844 });
      expect(await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  } finally {
    await a.close();
    await b.close();
  }
});

test("group mesh keeps every voice and screen connected across late join, departure and rejoin", async ({
  browser,
}) => {
  const contexts: BrowserContext[] = [],
    pages: Page[] = [];
  const code = randomBytes(16).toString("hex");
  const enter = async () => {
    const context = await browser.newContext();
    contexts.push(context);
    await synthetic(context, 0.125);
    const page = await context.newPage();
    pages.push(page);
    await page.addInitScript(
      (name) => localStorage.setItem("sharestream:display-name", name),
      ["Alex", "Maya", "Leo", "Sam"][pages.length - 1],
    );
    await page.goto(`/#room=${code}`);
    await joinRoom(page);
    return page;
  };
  const connected = async (page: Page, peers: number) => {
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.testPCs.filter(
                (p) => p.connectionState !== "closed" && p.connectionState === "connected",
              ).length,
          ),
        { timeout: 25000 },
      )
      .toBe(peers * 2);
  };
  const receiving = async (page: Page, kind: string, property: string, count: number) => {
    await expect
      .poll(
        () =>
          page.evaluate(
            async ({ kind, property }) => {
              const reports = await Promise.all(
                window.testPCs
                  .filter((p) => p.connectionState !== "closed")
                  .map((p) => p.getStats()),
              );
              return reports
                .flatMap((report) => [...report.values()])
                .filter((s) => s.type === "inbound-rtp" && s.kind === kind && s[property] > 500)
                .length;
            },
            { kind, property },
          ),
        { timeout: 20000 },
      )
      .toBe(count);
  };
  try {
    const a = await enter(),
      b = await enter(),
      c = await enter();
    for (const page of [a, b, c]) {
      await connected(page, 2);
      await page.locator("#mic").click();
    }
    for (const page of [a, b, c]) await receiving(page, "audio", "bytesReceived", 2);
    await a.locator("#share").click();
    await expect.poll(() => stats(b, "video", "framesDecoded")).toBeGreaterThan(5);
    await expect.poll(() => stats(c, "video", "framesDecoded")).toBeGreaterThan(5);
    await b.locator("#share").click();
    await expect(c.getByRole("combobox", { name: "View screen" })).toBeVisible();
    await expect.poll(() => stats(c, "video", "framesDecoded")).toBeGreaterThan(15);
    const d = await enter();
    await connected(d, 3);
    await receiving(d, "audio", "bytesReceived", 3);
    expect(await d.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await d.locator("#mic").click();
    for (const page of [a, b, c]) {
      await connected(page, 3);
      await receiving(page, "audio", "bytesReceived", 3);
      expect((await page.evaluate(() => window.mediaRequests)).audio).toBe(1);
    }
    await b.locator("#leave").click();
    expect(
      await b.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")),
    ).toBe(true);
    for (const page of [a, c, d]) {
      await connected(page, 2);
      await receiving(page, "audio", "bytesReceived", 2);
    }
    await expect(c.getByRole("combobox", { name: "View screen" })).toHaveCount(0);
    await b.locator("#join").click();
    await connected(b, 3);
    await receiving(b, "audio", "bytesReceived", 3);
    expect((await b.evaluate(() => window.mediaRequests)).audio).toBe(1);
    await c.locator("#participant-heading").click();
    await expect(c.locator(".participant")).toHaveCount(4, { timeout: 10000 });
    await expect(c.locator(".participant-name").filter({ hasText: "Maya" })).toBeVisible();
    await c.screenshot({ path: "/tmp/share-stream-group-web.png", fullPage: true });
    await a.locator("#share").click();
    await expect(c.locator("#remote-screen")).toBeHidden();
    await c.screenshot({ path: "/tmp/share-stream-group-participants.png", fullPage: true });
    for (const width of [390, 320]) {
      await c.setViewportSize({ width, height: 844 });
      expect(await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await c.screenshot({ path: `/tmp/share-stream-group-${width}.png`, fullPage: true });
    }
    await openAudio(c);
    await c.locator("#voice-settings > button").click();
    expect(await c.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await c.screenshot({ path: "/tmp/share-stream-audio-mobile.png", fullPage: true });
  } finally {
    for (const context of contexts) await context.close();
  }
});

test("native handoff confirms identity, keeps account tabs independent and never mounts a guest on reload", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext();
  await synthetic(context);
  const page = await context.newPage();
  const suffix = randomBytes(5).toString("hex");
  const nativeAccount = async (username: string, name: string) => {
    const registration = await request.post("/api/accounts/register", {
      data: { username, password: "native handoff test password" },
    });
    expect(registration.ok()).toBe(true);
    const account = (await registration.json()) as import("../shared/directory.js").SavedAccount;
    const headers = { Authorization: `Bearer ${account.token}` };
    const roomResponse = await request.post("/api/rooms", {
      headers,
      data: { name, code: randomBytes(16).toString("hex") },
    });
    expect(roomResponse.ok()).toBe(true);
    const data = (await roomResponse.json()) as {
      selected: string;
      rooms: import("../shared/directory.js").SavedRoom[];
    };
    const room = data.rooms.find((r) => r.id === data.selected)!;
    return {
      ...account,
      room,
      ticket: async () => {
        const result = await request.post("/api/accounts/browser-handoffs", {
          headers,
          data: { roomId: room.id },
        });
        expect(result.ok()).toBe(true);
        return ((await result.json()) as { ticket: string }).ticket;
      },
    };
  };
  try {
    const alice = await nativeAccount(`handoff_a_${suffix}`, "Evening mix");
    const firstTicket = await alice.ticket();
    await page.goto(`/connect#handoff=${firstTicket}`);
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await expect(page.locator("input")).toHaveCount(0);
    await expect(page.locator("#voice")).toHaveCount(0);
    expect(await page.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await page
      .getByRole("button", { name: `Continue as @${alice.user.username}`, exact: true })
      .click();
    await expect(page.locator("#leave")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evening mix", exact: true })).toBeVisible();
    const { createHash } = await import("node:crypto");
    const identity = createHash("sha256").update(alice.room.participant).digest("hex").slice(0, 32);
    await expect(page.locator(".participant")).toHaveAttribute("data-participant-id", identity);
    expect(await page.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    const sameTicket = await alice.ticket();
    await page.goto(`/connect#handoff=${sameTicket}`);
    await expect(page.locator("#leave")).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // An explicit guest plugin binding must survive even when this browser has
    // an account membership in the same room; selecting the saved room uses the account again.
    const guestToken = randomBytes(16).toString("hex");
    await page.goto(`/#room=${alice.room.code}&join=1&participant=${guestToken}`);
    await page.reload();
    await expect(page.locator("#leave")).toBeVisible();
    await expect(page.locator(".participant")).toHaveAttribute(
      "data-participant-id",
      createHash("sha256").update(guestToken).digest("hex").slice(0, 32),
    );
    expect(new URL(page.url()).hash).not.toContain("participant");
    await page.reload();
    await joinRoom(page);
    await expect(page.locator(".participant")).toHaveAttribute(
      "data-participant-id",
      createHash("sha256").update(guestToken).digest("hex").slice(0, 32),
    );
    await page
      .getByRole("navigation", { name: "Saved rooms" })
      .getByRole("button", { name: "Evening mix", exact: true })
      .click();

    // Directory membership must resolve before the first call/presence identity is mounted.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let directoryStarted = false;
    await page.route("**/api/rooms", async (route) => {
      directoryStarted = true;
      await gate;
      await route.continue();
    });
    await page.goto(`/#room=${alice.room.code}&join=1`);
    await page.reload();
    await expect.poll(() => directoryStarted).toBe(true);
    await expect(page.locator("#voice")).toHaveCount(0);
    expect(await page.evaluate(() => window.testPCs.length)).toBe(0);
    release();
    await expect(page.locator("#leave")).toBeVisible();
    await expect(page.locator(".participant")).toHaveAttribute("data-participant-id", identity);
    await page.unroute("**/api/rooms");
    await page.locator("#mic").click();
    await expect(page.locator("#mic")).toHaveAttribute("aria-label", "Mute microphone");

    const bob = await nativeAccount(`handoff_b_${suffix}`, "Second room");
    const other = await context.newPage();
    await other.goto(`/connect#handoff=${await bob.ticket()}`);
    await expect(other.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Account: ${alice.user.username}`, exact: true }),
    ).toBeVisible();
    await other
      .getByRole("button", { name: `Continue as @${bob.user.username}`, exact: true })
      .click();
    await expect(other.locator("#leave")).toBeVisible();
    await other.locator("#mic").click();
    await expect(other.locator("#mic")).toHaveAttribute("aria-label", "Mute microphone");
    await page.bringToFront();
    await expect(page.locator("#mic")).toHaveAttribute("aria-label", "Mute microphone");
    expect(
      await page.evaluate(() => window.captureTracks.filter((t) => t.readyState === "live").length),
    ).toBe(1);
    for (const tab of [page, other]) {
      const storage = await tab.evaluate(() =>
        JSON.stringify(
          [localStorage, sessionStorage].flatMap((storage) =>
            Object.keys(storage).map((key) => storage.getItem(key)),
          ),
        ),
      );
      expect(storage).not.toContain(alice.token);
      expect(storage).not.toContain(bob.token);
      expect(storage).not.toContain(firstTicket);
    }
    // Revoking Alice's browser grant stops Alice's tab but leaves Bob's microphone alone.
    expect(
      await other.evaluate(async (accountId) => {
        const session = (await (await fetch("/api/browser/session")).json()) as { csrf: string };
        return (
          await fetch("/api/browser/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf },
            body: JSON.stringify({ accountId }),
          })
        ).status;
      }, alice.user.id),
    ).toBe(200);
    await expect(page.getByRole("button", { name: "Account: Guest", exact: true })).toBeVisible({
      timeout: 10000,
    });
    expect(
      await page.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")),
    ).toBe(true);
    await expect(other.locator("#mic")).toHaveAttribute("aria-label", "Mute microphone");
    const replay = await context.newPage();
    await replay.goto(`/connect#handoff=${firstTicket}`);
    await expect(replay.getByRole("alert")).toContainText("Open Voice & screen again from the app");
    await expect(replay.locator("#leave")).toHaveCount(0);
    await expect(replay.locator("input:visible")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("concurrent browser bootstrap is serialized and interrupted handoff can be reopened", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext();
  await synthetic(context);
  const a = await context.newPage(),
    b = await context.newPage();
  const suffix = randomBytes(5).toString("hex");
  let anonymousRequests = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route("**/api/browser/session", async (route) => {
    if (!(await route.request().allHeaders()).cookie) {
      anonymousRequests++;
      await gate;
    }
    await route.continue();
  });
  try {
    await Promise.all([a.goto("/"), b.goto("/")]);
    await expect.poll(() => anonymousRequests).toBe(1);
    release();
    await expect(a.locator("#voice")).toBeAttached();
    await expect(b.locator("#voice")).toBeAttached();
    expect(anonymousRequests).toBe(1);
    await context.unroute("**/api/browser/session");
    const registration = await request.post("/api/accounts/register", {
      data: { username: `pending_${suffix}`, password: "pending handoff test password" },
    });
    const account = (await registration.json()) as import("../shared/directory.js").SavedAccount;
    const headers = { Authorization: `Bearer ${account.token}` };
    const roomResponse = await request.post("/api/rooms", {
      headers,
      data: { code: randomBytes(16).toString("hex"), name: "Pending room" },
    });
    const room = (await roomResponse.json()) as { selected: string };
    const ticketResponse = await request.post("/api/accounts/browser-handoffs", {
      headers,
      data: { roomId: room.selected },
    });
    const ticket = (await ticketResponse.json()) as { ticket: string };
    await a.goto(`/connect#handoff=${ticket.ticket}`);
    await expect(a.getByRole("dialog")).toBeVisible();
    await a.reload();
    await expect(a.getByRole("alert")).toContainText("connection was interrupted");
    await expect(a.getByRole("dialog")).toHaveCount(0);
    await expect(a.locator("#leave")).toHaveCount(0);
    expect(await a.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    // Dialogs and menus remain usable without a pointer, and leave no forms on the page.
    await a.getByRole("button", { name: "Add room", exact: true }).focus();
    await a.keyboard.press("Enter");
    await a.getByRole("menuitem", { name: "Open invitation", exact: true }).focus();
    await a.keyboard.press("Enter");
    await expect(a.getByRole("dialog", { name: "Open invitation" })).toBeVisible();
    await a.keyboard.press("Escape");
    await expect(a.getByRole("dialog")).toHaveCount(0);
    await expect(a.locator("input:visible")).toHaveCount(0);
  } finally {
    release();
    await context.close();
  }
});

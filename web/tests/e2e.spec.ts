import { test, expect, type BrowserContext, type Browser, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

async function synthetic(context: BrowserContext) {
  await context.addInitScript(
    ({ relay, tcp }) => {
      window.mediaRequests = { audio: 0, display: 0 };
      window.testPCs = [];
      window.captureTracks = [];
      window.iceErrors = [];
      window.micConstraints = [];
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
        oscillator.connect(target);
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
    { relay: process.env.TEST_RELAY === "1", tcp: process.env.TEST_TURN_TCP === "1" },
  );
}
async function pair(browser: Browser, baseURL = "http://localhost:48101") {
  const a = await browser.newContext(),
    b = await browser.newContext();
  await synthetic(a);
  await synthetic(b);
  const pa = await a.newPage(),
    pb = await b.newPage(),
    code = randomBytes(16).toString("hex");
  await pa.goto(`${baseURL}/#room=${code}`);
  await pb.goto(`${baseURL}/#room=${code}`);
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
    await expect(pb.locator("#remote-mic")).toHaveText("Partner’s mic off");
    await pa.locator("#share").click();
    await expect(pb.locator("#remote-screen")).toBeHidden();
    // Rejoining is a fresh pair of ICE transports; old media tracks are released.
    await pa.locator("#leave").click();
    await expect(pb.locator("#status")).toContainText("waiting");
    expect(
      await pa.evaluate(() => window.captureTracks.every((t) => t.readyState === "ended")),
    ).toBe(true);
    await pa.locator("#join").click();
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
    await expect(page.locator("#voice-mode")).toHaveText("Headphones · unprocessed");
    await page.locator("#join").click();
    await page.locator("#mic").click();
    await expect(page.locator("#mic")).toHaveText("Mute microphone");
    const constraints = await page.evaluate(() => window.micConstraints[0]);
    expect(constraints.echoCancellation).toEqual({ exact: false });
    expect(constraints.noiseSuppression).toEqual({ exact: false });
    expect(constraints.autoGainControl).toEqual({ exact: false });
    await page.locator("#mic").click();
    await expect(page.locator("#mic")).toHaveText("Unmute microphone");
    await page.locator("#voice-mode").click();
    await page.getByRole("option", { name: "Speakers · echo cancellation" }).click();
    await expect(page.locator("#voice-mode")).toBeEnabled();
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
    await expect(pa.locator("#room")).toHaveValue(code);
    expect(await pa.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    expect(await pb.evaluate(() => window.mediaRequests)).toEqual({ audio: 0, display: 0 });
    await pa.getByRole("button", { name: "Copy invite", exact: true }).click();
    await expect(pa.locator("#copy")).toHaveText("Copied");
    const copied = await pa.evaluate(() => navigator.clipboard.readText());
    const parameters = new URLSearchParams(new URL(copied).hash.slice(1));
    expect(Object.fromEntries(parameters)).toEqual({
      room: code,
      relay: "relay.example.com",
      port: "48123",
      join: "1",
    });
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
    await expect(page.locator("#join")).toBeEnabled();
    await expect(page.locator("#mic")).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (!process.env.TEST_BASE_URL)
      await page.screenshot({ path: "../build/web-mobile.png", fullPage: true });
  } finally {
    await context.close();
  }
});

test("Radix controls support the keyboard and update actual voice playback volume", async ({
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
    const volume = page.getByRole("slider", { name: "Partner’s voice volume" });
    await volume.focus();
    await volume.press("Home");
    await expect(volume).toHaveAttribute("aria-valuenow", "0");
    await expect
      .poll(() => page.locator("#voice").evaluate((audio) => (audio as HTMLAudioElement).volume))
      .toBe(0);
    await volume.press("End");
    await expect
      .poll(() => page.locator("#voice").evaluate((audio) => (audio as HTMLAudioElement).volume))
      .toBe(1);
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
    await pa.locator("#join").click();
    await pb.locator("#join").click();
    await expect(pa.locator("#status")).toContainText("Connected", { timeout: 25000 });
    await pa.locator("#mic").click();
    await pa.locator("#share").click();
    await expect.poll(() => stats(pb, "video", "framesDecoded")).toBeGreaterThan(5);
    await pa.evaluate(() => {
      window.forcePressure = true;
    });
    await expect(pa.locator("#voice-budget")).toHaveText("≤32 kbps", { timeout: 6500 });
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
    await expect(pa.locator("#screen-budget")).not.toHaveText("≤1.2 Mbps", { timeout: 5000 });
    await pa.evaluate(() => {
      window.forcePressure = false;
    });
    await expect(pa.locator("#voice-budget")).toHaveText("≤64 kbps", { timeout: 15000 });
  } finally {
    await a.close();
    await b.close();
  }
});

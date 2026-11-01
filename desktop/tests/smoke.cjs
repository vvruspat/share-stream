const { test } = require("node:test");
const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const { once } = require("node:events");
const { spawn, execFile } = require("node:child_process");
const { _electron } = require("../../web/node_modules/playwright");
const expect = require("../../web/node_modules/@playwright/test").expect.configure({
  timeout: 15000,
});
const root = resolve(__dirname, "../..");
const nativeBuild = process.env.SHARE_STREAM_TEST_BUILD_DIR || "build";
const helper = join(root, nativeBuild, "session_helper");
function probe(args, env, body) {
  const child = spawn(
    join(root, nativeBuild, "processor_tests_artefacts/Release/processor_tests"),
    args,
    { env, stdio: ["pipe", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (b) => (output += b));
  child.stderr.on("data", (b) => (output += b));
  child.stdin.end(body ? JSON.stringify(body) : undefined);
  const done = once(child, "close").then(([code]) => assert.equal(code, 0, output));
  void done.catch(() => {});
  return done;
}
const helperCommand = (env, body) =>
  new Promise((accept, reject) => {
    const child = execFile(helper, [], { env }, (error) => (error ? reject(error) : accept()));
    child.stdin.end(JSON.stringify(body));
  });

test(
  "desktop account, rooms and settings use separate windows and a shared native session",
  { timeout: 60000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "share-stream-desktop-"));
    const { createService } = await import(
      pathToFileURL(join(root, "web/dist/server/service.js")).href
    );
    const dev = process.env.SHARE_STREAM_DESKTOP_RENDERER_URL;
    const service = createService({
      dataDir: join(temporary, "data"),
      ...(dev ? { origin: dev } : {}),
    });
    service.server.listen(0, "127.0.0.1");
    await once(service.server, "listening");
    const origin = `http://127.0.0.1:${service.server.address().port}`;
    const env = {
      ...process.env,
      SHARE_STREAM_DIRECTORY_URL: origin,
      SHARE_STREAM_PRESENCE_URL: origin,
      SHARE_STREAM_ACCOUNT_FILE: join(temporary, "native/accounts.json"),
      SHARE_STREAM_SESSION_HELPER: helper,
      SHARE_STREAM_DESKTOP_USER_DATA: join(temporary, "profile"),
      SHARE_STREAM_DESKTOP_TEST: "1",
    };
    delete env.ELECTRON_RUN_AS_NODE;
    let application;
    try {
      if (process.env.SHARE_STREAM_CHAT_EXECUTABLE) delete env.SHARE_STREAM_SESSION_HELPER;
      application = await _electron.launch({
        executablePath:
          process.env.SHARE_STREAM_CHAT_EXECUTABLE || require("../node_modules/electron"),
        args: [join(root, "desktop")],
        env,
      });
      const main = await application.firstWindow();
      const errors = [];
      main.on("pageerror", (error) => errors.push(error.message));
      await main.getByRole("button", { name: "Sign in", exact: true }).first().waitFor();
      assert.equal(await main.evaluate(() => typeof require), "undefined");
      const accountReady = application.waitForEvent("window");
      const watcher = probe(["--watch-account", "desktop_test"], env);
      await main.getByRole("button", { name: "Sign in", exact: true }).first().click();
      const account = await accountReady;
      await account.getByRole("button", { name: "Create a new account", exact: true }).click();
      await account.getByLabel("Username", { exact: true }).fill("desktop_test");
      await account.getByLabel("Password", { exact: true }).fill("123");
      await account.getByRole("button", { name: "Create account", exact: true }).click();
      await main.getByRole("button", { name: "desktop_test", exact: true }).waitFor();
      await watcher;
      const stored = JSON.parse(await readFile(env.SHARE_STREAM_ACCOUNT_FILE, "utf8"));
      assert.equal(stored.accounts.length, 1);
      assert.equal(stored.active, stored.accounts[0].user.id);
      assert.equal(
        JSON.stringify(await main.evaluate(() => window.shareStreamDesktop.model())).includes(
          stored.accounts[0].token,
        ),
        false,
      );
      const roomsReady = application.waitForEvent("window");
      await main.getByRole("button", { name: "Choose a room", exact: true }).click();
      const rooms = await roomsReady;
      const createReady = application.waitForEvent("window");
      await rooms.getByRole("button", { name: "Create room", exact: true }).click();
      const create = await createReady;
      await create.getByLabel("Room name", { exact: true }).fill("Desktop mix");
      await create.getByRole("button", { name: "Create and join", exact: true }).click();
      await main.getByRole("heading", { name: "Desktop mix", exact: true, level: 1 }).waitFor();
      const before = await main.evaluate(() => [innerWidth, innerHeight]);
      const settingsReady = application.waitForEvent("window");
      await main.getByRole("button", { name: "Audio settings window", exact: true }).click();
      const settings = await settingsReady;
      await settings.getByRole("heading", { name: "Audio settings", exact: true }).waitFor();
      assert.deepEqual(await main.evaluate(() => [innerWidth, innerHeight]), before);
      await main.screenshot({ path: join(root, "build/desktop-chat.png") });
      await settings.screenshot({ path: join(root, "build/desktop-settings.png") });
      await settings.getByRole("button", { name: "Close", exact: true }).click();
      await application.evaluate(({ clipboard }) => {
        globalThis.savedTestClipboard = clipboard.readText();
      });
      const inviteReady = application.waitForEvent("window");
      await main.getByRole("button", { name: "Invite", exact: true }).click();
      const invite = await inviteReady;
      await invite.getByRole("button", { name: "Copy code", exact: true }).click();
      await invite.getByRole("status").filter({ hasText: "Room code copied" }).waitFor();
      const selected = await main.evaluate(() => window.shareStreamDesktop.model());
      await expect
        .poll(
          async () =>
            (await application.evaluate(({ clipboard }) => clipboard.readText())) ===
            selected.launch.code,
        )
        .toBe(true);
      await invite.getByRole("button", { name: "Close", exact: true }).click();
      const accountAgain = application.waitForEvent("window");
      await main.getByRole("button", { name: "desktop_test", exact: true }).click();
      const signing = await accountAgain;
      await signing.getByRole("button", { name: "Sign out", exact: true }).click();
      await main.getByRole("button", { name: "Sign in", exact: true }).first().waitFor();
      await probe(["--native-login"], env, { username: "desktop_test", password: "123" });
      await main.getByRole("button", { name: "desktop_test", exact: true }).waitFor();
      assert.deepEqual(errors, []);
    } catch (error) {
      if (application)
        for (const page of application.windows())
          console.error(
            "Window:",
            page.url(),
            await page
              .locator("body")
              .innerText()
              .catch(() => "unavailable"),
          );
      throw error;
    } finally {
      if (application) {
        await application.evaluate(({ clipboard }) => {
          if (typeof globalThis.savedTestClipboard === "string")
            clipboard.writeText(globalThis.savedTestClipboard);
        });
        await application.close();
      }
      await service.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

async function synthetic(main) {
  await main.addInitScript(() => {
    window.testPCs = [];
    window.mediaRequests = { audio: 0, display: 0 };
    const Peer = RTCPeerConnection;
    window.RTCPeerConnection = class extends Peer {
      constructor(config) {
        super(config);
        window.testPCs.push(this);
      }
    };
    navigator.mediaDevices.getUserMedia = async () => {
      window.mediaRequests.audio++;
      const context = new AudioContext(),
        oscillator = context.createOscillator(),
        target = context.createMediaStreamDestination();
      oscillator.connect(target);
      oscillator.start();
      await context.resume();
      return target.stream;
    };
    navigator.mediaDevices.getDisplayMedia = async () => {
      window.mediaRequests.display++;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d");
      let frame = 0;
      const draw = () => {
        context.fillStyle = "#1a5030";
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = "white";
        context.font = "32px sans-serif";
        context.fillText(`Screen ${frame++}`, 40, 160);
      };
      draw();
      const timer = setInterval(draw, 66);
      const stream = canvas.captureStream(15);
      stream.getVideoTracks()[0].addEventListener("ended", () => clearInterval(timer));
      return stream;
    };
  });
  await main.reload();
}

test(
  "two apps invite with consent, synchronize room names, stream media and restore the room with capture off",
  { timeout: 120000 },
  async () => {
    const temporary = await mkdtemp(join(tmpdir(), "share-stream-pair-"));
    const { createService } = await import(
      pathToFileURL(join(root, "web/dist/server/service.js")).href
    );
    const dev = process.env.SHARE_STREAM_DESKTOP_RENDERER_URL;
    const service = createService({
      dataDir: join(temporary, "data"),
      ...(dev ? { origin: dev } : {}),
    });
    service.server.listen(0, "127.0.0.1");
    await once(service.server, "listening");
    const origin = `http://127.0.0.1:${service.server.address().port}`,
      applications = [],
      errors = [];
    const environment = (name) => {
      const env = {
        ...process.env,
        SHARE_STREAM_DIRECTORY_URL: origin,
        SHARE_STREAM_ACCOUNT_FILE: join(temporary, name, "native/accounts.json"),
        SHARE_STREAM_SESSION_HELPER: helper,
        SHARE_STREAM_DESKTOP_USER_DATA: join(temporary, name, "profile"),
        SHARE_STREAM_DESKTOP_TEST: "1",
      };
      delete env.ELECTRON_RUN_AS_NODE;
      return env;
    };
    const launch = async (env) => {
      if (process.env.SHARE_STREAM_CHAT_EXECUTABLE) delete env.SHARE_STREAM_SESSION_HELPER;
      const application = await _electron.launch({
        executablePath:
          process.env.SHARE_STREAM_CHAT_EXECUTABLE || require("../node_modules/electron"),
        args: [join(root, "desktop")],
        env,
      });
      applications.push(application);
      await application.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.webContents.setAudioMuted(true);
      });
      const main = await application.firstWindow();
      main.on("pageerror", (e) => errors.push(e.message));
      await synthetic(main);
      return { application, main };
    };
    const request = (page, path, method = "GET", body) =>
      page.evaluate(
        ({ path, method, body }) => window.shareStreamDesktop.request(path, method, body),
        { path, method, body },
      );
    try {
      const envA = environment("alice"),
        envB = environment("bob"),
        a = await launch(envA),
        b = await launch(envB);
      await request(a.main, "/api/accounts/register", "POST", {
        username: "pair_alice",
        password: "123",
      });
      await request(b.main, "/api/accounts/register", "POST", {
        username: "pair_bob",
        password: "123",
      });
      const created = await request(a.main, "/api/rooms", "POST", {
          code: "9".repeat(32),
          name: "Pair mix",
          host: "stream.whitesquirrel.digital",
          port: 48100,
        }),
        room = created.rooms[0];
      await request(a.main, `/api/rooms/${room.id}/invitations`, "POST", { username: "pair_bob" });
      await expect
        .poll(
          async () =>
            (await b.main.evaluate(() => window.shareStreamDesktop.model())).invitations.length,
        )
        .toBe(1);
      const pending = await b.main.evaluate(() => window.shareStreamDesktop.model());
      assert.equal(pending.rooms.length, 0);
      assert.equal(pending.launch, null);
      const notificationsReady = b.application.waitForEvent("window");
      await b.main.getByRole("button", { name: "Invitations", exact: true }).click();
      const notifications = await notificationsReady;
      await notifications.getByRole("heading", { name: "Pair mix", exact: true }).waitFor();
      await notifications.getByRole("button", { name: "Accept and join", exact: true }).click();
      await expect(a.main.locator("#status")).toHaveText("Connected");
      await expect(b.main.locator("#status")).toHaveText("Connected");
      assert.deepEqual(await b.main.evaluate(() => window.mediaRequests), { audio: 0, display: 0 });
      await a.main.locator("#mic").click();
      await b.main.locator("#mic").click();
      await a.main.locator("#share").click();
      await expect
        .poll(() =>
          b.main.evaluate(async () => {
            let bytes = 0;
            for (const pc of window.testPCs)
              for (const s of (await pc.getStats()).values())
                if (s.type === "inbound-rtp" && s.kind === "audio") bytes += s.bytesReceived || 0;
            return bytes;
          }),
        )
        .toBeGreaterThan(200);
      await expect
        .poll(() => b.main.locator("#remote-screen").evaluate((video) => video.videoWidth))
        .toBeGreaterThan(0);
      await request(a.main, `/api/rooms/${room.id}`, "PATCH", { name: "Album session" });
      await b.main.getByRole("heading", { name: "Album session", exact: true, level: 1 }).waitFor();
      await b.main.locator("#leave").click();
      await expect(b.main.locator("#status")).toHaveText("Ready");
      await b.main.waitForTimeout(5600);
      await expect(b.main.locator("#status")).toHaveText("Ready");
      const stored = JSON.parse(await readFile(envB.SHARE_STREAM_ACCOUNT_FILE, "utf8"));
      await helperCommand(envB, { operation: "launch", room: stored.room });
      await expect(b.main.locator("#status")).toHaveText("Connected");
      assert.deepEqual(await b.main.evaluate(() => window.mediaRequests), { audio: 1, display: 0 });
      await b.application.close();
      applications.splice(applications.indexOf(b.application), 1);
      const reopened = await launch(envB);
      await reopened.main
        .getByRole("heading", { name: "Album session", exact: true, level: 1 })
        .waitFor();
      await expect(reopened.main.locator("#status")).toHaveText("Connected");
      assert.equal(
        (await reopened.main.evaluate(() => window.shareStreamDesktop.model())).launch.code,
        room.code,
      );
      assert.deepEqual(await reopened.main.evaluate(() => window.mediaRequests), {
        audio: 0,
        display: 0,
      });
      assert.deepEqual(errors, []);
    } catch (error) {
      for (const app of applications)
        for (const page of app.windows())
          console.error(
            "Window:",
            page.url(),
            await page
              .locator("body")
              .innerText()
              .catch(() => ""),
          );
      throw error;
    } finally {
      for (const app of applications) await app.close();
      await service.close();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);

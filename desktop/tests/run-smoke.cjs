// PRs exercise the development renderer; no distributable frontend/app is built.
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { resolve, join } = require("node:path");
const root = resolve(__dirname, "../..");
const development = process.argv.includes("--development");
let vite;
(async () => {
  const env = { ...process.env };
  if (development) {
    env.SHARE_STREAM_DESKTOP_RENDERER_URL = "http://127.0.0.1:5173";
    vite = spawn(
      process.execPath,
      [join(root, "web/node_modules/vite-plus/bin/vp"), "dev", "--mode", "test"],
      { cwd: join(root, "web"), env, stdio: "inherit" },
    );
    let ready = false;
    for (let attempt = 0; attempt < 100; ++attempt) {
      if (vite.exitCode !== null) throw new Error("The test renderer stopped.");
      try {
        if ((await fetch(env.SHARE_STREAM_DESKTOP_RENDERER_URL)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error("The test renderer did not start.");
  }
  const child = spawn(process.execPath, ["--test", join(__dirname, "smoke.cjs")], {
    cwd: root,
    env,
    stdio: "inherit",
  });
  const [code] = await once(child, "exit");
  process.exitCode = code ?? 1;
})()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => {
    vite?.kill();
  });

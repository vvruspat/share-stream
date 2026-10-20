import { createService } from "../web/dist/server/service.js";
import { createHash, randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
const service = createService({ origin: "http://localhost", clientDir: "web/dist/client" });
await new Promise((resolve) => service.server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${service.server.address().port}`;
const code = randomBytes(16).toString("hex"),
  token = randomBytes(16).toString("hex");
const room = createHash("sha256").update(`ShareStream-call-room-v1:${code}`).digest("hex");
try {
  const response = await fetch(base + "/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      room,
      token,
      source: "browser",
      connected: true,
      mic: true,
      name: "Integration participant",
    }),
  });
  if (!response.ok) throw new Error("Browser registration failed");
  const probe = spawn(
    "build/processor_tests_artefacts/Release/processor_tests",
    ["--presence-probe", code, token],
    {
      env: { ...process.env, SHARE_STREAM_PRESENCE_URL: base + "/api/presence" },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  probe.stdout.pipe(process.stdout);
  const status = await new Promise((resolve) => probe.once("exit", resolve));
  if (status !== 0) throw new Error("Native integration probe failed");
  const final = await fetch(base + "/api/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ room, token, source: "browser", connected: true, mic: false }),
  });
  const people = (await final.json()).participants;
  if (people.length !== 1 || people[0].music !== null || !people[0].browser)
    throw new Error("Native departure removed the browser participant");
  console.log("PASS: native departure preserves the browser source");
} finally {
  await service.close();
}

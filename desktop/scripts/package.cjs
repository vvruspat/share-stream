const { packager } = require("@electron/packager");
const { cp, mkdir, rm, chmod, readdir } = require("node:fs/promises");
const { resolve, join } = require("node:path");
const root = resolve(__dirname, "../..");
const version = require("../package.json").version;
(async () => {
  const resources = join(root, "build/chat-resources");
  await mkdir(join(resources, "bin"), { recursive: true });
  await cp(join(root, "build/session_helper"), join(resources, "bin/session_helper"));
  await chmod(join(resources, "bin/session_helper"), 0o755);
  await mkdir(join(resources, "Licenses"), { recursive: true });
  for (const file of ["THIRD_PARTY.md", "vendor/Opus-COPYING", "vendor/monocypher/LICENCE.md"])
    await cp(join(root, file), join(resources, "Licenses", file.replaceAll("/", "-")));
  for (const file of ["LICENSE", "LICENSES.chromium.html"])
    await cp(
      join(root, "desktop/node_modules/electron/dist", file),
      join(resources, "Licenses", `Electron-${file}`),
    );
  const packages = require("../../web/package-lock.json").packages;
  for (const [path, metadata] of Object.entries(packages))
    if (path && !metadata.dev) {
      for (const file of await readdir(join(root, "web", path)))
        if (/^licen[cs]e(?:[.-].*)?$/i.test(file))
          await cp(
            join(root, "web", path, file),
            join(resources, "Licenses", `${path.replaceAll("/", "-")}-${file}`),
          );
    }
  const [output] = await packager({
    dir: resolve(__dirname, ".."),
    name: "Share Stream Chat",
    appBundleId: "audio.sharestream.chat",
    appVersion: version,
    buildVersion: version,
    platform: "darwin",
    arch: process.env.CHAT_ARCH || "universal",
    out: join(root, "build/chat-package"),
    overwrite: true,
    asar: true,
    prune: true,
    ignore: [
      /^\/(src|scripts|tests|node_modules)(\/|$)/,
      /^\/build\/desktop\/tests(\/|$)/,
      /^\/(package-lock\.json|tsconfig\.json)$/,
    ],
    extraResource: [
      join(root, "web/dist/client"),
      join(resources, "bin"),
      join(resources, "Licenses"),
    ],
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Share your voice with the people in your room when you enable the microphone.",
      NSScreenCaptureUsageDescription:
        "Share the screen or window you choose with the people in your room.",
    },
  });
  const target = join(root, "build/ShareStreamChat/Share Stream Chat.app");
  await rm(target, { recursive: true, force: true });
  await mkdir(join(root, "build/ShareStreamChat"), { recursive: true });
  await cp(join(output, "Share Stream Chat.app"), target, {
    recursive: true,
    verbatimSymlinks: true,
  });
  console.log(target);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

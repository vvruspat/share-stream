const { sign } = require("@electron/osx-sign");
const { resolve } = require("node:path");
if (!process.env.SIGNING_IDENTITY) throw new Error("The owner Developer ID identity is required.");
sign({
  app: resolve(process.argv[2]),
  identity: process.env.SIGNING_IDENTITY,
  keychain: process.env.NOTARY_KEYCHAIN,
  platform: "darwin",
  gatekeeperAssess: false,
  optionsForFile: () => ({
    entitlements: resolve(__dirname, "../entitlements.mac.plist"),
    hardenedRuntime: true,
  }),
}).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

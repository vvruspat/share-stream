import { defineConfig } from "@playwright/test";
const development = process.env.TEST_WEB_DEV === "1";
const localURL = development ? "http://localhost:5173" : "http://localhost:48101";
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.ts",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || localURL,
    headless: true,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  ...(!process.env.TEST_BASE_URL
    ? {
        webServer: {
          command: development ? "npm run dev" : "npm start",
          url: `${localURL}/api/health`,
          reuseExistingServer: false,
        },
      }
    : {}),
});

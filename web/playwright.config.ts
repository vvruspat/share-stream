import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e.spec.ts",
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL || "http://localhost:48101",
    headless: true,
    launchOptions: { args: ["--autoplay-policy=no-user-gesture-required"] },
  },
  ...(!process.env.TEST_BASE_URL
    ? {
        webServer: {
          command: "npm start",
          url: "http://localhost:48101/api/health",
          reuseExistingServer: false,
        },
      }
    : {}),
});

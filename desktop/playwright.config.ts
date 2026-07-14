import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:1421",
    channel: "chrome",
    viewport: { width: 1365, height: 900 },
    trace: "retain-on-failure"
  },
  webServer: {
    command: "npm run dev:mock",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000
  }
});

import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5199",
    trace: "retain-on-failure",
  },
  webServer: {
    // preview serves the production build — no HMR, no remount races
    command: "pnpm build && pnpm preview --port 5199 --strictPort",
    url: "http://localhost:5199",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" }, grepInvert: /@perf/ },
    { name: "perf", use: { browserName: "chromium" }, grep: /@perf/ },
  ],
});

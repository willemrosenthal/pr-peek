import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, SERVER_ENV } from "./env";

// Needs a fresh `pnpm build`, since the server serves apps/web/dist.
export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts",
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE_URL,
    // Keeps every run the same, with no files kept from the last one.
    serviceWorkers: "block",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    // Seeds first, so every run starts from the same data.
    command:
      "pnpm --filter @pr-peek/server e2e:seed && pnpm --filter @pr-peek/server start",
    url: `${BASE_URL}/api/health`,
    env: SERVER_ENV,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});

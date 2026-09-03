import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
if (!testDatabaseUrl) {
  throw new Error(
    "TEST_DATABASE_URL is required for Playwright E2E tests; refusing to start a web server without an isolated database",
  );
}

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: false,
    env: {
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      BETTER_AUTH_SECRET:
        process.env.E2E_BETTER_AUTH_SECRET ??
        "e2e-local-only-secret-change-me-0123456789",
      BETTER_AUTH_URL: baseURL,
      BETTER_AUTH_TRUSTED_ORIGINS: baseURL,
      BETTER_AUTH_TRUSTED_PROXIES: "127.0.0.1/32",
      RESEND_API_KEY: process.env.E2E_RESEND_API_KEY ?? "e2e-no-mail",
      AUTH_EMAIL_FROM:
        process.env.E2E_AUTH_EMAIL_FROM ?? "E2E <e2e@example.invalid>",
      NODE_ENV: "development",
      NODE_OPTIONS: "",
      GENERATION_RATE_LIMIT_WINDOW_SECONDS: "3600",
      GENERATION_RATE_LIMIT_MAX_REQUESTS: "5",
    },
  },
});

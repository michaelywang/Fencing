import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against a PRODUCTION build (`next build && next start`)
 * on port 3100 with a dedicated database, so they exercise the same code that
 * gets deployed. Set E2E_DATABASE_URL to override the database.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
export const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgres://fencing:fencing@localhost:5432/fencing_e2e";
export const E2E_SETUP_TOKEN = "e2e-setup-token-0123456789abcdef";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "tests/e2e/.artifacts/results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "off",
    screenshot: "only-on-failure",
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: process.env.E2E_SKIP_BUILD ? `npx next start -p ${PORT}` : `npx next build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: {
      DATABASE_URL: E2E_DB,
      DATABASE_URL_UNPOOLED: E2E_DB,
      SETUP_TOKEN: E2E_SETUP_TOKEN,
      RECOVERY_TOKEN: "",
      SMTP_HOST: "",
      APP_URL: "",
    },
  },
});

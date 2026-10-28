import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run the real stack: Vite → Express API → PostgreSQL.
// E2E_DATABASE_URL must point at a disposable loopback database named *_e2e;
// the API's e2e:serve script wipes and reseeds it with synthetic data.
const databaseUrl = process.env.E2E_DATABASE_URL
  ?? "postgresql://restaurant_dev:local-development-only@127.0.0.1:5433/restaurant_e2e";
const apiPort = 3101;
const webPort = 5174;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "npm --prefix server run e2e:serve",
      url: `http://127.0.0.1:${apiPort}/api/ready`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        DATABASE_URL: databaseUrl,
        PORT: String(apiPort),
        HOST: "127.0.0.1",
        APP_ENV: "test",
        SECURE_COOKIES: "false",
        REQUIRE_ADMIN_MFA: "false",
      },
    },
    {
      command: `npx vite --port ${webPort} --strictPort --host 127.0.0.1`,
      url: `http://127.0.0.1:${webPort}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_PROXY_TARGET: `http://127.0.0.1:${apiPort}` },
    },
  ],
});

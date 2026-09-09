import { defineConfig, devices } from '@playwright/test';

const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5174);
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL_TEST ?? 'postgres://postgres:postgres@localhost:5432/krabi_flight_radar_test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : undefined,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `npx tsx packages/server/src/main.ts`,
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120000,
      env: { ...process.env, PORT: String(API_PORT), DATABASE_URL, FLIGHT_PROVIDERS: 'mock', SCHEDULER_ENABLED: 'false', AUTO_SEED: 'true', LOG_LEVEL: 'warn', PROVIDER_MIN_INTERVAL_MS: '0' },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort --host 127.0.0.1`,
      cwd: 'packages/web',
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120000,
      env: { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

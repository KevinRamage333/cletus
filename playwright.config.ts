import { defineConfig, devices } from '@playwright/test';

/** E2E smoke tests run against a production build in public-demo mode (no database, no secrets, live trading off). */
const PORT = Number(process.env.E2E_PORT || 3100);
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 2,
  reporter: [['list']],
  use: { baseURL: process.env.E2E_BASE_URL || `http://127.0.0.1:${PORT}`, launchOptions: { executablePath: chrome, args: ['--no-sandbox'] }, trace: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'mobile', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    env: { CLETUS_DEMO: '1', TRADING_MODE: 'simulation', CLETUS_ALLOW_DEV_SECRET: 'true', COOKIE_SECURE: 'false', SESSION_SECRET: 'e2e-owner-desk-session-secret-32ch-min!!', OWNER_WALLET: '4qkz9HaAsdJnZ7ammDmquhpdGJcoGpgtaT2rXBQgAMgd', PAPER_READ_DATABASE_URL: process.env.CI ? '' : (process.env.PAPER_READ_DATABASE_URL ?? '') },
  },
});

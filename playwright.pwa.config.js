import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/pwa',
  testMatch: '**/*.spec.js',
  workers: 1,
  fullyParallel: false,
  timeout: 30000,
  reporter: 'list',
  globalSetup: './tests/pwa/buildFixtures.js',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'),
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node tests/pwa/server.js',
    url: 'http://127.0.0.1:4175/_pwa-test/health',
    reuseExistingServer: false,
  },
});

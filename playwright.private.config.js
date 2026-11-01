import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/private', testMatch: '**/*.spec.js', workers: 1, fullyParallel: false, timeout: 60000, reporter: 'list',
  use: { baseURL: 'http://localhost:4180', channel: process.env.PLAYWRIGHT_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chromium'), trace: 'retain-on-failure' },
  webServer: { command: 'node tests/private/server.js', url: 'http://localhost:4180', reuseExistingServer: false, timeout: 90000 },
});

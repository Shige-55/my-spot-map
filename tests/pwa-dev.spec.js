import { test, expect } from '@playwright/test';

test('開発サーバーではService Workerを登録せず、設定にビルド版の確認方法を案内する', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#open-settings')).toBeEnabled();
  expect(await page.evaluate(async () => (await window.navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.locator('#open-settings').click();
  await expect(page.locator('#pwa-state')).toContainText('開発サーバーではオフライン機能は無効');
  await expect(page.locator('#check-updates')).toBeDisabled();
});

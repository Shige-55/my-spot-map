import { test, expect } from '@playwright/test';
import { writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadPagesTarget } from '../../build/pagesConfig.js';
import { verifyPagesBuild } from '../../build/verifyPagesBuild.js';

const appUrl = '/pwa-check/';
test.beforeEach(async ({ context, request }) => {
  await request.post('/_pwa-test/reset');
  await context.route('https://tile.openstreetmap.org/**', (route) => route.abort());
});
async function ready(page, url = appUrl) {
  await page.goto(url);
  await expect(page.locator('#register-center')).toBeEnabled();
  await page.evaluate(async () => {
    await window.navigator.serviceWorker.ready;
    if (!window.navigator.serviceWorker.controller) {
      await new Promise((resolve) => window.navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await expect(page.locator('#pwa-state')).toContainText('準備ができました');
}
async function create(page, name, category = '') {
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill(name);
  await page.locator('#spot-memo').fill('架空のオフライン検証地点');
  await page.locator('#spot-category').fill(category);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
}
async function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('my-spot-map');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('spots', 'readonly');
      const get = transaction.objectStore('spots').getAll();
      transaction.oncomplete = () => { db.close(); resolve(get.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}
async function exportFile(page) {
  const promise = page.waitForEvent('download');
  await page.locator('#export-backup').click();
  const download = await promise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}
async function stageUpdate(page, request) {
  await request.post('/_pwa-test/build/b');
  await page.evaluate(async () => {
    const registration = await window.navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await expect(page.locator('#pwa-update')).toBeVisible();
}

for (const base of [appUrl, loadPagesTarget().base]) {
test(`manifest・アイコン・SW・キャッシュのURLが公開サブパス内で一致する: ${base}`, async ({ page }) => {
  await ready(page, base);
  const info = await page.evaluate(async () => {
    const manifestUrl = window.document.querySelector('link[rel="manifest"]').href;
    const manifest = await (await window.fetch(manifestUrl)).json();
    const registration = await window.navigator.serviceWorker.getRegistration();
    const urls = (await Promise.all((await window.caches.keys()).map(async (key) =>
      (await (await window.caches.open(key)).keys()).map((request) => request.url)))).flat();
    const icons = [];
    for (const icon of manifest.icons) {
      const image = new window.Image();
      image.src = new URL(icon.src, manifestUrl).href;
      await image.decode();
      icons.push({ width: image.naturalWidth, height: image.naturalHeight, purpose: icon.purpose });
    }
    const apple = new window.Image();
    apple.src = window.document.querySelector('link[rel="apple-touch-icon"]').href;
    await apple.decode();
    return { manifest, manifestUrl, start: new URL(manifest.start_url, manifestUrl).href,
      scope: registration.scope, sw: registration.active.scriptURL, urls, icons, apple: apple.naturalWidth };
  });
  expect(info.manifest.display).toBe('standalone');
  expect(info.start).toBe(`http://127.0.0.1:4175${base}`);
  expect(info.scope).toBe(info.start);
  expect(info.sw).toBe(info.start + 'sw.js');
  expect(info.icons).toEqual([{ width: 192, height: 192, purpose: 'any' }, { width: 512, height: 512, purpose: 'any' }, { width: 512, height: 512, purpose: 'maskable' }]);
  expect(info.apple).toBe(180);
  expect(info.urls.length).toBeGreaterThanOrEqual(9);
  expect(info.urls.every((url) => url.startsWith(info.start))).toBe(true);
  expect(info.urls.some((url) => /tile\.openstreetmap|backup-.*\.json/.test(url))).toBe(false);
});
}

test('公開資産はbase不一致と余分なバックアップJSONを拒否する', () => {
  const directory = fileURLToPath(new URL('../../.pwa-test/pages/', import.meta.url));
  expect(verifyPagesBuild(directory, loadPagesTarget().base).files).toBeGreaterThanOrEqual(10);
  expect(() => verifyPagesBuild(directory, '/wrong-repository/')).toThrow('base');
  const unexpected = new URL('../../.pwa-test/pages/unexpected-backup.json', import.meta.url);
  try {
    writeFileSync(unexpected, '{"spots":[]}');
    expect(() => verifyPagesBuild(directory, loadPagesTarget().base)).toThrow('公開対象外');
  } finally { unlinkSync(unexpected); }
});

test('ルート配信でも初回準備後はオフラインで再起動できる', async ({ page, context }) => {
  await ready(page, '/');
  await expect(page.locator('#pwa-update')).toBeHidden();
  await create(page, 'ルート配信の架空地点');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.spot-name')).toHaveText('ルート配信の架空地点');
  await expect(page.locator('#offline-note')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toBeInViewport();
});

test('公開baseの実Vite previewでオフライン再起動時にJSとCSSを読み込める', async ({ page, request, context }) => {
  expect((await request.post('/_pwa-test/start-preview')).ok()).toBe(true);
  await ready(page, `http://127.0.0.1:4176${loadPagesTarget().base}`);
  await create(page, 'previewオフラインの架空地点');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#register-center')).toBeEnabled();
  await expect(page.locator('#offline-note')).toBeVisible();
  await expect(page.locator('.spot-name')).toHaveText('previewオフラインの架空地点');
  expect(await page.locator('.app-header').evaluate((element) => window.getComputedStyle(element).display)).toBe('flex');
  await create(page, 'previewオフラインで追加した架空地点');
  await expect(page.locator('.spot-name')).toHaveCount(2);
});

test('iPhone幅でオフライン再起動・検索・タブ往復しても地図と帰属表示を保つ', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  await create(page, 'iPhone幅の架空地点', '散歩');
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('tab', { name: '登録地点' }).click();
  await page.locator('#spot-query').fill('架空');
  await page.locator('#category-filter').selectOption(JSON.stringify('散歩'));
  await expect(page.locator('.spot-name')).toHaveText('iPhone幅の架空地点');
  await page.getByRole('button', { name: 'iPhone幅の架空地点を地図で表示', exact: true }).click();
  await expect(page.locator('#map-panel')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toBeInViewport();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('.leaflet-control-attribution')).toBeInViewport();
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('待機版のキャッシュ準備後ならオフラインでも明示操作で更新できる', async ({ page, request, context }) => {
  await ready(page);
  await create(page, 'オフライン更新後も残る架空地点');
  await stageUpdate(page, request);
  await context.setOffline(true);
  await page.locator('#apply-update').click();
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'b');
  await expect(page.locator('.spot-name')).toHaveText('オフライン更新後も残る架空地点');
  await expect(page.locator('#offline-note')).toBeVisible();
});

test('オフライン再起動後も一覧・検索・登録・編集・削除・JSON往復を利用できる', async ({ page, context }) => {
  await ready(page);
  await create(page, '架空Ｃａｆｅ', '飲食');
  await create(page, '架空の公園', '散歩');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#offline-note')).toBeVisible();
  await page.locator('#spot-query').fill('cafe');
  await page.locator('#category-filter').selectOption(JSON.stringify('飲食'));
  await expect(page.locator('.spot-name')).toHaveText('架空Ｃａｆｅ');
  await page.getByRole('button', { name: '架空Ｃａｆｅを編集', exact: true }).click();
  await page.locator('#spot-memo').fill('通信なしで編集した架空のメモ');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await page.locator('#clear-filters').click();
  await page.getByRole('button', { name: '架空の公園を削除', exact: true }).click();
  await page.locator('#confirm-delete').click();
  await expect(page.locator('#delete-dialog')).toBeHidden();
  await create(page, 'オフライン追加の架空地点');
  const before = await records(page);
  expect(before).toHaveLength(3);
  await page.locator('#open-settings').click();
  const text = await exportFile(page);
  expect(JSON.parse(text).spots).toHaveLength(3);
  await page.locator('#close-settings').click();
  await create(page, '復元で除く架空地点');
  await page.locator('#open-settings').click();
  await page.locator('#backup-file').setInputFiles({ name: '架空のオフライン復元.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await page.locator('#validate-backup').click();
  await expect(page.locator('#restore-preview')).toBeVisible();
  await page.locator('#confirm-replace').check();
  await page.locator('#restore-backup').click();
  await expect(page.locator('#backup-status')).toContainText('復元が完了');
  expect(await records(page)).toEqual(before);
  await page.close();
  const restarted = await context.newPage();
  await restarted.goto(appUrl);
  await expect(restarted.locator('.spot-name')).toHaveCount(2);
  await expect(restarted.getByText('通信なしで編集した架空のメモ', { exact: true })).toBeVisible();
  await expect(restarted.locator('.leaflet-control-attribution')).toBeInViewport();
  expect(await records(restarted)).toEqual(before);
});

test('編集中の新しい版は通知だけ行い、保存後の明示操作で切り替える', async ({ page, request }) => {
  await ready(page);
  await create(page, '更新前の架空地点');
  const original = await records(page);
  await page.locator('#register-center').click();
  await page.locator('#spot-name').fill('保持する未保存の架空地点');
  await page.locator('#spot-memo').fill('更新によって失わない架空の入力');
  await stageUpdate(page, request);
  await expect(page.locator('#apply-update')).toBeDisabled();
  await expect(page.locator('#spot-name')).toHaveValue('保持する未保存の架空地点');
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a');
  expect(await records(page)).toEqual(original);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await expect(page.locator('#apply-update')).toBeEnabled();
  await page.locator('#apply-update').click();
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'b');
  await expect(page.locator('.spot-name')).toHaveCount(2);
  expect((await records(page)).find((spot) => spot.name === '保持する未保存の架空地点').memo).toBe('更新によって失わない架空の入力');
});

test('別タブが更新しても編集中のタブは再読み込みせず、保存してから更新できる', async ({ page, context, request }) => {
  await ready(page);
  const editor = await context.newPage();
  await ready(editor);
  await editor.locator('#register-center').click();
  await editor.locator('#spot-name').fill('別タブ更新中の架空入力');
  await stageUpdate(page, request);
  await page.locator('#apply-update').click();
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'b');
  await expect(editor.locator('#spot-name')).toHaveValue('別タブ更新中の架空入力');
  await expect(editor.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a');
  await expect(editor.locator('#apply-update')).toBeDisabled();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.locator('#spot-dialog')).toBeHidden();
  await editor.locator('#apply-update').click();
  await expect(editor.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'b');
  await expect(editor.locator('.spot-name')).toHaveText('別タブ更新中の架空入力');
});

test('新しい版の有効化で旧シェルだけを整理し、DBと別scopeのキャッシュを保持する', async ({ page, request }) => {
  await ready(page);
  await create(page, 'キャッシュ整理後も残る架空地点');
  const before = await records(page);
  const old = await page.evaluate(() => window.caches.keys());
  await page.evaluate(async () => {
    await window.caches.open('別アプリのキャッシュ');
    await window.caches.open('my-spot-map-shell:%2Fother%2F:old');
  });
  await stageUpdate(page, request);
  await page.locator('#apply-update').click();
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'b');
  const after = await page.evaluate(() => window.caches.keys());
  expect(after).toContain('別アプリのキャッシュ');
  expect(after).toContain('my-spot-map-shell:%2Fother%2F:old');
  expect(after.some((name) => old.includes(name))).toBe(false);
  expect(await records(page)).toEqual(before);
});

test('更新資産の取得が失敗しても旧版を保ち、オフラインで再起動できる', async ({ page, request, context }) => {
  await ready(page);
  await create(page, '更新失敗後も残る架空地点');
  const before = await records(page);
  const caches = await page.evaluate(() => window.caches.keys());
  await request.post('/_pwa-test/build/b');
  await request.post('/_pwa-test/fail-assets');
  await page.evaluate(async () => { await (await window.navigator.serviceWorker.getRegistration()).update(); });
  await expect(page.locator('#pwa-state')).toContainText('準備に失敗');
  await expect(page.locator('meta[name="pwa-test-build"]')).toHaveAttribute('content', 'a');
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.spot-name')).toHaveText('更新失敗後も残る架空地点');
  expect(await page.evaluate(() => window.caches.keys())).toEqual(caches);
  expect(await records(page)).toEqual(before);
});

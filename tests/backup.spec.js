import { test, expect } from '@playwright/test';
import { testBackup, testId, testSpot } from './fixtures/backup.js';

const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece5"/><path d="M0 128h256M128 0v256" stroke="#fff" stroke-width="12"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
});
async function tab(page, name) {
  const button = page.getByRole('tab', { name, exact: name === '地図' });
  if (await button.isVisible()) await button.click();
}
async function create(page, name, category = '') {
  await tab(page, '地図');
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill(name);
  await page.locator('#spot-memo').fill(`${name}の架空メモ`);
  await page.locator('#spot-category').fill(category);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
}
async function remove(page, name) {
  await tab(page, '登録地点');
  await page.getByRole('button', { name: `${name}を削除`, exact: true }).click();
  await page.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.locator('#delete-dialog')).toBeHidden();
}
async function records(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('my-spot-map');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('spots', 'readonly');
      const read = transaction.objectStore('spots').getAll();
      transaction.oncomplete = () => { db.close(); resolve(read.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}
async function openSettings(page) {
  await page.getByRole('button', { name: '設定', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toBeVisible();
}
async function exportFile(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONバックアップを保存', exact: true }).click();
  const download = await downloadPromise;
  const chunks = [];
  const stream = await download.createReadStream();
  for await (const chunk of stream) chunks.push(chunk);
  // ダウンロード内容はメモリで検証し、個人バックアップをリポジトリへ保存しない。
  const text = Buffer.concat(chunks).toString('utf8');
  return { text, data: JSON.parse(text), filename: download.suggestedFilename() };
}
async function choose(page, payload, filename = '架空の復元ファイル.json') {
  await page.locator('#backup-file').setInputFiles({ name: filename, mimeType: 'application/json',
    buffer: Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload), 'utf8') });
}
async function prepare(page, payload) {
  await choose(page, payload);
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#restore-preview')).toBeVisible();
  await expect(page.locator('#restore-backup')).toBeDisabled();
}
async function restore(page) {
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: '全件置換して復元', exact: true }).click();
  await expect(page.locator('#backup-status')).toContainText('復元が完了');
}

for (const width of [1280, 390]) {
  test(`${width}pxでJSON保存→変更→復元→再読み込みが削除記録を含め一致する`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await create(page, '架空の喫茶店', '飲食');
    await create(page, '架空の書店', '買い物');
    await create(page, '架空の旧広場', '散歩');
    await remove(page, '架空の旧広場');
    const original = await records(page);
    await page.locator('#spot-query').fill('喫茶店');
    await page.locator('#category-filter').selectOption(JSON.stringify('飲食'));
    await openSettings(page);
    const backup = await exportFile(page);
    expect(backup.filename).toMatch(/^my-spot-map-backup-.*\.json$/);
    expect(backup.data).toMatchObject({ app: 'MySpotMap', schemaVersion: 1 });
    expect(backup.data.spots).toEqual(original);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await page.getByRole('button', { name: '絞り込みを解除', exact: true }).click();
    await page.getByRole('button', { name: '架空の喫茶店を編集', exact: true }).click();
    await page.locator('#spot-name').fill('変更後の架空喫茶店');
    await page.locator('#spot-memo').fill('復元で戻るはずの編集');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('#spot-dialog')).toBeHidden();
    await remove(page, '架空の書店');
    await create(page, '追加した架空地点');
    await tab(page, '登録地点');
    await page.locator('#spot-query').fill('追加');
    const changed = await records(page);
    expect(changed).not.toEqual(original);
    await openSettings(page);
    await prepare(page, backup.text);
    await expect(page.locator('#restore-current')).toContainText('合計 4件');
    await expect(page.locator('#restore-incoming')).toHaveText('有効 2件・削除記録 1件（合計 3件）');
    expect(await records(page)).toEqual(changed);
    await restore(page);
    expect(await records(page)).toEqual(original);
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
    await expect(page.locator('#open-settings')).toBeFocused();
    await expect(page.locator('#spot-query')).toHaveValue('');
    await expect(page.locator('#category-filter')).toHaveValue('');
    await expect(page.locator('.spot-name')).toHaveText(['架空の書店', '架空の喫茶店']);
    await expect(page.locator('.spot-marker')).toHaveCount(2);
    await page.reload();
    await tab(page, '登録地点');
    await expect(page.locator('.spot-name')).toHaveText(['架空の書店', '架空の喫茶店']);
    expect(await records(page)).toEqual(original);
  });
}

test('不正JSON・未知バージョン・重複ID・不正座標・欠落項目はDBを変更しない', async ({ page }) => {
  await page.goto('/');
  await create(page, '保持する架空地点');
  const before = await records(page);
  await openSettings(page);
  const cases = [
    ['{', 'JSON'],
    [testBackup([], { schemaVersion: 9 }), 'バージョン'],
    [testBackup([testSpot(), testSpot()]), '重複'],
    [testBackup([testSpot({ longitude: 181 })]), '経度'],
    [testBackup([testSpot({ createdAt: '2026-02-30T00:00:00.000Z' })]), '日時'],
    [testBackup([testSpot({ syncStatus: 'invalid' })]), '同期状態'],
    [{ app: 'MySpotMap', schemaVersion: 1 }, '必須項目'],
  ];
  for (const [payload, message] of cases) {
    await choose(page, payload);
    await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
    await expect(page.locator('#backup-error')).toContainText(message);
    await expect(page.locator('#restore-preview')).toBeHidden();
    await expect(page.locator('#restore-backup')).toBeDisabled();
    expect(await records(page)).toEqual(before);
  }
});

test('復元キャンセル・閉じる・Escape・ファイルの選び直しは無変更', async ({ page }) => {
  await page.goto('/');
  await create(page, '保持する架空地点');
  const before = await records(page);
  await openSettings(page);
  await prepare(page, testBackup());
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: '復元をキャンセル', exact: true }).click();
  expect(await records(page)).toEqual(before);
  await expect(page.locator('#restore-backup')).toBeDisabled();
  await prepare(page, testBackup());
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeHidden();
  expect(await records(page)).toEqual(before);
  await openSettings(page);
  await prepare(page, testBackup());
  await page.locator('#confirm-replace').check();
  await choose(page, '{');
  await expect(page.locator('#restore-preview')).toBeHidden();
  await expect(page.locator('#confirm-replace')).not.toBeChecked();
  await expect(page.locator('#restore-backup')).toBeDisabled();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  expect(await records(page)).toEqual(before);
});

test('容量・件数上限を超えたファイルはDBを変更しない', async ({ page }) => {
  await page.goto('/');
  await create(page, '保持する架空地点');
  const before = await records(page);
  await openSettings(page);
  await choose(page, ' '.repeat(10 * 1024 * 1024 + 1));
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#backup-error')).toContainText('10MiB');
  await choose(page, testBackup(Array.from({ length: 10001 }, (_, index) => testSpot({ id: testId(index + 1) }))));
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#backup-error')).toContainText('10,000件');
  expect(await records(page)).toEqual(before);
});

test('ファイル読込失敗を案内して再試行でき、検証中は操作と閉じるを無効にする', async ({ page }) => {
  await page.goto('/');
  await create(page, '保持する架空地点');
  const before = await records(page);
  await openSettings(page);
  await choose(page, testBackup());
  await page.evaluate(() => {
    const original = window.File.prototype.arrayBuffer;
    window.File.prototype.arrayBuffer = function () {
      window.File.prototype.arrayBuffer = original;
      return Promise.reject(new Error('架空の読込失敗'));
    };
  });
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#backup-error')).toContainText('読み込みエラー');
  expect(await records(page)).toEqual(before);
  await page.evaluate(() => {
    const original = window.File.prototype.arrayBuffer;
    window.File.prototype.arrayBuffer = function () {
      return new Promise((resolve) => {
        window.finishBackupRead = () => { window.File.prototype.arrayBuffer = original; resolve(original.call(this)); };
      });
    };
  });
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#settings-dialog')).toHaveAttribute('aria-busy', 'true');
  await expect(page.locator('#close-settings')).toBeDisabled();
  await expect(page.locator('#export-backup')).toBeDisabled();
  await expect(page.locator('#backup-file')).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-dialog')).toBeVisible();
  await page.evaluate(() => window.finishBackupRead());
  await expect(page.locator('#restore-preview')).toBeVisible();
  await expect(page.locator('#close-settings')).toBeEnabled();
  expect(await records(page)).toEqual(before);
});

test('全件置換中の書込失敗でclearもロールバックし、再試行できる', async ({ page }) => {
  await page.goto('/');
  await create(page, '保持する架空地点');
  await create(page, '削除記録も保持する架空地点');
  await remove(page, '削除記録も保持する架空地点');
  const before = await records(page);
  await openSettings(page);
  const incoming = [testSpot(), testSpot({ id: testId(2), name: '取り込む架空地点2' })];
  await prepare(page, testBackup(incoming));
  await page.evaluate(() => {
    const original = window.IDBObjectStore.prototype.add;
    let calls = 0;
    window.IDBObjectStore.prototype.add = function (...args) {
      if (this.name === 'spots' && ++calls === 2) {
        window.IDBObjectStore.prototype.add = original;
        throw new window.DOMException('架空の容量不足', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: '全件置換して復元', exact: true }).click();
  await expect(page.locator('#backup-error')).toContainText('書き込みエラー');
  await expect(page.locator('#backup-error')).toContainText('変更していません');
  await expect(page.locator('#restore-preview')).toBeVisible();
  expect(await records(page)).toEqual(before);
  await restore(page);
  expect(await records(page)).toEqual(incoming);
});

test('確認後の別操作による変更を検出し、再検証するまで置換しない', async ({ page }) => {
  await page.goto('/');
  await create(page, '保持する架空地点');
  const before = await records(page);
  await openSettings(page);
  await prepare(page, testBackup());
  const modified = { ...before[0], memo: '別タブでの変更に相当する架空メモ' };
  await page.evaluate((spot) => new Promise((resolve, reject) => {
    const request = window.indexedDB.open('my-spot-map');
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('spots', 'readwrite');
      transaction.objectStore('spots').put(spot);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
    request.onerror = () => reject(request.error);
  }), modified);
  await page.locator('#confirm-replace').check();
  await page.getByRole('button', { name: '全件置換して復元', exact: true }).click();
  await expect(page.locator('#backup-error')).toContainText('確認後に保存内容が変更');
  await expect(page.locator('#restore-preview')).toBeHidden();
  expect(await records(page)).toEqual([modified]);
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#restore-preview')).toBeVisible();
  await restore(page);
  expect(await records(page)).toEqual([testSpot()]);
});

test('ファイル名・地点名のHTMLを実行せず、未知フィールドを保存しない', async ({ page }) => {
  await page.goto('/');
  await openSettings(page);
  const html = '<img src=x onerror="window.injected=true">';
  const payload = testBackup([testSpot({ name: html, extra: '取り込まない', syncStatus: 'synced' })]);
  await choose(page, payload, html + '.json');
  await page.getByRole('button', { name: 'ファイルを検証', exact: true }).click();
  await expect(page.locator('#restore-filename')).toHaveText(html + '.json');
  await expect(page.locator('#restore-filename img')).toHaveCount(0);
  await restore(page);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.spot-name')).toHaveText(html);
  await expect(page.locator('.spot-list img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  expect(await records(page)).toEqual([testSpot({ name: html })]);
});

test('空のバックアップは全件削除になることを案内し、明示確認後にだけ実行する', async ({ page }) => {
  await page.goto('/');
  await create(page, '空復元前の架空地点');
  await openSettings(page);
  await prepare(page, testBackup([]));
  await expect(page.locator('#empty-restore-warning')).toContainText('全地点と削除記録がなくなります');
  expect(await records(page)).toHaveLength(1);
  await restore(page);
  expect(await records(page)).toEqual([]);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.getByText('まだ登録地点はありません')).toBeVisible();
  await expect(page.locator('.spot-marker')).toHaveCount(0);
});

test('地図タイル通信がなくても書き出しと復元が動作する', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
  await create(page, '地図通信なしの架空地点');
  await openSettings(page);
  const backup = await exportFile(page);
  expect(backup.data.spots).toHaveLength(1);
  await prepare(page, testBackup());
  await restore(page);
  expect(await records(page)).toEqual([testSpot()]);
});

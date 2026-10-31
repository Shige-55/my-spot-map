import { test, expect } from '@playwright/test';

const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece5"/><path d="M0 128h256M128 0v256" stroke="#fff" stroke-width="12"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
});
async function showList(page) {
  const tab = page.getByRole('tab', { name: '登録地点' });
  if (await tab.isVisible()) await tab.click();
}
async function showMap(page) {
  const tab = page.getByRole('tab', { name: '地図', exact: true });
  if (await tab.isVisible()) await tab.click();
}
async function create(page, name, latitude = '35.6', longitude = '139.7') {
  await showMap(page);
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill(name);
  await page.locator('#spot-memo').fill(`${name}の架空メモ`);
  await page.locator('#spot-latitude').fill(latitude);
  await page.locator('#spot-longitude').fill(longitude);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).not.toBeVisible();
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
async function failWriteOnce(page, method) {
  await page.evaluate((method) => {
    const prototype = window.IDBObjectStore.prototype;
    const original = prototype[method];
    prototype[method] = function (...args) {
      if (this.name === 'spots') {
        prototype[method] = original;
        throw new window.DOMException('架空の容量不足', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  }, method);
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`${viewport.width}pxで3地点登録→選択→編集→削除→再読み込みが一致する`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await create(page, '架空の広場');
    await page.getByRole('button', { name: '拡大', exact: true }).click();
    await expect(page.locator('.leaflet-tile-loaded[src*="/14/"]').first()).toBeVisible();
    await create(page, '架空の書店', '35.7', '139.8');
    await create(page, '架空の喫茶店', '35.8', '139.9');
    await showList(page);
    await expect(page.locator('#spot-list > li')).toHaveCount(3);
    await expect(page.locator('.spot-name')).toHaveText(['架空の喫茶店', '架空の書店', '架空の広場']);
    await page.getByRole('button', { name: '架空の広場を地図で表示', exact: true }).click();
    await expect(page.locator('.spot-marker.is-selected')).toHaveAttribute('aria-label', '架空の広場を選択');
    await expect(page.locator('.leaflet-tile-loaded[src*="/13/"]').first()).toBeVisible();
    await page.getByRole('button', { name: '地図中心を登録' }).click();
    // Leafletの同倍率移動はピクセル単位に丸められるため、1px相当以内を許容。
    const degreePerPixel = 360 / (256 * 2 ** 13);
    expect(Math.abs(Number(await page.locator('#spot-latitude').inputValue()) - 35.6)).toBeLessThan(degreePerPixel);
    expect(Math.abs(Number(await page.locator('#spot-longitude').inputValue()) - 139.7)).toBeLessThan(degreePerPixel);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();

    await showList(page);
    await page.getByRole('button', { name: '架空の書店を編集', exact: true }).click();
    await page.locator('#spot-name').fill('架空の本屋');
    await page.locator('#spot-memo').fill('編集後の架空メモ');
    await page.locator('#spot-latitude').fill('35.75');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await expect(page.locator('#spot-dialog')).not.toBeVisible();
    await expect(page.locator('.spot-marker.is-selected')).toHaveAttribute('aria-label', '架空の本屋を選択');

    await showList(page);
    await expect(page.locator('.spot-name').first()).toHaveText('架空の本屋');
    await page.getByRole('button', { name: '架空の喫茶店を削除', exact: true }).click();
    await expect(page.getByRole('button', { name: 'キャンセル', exact: true })).toBeFocused();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(page.locator('#spot-list > li')).toHaveCount(3);
    await page.getByRole('button', { name: '架空の喫茶店を削除', exact: true }).click();
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(page.locator('#delete-dialog')).not.toBeVisible();
    await expect(page.locator('#spot-list > li')).toHaveCount(2);
    await expect(page.locator('.spot-marker')).toHaveCount(2);
    const data = await records(page);
    expect(data).toHaveLength(3);
    expect(data.filter((spot) => spot.deletedAt !== null)).toHaveLength(1);
    expect(data.find((spot) => spot.name === '架空の本屋')).toMatchObject({ latitude: 35.75, memo: '編集後の架空メモ' });

    await page.reload();
    await showList(page);
    await expect(page.locator('.spot-name')).toHaveText(['架空の本屋', '架空の広場']);
    await expect(page.getByText('編集後の架空メモ', { exact: true })).toBeVisible();
    await expect(page.locator('.spot-marker')).toHaveCount(2);
  });
}

test('フォームのキャンセル・EscapeでDBへ書き込まず、フォーカスを戻す', async ({ page }) => {
  await page.goto('/');
  const open = page.getByRole('button', { name: '地図中心を登録' });
  await open.click();
  await expect(page.locator('#spot-name')).toBeFocused();
  await page.locator('#spot-name').fill('未保存の架空地点');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(open).toBeFocused();
  expect(await records(page)).toEqual([]);
  await open.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#spot-dialog')).not.toBeVisible();
  expect(await records(page)).toEqual([]);
});

test('不正入力は項目を示して保持し、修正後に保存できる', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill(' ');
  await page.locator('#spot-latitude').fill('91');
  await page.locator('#spot-longitude').fill('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#form-error')).toContainText('名前');
  await expect(page.locator('#form-error')).toContainText('緯度');
  await expect(page.locator('#spot-latitude')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#spot-dialog')).toBeVisible();
  expect(await records(page)).toEqual([]);
  await page.locator('#spot-name').fill('🌳'.repeat(100));
  await page.locator('#spot-latitude').fill('35');
  await page.locator('#spot-longitude').fill('139');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).not.toBeVisible();
  expect(await records(page)).toHaveLength(1);
});

test('登録失敗は入力を残し、再試行で1件だけ保存する', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill('架空の保存失敗テスト');
  await failWriteOnce(page, 'add');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#form-error')).toContainText('入力は残っています');
  await expect(page.locator('#spot-name')).toHaveValue('架空の保存失敗テスト');
  await expect(page.locator('#spot-list > li')).toHaveCount(0);
  expect(await records(page)).toHaveLength(0);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).not.toBeVisible();
  expect(await records(page)).toHaveLength(1);
});

test('編集・削除の書き込み失敗は元の地点を保持し、再試行可能', async ({ page }) => {
  await page.goto('/');
  await create(page, '架空の公園');
  const initial = await records(page);
  await page.getByRole('button', { name: '架空の公園を編集', exact: true }).click();
  await page.locator('#spot-name').fill('架空の公園・編集後');
  await failWriteOnce(page, 'put');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#form-error')).toContainText('変更を保存できません');
  expect(await records(page)).toEqual(initial);
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).not.toBeVisible();
  const edited = await records(page);
  await page.getByRole('button', { name: '架空の公園・編集後を削除', exact: true }).click();
  await failWriteOnce(page, 'put');
  await page.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.locator('#delete-error')).toContainText('削除できません');
  expect(await records(page)).toEqual(edited);
  await expect(page.locator('#spot-list > li')).toHaveCount(1);
  await page.getByRole('button', { name: '削除する', exact: true }).click();
  await expect(page.locator('#delete-dialog')).not.toBeVisible();
  await expect(page.locator('#spot-list > li')).toHaveCount(0);
});

test('名前とメモにHTMLを書いても実行せず文字として表示する', async ({ page }) => {
  await page.goto('/');
  const text = '<img src=x onerror="window.injected=true">';
  await create(page, text);
  await expect(page.locator('.spot-name')).toHaveText(text);
  await expect(page.locator('.spot-select img')).toHaveCount(0);
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await page.getByRole('button', { name: `${text}を削除`, exact: true }).click();
  await expect(page.locator('#delete-description')).toContainText(text);
  await expect(page.locator('#delete-description img')).toHaveCount(0);
});

test('DB起動失敗時に案内を出し、読み直して復帰できる', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.IDBFactory.prototype.open;
    let failed = false;
    window.IDBFactory.prototype.open = function (...args) {
      if (args[0] === 'my-spot-map' && !failed) {
        failed = true;
        throw new window.DOMException('架空の起動拒否', 'SecurityError');
      }
      return original.apply(this, args);
    };
  });
  await page.goto('/');
  await expect(page.locator('#read-error')).toContainText('地点を読み込めません');
  await page.getByRole('button', { name: 'もう一度読み込む' }).click();
  await expect(page.locator('#read-error')).not.toBeVisible();
  await create(page, '復帰後の架空地点');
  expect(await records(page)).toHaveLength(1);
});

test('タイル通信がなくても地点の登録と保存済み一覧を操作できる', async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
  await create(page, '通信なしの架空地点');
  await page.reload();
  await expect(page.getByRole('button', { name: '通信なしの架空地点を地図で表示', exact: true })).toBeVisible();
  await expect(page.locator('#map-status')).toContainText('背景地図を読み込めません');
});

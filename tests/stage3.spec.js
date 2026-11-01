import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece5"/><path d="M0 128h256M128 0v256" stroke="#fff" stroke-width="12"/></svg>';
test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: tile }));
});
async function tab(page, name) {
  await expect(page.locator('#register-center')).toBeVisible();
  const button = page.getByRole('tab', { name, exact: name === '地図' });
  if (await button.isVisible()) await button.click();
}
async function create(page, name, memo = '', category = '') {
  await tab(page, '地図');
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill(name);
  await page.locator('#spot-memo').fill(memo);
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
      const read = transaction.objectStore('spots').getAll();
      transaction.oncomplete = () => { db.close(); resolve(read.result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
    };
  }));
}

for (const width of [1280, 390]) {
  test(`${width}pxで検索・カテゴリがANDで一覧とマーカーに同時反映される`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');
    await create(page, '架空Ｃａｆｅ', 'ｶﾌｪ 静かな席', '飲食');
    await create(page, '架空の書店', 'Cafeの隣', '買い物');
    await create(page, '架空の公園', '静かなベンチ');
    await create(page, '削除済みCafe', '', '飲食');
    await tab(page, '登録地点');
    await page.getByRole('button', { name: '削除済みCafeを削除', exact: true }).click();
    await page.getByRole('button', { name: '削除する', exact: true }).click();
    await expect(page.locator('#delete-dialog')).toBeHidden();
    await page.locator('#spot-query').fill('　ＣＡＦＥ　');
    await expect(page.locator('.spot-name')).toHaveText(['架空の書店', '架空Ｃａｆｅ']);
    await expect(page.locator('.spot-marker')).toHaveCount(2);
    await page.locator('#category-filter').selectOption(JSON.stringify('飲食'));
    await expect(page.locator('.spot-name')).toHaveText(['架空Ｃａｆｅ']);
    await expect(page.locator('.spot-marker')).toHaveCount(1);
    await expect(page.locator('.spot-marker.is-selected')).toHaveCount(0);
    await page.locator('#category-filter').selectOption(JSON.stringify('買い物'));
    await expect(page.locator('.spot-name')).toHaveText(['架空の書店']);
    await page.locator('#spot-query').fill('静かな');
    await expect(page.locator('.spot-marker')).toHaveCount(0);
    await expect(page.getByText('条件に一致する地点はありません')).toBeVisible();
    await page.locator('#category-filter').selectOption(JSON.stringify(''));
    await expect(page.locator('.spot-name')).toHaveText(['架空の公園']);
    await page.getByRole('button', { name: '絞り込みを解除' }).click();
    await expect(page.locator('.spot-marker')).toHaveCount(3);
    await expect(page.locator('.spot-name')).toHaveCount(3);
    expect(await records(page)).toHaveLength(4);
    await page.reload();
    await tab(page, '登録地点');
    await expect(page.locator('#category-filter option')).toHaveText(['すべてのカテゴリ', '未分類（未設定）', '飲食', '買い物']);
    await page.getByRole('button', { name: '架空Ｃａｆｅを編集', exact: true }).click();
    await expect(page.locator('#spot-category')).toHaveValue('飲食');
    await expect(page.locator('#category-options option[value="買い物"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  });
}

test('カテゴリを編集して絞り込み対象外になった場合も条件を保ち、解除後に編集結果を表示', async ({ page }) => {
  await page.goto('/');
  await create(page, '架空の広場', '', '散歩');
  await page.locator('#category-filter').selectOption(JSON.stringify('散歩'));
  await page.getByRole('button', { name: '架空の広場を編集', exact: true }).click();
  await page.locator('#spot-category').fill('休憩');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await expect(page.locator('#app-status')).toContainText('現在の絞り込み条件では表示されません');
  await expect(page.locator('.spot-marker')).toHaveCount(0);
  await expect(page.locator('#category-filter')).toHaveValue(JSON.stringify('散歩'));
  await page.getByRole('button', { name: '絞り込みを解除' }).click();
  await expect(page.locator('.spot-category')).toHaveText('休憩');
  await expect(page.locator('.spot-marker')).toHaveCount(1);
});

test('カテゴリのコードポイント文字数・未分類の区別・HTMLの安全な表示', async ({ page }) => {
  await page.goto('/');
  await create(page, '未設定の架空地点');
  await create(page, '名前付き分類の架空地点', '', '未分類');
  await page.locator('#category-filter').selectOption({ label: '未分類（未設定）' });
  await expect(page.locator('.spot-name')).toHaveText('未設定の架空地点');
  await page.locator('#category-filter').selectOption({ label: '未分類（カテゴリ名）' });
  await expect(page.locator('.spot-name')).toHaveText('名前付き分類の架空地点');
  await page.getByRole('button', { name: '絞り込みを解除' }).click();
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  await page.locator('#spot-name').fill('架空の長い分類');
  await page.locator('#spot-category').fill('🌳'.repeat(51));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-category')).toHaveAttribute('aria-invalid', 'true');
  await page.locator('#spot-category').fill('🌳'.repeat(50));
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('#spot-dialog')).toBeHidden();
  const html = '<img src=x onerror="window.injected=true">';
  await create(page, '架空の記号分類', '', html);
  await expect(page.locator('.spot-category').first()).toHaveText(html);
  await expect(page.locator('.spot-list img')).toHaveCount(0);
  await page.locator('#category-filter').selectOption(JSON.stringify(html));
  await expect(page.locator('.spot-name')).toHaveText('架空の記号分類');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
});

test('PC右クリック位置でフォームを開き、キャンセルならDBを書き換えない', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: '地図中心を登録' })).toBeEnabled();
  const box = await page.locator('#map').boundingBox();
  await page.mouse.click(box.x + box.width * 0.7, box.y + box.height * 0.6, { button: 'right' });
  await expect(page.locator('#spot-dialog')).toBeVisible();
  expect(Number(await page.locator('#spot-longitude').inputValue())).toBeGreaterThan(139.7671);
  expect(Number(await page.locator('#spot-latitude').inputValue())).toBeLessThan(35.6812);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  expect(await records(page)).toEqual([]);
});

test('ブラウザのタッチを600ms長押しした位置で一度だけ開き、contextmenuで入力を失わない', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '地図中心を登録' })).toBeEnabled();
  await page.clock.install();
  const box = await page.locator('#map').boundingBox();
  const touch = { x: box.x + box.width * 0.7, y: box.y + box.height * 0.6, id: 1 };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] });
  await page.clock.runFor(599);
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await page.clock.runFor(1);
  await expect(page.locator('#spot-dialog')).toBeVisible();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(Number(await page.locator('#spot-longitude').inputValue())).toBeGreaterThan(139.7671);
  await page.locator('#spot-name').fill('保持する架空の入力');
  await page.locator('#map').dispatchEvent('contextmenu', { clientX: touch.x, clientY: touch.y, button: 2 });
  await expect(page.locator('#spot-name')).toHaveValue('保持する架空の入力');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.locator('#map').dispatchEvent('contextmenu', { clientX: touch.x, clientY: touch.y, button: 2 });
  await expect(page.locator('#spot-dialog')).toBeHidden();
  expect(await records(page)).toEqual([]);
});

test('ドラッグ・複数指・pointercancel・画面離脱で長押し登録しない', async ({ page, context }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '地図中心を登録' })).toBeEnabled();
  await page.clock.install();
  const box = await page.locator('#map').boundingBox();
  const a = { x: box.x + 100, y: box.y + 180, id: 1 };
  const b = { x: box.x + 200, y: box.y + 180, id: 2 };
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...a, x: a.x + 40 }] });
  await page.clock.runFor(700);
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a, b] });
  await page.clock.runFor(700);
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  const pointer = { pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, clientX: a.x, clientY: a.y };
  await page.locator('#map').dispatchEvent('pointerdown', pointer);
  await page.locator('#map').dispatchEvent('pointercancel', pointer);
  await page.clock.runFor(700);
  await expect(page.locator('#spot-dialog')).toBeHidden();
  await page.locator('#map').dispatchEvent('pointerdown', { ...pointer, pointerId: 10 });
  await page.evaluate(() => window.dispatchEvent(new window.Event('blur')));
  await page.clock.runFor(700);
  await expect(page.locator('#spot-dialog')).toBeHidden();
  expect(await records(page)).toEqual([]);
});

async function mockLocation(page, mode) {
  await page.addInitScript((mode) => {
    window.locationCalls = 0;
    Object.defineProperty(window.navigator, 'geolocation', { configurable: true, value: mode === 'unsupported' ? undefined : {
      getCurrentPosition(success, fail) {
        window.locationCalls += 1;
        if (mode === 'success') success({ coords: { latitude: 35.68, longitude: 139.76, accuracy: 40 } });
        else if (mode !== 'timeout') fail({ code: mode === 'denied' ? 1 : 2 });
      },
      watchPosition() { throw new Error('継続追跡は禁止'); },
    } });
  }, mode);
}

test('現在地はボタン操作でのみ取得し、専用マーカー・精度円を表示、DBに保存しない', async ({ page }) => {
  await mockLocation(page, 'success');
  await page.goto('/');
  await create(page, '架空の登録地点');
  expect(await page.evaluate(() => window.locationCalls)).toBe(0);
  const before = await records(page);
  await page.getByRole('button', { name: '現在地', exact: true }).click();
  await expect(page.locator('#location-status')).toContainText('推定精度 約40m');
  await expect(page.locator('.leaflet-tile-loaded[src*="/15/"]').first()).toBeVisible();
  await expect(page.locator('.current-location-marker')).toHaveCount(1);
  await expect(page.locator('.location-accuracy')).toHaveCount(1);
  await page.getByRole('button', { name: '地図中心を登録' }).click();
  const degreePerPixel = 360 / (256 * 2 ** 15);
  expect(Math.abs(Number(await page.locator('#spot-latitude').inputValue()) - 35.68)).toBeLessThan(degreePerPixel);
  expect(Math.abs(Number(await page.locator('#spot-longitude').inputValue()) - 139.76)).toBeLessThan(degreePerPixel);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.getByRole('button', { name: '現在地', exact: true }).click();
  await expect(page.locator('.current-location-marker')).toHaveCount(1);
  await expect(page.locator('.location-accuracy')).toHaveCount(1);
  expect(await records(page)).toEqual(before);
  await page.locator('#spot-query').fill('一致しない');
  await expect(page.locator('.spot-marker')).toHaveCount(0);
  await expect(page.locator('.current-location-marker')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.current-location-marker')).toHaveCount(0);
});

for (const [mode, text] of [['denied', '許可されていません'], ['unavailable', '取得できません'], ['unsupported', '対応していません'], ['timeout', 'タイムアウト']]) {
  test(`現在地の${mode}を案内し、地点登録を続けられる`, async ({ page }) => {
    await mockLocation(page, mode);
    await page.goto('/');
    if (mode === 'timeout') await page.clock.install();
    await page.getByRole('button', { name: '現在地', exact: true }).click();
    if (mode === 'timeout') await page.clock.runFor(10000);
    await expect(page.locator('#location-status')).toContainText(text);
    await expect(page.getByRole('button', { name: '現在地', exact: true })).toBeEnabled();
    await create(page, '拒否後も保存できる架空地点');
    expect(await records(page)).toHaveLength(1);
  });
}

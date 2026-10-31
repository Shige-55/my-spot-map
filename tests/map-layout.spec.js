import { test, expect } from '@playwright/test';

// 外部OSMへアクセスせず、通常表示・通信失敗を再現する。
const tile = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#e5ece5"/><path d="M0 128h256M128 0v256" stroke="#fff" stroke-width="12"/></svg>';

test.beforeEach(async ({ page }) => {
  await page.route('https://tile.openstreetmap.org/**', (route) => route.fulfill({
    contentType: 'image/svg+xml', body: tile,
  }));
});

async function expectMapReady(page) {
  const map = page.locator('#map');
  await expect(map).toBeVisible();
  await expect(page.locator('.leaflet-tile-loaded').first()).toBeVisible();
  // 四隅と中央が実際のタイルで覆われることを確認。非表示中の幅変更も検出する。
  await expect.poll(() => map.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const tiles = [...element.querySelectorAll('.leaflet-tile-loaded')]
      .map((image) => image.getBoundingClientRect());
    return [[2, 2], [bounds.width - 2, 2], [2, bounds.height - 2],
      [bounds.width - 2, bounds.height - 2], [bounds.width / 2, bounds.height / 2]]
      .every(([x, y]) => tiles.some((tileBounds) =>
        tileBounds.left <= bounds.left + x && tileBounds.right >= bounds.left + x
        && tileBounds.top <= bounds.top + y && tileBounds.bottom >= bounds.top + y));
  })).toBe(true);

  const attribution = page.locator('.leaflet-control-attribution');
  await expect(attribution).toBeInViewport();
  await expect(attribution).toContainText('© OpenStreetMap contributors');
  await expect(attribution.getByRole('link', { name: 'OpenStreetMap contributors' }))
    .toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');
}

test('PCは一覧と地図を左右に表示し、ドラッグ移動・拡大縮小できる', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expectMapReady(page);
  await expect(page.locator('#list-panel')).toBeVisible();
  await expect(page.getByRole('tablist')).toBeHidden();
  const listBounds = await page.locator('#list-panel').boundingBox();
  const mapBounds = await page.locator('#map').boundingBox();
  expect(listBounds.x + listBounds.width).toBeLessThanOrEqual(mapBounds.x);
  await expect(page.locator('.leaflet-tile-loaded').first()).toHaveAttribute('src', /\/13\//);

  const pane = page.locator('.leaflet-map-pane');
  const transform = await pane.getAttribute('style');
  await page.mouse.move(mapBounds.x + mapBounds.width / 2, mapBounds.y + mapBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(mapBounds.x + mapBounds.width / 2 + 120, mapBounds.y + mapBounds.height / 2 + 60, { steps: 12 });
  await page.mouse.up();
  await expect(pane).not.toHaveAttribute('style', transform);

  await page.getByRole('button', { name: '拡大', exact: true }).click();
  await expect(page.locator('.leaflet-tile-loaded[src*="/14/"]').first()).toBeVisible();
  await page.getByRole('button', { name: '縮小', exact: true }).click();
  await expect(page.locator('.leaflet-tile-loaded[src*="/13/"]').first()).toBeVisible();
  await expectMapReady(page);
  expect(errors).toEqual([]);
});

test('iPhone幅でタブを往復しても地図の範囲と帰属表示が保たれる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expectMapReady(page);
  await expect(page.locator('#list-panel')).toBeHidden();
  for (let index = 0; index < 3; index += 1) {
    await page.getByRole('tab', { name: '登録地点' }).click();
    await expect(page.locator('#map-panel')).toBeHidden();
    await expect(page.getByText('まだ登録地点はありません')).toBeVisible();
    await page.getByRole('tab', { name: '地図', exact: true }).click();
    await expectMapReady(page);
  }
  expect(await page.evaluate(() => window.document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('一覧を表示したまま画面幅を変え、地図へ戻ってもタイルが領域を覆う', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expectMapReady(page);
  await page.getByRole('tab', { name: '登録地点' }).click();
  await page.setViewportSize({ width: 700, height: 500 });
  await page.getByRole('tab', { name: '地図', exact: true }).click();
  await expectMapReady(page);
  await page.getByRole('tab', { name: '登録地点' }).click();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectMapReady(page);
  await expect(page.locator('#list-panel')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(page.locator('#map-panel')).toBeHidden();
  await page.getByRole('tab', { name: '地図', exact: true }).click();
  await expectMapReady(page);
});

test('タブは矢印キー・Home・Endで操作でき、地図もキーボードで移動できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const mapTab = page.getByRole('tab', { name: '地図', exact: true });
  const listTab = page.getByRole('tab', { name: '登録地点' });
  await mapTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(listTab).toBeFocused();
  await expect(listTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(mapTab).toBeFocused();
  await page.keyboard.press('End');
  await expect(listTab).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(mapTab).toBeFocused();
  await expectMapReady(page);
  const pane = page.locator('.leaflet-map-pane');
  const transform = await pane.getAttribute('style');
  await page.locator('#map').focus();
  await page.keyboard.press('ArrowRight');
  await expect(pane).not.toHaveAttribute('style', transform);
});

test('タイル通信失敗を案内し、一覧への切り替えを妨げない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://tile.openstreetmap.org/**', (route) => route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('背景地図を読み込めません');
  await expect(page.locator('.leaflet-control-attribution')).toBeInViewport();
  await page.getByRole('tab', { name: '登録地点' }).click();
  await expect(page.getByText('まだ登録地点はありません')).toBeVisible();
  await page.getByRole('tab', { name: '地図', exact: true }).click();
  await expect(page.getByRole('status')).toBeVisible();
});

test('通信回復後に地図操作でタイルが読み込まれるとエラー案内が消える', async ({ page }) => {
  let online = false;
  await page.route('https://tile.openstreetmap.org/**', (route) => online
    ? route.fulfill({ contentType: 'image/svg+xml', body: tile }) : route.abort());
  await page.goto('/');
  await expect(page.getByRole('status')).toBeVisible();
  online = true;
  await page.getByRole('button', { name: '拡大', exact: true }).click();
  await expectMapReady(page);
  await expect(page.getByRole('status')).toBeHidden();
});

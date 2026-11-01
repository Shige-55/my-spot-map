import { test, expect } from '@playwright/test';

async function client(browser) {
  const context = await browser.newContext(); const page = await context.newPage();
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { context, page, cdp };
}
async function api(page, path, method = 'GET', body) {
  return page.evaluate(async ({ path, method, body }) => {
    const response = await window.fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  }, { path, method, body });
}

test('パスキー、管理者承認、共有、取消、入口保護を実ブラウザで検証する', async ({ browser }) => {
  const owner = await client(browser), member = await client(browser), stranger = await client(browser);
  const errors = []; owner.page.on('pageerror', (e) => errors.push(e.message)); member.page.on('pageerror', (e) => errors.push(e.message));
  await stranger.page.goto('/');
  await expect(stranger.page.getByRole('button', { name: 'パスキーでログイン', exact: true })).toBeVisible();
  expect((await stranger.context.request.get('/assets/anything.js')).status()).toBe(401);
  expect((await stranger.context.request.get('/sw.js')).status()).toBe(401);
  await owner.page.goto('/#invite=' + '1'.repeat(64));
  await owner.page.getByRole('button', { name: '招待を受けてパスキーを登録' }).click();
  await expect(owner.page.locator('#register-center')).toBeVisible();
  // 別の認証器へ追加した鍵でもログインできる。
  await owner.cdp.send('WebAuthn.disable'); await owner.cdp.send('WebAuthn.enable');
  await owner.cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
    hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await owner.page.goto('/auth/add');
  await owner.page.getByRole('button', { name: '追加のパスキーを登録', exact: true }).click();
  await expect(owner.page.locator('#register-center')).toBeVisible();
  expect((await api(owner.page, 'logout', 'POST', {})).status).toBe(200);
  await owner.page.goto('/auth/login');
  await owner.page.getByRole('button', { name: 'パスキーでログイン', exact: true }).click();
  await expect(owner.page.locator('#register-center')).toBeVisible();
  const invited = await api(owner.page, 'invitations', 'POST', { email: 'family@example.test' });
  expect(invited.status, JSON.stringify(invited.body)).toBe(200);
  await owner.page.waitForTimeout(1100); // 同一IPの認証レート制限を守る。
  await member.page.goto(invited.body.invitationUrl);
  await member.page.getByRole('button', { name: '招待を受けてパスキーを登録' }).click();
  await expect(member.page.locator('#status')).toContainText('管理者の承認後');
  expect((await member.context.request.get('/sw.js')).status()).toBe(401);
  await member.page.getByRole('button', { name: 'パスキーでログイン', exact: true }).click();
  await expect(member.page.locator('#status')).toContainText('承認');
  const rows = (await api(owner.page, 'members')).body.members;
  const family = rows.find((item) => item.email === 'family@example.test');
  expect(family.status).toBe('invited'); expect(family.has_passkey).toBe(1);
  expect((await api(owner.page, `members/${family.id}/approve`, 'POST', {})).status).toBe(200);
  await owner.page.waitForTimeout(1100);
  await member.page.getByRole('button', { name: 'パスキーでログイン', exact: true }).click();
  await expect(member.page.locator('#register-center')).toBeVisible();
  expect((await api(member.page, 'members')).status).toBe(403);
  const account = (await api(owner.page, 'session', 'POST', { device: '10000000-0000-4000-8000-000000000002' })).body.member;
  expect((await api(owner.page, 'contacts', 'POST', { userId: family.id })).status).toBe(200);
  expect((await api(member.page, 'contacts/' + account.id, 'PUT', {})).status).toBe(200);
  const id = '10000000-0000-4000-8000-000000000003';
  const spot = { name: '<img src=x onerror=alert(1)>', memo: '架空データ', category: '', latitude: 35, longitude: 139, zoom: 13 };
  expect((await api(owner.page, 'spots/' + id, 'PUT', { expectedRevision: 0, spot, recipients: [family.id] })).status).toBe(200);
  expect((await api(member.page, 'spots')).body.spots).toHaveLength(1);
  expect((await api(stranger.page, 'spots')).status).toBe(401);
  await expect(member.page.locator('#received-spots')).toContainText(spot.name, { timeout: 12000 });
  expect(await member.page.locator('#received-spots img').count()).toBe(0);
  expect((await api(owner.page, 'members/' + family.id, 'DELETE', {})).status).toBe(200);
  expect((await api(member.page, 'spots')).status).toBe(401);
  expect((await member.context.request.get('/sw.js')).status()).toBe(401);
  // 一度キャッシュした端末もオンライン取消確認でロックされる。
  await member.page.reload();
  await expect(member.page.locator('#access-gate')).toBeVisible();
  await expect(member.page.locator('#private-app')).toBeHidden();
  // 認証後のオフライン個人利用と、オフラインログアウトの接続復帰を確認する。
  await owner.page.evaluate(async () => { await window.navigator.serviceWorker.ready; });
  await expect.poll(() => owner.page.evaluate(() => Boolean(window.navigator.serviceWorker.controller))).toBe(true);
  await owner.context.setOffline(true); await owner.page.reload();
  await expect(owner.page.locator('#register-center')).toBeVisible();
  await owner.page.getByRole('button', { name: '設定', exact: true }).click();
  await owner.page.locator('#account-logout').click();
  await expect(owner.page.locator('#private-app')).toBeHidden();
  await owner.context.setOffline(false); await owner.page.reload();
  await expect(owner.page.locator('#access-message')).toContainText('ログアウト済み');
  await expect(owner.page.locator('#private-app')).toBeHidden();
  expect(errors).toEqual([]);
  await Promise.all([owner.context.close(), member.context.close(), stranger.context.close()]);
});

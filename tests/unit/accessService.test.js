import { beforeEach, describe, expect, test } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createAccessService } from '../../src/access/accessService.js';
import { AccessError } from '../../src/access/api.js';
import { validatePermit } from '../../src/access/permit.js';

let keys, publicJwk, clock, mono, saved, repository;
const device = '10000000-0000-4000-8000-000000000001';
const origin = 'https://app.example.test';
beforeEach(async () => {
  keys = await generateKeyPair('ES256', { extractable: true }); publicJwk = await exportJWK(keys.publicKey);
  clock = Date.now(); mono = 0; saved = null;
  repository = { device: async () => device, load: async () => saved,
    save: async (value) => { saved = value; }, clear: async () => { saved = null; } };
});
async function token(extra = {}, expires = 86400) {
  return new SignJWT({ kind: 'offline-local-only', device, role: 'member', name: '架空の家族', ...extra })
    .setProtectedHeader({ alg: 'ES256' }).setSubject('fixture-member').setIssuer('my-spot-map').setAudience(origin)
    .setIssuedAt(Math.floor(clock / 1000)).setExpirationTime(Math.floor(clock / 1000) + expires).sign(keys.privateKey);
}
const create = (api) => createAccessService({ repository, api, publicJwk, origin, now: () => clock, monotonic: () => mono });
const network = () => { throw new AccessError('通信できません。接続を確認してください。'); };

describe('オフライン許可の署名と利用制限', () => {
  test('端末・サイト・署名・種類・期限・時計の巻戻しを検証する', async () => {
    const record = { token: await token(), lastSeen: clock };
    expect((await validatePermit(record, { publicJwk, origin, device, now: clock })).id).toBe('fixture-member');
    await expect(validatePermit(record, { publicJwk, origin, device: 'other', now: clock })).rejects.toThrow();
    await expect(validatePermit(record, { publicJwk, origin: 'https://other.example.test', device, now: clock })).rejects.toThrow();
    await expect(validatePermit(record, { publicJwk, origin, device, now: clock - 10000 })).rejects.toThrow();
    await expect(validatePermit(record, { publicJwk, origin, device, now: clock + 86400001 })).rejects.toThrow();
    await expect(validatePermit({ token: await token({ kind: 'app-session' }), lastSeen: clock }, { publicJwk, origin, device, now: clock })).rejects.toThrow();
  });
  test('初回オフラインを拒否し、有効な許可がある場合だけ個人機能を許可する', async () => {
    const service = create(network);
    await expect(service.check()).rejects.toThrow('オンライン');
    saved = { token: await token(), lastSeen: clock };
    expect((await service.check()).online).toBe(false);
  });
  test('取消・不正応答では以前の許可を使って迂回しない', async () => {
    for (const status of [401, 403, 502]) {
      saved = { token: await token(), lastSeen: clock };
      const service = create(() => { throw new AccessError('確認エラー', status); });
      await expect(service.check()).rejects.toThrow('確認エラー'); expect(saved).toBeNull();
    }
  });
  test('無料枠制限などの503時も、有効な許可のある個人機能だけを許可する', async () => {
    saved = { token: await token(), lastSeen: clock };
    expect((await create(() => { throw new AccessError('利用上限', 503); }).check()).online).toBe(false);
  });
  test('同じ許可を再読込しても単調時計の期限を延ばさない', async () => {
    saved = { token: await token({}, 10), lastSeen: clock };
    const service = create(network); await service.check();
    mono += 9000; await service.check(); mono += 2000;
    await expect(service.check()).rejects.toThrow('オンライン');
  });
  test('ログアウト前に開始した応答が後から届いても許可を復活させない', async () => {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const service = create(async () => pending);
    const checking = service.check(); await Promise.resolve(); await service.logout();
    resolve({ member: { id: 'fixture-member', role: 'member' }, permit: { token: await token() } });
    await checking; expect(service.current).toBeNull(); expect(saved).toBeNull();
  });
  test('オフラインでログアウトしたセッションは接続復帰後も再利用しない', async () => {
    let blocked = '';
    repository.blockedSession = async () => blocked;
    repository.blockSession = async () => { blocked = saved?.sessionId || ''; saved = null; };
    let sessionId = 'old-session';
    const service = create(async () => ({ sessionId, member: { id: 'fixture-member', role: 'member' }, permit: { token: await token() } }));
    await service.check(); await service.logout();
    await expect(service.check()).rejects.toThrow('ログアウト済み');
    expect(saved).toBeNull();
    sessionId = 'fresh-passkey-session';
    expect((await service.check()).online).toBe(true);
  });
});

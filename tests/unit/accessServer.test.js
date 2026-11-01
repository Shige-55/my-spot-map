import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT } from 'jose';
import { createHandler } from '../../server/index.js';
import { HttpError } from '../../server/auth.js';

function sqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../server/migrations/0001_access.sql', import.meta.url), 'utf8'));
  db.exec(readFileSync(new URL('../../server/migrations/0002_passkeys.sql', import.meta.url), 'utf8'));
  return {
    raw: db,
    prepare(sql) {
      return { bind(...values) {
        return {
          async first() { return db.prepare(sql).get(...values) || null; },
          async all() { return { results: db.prepare(sql).all(...values) }; },
          async run() { const result = db.prepare(sql).run(...values); return { meta: { changes: Number(result.changes) } }; },
        };
      } };
    },
    async batch(statements) {
      db.exec('BEGIN');
      try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('COMMIT'); return results; }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
  };
}

let env, handler, accessKey, permitKey, time;
beforeEach(async () => {
  time = Date.now();
  accessKey = await generateKeyPair('RS256', { extractable: true });
  const accessJwk = { ...await exportJWK(accessKey.publicKey), kid: 'fixture' };
  permitKey = await generateKeyPair('ES256', { extractable: true });
  env = { DB: sqliteD1(), ACCESS_TEAM_DOMAIN: 'fixture.cloudflareaccess.com', ACCESS_AUD: 'a'.repeat(64),
    SESSION_SECRET: 'b'.repeat(64),
    OWNER_EMAIL: 'owner@example.test', APP_ORIGIN: 'https://app.example.test',
    OFFLINE_PRIVATE_JWK: JSON.stringify(await exportJWK(permitKey.privateKey)), ASSETS: { fetch: async () => new Response('private-app') } };
  const keys = createLocalJWKSet({ keys: [accessJwk] });
  env.DB.raw.prepare(`INSERT INTO app_members(id,email,subject,name,role,status,created_at,updated_at)
    VALUES ('fixture-owner','owner@example.test','https://fixture.cloudflareaccess.com|owner@example.test','管理者','owner','active',?,?)`).run(time, time);
  // API認可のテスト用。実際のパスキー・Cookie認証は別のブラウザ統合テストで検証する。
  handler = createHandler({ now: () => time, authenticate: async (request) => {
    try { const { payload } = await jwtVerify(request.headers.get('Cf-Access-Jwt-Assertion'), keys,
      { issuer: 'https://fixture.cloudflareaccess.com', audience: env.ACCESS_AUD, algorithms: ['RS256'] });
    return { email: payload.email, subject: 'https://fixture.cloudflareaccess.com|' + payload.sub };
    } catch { throw new HttpError(401, '本人確認が必要です。'); }
  } });
});
afterEach(() => env.DB.raw.close());

async function call(email, path = '/', method = 'GET', body, headers = {}) {
  const jwt = email ? await new SignJWT({ email }).setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
    .setIssuer('https://fixture.cloudflareaccess.com').setAudience(env.ACCESS_AUD).setSubject(email)
    .setIssuedAt().setExpirationTime('1h').sign(accessKey.privateKey) : '';
  return handler.fetch(new Request(env.APP_ORIGIN + path, { method,
    headers: { ...(jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {}), ...(body ? { 'Content-Type': 'application/json', Origin: env.APP_ORIGIN } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
async function invite(email) {
  const response = await call('owner@example.test', '/api/invitations', 'POST', { email });
  expect(response.status).toBe(200);
  const data = await response.json();
  time += 1100;
  expect(new URL(data.invitationUrl).hash).toContain('invite=');
  env.DB.raw.prepare("UPDATE app_members SET status='active',subject=?,invitation_hash=NULL,invitation_expires=NULL WHERE email=?")
    .run('https://fixture.cloudflareaccess.com|' + email, email);
  return env.DB.raw.prepare('SELECT * FROM app_members WHERE email=?').get(email);
}
async function connect(left, right) {
  expect((await call(left.email, '/api/contacts', 'POST', { userId: right.id })).status).toBe(200);
  expect((await call(right.email, '/api/contacts/' + left.id, 'PUT', {})).status).toBe(200);
}
const spotId = '10000000-0000-4000-8000-000000000001';
const spot = { name: '架空の共有地点', memo: '<script>実行しない</script>', category: '架空', latitude: 35, longitude: 139, zoom: 13 };

describe('入口と招待の認証・認可', () => {
  test('未設定・未認証・偽署名・別originを拒否し、資産を返さない', async () => {
    expect((await call(null, '/assets/app.js')).status).toBe(401);
    expect((await call(null, '/sw.js', 'GET', undefined, { 'Cf-Access-Jwt-Assertion': 'fake' })).status).toBe(401);
    expect((await call('stranger@example.test', '/assets/app.js')).status).toBe(403);
    expect((await handler.fetch(new Request('https://preview.example.test/'), env)).status).toBe(404);
    const previous = env.SESSION_SECRET; env.SESSION_SECRET = '';
    expect((await call('owner@example.test')).status).toBe(503); env.SESSION_SECRET = previous;
  });
  test('管理者の本人確認でだけ初期化し、他人やフロントの役割指定で昇格しない', async () => {
    expect((await call('stranger@example.test')).status).toBe(403);
    expect(env.DB.raw.prepare('SELECT count(*) n FROM app_members').get().n).toBe(1);
    expect(await (await call('owner@example.test')).text()).toBe('private-app');
    const a = await invite('a@example.test');
    expect((await call(a.email, '/api/invitations', 'POST', { email: 'b@example.test', role: 'owner' })).status).toBe(403);
    expect((await call(a.email, '/api/members')).status).toBe(403);
    expect((await call(a.email, '/api/profile', 'PUT', { name: '家族A', role: 'owner' })).status).toBe(200);
    expect(env.DB.raw.prepare('SELECT role FROM app_members WHERE id=?').get(a.id).role).toBe('member');
  });
  test('招待コードは期限を確認し、パスキーと管理者承認を省略して利用できない', async () => {
    const response = await call('owner@example.test', '/api/invitations', 'POST', { email: 'a@example.test' });
    const { invitationUrl } = await response.json();
    expect((await call('a@example.test', '/assets/app.js')).status).toBe(403);
    expect(await (await call('a@example.test')).text()).toContain('招待');
    expect((await call('a@example.test', '/api/invitations/accept', 'POST', { token: 'bad' })).status).toBe(403);
    const token = new URLSearchParams(new URL(invitationUrl).hash.slice(1)).get('invite');
    expect((await call('b@example.test', '/api/invitations/accept', 'POST', { token })).status).toBe(403);
    time += 86400001;
    expect((await call('a@example.test', '/auth/register/options', 'POST', { token })).status).toBe(403);
  });
  test('CSRF・不正JSON・大きな入力を拒否する', async () => {
    expect((await call('owner@example.test', '/api/invitations', 'POST', { email: 'a@example.test' }, { Origin: 'https://evil.example.test' })).status).toBe(403);
    expect((await call('owner@example.test', '/api/profile', 'PUT', { name: 'x'.repeat(2000) })).status).toBe(413);
  });
  test('利用取消はアプリの入口とAPIの両方で拒否する', async () => {
    const a = await invite('a@example.test');
    expect((await call('owner@example.test', '/api/members/' + a.id, 'DELETE')).status).toBe(403); // Originなしは拒否
    expect((await call('owner@example.test', '/api/members/' + a.id, 'DELETE', {})).status).toBe(200);
    expect((await call(a.email)).status).toBe(403);
    expect((await call('owner@example.test')).status).toBe(200);
  });
  test('オフライン許可は24時間・端末固定・個人機能専用の署名付き', async () => {
    const device = '10000000-0000-4000-8000-000000000002';
    const response = await call('owner@example.test', '/api/session', 'POST', { device });
    expect(response.status).toBe(200);
    const { permit } = await response.json();
    const { payload } = await jwtVerify(permit.token, permitKey.publicKey, { issuer: 'my-spot-map', audience: env.APP_ORIGIN });
    expect(payload.kind).toBe('offline-local-only'); expect(payload.device).toBe(device); expect(payload.exp - payload.iat).toBe(86400);
    expect((await call('owner@example.test', '/api/session', 'POST', { device: 'invalid' })).status).toBe(400);
  });
});

describe('共有地点と現在地をA・B・無関係なCで検査', () => {
  test('双方が共有相手を申請しても関係を二重登録せず、受けた側が承認できる', async () => {
    const a = await invite('a@example.test'), b = await invite('b@example.test');
    expect((await call(a.email, '/api/contacts', 'POST', { userId: b.id })).status).toBe(200);
    expect((await call(b.email, '/api/contacts', 'POST', { userId: a.id })).status).toBe(200);
    const rows = (await (await call(b.email, '/api/contacts')).json()).contacts;
    expect(rows).toHaveLength(1); expect(rows[0].recipient).toBe(b.id);
    expect((await call(b.email, '/api/contacts/' + a.id, 'PUT', {})).status).toBe(200);
    expect((await (await call(a.email, '/api/contacts')).json()).contacts).toHaveLength(1);
  });
  test('成功応答を失った同じ操作の再送を受理し、解除後の古い再送では復活しない', async () => {
    const a = await invite('a@example.test'), b = await invite('b@example.test'); await connect(a, b);
    const operationId = globalThis.crypto.randomUUID();
    const body = { operationId, expectedRevision: 0, recipients: [b.id], spot };
    expect((await call(a.email, '/api/spots/' + spotId, 'PUT', body)).status).toBe(200); time += 300;
    const again = await call(a.email, '/api/spots/' + spotId, 'PUT', body);
    expect(again.status).toBe(200); expect((await again.json()).revision).toBe(1); time += 300;
    expect((await call(a.email, '/api/spots/' + spotId, 'DELETE', { operationId: globalThis.crypto.randomUUID(), expectedRevision: 1 })).status).toBe(200); time += 300;
    expect((await call(a.email, '/api/spots/' + spotId, 'PUT', body)).status).toBe(409);
    expect((await (await call(b.email, '/api/spots')).json()).spots).toHaveLength(0);
  });
  test('地点は許可相手だけが読み、無関係な相手への共有・他人の更新を拒否する', async () => {
    const a = await invite('a@example.test'), b = await invite('b@example.test'), c = await invite('c@example.test');
    await connect(a, b);
    expect((await call(a.email, '/api/spots/' + spotId, 'PUT', { expectedRevision: 0, recipients: [c.id], spot })).status).toBe(403);
    time += 300;
    const saved = await call(a.email, '/api/spots/' + spotId, 'PUT', { expectedRevision: 0, recipients: [b.id], spot });
    expect(saved.status).toBe(200);
    expect((await (await call(b.email, '/api/spots')).json()).spots).toHaveLength(1);
    expect((await (await call(c.email, '/api/spots')).json()).spots).toHaveLength(0);
    expect((await call(b.email, '/api/spots/' + spotId, 'DELETE', { expectedRevision: 1, ownerId: a.id })).status).toBe(409);
    time += 300;
    expect((await call(a.email, '/api/spots/' + spotId, 'DELETE', { expectedRevision: 1 })).status).toBe(200);
    expect((await (await call(b.email, '/api/spots')).json()).spots).toHaveLength(0);
    time += 300;
    expect((await call(a.email, '/api/spots/' + spotId, 'PUT', { expectedRevision: 1, recipients: [b.id], spot })).status).toBe(409);
  });
  test('招待の取消で位置・地点・関係を失効させ、再招待でも復活させない', async () => {
    const a = await invite('a@example.test'), b = await invite('b@example.test'); await connect(a, b);
    await call(a.email, '/api/spots/' + spotId, 'PUT', { expectedRevision: 0, recipients: [b.id], spot });
    expect((await call('owner@example.test', '/api/members/' + a.id, 'DELETE', {})).status).toBe(200);
    expect((await call(a.email, '/api/spots')).status).toBe(403);
    expect((await (await call(b.email, '/api/spots')).json()).spots).toHaveLength(0);
    await invite(a.email);
    expect((await (await call(b.email, '/api/spots')).json()).spots).toHaveLength(0);
    expect((await (await call(a.email, '/api/contacts')).json()).contacts).toHaveLength(0);
  });
  test('現在地は双方の同意と生存期限が必要で、履歴と期限切れを返さない', async () => {
    const a = await invite('a@example.test'), b = await invite('b@example.test'), c = await invite('c@example.test'); await connect(a, b);
    const sa = await (await call(a.email, '/api/live/start', 'POST', { recipients: [b.id] })).json();
    const position = { latitude: 35, longitude: 139, accuracy: 40, ageMs: 0 };
    const waiting = await (await call(a.email, '/api/live/pulse', 'POST', { sessionId: sa.sessionId, position })).json();
    expect(waiting.eligibleCount).toBe(0);
    expect(env.DB.raw.prepare('SELECT position FROM live_sessions WHERE owner_id=?').get(a.id).position).toBeNull();
    const sb = await (await call(b.email, '/api/live/start', 'POST', { recipients: [a.id] })).json();
    time += 5000;
    expect((await call(a.email, '/api/live/pulse', 'POST', { sessionId: sa.sessionId, position })).status).toBe(200);
    const visibleResponse = await call(b.email, '/api/live/pulse', 'POST', { sessionId: sb.sessionId });
    expect(visibleResponse.status).toBe(200);
    const visible = await visibleResponse.json();
    expect(visible.positions).toHaveLength(1); expect(visible.positions[0].latitude).toBe(35);
    expect((await call(c.email, '/api/live/pulse', 'POST', { sessionId: sa.sessionId })).status).toBe(409);
    expect((await call(a.email, '/api/live/stop', 'POST', { sessionId: sa.sessionId })).status).toBe(200);
    time += 5000;
    expect((await (await call(b.email, '/api/live/pulse', 'POST', { sessionId: sb.sessionId })).json()).positions).toHaveLength(0);
    expect((await call(a.email, '/api/live/pulse', 'POST', { sessionId: sa.sessionId, position })).status).toBe(409);
    time += 16000; await handler.scheduled({}, env);
    expect(env.DB.raw.prepare('SELECT count(*) n FROM live_sessions').get().n).toBe(0);
  });
});

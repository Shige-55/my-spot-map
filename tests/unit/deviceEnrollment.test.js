import { afterEach, beforeEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { sqliteD1 } from '../helpers/sqliteD1.js';
import { createHandler } from '../../server/index.js';

let db, env, time, owner, other;
const memberId = '10000000-0000-4000-8000-000000000001';
function account(id, email, role) {
  db.raw.prepare("INSERT INTO app_members(id,email,name,role,status,subject,created_at,updated_at) VALUES (?,?,'架空利用者',?,'active',?,?,?)")
    .run(id, email, role, 'passkey:' + id, time, time);
  const sessionId = globalThis.crypto.randomUUID();
  db.raw.prepare('INSERT INTO auth_sessions VALUES (?,?,1,?,?)').run(sessionId, id, time, time + 86400000);
  return { id, email, sessionId, authenticatedAt: time };
}
beforeEach(() => {
  time = Date.now(); db = sqliteD1();
  owner = account(memberId, 'owner@example.test', 'owner');
  other = account('10000000-0000-4000-8000-000000000002', 'other@example.test', 'member');
  db.raw.prepare('INSERT INTO auth_credentials VALUES (?,?,?,?,?,?)').run('fixture-existing-key', owner.id, 'AA', 0, '[]', time);
  env = { DB: db, APP_ORIGIN: 'https://app.example.test', SESSION_SECRET: 'a'.repeat(64), OFFLINE_PRIVATE_JWK: 'fixture', ASSETS: {} };
});
afterEach(() => db.raw.close());
function call(path, method = 'GET', body, actor = owner, origin = env.APP_ORIGIN) {
  const handler = createHandler({ now: () => time, authenticate: async () => ({ ...actor, subject: 'passkey:' + actor.id }) });
  return handler.fetch(new Request(env.APP_ORIGIN + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}) }), env);
}
async function issue() {
  const response = await call('/api/devices', 'POST', {}); expect(response.status).toBe(200);
  const data = await response.json(); return { ...data, token: new URLSearchParams(new URL(data.registrationUrl).hash.slice(1)).get('device') };
}
function registered(id) {
  db.raw.prepare("UPDATE device_enrollments SET status='registered',credential_id='fixture-phone-key',public_key='AQ',counter=0,transports='[]',confirmation_code='A1B2C3D4' WHERE id=?").run(id);
}

test('登録リンクは10分・ハッシュ保存で、名簿APIに秘密と確認コードを返さない', async () => {
  const link = await issue(); const row = db.raw.prepare('SELECT * FROM device_enrollments WHERE id=?').get(link.id);
  expect(row.token_hash).not.toBe(link.token); expect(row.expires_at - time).toBe(600000);
  const list = await (await call('/api/devices')).json(); expect(JSON.stringify(list)).not.toContain(link.token);
  expect(list.devices[0]).toEqual({ id: link.id, status: 'issued', expires_at: time + 600000 });
  expect((await call('/auth/device/options', 'POST', { token: link.token })).status).toBe(200);
  time += 600001; expect((await call('/auth/device/options', 'POST', { token: link.token })).status).toBe(403);
});
test('再発行・取消で古いリンクを失効させ、CSRFと古い本人確認を拒否する', async () => {
  const first = await issue(); time += 1100; const second = await issue();
  expect((await call('/auth/device/options', 'POST', { token: first.token })).status).toBe(403);
  expect((await call('/api/devices/' + second.id, 'DELETE', {})).status).toBe(200); time += 1100;
  expect((await call('/auth/device/options', 'POST', { token: second.token })).status).toBe(403);
  expect((await call('/api/devices', 'POST', {}, owner, 'https://evil.example.test')).status).toBe(403);
  time += 600001; expect((await call('/api/devices', 'POST', {})).status).toBe(401);
});
test('登録前・誤コード・別人・別セッションから承認できず、正しい承認だけ1回追加する', async () => {
  const link = await issue();
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' })).status).toBe(403);
  registered(link.id);
  expect(JSON.stringify(await (await call('/api/devices')).json())).not.toContain('A1B2C3D4');
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' }, other)).status).toBe(403); time += 1100;
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' }, { ...owner, sessionId: 'another' })).status).toBe(403); time += 1100;
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: '00000000' })).status).toBe(403); time += 1100;
  expect(db.raw.prepare('SELECT count(*) n FROM auth_credentials').get().n).toBe(1);
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' })).status).toBe(200); time += 1100;
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' })).status).toBe(200);
  expect(db.raw.prepare('SELECT count(*) n FROM auth_credentials').get().n).toBe(2);
  expect(db.raw.prepare('SELECT member_id FROM auth_credentials WHERE id=?').get('fixture-phone-key').member_id).toBe(owner.id);
  expect((await call('/api/devices/' + link.id, 'DELETE', {})).status).toBe(409);
});
test('登録済みでも期限切れ後は承認できず、既存の鍵を保持する', async () => {
  const link = await issue(); registered(link.id); time += 600001;
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' })).status).toBe(403);
  expect(db.raw.prepare('SELECT count(*) n FROM auth_credentials').get().n).toBe(1);
});
test('承認と別の追加が競合して上限に達した場合も5個を超えて有効にしない', async () => {
  const link = await issue(); registered(link.id);
  for (let index = 0; index < 4; index++) db.raw.prepare('INSERT INTO auth_credentials VALUES (?,?,?,?,?,?)').run('fixture-extra-'+index, owner.id, 'AA', 0, '[]', time);
  expect((await call(`/api/devices/${link.id}/approve`, 'POST', { code: 'A1B2C3D4' })).status).toBe(403);
  expect(db.raw.prepare('SELECT count(*) n FROM auth_credentials').get().n).toBe(5);
  time += 1100; expect((await call('/api/devices', 'POST', {})).status).toBe(409);
});
test('作成元セッションの取消・利用者version変更・不正署名で追加を有効にしない', async () => {
  const link = await issue();
  const options = await (await call('/auth/device/options', 'POST', { token: link.token })).json();
  expect(options.options.authenticatorSelection.authenticatorAttachment).toBe('platform');
  expect((await call('/auth/device/verify', 'POST', { token: link.token, challengeId: link.id, response: {} })).status).toBe(403);
  db.raw.prepare('UPDATE app_members SET version=version+1 WHERE id=?').run(owner.id); time += 1100;
  expect((await call('/auth/device/options', 'POST', { token: link.token })).status).toBe(403);
  db.raw.prepare('DELETE FROM auth_sessions WHERE id=?').run(owner.sessionId);
  expect(db.raw.prepare('SELECT count(*) n FROM device_enrollments').get().n).toBe(0);
  expect(db.raw.prepare('SELECT count(*) n FROM auth_credentials').get().n).toBe(1);
});
test('マイグレーションは既存の鍵・利用者を消さず、追加テーブルだけを作る', () => {
  const old = sqliteD1(['0001_access.sql', '0002_passkeys.sql']);
  try {
    old.raw.prepare("INSERT INTO app_members(id,email,name,role,status,created_at,updated_at) VALUES ('old','old@example.test','架空','owner','active',1,1)").run();
    old.raw.prepare("INSERT INTO auth_credentials VALUES ('old-key','old','AA',0,'[]',1)").run();
    const before = old.raw.prepare('SELECT * FROM auth_credentials').all();
    old.raw.exec(readFileSync(new URL('../../server/migrations/0003_device_enrollments.sql', import.meta.url), 'utf8'));
    expect(old.raw.prepare('SELECT * FROM auth_credentials').all()).toEqual(before);
    expect(old.raw.prepare('SELECT count(*) n FROM device_enrollments').get().n).toBe(0);
  } finally { old.raw.close(); }
});

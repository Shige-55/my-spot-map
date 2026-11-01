import { expect, test } from 'vitest';
import { SignJWT } from 'jose';
import { createHandler } from '../../server/index.js';

const env = { APP_ORIGIN: 'https://app.example.test', SESSION_SECRET: 'b'.repeat(64), OFFLINE_PRIVATE_JWK: 'fixture',
  DB: { prepare() { throw new Error('fixture: free quota exhausted'); } }, ASSETS: { fetch() { throw new Error('private assets must not be reached'); } } };
const handler = createHandler();

test('偽Cookieや旧認証ヘッダーでは本番の認証を迂回できない', async () => {
  const response = await handler.fetch(new Request(env.APP_ORIGIN + '/sw.js', { headers: {
    Cookie: '__Host-myspot-session=forged', 'Cf-Access-Jwt-Assertion': 'unused',
  } }), env);
  expect(response.status).toBe(401); expect(await response.text()).not.toContain('fixture');
});

test('署名が正しくてもDBが利用不能なら503で閉じ、取消と誤判定しない', async () => {
  const token = await new SignJWT({ kind: 'app-session' }).setProtectedHeader({ alg: 'HS256' })
    .setSubject('fixture-member').setJti('fixture-session').setIssuedAt().setExpirationTime('1h')
    .setIssuer('my-spot-map-session').setAudience(env.APP_ORIGIN).sign(new TextEncoder().encode(env.SESSION_SECRET));
  const response = await handler.fetch(new Request(env.APP_ORIGIN + '/api/session', { method: 'POST',
    headers: { Cookie: '__Host-myspot-session=' + token, Origin: env.APP_ORIGIN, 'Content-Type': 'application/json' }, body: '{}' }), env);
  expect(response.status).toBe(503);
  const body = await response.text(); expect(body).not.toContain('fixture'); expect(body).not.toContain('SELECT');
});

import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { base64url, jwtVerify, SignJWT } from 'jose';
import { HttpError, readBody } from './auth.js';
import { digest, query, throttle } from './accessRepository.js';
import { loginPage } from './loginPage.js';
import { updatePage } from './updatePage.js';

const cookieName = '__Host-myspot-session';
const json = (body, headers = {}) => Response.json(body, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...headers } });

export function appConfiguration(env) {
  let url;
  try { url = new URL(env.APP_ORIGIN); } catch { throw new HttpError(503, '配信先の設定が完了していません。'); }
  if (url.origin !== env.APP_ORIGIN || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
    || !/^[a-f0-9]{64}$/.test(env.SESSION_SECRET || '') || !env.DB || !env.ASSETS || !env.OFFLINE_PRIVATE_JWK) {
    throw new HttpError(503, '招待制の設定が完了していません。');
  }
  return { origin: url.origin, rpID: url.hostname };
}

export async function authenticateSession(request, env) {
  const { origin } = appConfiguration(env);
  const token = request.headers.get('Cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
  if (!token || token.length > 3000) throw new HttpError(401, 'パスキーで本人確認してください。');
  let payload;
  try {
    ({ payload } = await jwtVerify(token, new TextEncoder().encode(env.SESSION_SECRET), { algorithms: ['HS256'],
      issuer: 'my-spot-map-session', audience: origin, requiredClaims: ['sub', 'exp', 'iat', 'jti'] }));
    if (payload.kind !== 'app-session') throw new Error();
  } catch { throw new HttpError(401, '本人確認の期限が切れているか、認証が正しくありません。'); }
  // DB障害や無料枠超過を認証失効と誤判定しない。上位が503にし、有効な個人用オフライン許可だけ残す。
  const row = await query(env.DB, `SELECT m.*,s.id session_id,s.created_at authenticated_at FROM auth_sessions s
      JOIN app_members m ON m.id=s.member_id WHERE s.id=? AND s.member_id=? AND s.expires_at>?
      AND m.status='active' AND m.version=s.member_version`, payload.jti, payload.sub, Date.now()).first();
  if (!row) throw new HttpError(401, '本人確認の期限切れ、または利用許可が取り消されています。');
  return { email: row.email, subject: row.subject, sessionId: row.session_id, authenticatedAt: row.authenticated_at };
}

async function issueSession(env, member, time) {
  const id = globalThis.crypto.randomUUID();
  await query(env.DB, `INSERT INTO auth_sessions(id,member_id,member_version,created_at,expires_at)
    SELECT ?,id,version,?,? FROM app_members WHERE id=? AND status='active'`, id, time, time + 86400000, member.id).run();
  const token = await new SignJWT({ kind: 'app-session' }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(member.id).setJti(id).setIssuer('my-spot-map-session').setAudience(env.APP_ORIGIN)
    .setIssuedAt(Math.floor(time / 1000)).setExpirationTime(Math.floor(time / 1000) + 86400).sign(new TextEncoder().encode(env.SESSION_SECRET));
  return `${cookieName}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}

export async function handlePasskeyRequest(request, env, time) {
  const { origin, rpID } = appConfiguration(env);
  const path = new URL(request.url).pathname;
  if (path === '/auth/login' && request.method === 'GET') return loginPage();
  if (path === '/auth/update' && request.method === 'GET') return updatePage();
  let ownIdentity;
  if (path === '/auth/add' || path.startsWith('/auth/keys')) {
    ownIdentity = await authenticateSession(request, env);
    if (time - ownIdentity.authenticatedAt > 600000) throw new HttpError(401, 'パスキーの管理には10分以内のログインが必要です。ログインし直してください。');
    if (path === '/auth/add' && request.method === 'GET') return loginPage({ adding: true });
  }
  if (request.method !== 'POST') throw new HttpError(405, 'この操作は利用できません。');
  const address = request.headers.get('CF-Connecting-IP') || 'local';
  const rateId = await digest(env.SESSION_SECRET + address);
  await throttle(env.DB, rateId, 'auth:' + path, 1000, time);
  const body = await readBody(request, 20000);
  if (path === '/auth/keys/options') {
    const member = await query(env.DB, "SELECT * FROM app_members WHERE subject=? AND status='active'", ownIdentity.subject).first();
    const credentials = (await query(env.DB, 'SELECT id,transports FROM auth_credentials WHERE member_id=?', member.id).all()).results;
    if (credentials.length >= 5) throw new HttpError(409, 'パスキーは5個までです。');
    const options = await generateRegistrationOptions({ rpName: 'My Spot Map', rpID, userID: new TextEncoder().encode(member.id),
      userName: member.email, userDisplayName: member.name, attestationType: 'none', supportedAlgorithmIDs: [-7],
      excludeCredentials: credentials.map((item) => ({ id: item.id, transports: JSON.parse(item.transports) })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 60000 });
    const challengeId = globalThis.crypto.randomUUID();
    await query(env.DB, "INSERT INTO auth_challenges(id,challenge,kind,member_id,session_id,expires_at) VALUES (?,?,'add',?,?,?)",
      challengeId, options.challenge, member.id, ownIdentity.sessionId, time + 300000).run();
    return json({ options, challengeId });
  }
  if (path === '/auth/register/options') {
    if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new HttpError(403, '招待コードを確認してください。');
    const tokenHash = await digest(body.token);
    const member = await query(env.DB, "SELECT * FROM app_members WHERE invitation_hash=? AND status='invited' AND invitation_expires>? AND subject IS NULL", tokenHash, time).first();
    if (!member) throw new HttpError(403, '招待が無効、受諾済み、または期限切れです。');
    const options = await generateRegistrationOptions({ rpName: 'My Spot Map', rpID, userID: new TextEncoder().encode(member.id),
      userName: member.email, userDisplayName: member.name, attestationType: 'none', supportedAlgorithmIDs: [-7],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, timeout: 60000 });
    const challengeId = globalThis.crypto.randomUUID();
    await query(env.DB, "INSERT INTO auth_challenges(id,challenge,kind,member_id,token_hash,expires_at) VALUES (?,?,'register',?,?,?)", challengeId, options.challenge, member.id, tokenHash, time + 300000).run();
    return json({ options, challengeId });
  }
  if (path === '/auth/login/options') {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', timeout: 60000 });
    const challengeId = globalThis.crypto.randomUUID();
    await query(env.DB, "INSERT INTO auth_challenges(id,challenge,kind,expires_at) VALUES (?,?,'login',?)", challengeId, options.challenge, time + 300000).run();
    return json({ options, challengeId });
  }
  const challenge = typeof body.challengeId === 'string' ? await query(env.DB,
    'SELECT * FROM auth_challenges WHERE id=? AND expires_at>? AND consumed_by IS NULL', body.challengeId, time).first() : null;
  if (!challenge || !body.response || typeof body.response !== 'object') throw new HttpError(403, '本人確認の手続きを開始し直してください。');
  const operation = globalThis.crypto.randomUUID();
  if (path === '/auth/keys/verify' && challenge.kind === 'add' && challenge.session_id === ownIdentity.sessionId) {
    let verified;
    try { verified = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7] }); }
    catch { throw new HttpError(403, '追加パスキーを確認できません。'); }
    if (!verified.verified || !verified.registrationInfo) throw new HttpError(403, '本人確認が完了していません。');
    const credential = verified.registrationInfo.credential;
    const results = await env.DB.batch([
      query(env.DB, 'UPDATE auth_challenges SET consumed_by=? WHERE id=? AND consumed_by IS NULL AND expires_at>?', operation, challenge.id, time),
      query(env.DB, `INSERT INTO auth_credentials(id,member_id,public_key,counter,transports,created_at)
        SELECT ?,m.id,?,?,?,? FROM app_members m JOIN auth_sessions s ON s.member_id=m.id
        WHERE m.id=? AND m.status='active' AND m.version=s.member_version AND s.id=? AND s.expires_at>?
        AND (SELECT count(*) FROM auth_credentials WHERE member_id=m.id)<5
        AND EXISTS(SELECT 1 FROM auth_challenges WHERE id=? AND consumed_by=?)`, credential.id, base64url.encode(credential.publicKey),
      credential.counter, JSON.stringify(credential.transports || []), time, challenge.member_id, ownIdentity.sessionId, time, challenge.id, operation),
    ]);
    if (!results[1].meta.changes) throw new HttpError(409, '利用許可が変更されています。再度ログインしてください。');
    return json({ added: true });
  }
  if (path === '/auth/register/verify' && challenge.kind === 'register') {
    let verified;
    try { verified = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7] }); }
    catch { throw new HttpError(403, 'パスキーの登録を確認できません。手続きを開始し直してください。'); }
    if (!verified.verified || !verified.registrationInfo) throw new HttpError(403, '本人確認が完了していません。');
    const credential = verified.registrationInfo.credential;
    const results = await env.DB.batch([
      query(env.DB, 'UPDATE auth_challenges SET consumed_by=? WHERE id=? AND consumed_by IS NULL AND expires_at>?', operation, challenge.id, time),
      query(env.DB, `UPDATE app_members SET subject='passkey:'||id,registration_id=?,status=CASE WHEN role='owner' THEN 'active' ELSE 'invited' END,
        invitation_hash=NULL,invitation_expires=NULL,version=version+1,updated_at=?
        WHERE id=? AND status='invited' AND subject IS NULL AND invitation_hash=? AND invitation_expires>?
        AND EXISTS (SELECT 1 FROM auth_challenges WHERE id=? AND consumed_by=?)`, operation, time, challenge.member_id, challenge.token_hash, time, challenge.id, operation),
      query(env.DB, `INSERT INTO auth_credentials(id,member_id,public_key,counter,transports,created_at)
        SELECT ?,id,?,?,?,? FROM app_members WHERE id=? AND registration_id=?`, credential.id, base64url.encode(credential.publicKey),
      credential.counter, JSON.stringify(credential.transports || []), time, challenge.member_id, operation),
    ]);
    if (!results[1].meta.changes) throw new HttpError(409, '招待が変更または受諾されています。管理者へ確認してください。');
    const member = await query(env.DB, 'SELECT * FROM app_members WHERE id=?', challenge.member_id).first();
    if (member.status !== 'active') return json({ pending: true });
    return json({ pending: false }, { 'Set-Cookie': await issueSession(env, member, time) });
  }
  if (path === '/auth/login/verify' && challenge.kind === 'login') {
    const credential = typeof body.response.id === 'string' ? await query(env.DB,
      `SELECT c.*,m.status,m.version FROM auth_credentials c JOIN app_members m ON m.id=c.member_id WHERE c.id=? AND m.status='active'`, body.response.id).first() : null;
    if (!credential) throw new HttpError(403, '利用許可または管理者の承認を確認できません。');
    let verified;
    try { verified = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge.challenge,
      expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
      credential: { id: credential.id, publicKey: base64url.decode(credential.public_key), counter: credential.counter, transports: JSON.parse(credential.transports) } }); }
    catch { throw new HttpError(403, 'パスキーによる本人確認に失敗しました。'); }
    if (!verified.verified) throw new HttpError(403, '本人確認が完了していません。');
    const results = await env.DB.batch([
      query(env.DB, 'UPDATE auth_challenges SET consumed_by=? WHERE id=? AND consumed_by IS NULL AND expires_at>?', operation, challenge.id, time),
      query(env.DB, `UPDATE auth_credentials SET counter=? WHERE id=? AND counter=?
        AND EXISTS (SELECT 1 FROM auth_challenges WHERE id=? AND consumed_by=?)
        AND EXISTS (SELECT 1 FROM app_members WHERE id=? AND status='active' AND version=?)`, verified.authenticationInfo.newCounter,
      credential.id, credential.counter, challenge.id, operation, credential.member_id, credential.version),
    ]);
    if (!results[1].meta.changes) throw new HttpError(409, '本人確認が変更されています。開始し直してください。');
    return json({ authenticated: true }, { 'Set-Cookie': await issueSession(env, { id: credential.member_id }, time) });
  }
  throw new HttpError(404, 'この操作は利用できません。');
}

export async function logoutSession(request, env, identity) {
  if (identity.sessionId) await query(env.DB, 'DELETE FROM auth_sessions WHERE id=?', identity.sessionId).run();
  return json({ loggedOut: true }, { 'Set-Cookie': `${cookieName}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0` });
}

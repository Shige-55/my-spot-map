import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server';
import { base64url } from 'jose';
import { HttpError, readBody } from './auth.js';
import { digest, query, throttle } from './accessRepository.js';

const json = (body) => Response.json(body, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
const current = `EXISTS(SELECT 1 FROM app_members m JOIN auth_sessions s ON s.member_id=m.id
  WHERE m.id=device_enrollments.member_id AND m.status='active' AND m.version=device_enrollments.member_version
  AND s.id=device_enrollments.session_id AND s.member_version=m.version AND s.expires_at>?)`;
const randomHex = (bytes) => [...globalThis.crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function manageDevices(request, env, member, identity, time) {
  const path = new URL(request.url).pathname;
  if (!identity.sessionId) throw new HttpError(401, 'ログインし直してください。');
  if (path === '/api/devices' && request.method === 'GET') {
    const rows = (await query(env.DB, `SELECT id,status,expires_at FROM device_enrollments
      WHERE member_id=? AND session_id=? AND expires_at>? AND ${current}`, member.id, identity.sessionId, time, time).all()).results;
    return json({ devices: rows });
  }
  if (path === '/api/devices' && request.method === 'POST') {
    if (time - identity.authenticatedAt > 600000) throw new HttpError(401, '登録リンクの発行には10分以内のログインが必要です。ログインし直してください。');
    await readBody(request, 500);
    await throttle(env.DB, member.id, 'device-create', 1000, time);
    const count = await query(env.DB, 'SELECT count(*) n FROM auth_credentials WHERE member_id=?', member.id).first();
    if (count.n >= 5) throw new HttpError(409, 'パスキーは5個までです。');
    const id = globalThis.crypto.randomUUID(), token = randomHex(32), expiresAt = time + 600000;
    const result = await env.DB.batch([
      query(env.DB, "DELETE FROM device_enrollments WHERE member_id=? AND status<>'approved'", member.id),
      query(env.DB, `INSERT INTO device_enrollments(id,member_id,member_version,session_id,token_hash,status,expires_at)
        SELECT ?,m.id,m.version,s.id,?,'issued',? FROM app_members m JOIN auth_sessions s ON s.member_id=m.id
        WHERE m.id=? AND m.version=? AND m.status='active' AND s.id=? AND s.member_version=m.version AND s.expires_at>?`,
      id, await digest(token), expiresAt, member.id, member.version, identity.sessionId, time),
    ]);
    if (!result[1].meta.changes) throw new HttpError(403, '利用許可が変更されています。ログインし直してください。');
    return json({ id, expiresAt, registrationUrl: `${env.APP_ORIGIN}/auth/login#device=${token}` });
  }
  const id = /^\/api\/devices\/([a-f0-9-]{36})(\/approve)?$/.exec(path);
  if (id && request.method === 'DELETE' && !id[2]) {
    const result = await query(env.DB, "DELETE FROM device_enrollments WHERE id=? AND member_id=? AND session_id=? AND status<>'approved'", id[1], member.id, identity.sessionId).run();
    if (!result.meta.changes && await query(env.DB, "SELECT id FROM device_enrollments WHERE id=? AND member_id=? AND session_id=? AND status='approved'", id[1], member.id, identity.sessionId).first()) {
      throw new HttpError(409, 'この端末は承認済みです。登録リンクの取消では有効なパスキーを削除できません。');
    }
    return json({ cancelled: true });
  }
  if (id?.[2] && request.method === 'POST') {
    const body = await readBody(request, 500);
    const code = typeof body.code === 'string' ? body.code.trim().toUpperCase() : '';
    if (!/^[A-F0-9]{8}$/.test(code)) throw new HttpError(400, 'iPhoneに表示された8桁の確認コードを入力してください。');
    await throttle(env.DB, member.id, 'device-approve', 1000, time);
    const operation = globalThis.crypto.randomUUID();
    const results = await env.DB.batch([
      query(env.DB, `UPDATE device_enrollments SET status='approved',approval_operation=? WHERE id=? AND member_id=? AND session_id=?
        AND status='registered' AND expires_at>? AND confirmation_code=? AND ${current}
        AND (SELECT count(*) FROM auth_credentials WHERE member_id=?)<5`, operation, id[1], member.id, identity.sessionId, time, code, time, member.id),
      query(env.DB, `INSERT INTO auth_credentials(id,member_id,public_key,counter,transports,created_at)
        SELECT credential_id,member_id,public_key,counter,transports,? FROM device_enrollments
        WHERE id=? AND status='approved' AND approval_operation=?`, time, id[1], operation),
    ]);
    if (!results[0].meta.changes) {
      const done = await query(env.DB, `SELECT id FROM device_enrollments WHERE id=? AND member_id=? AND session_id=?
        AND status='approved' AND confirmation_code=? AND expires_at>? AND ${current}`, id[1], member.id, identity.sessionId, code, time, time).first();
      if (!done) throw new HttpError(403, '確認コード・期限・ログイン状態を確認してください。');
    }
    return json({ approved: true });
  }
  throw new HttpError(404, 'この操作は利用できません。');
}

export async function registerDevice(path, body, env, time, origin, rpID) {
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) throw new HttpError(403, '端末の登録リンクを確認してください。');
  const row = await query(env.DB, `SELECT * FROM device_enrollments WHERE token_hash=? AND expires_at>? AND ${current}`,
    await digest(body.token), time, time).first();
  if (!row || row.status !== 'issued') throw new HttpError(403, '登録リンクは無効・登録済み・期限切れです。元のPCで作り直してください。');
  if (path === '/auth/device/options') {
    const member = await query(env.DB, 'SELECT email,name FROM app_members WHERE id=?', row.member_id).first();
    const credentials = (await query(env.DB, 'SELECT id FROM auth_credentials WHERE member_id=?', row.member_id).all()).results;
    const options = await generateRegistrationOptions({ rpName: 'My Spot Map', rpID, userID: new TextEncoder().encode(row.member_id),
      userName: member.email, userDisplayName: member.name, attestationType: 'none', supportedAlgorithmIDs: [-7],
      excludeCredentials: credentials.map((item) => ({ id: item.id })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required', authenticatorAttachment: 'platform' }, timeout: 60000 });
    const result = await query(env.DB, `UPDATE device_enrollments SET challenge=?,challenge_expires=? WHERE id=? AND status='issued' AND expires_at>? AND ${current}`,
      options.challenge, Math.min(row.expires_at, time + 300000), row.id, time, time).run();
    if (!result.meta.changes) throw new HttpError(403, '登録リンクの期限切れ、または利用許可が変更されています。');
    return json({ options, challengeId: row.id });
  }
  if (path !== '/auth/device/verify' || body.challengeId !== row.id || !row.challenge || row.challenge_expires <= time) throw new HttpError(403, '端末の登録を開始し直してください。');
  let verified;
  try { verified = await verifyRegistrationResponse({ response: body.response, expectedChallenge: row.challenge,
    expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7] }); }
  catch { throw new HttpError(403, 'この端末のパスキーを確認できません。登録を開始し直してください。'); }
  if (!verified.verified || !verified.registrationInfo) throw new HttpError(403, '本人確認を完了してください。');
  const credential = verified.registrationInfo.credential, code = randomHex(4).toUpperCase();
  const result = await query(env.DB, `UPDATE device_enrollments SET status='registered',credential_id=?,public_key=?,counter=?,transports=?,confirmation_code=?,challenge=NULL
    WHERE id=? AND status='issued' AND challenge=? AND challenge_expires>? AND expires_at>? AND ${current}`,
  credential.id, base64url.encode(credential.publicKey), credential.counter, JSON.stringify(credential.transports || []), code,
  row.id, row.challenge, time, time, time).run();
  if (!result.meta.changes) throw new HttpError(403, '登録が変更または期限切れになりました。元のPCで確認してください。');
  return json({ pending: true, deviceEnrollment: true, confirmationCode: code });
}

import { checkWriteOrigin, HttpError, readBody } from './auth.js';
import { digest, identifyMember, peers, query, requireCurrent, throttle } from './accessRepository.js';
import { issuePermit } from './permits.js';
import { appConfiguration, authenticateSession, handlePasskeyRequest, logoutSession } from './passkeys.js';
import { loginPage } from './loginPage.js';
import { manageDevices } from './deviceEnrollment.js';
import { pulseLive, readShared, startLive, writeShared } from './sharingRepository.js';

const json = (value, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,63}$/;

export function createHandler({ authenticate = authenticateSession, now = () => Date.now() } = {}) {
  return {
    async fetch(request, env) {
      try {
        appConfiguration(env);
        const url = new URL(request.url);
        if (!env.APP_ORIGIN || url.origin !== env.APP_ORIGIN) throw new HttpError(404, 'このURLは利用できません。');
        if (!['GET', 'HEAD', 'POST', 'PUT', 'DELETE'].includes(request.method)) throw new HttpError(405, 'この操作は利用できません。');
        checkWriteOrigin(request);
        if (url.pathname.startsWith('/auth/')) return await handlePasskeyRequest(request, env, now());
        const identity = await authenticate(request, env);
        const time = now();
        let member = await identifyMember(env.DB, identity);
        if (member.status === 'invited') {
          if (url.pathname === '/' && request.method === 'GET') return loginPage();
          throw new HttpError(403, '利用招待の受諾が必要です。管理者の招待リンクを開いてください。');
        }
        member = await requireCurrent(env.DB, member);
        if (url.pathname === '/api/devices' || url.pathname.startsWith('/api/devices/')) return await manageDevices(request, env, member, identity, time);
        if (url.pathname === '/api/logout' && request.method === 'POST') return await logoutSession(request, env, identity);
        if (!url.pathname.startsWith('/api/')) {
          if (!['GET', 'HEAD'].includes(request.method)) throw new HttpError(405, 'この操作は利用できません。');
          const response = await env.ASSETS.fetch(request);
          const headers = new Headers(response.headers);
          headers.set('Cache-Control', 'private, no-cache'); headers.set('X-Content-Type-Options', 'nosniff');
          headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
          headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tile.openstreetmap.org; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
          return new Response(response.body, { status: response.status, headers });
        }
        if (url.pathname === '/api/session' && request.method === 'POST') {
          const body = await readBody(request, 1000);
          return json({ member: { id: member.id, name: member.name, role: member.role, email: member.email }, sessionId: identity.sessionId || '',
            permit: await issuePermit(env, member, body.device, time) });
        }
        if (url.pathname === '/api/profile' && request.method === 'PUT') {
          const body = await readBody(request, 1000);
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          if (!name || [...name].length > 60) throw new HttpError(400, '表示名は1〜60文字にしてください。');
          await query(env.DB, "UPDATE app_members SET name=?,updated_at=? WHERE id=? AND status='active' AND version=?", name, time, member.id, member.version).run();
          return json({ name });
        }
        if (url.pathname === '/api/members' && request.method === 'GET') {
          if (member.role !== 'owner') throw new HttpError(403, '管理者だけが利用者を管理できます。');
          return json({ members: (await query(env.DB, `SELECT id,email,name,role,status,invitation_expires,
            EXISTS(SELECT 1 FROM auth_credentials c WHERE c.member_id=app_members.id) has_passkey
            FROM app_members ORDER BY created_at`).all()).results });
        }
        if (url.pathname === '/api/invitations' && request.method === 'POST') {
          if (member.role !== 'owner') throw new HttpError(403, '管理者だけが利用者を招待できます。');
          await throttle(env.DB, member.id, 'invite', 1000, time);
          const body = await readBody(request, 1000);
          const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
          if (!emailPattern.test(email) || email === member.email) throw new HttpError(400, '招待するメールアドレスを確認してください。');
          const existing = await query(env.DB, 'SELECT * FROM app_members WHERE email=?', email).first();
          if (existing?.role === 'owner' || existing?.status === 'active') throw new HttpError(409, 'この人は既に利用者です。');
          const count = await query(env.DB, "SELECT count(*) count FROM app_members WHERE status<>'revoked'").first();
          if (count.count >= 50 && existing?.status !== 'invited') throw new HttpError(409, '無料枠を守るため利用者は管理者を含め50人までです。');
          const token = [...globalThis.crypto.getRandomValues(new Uint8Array(32))].map((n) => n.toString(16).padStart(2, '0')).join('');
          const id = existing?.id || globalThis.crypto.randomUUID();
          await env.DB.batch([query(env.DB, `INSERT INTO app_members(id,email,name,role,status,invitation_hash,invitation_expires,created_at,updated_at)
            VALUES (?,?,'利用者','member','invited',?,?,?,?) ON CONFLICT(email) DO UPDATE SET status='invited',subject=NULL,
            invitation_hash=excluded.invitation_hash,invitation_expires=excluded.invitation_expires,version=app_members.version+1,updated_at=excluded.updated_at`,
          id, email, await digest(token), time + 86400000, time, time),
          query(env.DB, 'DELETE FROM auth_credentials WHERE member_id=?', id),
          query(env.DB, 'DELETE FROM auth_sessions WHERE member_id=?', id),
          query(env.DB, 'DELETE FROM auth_challenges WHERE member_id=?', id)]);
          return json({ invitationUrl: `${env.APP_ORIGIN}/auth/login#invite=${token}`, expiresAt: time + 86400000 });
        }
        const approvalId = /^\/api\/members\/([a-f0-9-]{36})\/approve$/.exec(url.pathname)?.[1];
        if (approvalId && request.method === 'POST') {
          if (member.role !== 'owner') throw new HttpError(403, '管理者だけが利用を承認できます。');
          const result = await query(env.DB, `UPDATE app_members SET status='active',version=version+1,updated_at=?
            WHERE id=? AND role='member' AND status='invited' AND subject IS NOT NULL AND invitation_hash IS NULL
            AND EXISTS (SELECT 1 FROM auth_credentials c WHERE c.member_id=app_members.id)`, time, approvalId).run();
          if (!result.meta.changes) throw new HttpError(409, 'パスキー登録済みの承認待ち申請がありません。');
          return json({ approved: true });
        }
        const memberId = /^\/api\/members\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
        if (memberId && request.method === 'DELETE') {
          if (member.role !== 'owner' || memberId === member.id) throw new HttpError(403, 'この利用者の変更は許可されていません。');
          await env.DB.batch([
            query(env.DB, "UPDATE app_members SET status='revoked',version=version+1,invitation_hash=NULL,invitation_expires=NULL,updated_at=? WHERE id=? AND role='member'", time, memberId),
            query(env.DB, "UPDATE contacts SET status='revoked',version=version+1 WHERE requester=? OR recipient=?", memberId, memberId),
            query(env.DB, 'DELETE FROM spot_grants WHERE owner_id=? OR recipient_id=?', memberId, memberId),
            query(env.DB, "UPDATE shared_spots SET deleted=1,revision=revision+1,payload='{}' WHERE owner_id=?", memberId),
            query(env.DB, 'DELETE FROM live_sessions WHERE owner_id=?', memberId),
            query(env.DB, 'DELETE FROM live_recipients WHERE recipient_id=?', memberId),
            query(env.DB, 'DELETE FROM auth_sessions WHERE member_id=?', memberId),
            query(env.DB, 'DELETE FROM auth_credentials WHERE member_id=?', memberId),
          ]);
          return json({ revoked: true });
        }
        if (url.pathname === '/api/contacts' && request.method === 'GET') return json({ contacts: await peers(env.DB, member.id) });
        if (url.pathname === '/api/contacts' && request.method === 'POST') {
          await throttle(env.DB, member.id, 'contact', 1000, time);
          const body = await readBody(request, 1000);
          if (typeof body.userId !== 'string' || body.userId === member.id) throw new HttpError(400, '相手の共有用IDを確認してください。');
          const recipient = await query(env.DB, "SELECT id FROM app_members WHERE id=? AND status='active'", body.userId).first();
          if (!recipient) throw new HttpError(400, '共有用IDを確認できません。相手へ確認してください。');
          await query(env.DB, `INSERT INTO contacts (requester,recipient,status) SELECT ?,?,'pending'
            WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE requester=? AND recipient=? AND status IN ('pending','accepted'))
            ON CONFLICT(requester,recipient) DO UPDATE SET status='pending',version=contacts.version+1 WHERE contacts.status='revoked'`,
          member.id, recipient.id, recipient.id, member.id).run();
          return json({ requested: true });
        }
        const contactId = /^\/api\/contacts\/([a-f0-9-]{36})$/.exec(url.pathname)?.[1];
        if (contactId && request.method === 'PUT') {
          const result = await query(env.DB, `UPDATE contacts SET status='accepted',version=version+1
            WHERE requester=? AND recipient=? AND status='pending'`, contactId, member.id).run();
          if (!result.meta.changes) throw new HttpError(409, '承認待ちの共有申請がありません。');
          return json({ accepted: true });
        }
        if (contactId && request.method === 'DELETE') {
          await env.DB.batch([
            query(env.DB, "UPDATE contacts SET status='revoked',version=version+1 WHERE (requester=? AND recipient=?) OR (requester=? AND recipient=?)", member.id, contactId, contactId, member.id),
            query(env.DB, 'DELETE FROM spot_grants WHERE (owner_id=? AND recipient_id=?) OR (owner_id=? AND recipient_id=?)', member.id, contactId, contactId, member.id),
            query(env.DB, 'DELETE FROM live_recipients WHERE (recipient_id=? AND session_id IN (SELECT session_id FROM live_sessions WHERE owner_id=?)) OR (recipient_id=? AND session_id IN (SELECT session_id FROM live_sessions WHERE owner_id=?))', member.id, contactId, contactId, member.id),
          ]);
          return json({ removed: true });
        }
        if (url.pathname === '/api/spots' && request.method === 'GET') return json({ spots: await readShared(env.DB, member), serverNow: time, validUntil: time + 15000 });
        const spotId = /^\/api\/spots\/([a-fA-F0-9-]{36})$/.exec(url.pathname)?.[1];
        if (spotId && request.method === 'GET') {
          const row = await query(env.DB, 'SELECT revision,deleted FROM shared_spots WHERE owner_id=? AND spot_id=?', member.id, spotId).first();
          return json(row ? { revision: row.revision, deleted: Boolean(row.deleted) } : { revision: 0, deleted: true });
        }
        if (spotId && ['PUT', 'DELETE'].includes(request.method)) {
          await throttle(env.DB, member.id, 'spot-write', 200, time);
          return json(await writeShared(env.DB, member, spotId, await readBody(request), time, request.method === 'DELETE'));
        }
        if (url.pathname === '/api/live/start' && request.method === 'POST') {
          await throttle(env.DB, member.id, 'start-live', 1000, time);
          return json(await startLive(env.DB, member, (await readBody(request, 4000)).recipients, time));
        }
        if (url.pathname === '/api/live/pulse' && request.method === 'POST') {
          await throttle(env.DB, member.id, 'pulse', 4500, time);
          return json(await pulseLive(env.DB, member, await readBody(request, 2000), time));
        }
        if (url.pathname === '/api/live/stop' && request.method === 'POST') {
          const body = await readBody(request, 1000);
          await query(env.DB, 'DELETE FROM live_sessions WHERE owner_id=? AND session_id=?', member.id, body.sessionId || '').run();
          return json({ stopped: true });
        }
        throw new HttpError(404, 'この操作は利用できません。');
      } catch (error) {
        if (error instanceof HttpError && error.status === 401 && request.method === 'GET' && new URL(request.url).pathname === '/') return loginPage();
        if (error instanceof HttpError) return json({ message: error.message }, error.status);
        // DBの容量制限・設定不備でも、公開アクセスや課金へ切り替えない。内部エラーに座標やSQLを出さない。
        return json({ message: '処理できませんでした。無料枠の上限または設定を管理者に確認してください。' }, 503);
      }
    },
    async scheduled(_event, env) {
      const time = now();
      await env.DB.batch([query(env.DB, 'DELETE FROM live_sessions WHERE expires_at<=?', time),
        query(env.DB, 'DELETE FROM rate_limits WHERE expires_at<=?', time),
        query(env.DB, 'DELETE FROM auth_challenges WHERE expires_at<=?', time),
        query(env.DB, 'DELETE FROM device_enrollments WHERE expires_at<=?', time),
        query(env.DB, 'DELETE FROM auth_sessions WHERE expires_at<=?', time)]);
    },
  };
}

export default createHandler();

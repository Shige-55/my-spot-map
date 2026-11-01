import { HttpError } from './auth.js';

export const query = (db, sql, ...values) => db.prepare(sql).bind(...values);
export const active = (alias) => `${alias}.status = 'active'`;
export const connection = (left, right) => `EXISTS (SELECT 1 FROM contacts c WHERE c.status = 'accepted'
  AND ((c.requester = ${left} AND c.recipient = ${right}) OR (c.recipient = ${left} AND c.requester = ${right})))`;

export async function digest(value) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function identifyMember(db, identity) {
  const member = await query(db, 'SELECT * FROM app_members WHERE email = ?', identity.email).first();
  if (!member || member.status === 'revoked' || (member.subject && member.subject !== identity.subject)) {
    throw new HttpError(403, 'このアプリの利用招待がありません。管理者へ確認してください。');
  }
  if (member.status === 'invited' && member.invitation_expires && member.invitation_expires <= Date.now()) throw new HttpError(403, '利用招待の期限が切れています。');
  return member;
}

export async function requireCurrent(db, member) {
  const current = await query(db, "SELECT * FROM app_members WHERE id = ? AND status = 'active' AND version = ?", member.id, member.version).first();
  if (!current) throw new HttpError(403, '利用許可が取り消されています。');
  return current;
}

export async function throttle(db, memberId, action, interval, now) {
  const result = await query(db, `INSERT INTO rate_limits (key,expires_at) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET expires_at = excluded.expires_at WHERE rate_limits.expires_at <= ?`,
  `${memberId}:${action}`, now + interval, now).run();
  if (!result.meta.changes) throw new HttpError(429, '操作の間隔を空けて、もう一度お試しください。');
}

export async function peers(db, memberId) {
  return (await query(db, `SELECT m.id,m.name,c.requester,c.recipient,c.status FROM contacts c
    JOIN app_members m ON m.id = CASE WHEN c.requester = ? THEN c.recipient ELSE c.requester END
    WHERE (c.requester = ? OR c.recipient = ?) AND c.status <> 'revoked' AND m.status = 'active'`, memberId, memberId, memberId).all()).results;
}

export async function assertPeers(db, memberId, ids) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 49 || new Set(ids).size !== ids.length
    || ids.some((id) => typeof id !== 'string' || id === memberId)) throw new HttpError(400, '共有する相手を選んでください。');
  const accepted = (await peers(db, memberId)).filter((peer) => peer.status === 'accepted');
  if (ids.some((id) => !accepted.some((peer) => peer.id === id))) throw new HttpError(403, '承認されていない相手へは共有できません。');
}

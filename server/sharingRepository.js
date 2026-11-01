import { validateSpotInput } from '../src/domain/spot.js';
import { HttpError } from './auth.js';
import { assertPeers, connection, query } from './accessRepository.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const memberCurrent = `EXISTS (SELECT 1 FROM app_members actor WHERE actor.id = ? AND actor.status = 'active' AND actor.version = ?)`;

export async function readShared(db, member) {
  const rows = (await query(db, `SELECT s.*, m.name owner_name FROM shared_spots s
    JOIN app_members m ON m.id = s.owner_id AND m.status = 'active'
    WHERE s.deleted = 0 AND (s.owner_id = ? OR (EXISTS (SELECT 1 FROM spot_grants g
      WHERE g.owner_id=s.owner_id AND g.spot_id=s.spot_id AND g.recipient_id=?)
      AND ${connection('s.owner_id', '?')}))`, member.id, member.id, member.id, member.id).all()).results;
  const grants = (await query(db, 'SELECT spot_id,recipient_id FROM spot_grants WHERE owner_id = ?', member.id).all()).results;
  return rows.map((row) => ({ ownerId: row.owner_id, ownerName: row.owner_name, spotId: row.spot_id,
    spot: validateSpotInput(JSON.parse(row.payload)), revision: row.revision,
    updatedAt: row.updated_at, recipients: row.owner_id === member.id ? grants.filter((g) => g.spot_id === row.spot_id).map((g) => g.recipient_id) : [] }));
}

export async function writeShared(db, member, spotId, body, now, removing = false) {
  if (!uuid.test(spotId) || !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) throw new HttpError(400, '地点IDまたは更新番号が正しくありません。');
  let spot = {};
  if (!removing) {
    try { spot = validateSpotInput(body.spot); } catch { throw new HttpError(400, '共有する地点の入力が正しくありません。'); }
    await assertPeers(db, member.id, body.recipients);
  }
  if (body.operationId !== undefined && !uuid.test(body.operationId)) throw new HttpError(400, '共有操作IDが正しくありません。');
  const operation = body.operationId || globalThis.crypto.randomUUID();
  const repeated = async () => {
    const row = await query(db, `SELECT revision,deleted,operation_id FROM shared_spots WHERE owner_id=? AND spot_id=? AND ${memberCurrent}`,
      member.id, spotId, member.id, member.version).first();
    if (!row || row.operation_id !== operation || Boolean(row.deleted) !== removing) return null;
    const recipients = (await query(db, 'SELECT recipient_id FROM spot_grants WHERE owner_id=? AND spot_id=?', member.id, spotId).all()).results.map((item) => item.recipient_id);
    return { revision: row.revision, recipients, deleted: removing };
  };
  const previous = await repeated();
  if (previous) return previous;
  const revision = body.expectedRevision + 1;
  const statements = [
    query(db, `INSERT OR IGNORE INTO shared_spots (owner_id,spot_id,payload,revision,operation_id,deleted,updated_at)
      SELECT ?,?,'{}',0,'',1,? WHERE ${memberCurrent}`, member.id, spotId, now, member.id, member.version),
    query(db, `UPDATE shared_spots SET payload=?,revision=revision+1,operation_id=?,deleted=?,updated_at=?
      WHERE owner_id=? AND spot_id=? AND revision=? AND ${memberCurrent}`, JSON.stringify(spot), operation, removing ? 1 : 0,
    now, member.id, spotId, body.expectedRevision, member.id, member.version),
    query(db, `DELETE FROM spot_grants WHERE owner_id=? AND spot_id=? AND EXISTS
      (SELECT 1 FROM shared_spots s WHERE s.owner_id=? AND s.spot_id=? AND s.operation_id=?)`, member.id, spotId, member.id, spotId, operation),
  ];
  if (!removing) for (const recipient of body.recipients) {
    // 相手の取消と競合した場合はNOT NULL制約でbatch全体をロールバックする。
    statements.push(query(db, `INSERT INTO spot_grants (owner_id,spot_id,recipient_id)
      SELECT ?,?,(SELECT m.id FROM app_members m WHERE m.id=? AND m.status='active' AND ${connection('?', 'm.id')})
      WHERE EXISTS (SELECT 1 FROM shared_spots s WHERE s.owner_id=? AND s.spot_id=? AND s.operation_id=?)`,
    member.id, spotId, recipient, member.id, member.id, member.id, spotId, operation));
  }
  const results = await db.batch(statements);
  if (!results[1].meta.changes) {
    const retry = await repeated();
    if (retry) return retry;
    throw new HttpError(409, '共有内容が別の操作で変わりました。最新の共有一覧を確認してください。');
  }
  return { revision, recipients: removing ? [] : [...body.recipients], deleted: removing };
}

function readableLiveSql() {
  return `SELECT other.owner_id,other.position,other.position_at,other.expires_at,m.name
    FROM live_sessions mine JOIN live_sessions other ON other.owner_id <> mine.owner_id
    JOIN app_members m ON m.id=other.owner_id AND m.status='active'
    WHERE mine.owner_id=? AND mine.session_id=? AND mine.expires_at>? AND other.expires_at>?
      AND ${connection('mine.owner_id', 'other.owner_id')}
      AND EXISTS (SELECT 1 FROM live_recipients r WHERE r.session_id=mine.session_id AND r.recipient_id=other.owner_id)
      AND EXISTS (SELECT 1 FROM live_recipients r WHERE r.session_id=other.session_id AND r.recipient_id=mine.owner_id)`;
}

export async function startLive(db, member, recipients, now) {
  await assertPeers(db, member.id, recipients);
  const sessionId = globalThis.crypto.randomUUID();
  const statements = [
    query(db, 'DELETE FROM live_sessions WHERE owner_id=?', member.id),
    query(db, `INSERT INTO live_sessions (owner_id,session_id,expires_at) SELECT ?,?,? WHERE ${memberCurrent}`,
      member.id, sessionId, now + 15000, member.id, member.version),
  ];
  for (const recipient of recipients) statements.push(query(db, `INSERT INTO live_recipients (session_id,recipient_id)
    VALUES (?,(SELECT m.id FROM app_members m WHERE m.id=? AND m.status='active' AND ${connection('?', 'm.id')}))`, sessionId, recipient, member.id, member.id));
  await db.batch(statements);
  return { sessionId, expiresAt: now + 15000 };
}

export async function pulseLive(db, member, body, now) {
  if (!uuid.test(body.sessionId || '')) throw new HttpError(400, '共有セッションが正しくありません。');
  const result = await query(db, `UPDATE live_sessions SET expires_at=? WHERE owner_id=? AND session_id=? AND expires_at>?
    AND ${memberCurrent}`, now + 15000, member.id, body.sessionId, now, member.id, member.version).run();
  if (!result.meta.changes) throw new HttpError(409, '現在地共有が終了しました。開始し直してください。');
  let eligible = (await query(db, readableLiveSql(), member.id, body.sessionId, now, now).all()).results;
  if (body.position && eligible.length) {
    const p = body.position;
    if (!Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180
      || !Number.isFinite(p.accuracy) || p.accuracy < 0 || p.accuracy > 1000000 || !Number.isFinite(p.ageMs) || p.ageMs < 0 || p.ageMs > 30000) throw new HttpError(400, '現在地の取得結果が正しくありません。');
    await query(db, `UPDATE live_sessions SET position=?,position_at=?,last_position_at=? WHERE owner_id=? AND session_id=?
      AND last_position_at<=? AND expires_at>? AND ${memberCurrent}
      AND EXISTS (SELECT 1 FROM live_sessions partner WHERE partner.owner_id<>? AND partner.expires_at>?
        AND ${connection('?', 'partner.owner_id')}
        AND EXISTS (SELECT 1 FROM live_recipients r WHERE r.session_id=? AND r.recipient_id=partner.owner_id)
        AND EXISTS (SELECT 1 FROM live_recipients r WHERE r.session_id=partner.session_id AND r.recipient_id=?))`,
    JSON.stringify({ latitude: p.latitude, longitude: p.longitude, accuracy: p.accuracy }), now - p.ageMs, now,
    member.id, body.sessionId, now - 4500, now, member.id, member.version, member.id, now, member.id, member.id, body.sessionId, member.id).run();
  }
  // 最後の読取でも条件を再評価する。相手が消えている場合は古い座標を返さない。
  eligible = (await query(db, readableLiveSql(), member.id, body.sessionId, now, now).all()).results;
  return { serverNow: now, expiresAt: now + 15000, eligibleCount: eligible.length,
    positions: eligible.filter((row) => row.position && row.position_at > now - 30000).map((row) => ({
      userId: row.owner_id, name: row.name, ...JSON.parse(row.position),
      capturedAt: row.position_at, expiresAt: Math.min(row.expires_at, row.position_at + 30000, now + 15000),
    })) };
}

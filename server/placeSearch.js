import { HttpError } from './auth.js';
import { digest, query, requireCurrent, throttle } from './accessRepository.js';

const DAY_LIMIT = 200, CACHE_MS = 7 * 86400000, GAP_MS = 1500;

function searchText(value) {
  if (typeof value !== 'string' || [...value].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127)) throw new HttpError(400, '住所・施設名を2〜120文字で入力してください。');
  const text = value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
  if ([...text].length < 2 || [...text].length > 120) throw new HttpError(400, '住所・施設名を2〜120文字で入力してください。');
  return text;
}

function results(value) {
  if (!Array.isArray(value) || value.length > 5) throw new Error('invalid results');
  return value.map((row) => {
    if (!row || typeof row.display_name !== 'string' || !row.display_name.trim() || [...row.display_name].length > 600
      || typeof row.lat !== 'string' || typeof row.lon !== 'string' || !/^-?\d+(\.\d+)?$/.test(row.lat) || !/^-?\d+(\.\d+)?$/.test(row.lon)) throw new Error('invalid result');
    const latitude = Number(row.lat), longitude = Number(row.lon);
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new Error('invalid coordinates');
    return { label: row.display_name, latitude, longitude, zoom: 16 };
  });
}

async function responseJson(response) {
  if (!response.ok || !response.headers.get('Content-Type')?.includes('json')) throw new Error('search unavailable');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    length += value.byteLength;
    if (length > 32768) { await reader.cancel(); throw new Error('large response'); }
    chunks.push(value);
  }
  const buffer = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer));
}

export async function searchPlaces({ env, member, body, now = () => Date.now(), fetchGeocoder = globalThis.fetch }) {
  if (env.PLACE_SEARCH_ENABLED !== 'true') throw new HttpError(503, '住所・施設名検索は現在停止しています。地図を動かして場所を選んでください。');
  const text = searchText(body.query), time = now();
  // 利用者の連打とキャッシュへの過大なアクセスも抑える。
  await throttle(env.DB, member.id, 'place-search', 1500, time);
  let endpoint;
  try {
    endpoint = new URL(env.PLACE_SEARCH_URL);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error();
  } catch { throw new HttpError(503, '住所・施設名検索の設定を確認してください。'); }
  const key = await digest(endpoint.href + '\nja\n' + text.toLowerCase());
  const cached = await query(env.DB, 'SELECT payload FROM place_search_cache WHERE cache_key=? AND expires_at>?', key, time).first();
  if (cached) {
    await requireCurrent(env.DB, member);
    return { results: JSON.parse(cached.payload) };
  }
  const reservedAt = now(), day = new Date(reservedAt).toISOString().slice(0, 10);
  // D1の単一UPDATEで、別Worker・別利用者の競合も含めて全体の通信枠を確保する。
  const reservation = await query(env.DB, `UPDATE place_search_gate SET next_at=?,lease_until=?,day=?,
    requests=CASE WHEN day=? THEN requests+1 ELSE 1 END
    WHERE id=1 AND next_at<=? AND lease_until<=? AND (day<>? OR requests<?)`,
  reservedAt + GAP_MS, reservedAt + 15000, day, day, reservedAt, reservedAt, day, DAY_LIMIT).run();
  if (!reservation.meta.changes) {
    const gate = await query(env.DB, 'SELECT day,requests FROM place_search_gate WHERE id=1').first();
    throw new HttpError(429, gate?.day === day && gate.requests >= DAY_LIMIT
      ? '本日の住所・施設名検索は上限に達しました。日付が変わってからお試しください（UTC基準）。'
      : '他の検索を処理中です。少し間隔を空けて、検索ボタンを押してください。');
  }
  try {
    if (now() - reservedAt > 6000) throw new Error('expired reservation');
    endpoint.searchParams.set('q', text); endpoint.searchParams.set('format', 'jsonv2');
    endpoint.searchParams.set('limit', '5'); endpoint.searchParams.set('accept-language', 'ja');
    // Cookie・利用者情報・現在地・保存地点・元リクエストのヘッダーを外部へ渡さない。
    const response = await fetchGeocoder(endpoint.href, { headers: { Accept: 'application/json',
      'User-Agent': `MySpotMap/1.0 (+${env.APP_ORIGIN}/; https://github.com/Shige-55/my-spot-map)` },
    redirect: 'error', signal: globalThis.AbortSignal.timeout(8000) });
    const found = results(await responseJson(response));
    await query(env.DB, `INSERT INTO place_search_cache(cache_key,payload,expires_at) VALUES(?,?,?)
      ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at`, key, JSON.stringify(found), now() + CACHE_MS).run();
    await requireCurrent(env.DB, member);
    return { results: found };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, '住所・施設名を検索できませんでした。時間を空けて検索し直すか、地図を動かして選んでください。');
  } finally {
    // 応答の完了後にも間隔を取り、同時実行・自動再試行・時間枠境界の連続送信を防ぐ。
    await query(env.DB, 'UPDATE place_search_gate SET lease_until=0,next_at=MAX(next_at,?) WHERE id=1 AND lease_until=?', now() + GAP_MS, reservedAt + 15000).run();
  }
}

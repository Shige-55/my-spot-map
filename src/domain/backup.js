import { validateSpotInput } from './spot.js';

export const BACKUP_APP = 'MySpotMap';
export const BACKUP_VERSION = 1;
export const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_BACKUP_RECORDS = 10000;

export class BackupValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackupValidationError';
    this.stage = 'validation';
  }
}

export class BackupConflictError extends Error {
  constructor() {
    super('確認後に保存内容が変更されました。もう一度ファイルを検証してから復元してください。');
    this.name = 'BackupConflictError';
    this.stage = 'conflict';
  }
}

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const own = (value, key) => Object.hasOwn(value, key);
const invalid = (message) => { throw new BackupValidationError(message); };

export function validateUtcDate(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    invalid(`${label}は実在するUTC日時（例: 2026-10-31T12:00:00.000Z）にしてください。`);
  }
  return value;
}

export function validateBackupSpots(spots, { maxRecords = MAX_BACKUP_RECORDS, resetSyncStatus = false } = {}) {
  if (!Array.isArray(spots)) invalid('spotsは地点の配列にしてください。');
  if (spots.length > maxRecords) invalid('復元できる地点は削除記録を含めて10,000件までです。');
  const ids = new Set();
  return Array.from(spots, (record, index) => {
    const label = `${index + 1}件目`;
    if (!object(record)) invalid(`${label}の地点形式が正しくありません。`);
    const required = ['id', 'name', 'latitude', 'longitude', 'zoom', 'memo', 'category', 'createdAt', 'updatedAt', 'deletedAt', 'syncStatus'];
    if (required.some((key) => !own(record, key) || record[key] === undefined)) invalid(`${label}に必須項目がありません。`);
    if (typeof record.id !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(record.id)) {
      invalid(`${label}のUUID形式が正しくありません。`);
    }
    const identity = record.id.toLowerCase();
    if (ids.has(identity)) invalid(`${label}のUUIDが重複しています。`);
    ids.add(identity);
    let data;
    try { data = validateSpotInput(record); }
    catch (error) { invalid(`${label}: ${error.message}`); }
    const createdAt = validateUtcDate(record.createdAt, `${label}の作成日時`);
    const updatedAt = validateUtcDate(record.updatedAt, `${label}の更新日時`);
    if (createdAt > updatedAt) invalid(`${label}の更新日時が作成日時より前になっています。`);
    const deletedAt = record.deletedAt === null ? null : validateUtcDate(record.deletedAt, `${label}の削除日時`);
    if (deletedAt !== null && (deletedAt < createdAt || deletedAt > updatedAt)) {
      invalid(`${label}の削除日時は作成日時から更新日時までの範囲にしてください。`);
    }
    if (!['pending', 'synced'].includes(record.syncStatus)) invalid(`${label}の同期状態が正しくありません。`);
    // 未知のフィールドやプロトタイプを引き継がず、既知の項目だけで組み立てる。
    return { id: record.id, ...data, createdAt, updatedAt, deletedAt,
      syncStatus: resetSyncStatus ? 'pending' : record.syncStatus };
  });
}

export function parseBackupText(text) {
  if (typeof text !== 'string') invalid('JSONテキストを読み込めません。');
  if (text.length > MAX_BACKUP_BYTES || new globalThis.TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) {
    invalid('復元ファイルは10MiBまでです。');
  }
  let payload;
  try { payload = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { invalid('JSONの構文が正しくありません。'); }
  if (!object(payload) || !own(payload, 'app') || payload.app !== BACKUP_APP) invalid('MySpotMapのバックアップではありません。');
  if (!own(payload, 'schemaVersion') || payload.schemaVersion !== BACKUP_VERSION) invalid('このバックアップのバージョンには対応していません。');
  if (!own(payload, 'exportedAt') || !own(payload, 'spots')) invalid('バックアップに必須項目がありません。');
  return {
    app: BACKUP_APP, schemaVersion: BACKUP_VERSION,
    exportedAt: validateUtcDate(payload.exportedAt, '書き出し日時'),
    spots: validateBackupSpots(payload.spots, { resetSyncStatus: true }),
  };
}

export function countSpots(spots) {
  const deleted = spots.filter((spot) => spot.deletedAt !== null).length;
  return { total: spots.length, active: spots.length - deleted, deleted };
}

// 確認後の別タブ編集も置換直前に検出する。プロパティ順・配列順には依存しない。
export function snapshotSpots(spots) {
  return JSON.stringify([...spots].sort((a, b) => a.id.localeCompare(b.id))
    .map((spot) => Object.keys(spot).sort().map((key) => [key, spot[key]])));
}

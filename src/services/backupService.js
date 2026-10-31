import {
  BACKUP_APP, BACKUP_VERSION, MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS,
  BackupConflictError, BackupValidationError, countSpots, parseBackupText,
  snapshotSpots, validateBackupSpots, validateUtcDate,
} from '../domain/backup.js';

function failure(stage, message, cause) {
  const error = new Error(message, { cause });
  error.stage = stage;
  return error;
}

export function createBackupService(repository, { now = () => new Date().toISOString() } = {}) {
  const prepared = new WeakMap();
  let restoring = false;
  const readAll = async () => {
    try { return await repository.exportAll(); }
    catch (error) { throw failure('read', '保存中の地点を読み込めませんでした。ブラウザの保存設定を確認して、もう一度試してください。', error); }
  };
  return {
    async exportBackup() {
      const all = await readAll();
      // 全件を書き出す。復元上限を超えた場合もバックアップ自体は取得できる。
      const spots = validateBackupSpots(all, { maxRecords: Infinity });
      const exportedAt = validateUtcDate(now(), '書き出し日時');
      const text = JSON.stringify({ app: BACKUP_APP, schemaVersion: BACKUP_VERSION, exportedAt, spots }, null, 2);
      const bytes = new globalThis.TextEncoder().encode(text).byteLength;
      return {
        text, filename: `my-spot-map-backup-${exportedAt.replace(/[:.]/g, '-')}.json`,
        counts: countSpots(spots),
        exceedsRestoreLimit: bytes > MAX_BACKUP_BYTES || spots.length > MAX_BACKUP_RECORDS,
      };
    },
    async prepareRestore(file) {
      if (!file || !Number.isInteger(file.size) || file.size < 0 || typeof file.arrayBuffer !== 'function') {
        throw failure('read', '復元するJSONファイルを選択してください。');
      }
      if (file.size > MAX_BACKUP_BYTES) throw new BackupValidationError('復元ファイルは10MiBまでです。');
      let text;
      try {
        const buffer = await file.arrayBuffer();
        if (buffer.byteLength > MAX_BACKUP_BYTES) throw new BackupValidationError('復元ファイルは10MiBまでです。');
        text = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch (error) {
        if (error instanceof BackupValidationError) throw error;
        throw failure('read', 'UTF-8のJSONファイルを読み込めませんでした。ファイルを選び直してください。', error);
      }
      const payload = parseBackupText(text);
      const current = await readAll();
      const preview = Object.freeze({
        filename: typeof file.name === 'string' ? file.name : '選択したファイル',
        exportedAt: payload.exportedAt,
        incoming: Object.freeze(countSpots(payload.spots)),
        current: Object.freeze(countSpots(current)),
      });
      prepared.set(preview, { spots: payload.spots, snapshot: snapshotSpots(current) });
      return preview;
    },
    async restore(preview, { confirmed = false } = {}) {
      if (!confirmed) throw new BackupValidationError('全件置換の内容を確認してから復元してください。');
      const plan = prepared.get(preview);
      if (!plan) throw new BackupValidationError('復元するファイルをもう一度検証してください。');
      if (restoring) throw failure('write', '復元処理中です。完了までお待ちください。');
      restoring = true;
      try {
        const spots = await repository.replaceAll(plan.spots, { expectedSnapshot: plan.snapshot });
        prepared.delete(preview);
        return { spots, counts: countSpots(spots) };
      } catch (error) {
        if (error instanceof BackupConflictError) { prepared.delete(preview); throw error; }
        if (error instanceof BackupValidationError) throw error;
        throw failure('write', '復元を書き込めませんでした。保存内容は変更していません。空き容量やブラウザの保存設定を確認して、もう一度試してください。', error);
      } finally { restoring = false; }
    },
    discard(preview) { if (preview) prepared.delete(preview); },
  };
}

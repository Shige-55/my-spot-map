import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBackupService } from '../../src/services/backupService.js';
import { BackupConflictError, MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS, snapshotSpots } from '../../src/domain/backup.js';
import { testBackup, testId, testSpot } from '../fixtures/backup.js';

const file = (payload = testBackup()) => new globalThis.File([JSON.stringify(payload)], '架空のバックアップ.json', { type: 'application/json' });
let repository;
let service;
beforeEach(() => {
  repository = { exportAll: vi.fn().mockResolvedValue([testSpot()]), replaceAll: vi.fn(async (spots) => spots) };
  service = createBackupService(repository, { now: () => '2026-10-31T02:00:00.000Z' });
});

describe('バックアップサービス', () => {
  it('全件と削除記録を含むバージョン付きJSONを書き出す', async () => {
    const all = [testSpot(), testSpot({ id: testId(2), deletedAt: '2026-10-31T01:00:00.000Z', syncStatus: 'synced' })];
    repository.exportAll.mockResolvedValue(all);
    const backup = await service.exportBackup();
    expect(JSON.parse(backup.text)).toEqual(testBackup(all));
    expect(backup.filename).toBe('my-spot-map-backup-2026-10-31T02-00-00-000Z.json');
    expect(backup.counts).toEqual({ total: 2, active: 1, deleted: 1 });
    expect(backup.exceedsRestoreLimit).toBe(false);
  });
  it('復元件数上限を超えても全件を書き出し、上限超過を通知する', async () => {
    repository.exportAll.mockResolvedValue(Array.from({ length: MAX_BACKUP_RECORDS + 1 }, (_, index) => testSpot({ id: testId(index + 1) })));
    const backup = await service.exportBackup();
    expect(JSON.parse(backup.text).spots).toHaveLength(MAX_BACKUP_RECORDS + 1);
    expect(backup.exceedsRestoreLimit).toBe(true);
  });
  it('全件検証後の件数だけを確認用に返し、この時点では書き込まない', async () => {
    const preview = await service.prepareRestore(file(testBackup([])));
    expect(preview.incoming).toEqual({ total: 0, active: 0, deleted: 0 });
    expect(preview.current).toEqual({ total: 1, active: 1, deleted: 0 });
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview.incoming)).toBe(true);
    expect(preview.spots).toBeUndefined();
    expect(repository.replaceAll).not.toHaveBeenCalled();
  });
  it('明示確認なし・偽の確認結果・キャンセル後の復元を拒否する', async () => {
    const preview = await service.prepareRestore(file());
    await expect(service.restore(preview)).rejects.toThrow('確認');
    await expect(service.restore({ ...preview }, { confirmed: true })).rejects.toThrow('もう一度検証');
    service.discard(preview);
    await expect(service.restore(preview, { confirmed: true })).rejects.toThrow('もう一度検証');
    expect(repository.replaceAll).not.toHaveBeenCalled();
  });
  it('検証済み内容と現在のスナップショットを渡し、成功した確認結果を再利用させない', async () => {
    const source = testSpot({ syncStatus: 'synced' });
    const preview = await service.prepareRestore(file(testBackup([source])));
    const result = await service.restore(preview, { confirmed: true });
    expect(result.spots).toEqual([{ ...source, syncStatus: 'pending' }]);
    expect(repository.replaceAll).toHaveBeenCalledWith(result.spots, { expectedSnapshot: snapshotSpots([testSpot()]) });
    await expect(service.restore(preview, { confirmed: true })).rejects.toThrow('もう一度検証');
    expect(repository.replaceAll).toHaveBeenCalledTimes(1);
  });
  it('ファイル読込・UTF-8・JSON検証の失敗を区別し、不正時はDBを呼ばない', async () => {
    await expect(service.prepareRestore(undefined)).rejects.toMatchObject({ stage: 'read' });
    await expect(service.prepareRestore({ size: 1, arrayBuffer: async () => { throw new Error('架空の読み込み失敗'); } })).rejects.toMatchObject({ stage: 'read' });
    await expect(service.prepareRestore(new globalThis.File([new Uint8Array([0xff])], '不正UTF8.json'))).rejects.toMatchObject({ stage: 'read' });
    await expect(service.prepareRestore(new globalThis.File(['{'], '構文不正.json'))).rejects.toMatchObject({ stage: 'validation' });
    await expect(service.prepareRestore(file(testBackup([], { schemaVersion: 9 })))).rejects.toMatchObject({ stage: 'validation' });
    expect(repository.exportAll).not.toHaveBeenCalled();
    expect(repository.replaceAll).not.toHaveBeenCalled();
  });
  it('大きいファイルは読み込む前に拒否する', async () => {
    const arrayBuffer = vi.fn();
    await expect(service.prepareRestore({ size: MAX_BACKUP_BYTES + 1, arrayBuffer })).rejects.toThrow('10MiB');
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
  it('現在のDBを読めない場合は確認画面へ進めず、保存内容を変更しない', async () => {
    repository.exportAll.mockRejectedValue(new Error('架空のDB読み込み失敗'));
    await expect(service.prepareRestore(file())).rejects.toMatchObject({ stage: 'read' });
    await expect(service.exportBackup()).rejects.toMatchObject({ stage: 'read' });
    expect(repository.replaceAll).not.toHaveBeenCalled();
  });
  it('書込失敗は確認内容を保持して再試行できる', async () => {
    repository.replaceAll.mockRejectedValueOnce(new Error('架空の容量不足'));
    const preview = await service.prepareRestore(file());
    await expect(service.restore(preview, { confirmed: true })).rejects.toMatchObject({ stage: 'write' });
    await expect(service.restore(preview, { confirmed: true })).resolves.toHaveProperty('counts.total', 1);
  });
  it('確認後のDB変更は再検証を要求する', async () => {
    repository.replaceAll.mockRejectedValueOnce(new BackupConflictError());
    const preview = await service.prepareRestore(file());
    await expect(service.restore(preview, { confirmed: true })).rejects.toMatchObject({ stage: 'conflict' });
    await expect(service.restore(preview, { confirmed: true })).rejects.toThrow('もう一度検証');
  });
  it('復元中の二重呼び出しを拒否する', async () => {
    let finish;
    repository.replaceAll.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const preview = await service.prepareRestore(file());
    const first = service.restore(preview, { confirmed: true });
    await expect(service.restore(preview, { confirmed: true })).rejects.toThrow('処理中');
    finish([testSpot()]);
    await first;
    expect(repository.replaceAll).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import {
  BackupValidationError, MAX_BACKUP_BYTES, MAX_BACKUP_RECORDS,
  countSpots, parseBackupText, snapshotSpots, validateBackupSpots,
} from '../../src/domain/backup.js';
import { testBackup, testId, testSpot } from '../fixtures/backup.js';

const parse = (spots, overrides) => parseBackupText(JSON.stringify(testBackup(spots, overrides)));

describe('バックアップの全件検証', () => {
  it('UUID・日時・削除記録を保持し、同期状態だけをpendingに正規化する', () => {
    const source = testSpot({ syncStatus: 'synced', deletedAt: '2026-10-31T00:30:00.000Z' });
    expect(parse([source]).spots).toEqual([{ ...source, syncStatus: 'pending' }]);
    expect(source.syncStatus).toBe('synced');
  });
  it('未知フィールドと__proto__を取り込まない', () => {
    const data = JSON.parse(JSON.stringify(testBackup()));
    data.extra = '未知';
    data.spots[0].extra = { nested: '引き継がない' };
    Object.defineProperty(data.spots[0], '__proto__', { value: { polluted: true }, enumerable: true });
    const result = parseBackupText(JSON.stringify(data));
    expect(Object.keys(result)).toEqual(['app', 'schemaVersion', 'exportedAt', 'spots']);
    expect(result.spots[0]).toEqual(testSpot());
    expect(Object.hasOwn(result.spots[0], '__proto__')).toBe(false);
    expect({}.polluted).toBeUndefined();
  });
  it('空のバックアップとUTF-8 BOMを受け付ける', () => {
    expect(parseBackupText('\uFEFF' + JSON.stringify(testBackup([]))).spots).toEqual([]);
  });
  it.each([null, [], 1, 'MySpotMap', {}, { app: '別アプリ' }, { app: 'MySpotMap', schemaVersion: 99 },
    testBackup([], { schemaVersion: '1' }), testBackup([], { exportedAt: null })])('不正なルート・バージョン・日時を拒否: %s', (payload) => {
    expect(() => parseBackupText(JSON.stringify(payload))).toThrow(BackupValidationError);
  });
  it.each(['{', '', 'undefined', '{"app": "MySpotMap",}'])('不正なJSON構文を拒否: %s', (text) => {
    expect(() => parseBackupText(text)).toThrow(BackupValidationError);
  });
  it.each(['app', 'schemaVersion', 'exportedAt', 'spots'])('ルート必須項目%sの欠落を拒否する', (field) => {
    const data = testBackup();
    delete data[field];
    expect(() => parseBackupText(JSON.stringify(data))).toThrow(BackupValidationError);
  });
  it.each(['id', 'name', 'memo', 'category', 'latitude', 'longitude', 'zoom', 'createdAt', 'updatedAt', 'deletedAt', 'syncStatus'])('地点の必須項目%sの欠落を拒否する', (field) => {
    const spot = testSpot();
    delete spot[field];
    expect(() => parse([spot])).toThrow(BackupValidationError);
  });
  it.each([
    { id: '不正ID' }, { id: 1 }, { name: ' ' }, { name: '🌳'.repeat(101) },
    { memo: '🌳'.repeat(2001) }, { memo: null }, { category: '🌳'.repeat(51) }, { category: [] },
    { latitude: '35.6' }, { latitude: 90.1 }, { longitude: -180.1 }, { zoom: 1.1 },
    { createdAt: '2026-02-30T00:00:00.000Z' }, { createdAt: '2026-10-31T09:00:00.000+09:00' },
    { createdAt: '2026-10-32T00:00:00.000Z' }, { updatedAt: '2026-10-30T00:00:00.000Z' },
    { deletedAt: false }, { deletedAt: '2026-10-30T00:00:00.000Z' }, { deletedAt: '2026-10-31T01:01:00.000Z' },
    { syncStatus: 'unknown' }, { syncStatus: 1 },
  ])('不正な地点を拒否: %s', (patch) => {
    expect(() => parse([testSpot(patch)])).toThrow(BackupValidationError);
  });
  it('JSONで1e999と書かれた非有限数を拒否する', () => {
    const text = JSON.stringify(testBackup()).replace('"latitude":35.6', '"latitude":1e999');
    expect(() => parseBackupText(text)).toThrow(BackupValidationError);
  });
  it('Unicode文字数と座標・倍率の境界値を受け付ける', () => {
    expect(parse([testSpot({ name: '🌳'.repeat(100), memo: '🌳'.repeat(2000), category: '🌳'.repeat(50), latitude: -90, longitude: 180, zoom: 0 })]).spots).toHaveLength(1);
    expect(parse([testSpot({ latitude: 90, longitude: -180, zoom: 19 })]).spots).toHaveLength(1);
  });
  it('大小文字だけ異なるUUIDも重複として拒否する', () => {
    const id = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    expect(() => parse([testSpot({ id }), testSpot({ id: id.toUpperCase() })])).toThrow('重複');
  });
  it('最後の地点が不正でも全体を拒否し、途中結果を返さない', () => {
    expect(() => parse([testSpot(), testSpot({ id: testId(2), name: '' })])).toThrow('2件目');
  });
  it('配列以外や空要素を拒否する', () => {
    expect(() => parse(null)).toThrow(BackupValidationError);
    expect(() => validateBackupSpots(new Array(1))).toThrow(BackupValidationError);
  });
  it('10,000件を受理し、10,001件を拒否する', () => {
    const spots = Array.from({ length: MAX_BACKUP_RECORDS }, (_, index) => testSpot({ id: testId(index + 1) }));
    expect(parse(spots).spots).toHaveLength(MAX_BACKUP_RECORDS);
    expect(() => parse([...spots, testSpot({ id: testId(MAX_BACKUP_RECORDS + 1) })])).toThrow('10,000件');
  });
  it('10MiBまで受理し、UTF-8バイト数で超過を検出する', () => {
    const text = JSON.stringify(testBackup([]));
    const limit = text + ' '.repeat(MAX_BACKUP_BYTES - new globalThis.TextEncoder().encode(text).byteLength);
    expect(parseBackupText(limit).spots).toEqual([]);
    expect(() => parseBackupText(limit + ' ')).toThrow('10MiB');
    const multibyte = JSON.stringify(testBackup([], { unknown: 'あ'.repeat(Math.floor(MAX_BACKUP_BYTES / 3)) }));
    expect(multibyte.length).toBeLessThan(MAX_BACKUP_BYTES);
    expect(() => parseBackupText(multibyte)).toThrow('10MiB');
  });
  it('端末時計のずれを許容し、書き出し日時より新しい更新日時も保持する', () => {
    expect(parse([testSpot()], { exportedAt: '2026-10-30T00:00:00.000Z' }).spots).toHaveLength(1);
  });
  it('有効・削除件数を数え、スナップショットは配列・項目順に依存しない', () => {
    const a = testSpot();
    const b = testSpot({ id: testId(2), deletedAt: '2026-10-31T01:00:00.000Z' });
    expect(countSpots([a, b])).toEqual({ total: 2, active: 1, deleted: 1 });
    const reordered = Object.fromEntries(Object.entries(a).reverse());
    expect(snapshotSpots([a, b])).toBe(snapshotSpots([b, reordered]));
    expect(snapshotSpots([a])).not.toBe(snapshotSpots([{ ...a, memo: '変化' }]));
  });
});

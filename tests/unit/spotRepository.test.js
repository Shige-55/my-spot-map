import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../../src/db/database.js';
import { createSpotRepository } from '../../src/repositories/spotRepository.js';
import { SpotNotFoundError, SpotValidationError } from '../../src/domain/spot.js';
import { createSpotService } from '../../src/services/spotService.js';
import { BackupConflictError, snapshotSpots } from '../../src/domain/backup.js';
import { testId, testSpot } from '../fixtures/backup.js';

const input = { name: '架空の広場', memo: '架空のテスト地点', latitude: 35.6, longitude: 139.7, zoom: 13 };
let db;
let repository;
let name;
beforeEach(() => {
  name = `my-spot-map-test-${globalThis.crypto.randomUUID()}`;
  db = createDatabase(name);
  repository = createSpotRepository(db);
});
afterEach(async () => {
  vi.restoreAllMocks();
  db.close();
  await Dexie.delete(name);
});

describe('地点Repository', () => {
  it('exportAllは削除記録を含めて独立したコピーを返す', async () => {
    await repository.create(input);
    const deleted = await repository.create(input);
    await repository.softDelete(deleted.id);
    const result = await repository.exportAll();
    expect(result).toHaveLength(2);
    expect(result.find((spot) => spot.id === deleted.id).deletedAt).not.toBeNull();
    result[0].name = 'コピーだけの変更';
    expect((await repository.exportAll())[0].name).toBe(input.name);
  });
  it('全件置換はID・日時・削除記録を保ち、再接続後も一致する', async () => {
    await repository.create(input);
    const records = [testSpot({ syncStatus: 'synced' }), testSpot({ id: testId(2), deletedAt: '2026-10-31T01:00:00.000Z' })];
    const replaced = await repository.replaceAll(records);
    expect(replaced).toEqual(records.map((spot) => ({ ...spot, syncStatus: 'pending' })));
    db.close();
    db = createDatabase(name);
    repository = createSpotRepository(db);
    expect(await repository.exportAll()).toEqual(replaced);
    expect(await repository.list()).toHaveLength(1);
  });
  it('空の配列での明示的な全件置換に対応する', async () => {
    await repository.create(input);
    expect(await repository.replaceAll([])).toEqual([]);
    expect(await repository.exportAll()).toEqual([]);
  });
  it('全件検証が失敗した場合はclearより前に止める', async () => {
    const original = await repository.create(input);
    const clear = vi.spyOn(db.spots, 'clear');
    await expect(repository.replaceAll([testSpot(), testSpot({ id: testId(2), longitude: 999 })])).rejects.toThrow('2件目');
    expect(clear).not.toHaveBeenCalled();
    expect(await repository.exportAll()).toEqual([original]);
  });
  it('clear後に一部の登録が成功してから失敗しても、全レコードをロールバックする', async () => {
    await repository.create(input);
    const deleted = await repository.create(input);
    await repository.softDelete(deleted.id);
    const original = await repository.exportAll();
    const bulkAdd = db.spots.bulkAdd.bind(db.spots);
    vi.spyOn(db.spots, 'bulkAdd').mockImplementationOnce(async (spots) => {
      await bulkAdd([spots[0]]);
      throw new Error('途中の書込失敗を模擬');
    });
    await expect(repository.replaceAll([testSpot(), testSpot({ id: testId(2) })])).rejects.toThrow('途中の書込失敗');
    expect(await repository.exportAll()).toEqual(original);
    await repository.replaceAll([testSpot()]);
    expect(await repository.exportAll()).toEqual([testSpot()]);
  });
  it('確認後の変更を同じtransaction内で検出し、全件置換しない', async () => {
    const original = await repository.create(input);
    const snapshot = snapshotSpots(await repository.exportAll());
    await repository.update(original.id, { memo: '別タブの編集に相当する変更' });
    const current = await repository.exportAll();
    await expect(repository.replaceAll([testSpot()], { expectedSnapshot: snapshot })).rejects.toBeInstanceOf(BackupConflictError);
    expect(await repository.exportAll()).toEqual(current);
    await repository.replaceAll([testSpot()], { expectedSnapshot: snapshotSpots(current) });
    expect(await repository.exportAll()).toEqual([testSpot()]);
  });
  it('検索とカテゴリをANDで適用し、削除記録を除外して再接続後も一致する', async () => {
    const cafe = await repository.create({ ...input, name: '架空Ｃａｆｅ', category: '飲食' });
    await repository.create({ ...input, name: '別の架空地点', memo: 'Cafe', category: '買い物' });
    const deleted = await repository.create({ ...input, name: 'Cafe削除済み', category: '飲食' });
    await repository.softDelete(deleted.id);
    db.close();
    db = createDatabase(name);
    repository = createSpotRepository(db);
    expect(await repository.list({ query: '　CAFE　', category: '飲食' })).toEqual([cafe]);
    expect(await repository.list({ query: 'Cafe', category: '' })).toEqual([]);
    expect(await db.spots.count()).toBe(3);
  });
  it('UUIDとUTC日時を生成し、再接続後も保存内容が残る', async () => {
    const spot = await repository.create({ ...input, id: '偽ID', syncStatus: 'synced', deletedAt: '不正' });
    expect(spot.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(spot.createdAt).toMatch(/Z$/);
    expect(spot).toMatchObject({ deletedAt: null, syncStatus: 'pending', updatedAt: spot.createdAt });
    db.close();
    db = createDatabase(name);
    repository = createSpotRepository(db);
    expect(await repository.get(spot.id)).toEqual(spot);
    const copy = await repository.get(spot.id);
    copy.name = '変更してもDBに波及しない';
    expect((await repository.get(spot.id)).name).toBe(input.name);
  });
  it('更新日時降順、同時刻はID順で一覧を返す', async () => {
    let id = 2;
    const sorted = createSpotRepository(db, { now: () => '2026-10-31T00:00:00.000Z', createId: () => String(id--) });
    const first = await sorted.create(input);
    const second = await sorted.create(input);
    expect((await sorted.list()).map((spot) => spot.id)).toEqual([second.id, first.id]);
    await sorted.update(first.id, { name: '更新した地点' });
    expect((await sorted.list())[0].id).toBe(first.id);
  });
  it('編集はID・作成日時を保持し、時刻が戻っても更新日時は進む', async () => {
    let date = '2026-10-31T01:00:00.000Z';
    const timed = createSpotRepository(db, { now: () => date });
    const spot = await timed.create(input);
    await db.spots.update(spot.id, { syncStatus: 'synced' });
    date = '2026-10-30T00:00:00.000Z';
    const updated = await timed.update(spot.id, { name: '改名', latitude: 36, memo: '変更' });
    expect(updated).toMatchObject({ id: spot.id, createdAt: spot.createdAt, name: '改名', latitude: 36, memo: '変更', syncStatus: 'pending' });
    expect(updated.updatedAt > spot.updatedAt).toBe(true);
  });
  it.each(['id', 'createdAt', 'updatedAt', 'deletedAt', 'syncStatus', 'unknown'])('編集で%sを書き換えられない', async (key) => {
    const spot = await repository.create(input);
    await expect(repository.update(spot.id, { [key]: '改ざん' })).rejects.toBeInstanceOf(SpotValidationError);
    expect(await repository.get(spot.id)).toEqual(spot);
  });
  it('削除記録を保持し、一覧・getから除外、削除済みの編集・再削除を拒否', async () => {
    const spot = await repository.create(input);
    await db.spots.update(spot.id, { syncStatus: 'synced' });
    const deleted = await repository.softDelete(spot.id);
    expect(deleted).toMatchObject({ id: spot.id, createdAt: spot.createdAt, syncStatus: 'pending', deletedAt: deleted.updatedAt });
    expect(await db.spots.get(spot.id)).toEqual(deleted);
    expect(await repository.list()).toEqual([]);
    expect(await repository.get(spot.id)).toBeNull();
    await expect(repository.update(spot.id, { name: '復活' })).rejects.toBeInstanceOf(SpotNotFoundError);
    await expect(repository.softDelete(spot.id)).rejects.toBeInstanceOf(SpotNotFoundError);
    db.close();
    db = createDatabase(name);
    expect(await db.spots.get(spot.id)).toEqual(deleted);
  });
  it('存在しない地点を編集・削除して新規作成しない', async () => {
    await expect(repository.update('missing', { name: '架空' })).rejects.toBeInstanceOf(SpotNotFoundError);
    await expect(repository.softDelete('missing')).rejects.toBeInstanceOf(SpotNotFoundError);
    expect(await db.spots.count()).toBe(0);
  });
  it('不正な作成・編集では既存データを変えない', async () => {
    const spot = await repository.create(input);
    await expect(repository.create({ ...input, latitude: NaN })).rejects.toBeInstanceOf(SpotValidationError);
    await expect(repository.update(spot.id, { longitude: 181 })).rejects.toBeInstanceOf(SpotValidationError);
    expect(await db.spots.toArray()).toEqual([spot]);
  });
  it('同時編集を単一トランザクションで順に処理し、各項目の更新を保持', async () => {
    const spot = await repository.create(input);
    await Promise.all([repository.update(spot.id, { name: '新しい名前' }), repository.update(spot.id, { memo: '新しいメモ' })]);
    expect(await repository.get(spot.id)).toMatchObject({ name: '新しい名前', memo: '新しいメモ' });
  });
  it('作成の途中失敗はロールバックし、再試行しても重複しない', async () => {
    await db.open();
    const add = db.spots.add.bind(db.spots);
    vi.spyOn(db.spots, 'add').mockImplementationOnce(async (spot) => {
      await add(spot);
      throw new Error('容量不足を模擬');
    });
    await expect(repository.create(input)).rejects.toThrow('容量不足');
    expect(await db.spots.count()).toBe(0);
    await repository.create(input);
    expect(await db.spots.count()).toBe(1);
  });
  it.each(['update', 'softDelete'])('%sの途中失敗でも元のレコードを保持', async (action) => {
    const spot = await repository.create(input);
    const put = db.spots.put.bind(db.spots);
    vi.spyOn(db.spots, 'put').mockImplementationOnce(async (value) => {
      await put(value);
      throw new Error('書き込み失敗を模擬');
    });
    await expect(repository[action](spot.id, { name: '変更' })).rejects.toThrow('書き込み失敗');
    expect(await repository.get(spot.id)).toEqual(spot);
  });
});

describe('初期DBスキーマと移行', () => {
  async function legacy() {
    db.close();
    const old = new Dexie(name);
    old.version(0.1).stores({ spots: 'id' });
    await old.open();
    const record = { ...input, category: '', id: globalThis.crypto.randomUUID(), createdAt: '2026-10-30T00:00:00.000Z',
      updatedAt: '2026-10-30T00:00:00.000Z', deletedAt: null, syncStatus: 'pending' };
    await old.spots.add(record);
    old.close();
    return record;
  }
  it('既存レコードを消さずにversion 1の索引を追加できる', async () => {
    const record = await legacy();
    db = createDatabase(name);
    await db.open();
    expect(db.verno).toBe(1);
    expect(db.spots.schema.indexes.map((index) => index.name)).toEqual(['updatedAt', 'category']);
    expect(await db.spots.toArray()).toEqual([record]);
  });
  it('移行中のエラーでも既存レコードと旧バージョンを保持する', async () => {
    const record = await legacy();
    db = createDatabase(name);
    db.version(1).upgrade(() => { throw new Error('移行失敗を模擬'); });
    await expect(db.open()).rejects.toThrow('移行失敗');
    db.close();
    db = new Dexie(name);
    db.version(0.1).stores({ spots: 'id' });
    await db.open();
    expect(db.verno).toBe(0.1);
    expect(await db.spots.toArray()).toEqual([record]);
  });
});

describe('地点サービスのエラー', () => {
  it('保存失敗を日本語化し、再試行の呼び出しを妨げない', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('QuotaExceededError')).mockResolvedValueOnce({ id: '架空' });
    const service = createSpotService({ create });
    await expect(service.create(input)).rejects.toThrow('入力は残っています');
    expect(await service.create(input)).toEqual({ id: '架空' });
  });
  it('入力エラーは項目情報を保持する', async () => {
    const service = createSpotService(repository);
    await expect(service.create({ ...input, name: '' })).rejects.toMatchObject({ fields: { name: expect.any(String) } });
  });
});

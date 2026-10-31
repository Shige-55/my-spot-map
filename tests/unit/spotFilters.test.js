import { describe, expect, it } from 'vitest';
import { filterSpots, normalizeSearch } from '../../src/domain/spot.js';

const spot = (id, name, memo, category, deletedAt = null) => ({
  id, name, memo, category, deletedAt, updatedAt: `2026-10-31T00:00:0${id}.000Z`,
});
const spots = [spot('1', '架空のＣａｆｅ', 'ｶﾌｪ 静かな場所', '飲食'),
  spot('2', '架空の書店', 'Cafeのとなり', '買い物'),
  spot('3', '架空の公園', '静かな場所', ''),
  spot('4', '削除済みCafe', '静かな場所', '飲食', '2026-10-31T01:00:00.000Z')];

describe('検索とカテゴリ', () => {
  it('前後空白・NFKC・英字大小を正規化する', () => {
    expect(normalizeSearch('　ＣＡＦＥ ｶﾌｪ　')).toBe('cafe カフェ');
  });
  it('名前とメモを部分一致で検索し、削除済みを含めない', () => {
    expect(filterSpots(spots, { query: '　cAfE　' }).map((spot) => spot.id)).toEqual(['2', '1']);
    expect(filterSpots(spots, { query: 'カフェ' }).map((spot) => spot.id)).toEqual(['1']);
    expect(filterSpots(spots, { query: '静かな' }).map((spot) => spot.id)).toEqual(['3', '1']);
  });
  it('空欄・空白だけなら有効地点を全件返す', () => {
    expect(filterSpots(spots, { query: '　 ' }).map((spot) => spot.id)).toEqual(['3', '2', '1']);
  });
  it('検索とカテゴリはAND、未設定と全件を区別する', () => {
    expect(filterSpots(spots, { query: 'cafe', category: '飲食' }).map((spot) => spot.id)).toEqual(['1']);
    expect(filterSpots(spots, { query: 'cafe', category: '' })).toEqual([]);
    expect(filterSpots(spots, { category: '' }).map((spot) => spot.id)).toEqual(['3']);
  });
  it('カテゴリ名自体は完全一致で比較し、特殊な文字列も区別する', () => {
    const data = [spot('1', '架空A', '', '未分類'), spot('2', '架空B', '', ''), spot('3', '架空C', '', '__all__')];
    expect(filterSpots(data, { category: '未分類' }).map((spot) => spot.id)).toEqual(['1']);
    expect(filterSpots(data, { category: '__all__' }).map((spot) => spot.id)).toEqual(['3']);
  });
  it('HTMLや記号を正規表現・HTMLとして解釈しない', () => {
    expect(filterSpots(spots, { query: '.*' })).toEqual([]);
    expect(filterSpots(spots, { query: '<script>' })).toEqual([]);
  });
  it('元の配列・地点を変更しない', () => {
    const original = globalThis.structuredClone(spots);
    const result = filterSpots(spots);
    result[0].name = '結果だけ変更';
    expect(spots).toEqual(original);
  });
});

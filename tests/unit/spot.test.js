import { describe, expect, it } from 'vitest';
import { SpotValidationError, validateSpotInput } from '../../src/domain/spot.js';

const input = { name: ' 架空の広場 ', memo: '', latitude: 35.6, longitude: 139.7, zoom: 13 };

describe('地点の入力検証', () => {
  it('前後空白を除き、未指定のメモとカテゴリを補完する', () => {
    expect(validateSpotInput({ ...input, memo: undefined })).toEqual({
      name: '架空の広場', memo: '', category: '', latitude: 35.6, longitude: 139.7, zoom: 13,
    });
  });
  it('Unicodeコードポイントの上限を適用し、座標の境界値を受け入れる', () => {
    expect(validateSpotInput({ ...input, name: '🌳'.repeat(100), memo: '🌳'.repeat(2000),
      category: '🌳'.repeat(50), latitude: -90, longitude: 180, zoom: 0 }).name).toHaveLength(200);
    expect(validateSpotInput({ ...input, latitude: 90, longitude: -180, zoom: 19 }).zoom).toBe(19);
  });
  it.each([
    ['name', '  '], ['name', '🌳'.repeat(101)], ['name', 123],
    ['memo', '🌳'.repeat(2001)], ['memo', {}],
    ['category', '🌳'.repeat(51)], ['category', null],
    ['latitude', -90.01], ['latitude', 90.01], ['latitude', NaN], ['latitude', '35.6'],
    ['longitude', -180.01], ['longitude', 180.01], ['longitude', Infinity],
    ['zoom', -1], ['zoom', 20], ['zoom', 1.1], ['zoom', '13'],
  ])('%sの不正値を拒否する', (key, value) => {
    try {
      validateSpotInput({ ...input, [key]: value });
      expect.fail('不正入力が受理されました');
    } catch (error) {
      expect(error).toBeInstanceOf(SpotValidationError);
      expect(error.fields).toHaveProperty(key);
    }
  });
  it.each([null, undefined, [], '地点'])('オブジェクト以外の入力を拒否する: %s', (value) => {
    expect(() => validateSpotInput(value)).toThrow(SpotValidationError);
  });
});

import { describe, expect, test } from 'vitest';
import { assertPublishTarget, loadPagesTarget, resolvePagesTarget } from '../../build/pagesConfig.js';

describe('Pages公開先', () => {
  test('指定した公開先・main・サブパスを使う', () => {
    expect(loadPagesTarget()).toMatchObject({ fullName: 'Shige-55/my-spot-map', branch: 'main',
      base: '/my-spot-map/', ref: 'refs/heads/main', siteUrl: 'https://shige-55.github.io/my-spot-map/' });
  });
  test('ユーザーサイトはルートで公開する', () => {
    expect(resolvePagesTarget({ owner: 'Example', repository: 'example.github.io', branch: 'main' }).base).toBe('/');
  });
  test.each([null, {}, { owner: 'a/b', repository: 'map', branch: 'main' },
    { owner: 'example', repository: '../backup', branch: 'main' },
    { owner: 'example', repository: 'map', branch: '../main' }])('不正な設定を拒否する: %j', (config) => {
    expect(() => resolvePagesTarget(config)).toThrow();
  });
  test('公開時は指定リポジトリの指定ブランチだけ許可する', () => {
    const target = loadPagesTarget();
    expect(() => assertPublishTarget(target, { repository: 'shige-55/MY-SPOT-MAP', ref: 'refs/heads/main' })).not.toThrow();
    for (const input of [{ repository: 'someone/my-spot-map', ref: target.ref },
      { repository: target.fullName, ref: 'refs/heads/master' }, { repository: target.fullName, ref: 'refs/pull/1/merge' }]) {
      expect(() => assertPublishTarget(target, input)).toThrow('一致しません');
    }
  });
});

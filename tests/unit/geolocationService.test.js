import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCurrentLocation } from '../../src/services/geolocationService.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('現在地の1回取得', () => {
  it('getCurrentPositionだけを呼び、座標と精度を返す', async () => {
    const coords = { latitude: 35.68, longitude: 139.76, accuracy: 24 };
    const geolocation = { getCurrentPosition: vi.fn((success) => success({ coords })), watchPosition: vi.fn() };
    await expect(getCurrentLocation({ geolocation, secure: true })).resolves.toEqual(coords);
    expect(geolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(geolocation.getCurrentPosition.mock.calls[0][2]).toEqual({ enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([[1, '許可'], [2, '取得できません'], [3, 'タイムアウト'], [99, '取得できません']])('コード%sを日本語で案内する', async (code, text) => {
    const geolocation = { getCurrentPosition: (_, fail) => fail({ code }) };
    await expect(getCurrentLocation({ geolocation, secure: true })).rejects.toThrow(text);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('非対応・安全でないコンテキストはAPIを呼ぶ前に案内する', async () => {
    await expect(getCurrentLocation({ geolocation: null, secure: true })).rejects.toThrow('対応していません');
    const geolocation = { getCurrentPosition: vi.fn() };
    await expect(getCurrentLocation({ geolocation, secure: false })).rejects.toThrow('HTTPS');
    expect(geolocation.getCurrentPosition).not.toHaveBeenCalled();
  });
  it('応答がない場合も10秒で打ち切り、遅れた成功結果を無視する', async () => {
    let success;
    const geolocation = { getCurrentPosition: (callback) => { success = callback; } };
    const result = getCurrentLocation({ geolocation, secure: true });
    const rejection = expect(result).rejects.toThrow('タイムアウト');
    await vi.advanceTimersByTimeAsync(10000);
    await rejection;
    success({ coords: { latitude: 35, longitude: 139, accuracy: 10 } });
    await expect(result).rejects.toThrow('タイムアウト');
  });
  it.each([
    { latitude: NaN, longitude: 139, accuracy: 10 },
    { latitude: 91, longitude: 139, accuracy: 10 },
    { latitude: 35, longitude: 181, accuracy: 10 },
    { latitude: 35, longitude: 139, accuracy: -1 },
  ])('不正な結果は表示層へ渡さない: %s', async (coords) => {
    const geolocation = { getCurrentPosition: (success) => success({ coords }) };
    await expect(getCurrentLocation({ geolocation, secure: true })).rejects.toThrow('正しくありません');
  });
  it('APIの同期例外でも取得中のままにならない', async () => {
    const geolocation = { getCurrentPosition: () => { throw new Error('架空の例外'); } };
    await expect(getCurrentLocation({ geolocation, secure: true })).rejects.toThrow('取得できません');
    expect(vi.getTimerCount()).toBe(0);
  });
});

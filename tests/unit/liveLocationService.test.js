import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createLiveLocationService } from '../../src/sharing/liveLocationService.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test('相手待ちでは位置を取得・送信せず、停止後のコールバックも無視する', async () => {
  let visible = true, eligible = 0, callback;
  const bodies = [], states = [];
  const service = createLiveLocationService({ isVisible: () => visible, isOnline: () => true,
    geolocation: { getCurrentPosition: vi.fn((ok) => { callback = ok; }) }, onChange: (state) => states.push(state),
    api: async (path, options) => {
      if (path === 'live/start') return { sessionId: 'fixture' };
      if (path === 'live/stop') return {};
      bodies.push(options.body); return { eligibleCount: eligible, positions: [], serverNow: Date.now(), expiresAt: Date.now() + 15000 };
    } });
  await service.start(['peer']); expect(bodies[0].position).toBeUndefined(); expect(callback).toBeUndefined();
  eligible = 1; await vi.advanceTimersByTimeAsync(5000); expect(callback).toBeTypeOf('function');
  visible = false; await service.stop(); callback({ timestamp: Date.now(), coords: { latitude: 35, longitude: 139, accuracy: 20 } });
  await vi.advanceTimersByTimeAsync(10000);
  expect(service.state.status).toBe('off'); expect(bodies.every((body) => !body.position)).toBe(true);
  expect(states.at(-1).positions).toEqual([]);
});

test('開始応答が非表示後に届いても座標を送らず、セッションの停止を要求する', async () => {
  let resolve; let visible = true; const calls = [];
  const service = createLiveLocationService({ isVisible: () => visible, isOnline: () => true, geolocation: {},
    api: async (path) => { calls.push(path); if (path === 'live/start') return new Promise((done) => { resolve = done; }); return {}; } });
  const starting = service.start(['peer']); await Promise.resolve(); await Promise.resolve();
  visible = false; await service.stop(); resolve({ sessionId: 'late' }); await starting;
  expect(calls).toContain('live/stop'); expect(calls).not.toContain('live/pulse'); expect(service.state.status).toBe('off');
});

test('通信断では停止し、復帰だけでは再開しない', async () => {
  let online = true; const calls = [];
  const service = createLiveLocationService({ isVisible: () => true, isOnline: () => online, geolocation: {},
    api: async (path) => { calls.push(path); if (path === 'live/start') return { sessionId: 'fixture' };
      return { positions: [], eligibleCount: 0, serverNow: Date.now() }; } });
  await service.start(['peer']); online = false; await vi.advanceTimersByTimeAsync(5000);
  expect(service.state.status).toBe('off'); online = true; await vi.advanceTimersByTimeAsync(10000);
  expect(calls.filter((path) => path === 'live/start')).toHaveLength(1);
});

test('前の停止通知の失敗で新たに開始した共有を停止中と表示しない', async () => {
  let reject; let count = 0;
  const service = createLiveLocationService({ isVisible: () => true, isOnline: () => true, geolocation: {},
    api: async (path) => {
      if (path === 'live/start') return { sessionId: 'fixture-' + (++count) };
      if (path === 'live/stop') return new Promise((_resolve, fail) => { reject = fail; });
      return { positions: [], eligibleCount: 0, serverNow: Date.now() };
    } });
  await service.start(['peer']);
  const stopping = service.stop();
  await service.start(['peer']);
  expect(service.state.status).toBe('waiting');
  reject(new Error('古い停止通信の失敗')); await stopping;
  expect(service.state.status).toBe('waiting');
});

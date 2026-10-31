import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLongPressGesture } from '../../src/map/longPressGesture.js';

const point = (patch = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 100, clientY: 200, ...patch });
let gesture;
let hold;
beforeEach(() => {
  vi.useFakeTimers();
  hold = vi.fn();
  gesture = createLongPressGesture({ onLongPress: hold });
});
afterEach(() => { gesture.reset(); vi.useRealTimers(); });

describe('長押しジェスチャー', () => {
  it('599msでは開かず、600msで押し始めの座標を一度だけ返す', () => {
    gesture.down(point(), true);
    vi.advanceTimersByTime(599);
    expect(hold).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(hold).toHaveBeenCalledWith({ pointerId: 1, clientX: 100, clientY: 200 });
    vi.advanceTimersByTime(1000);
    expect(hold).toHaveBeenCalledTimes(1);
  });
  it('10px以内の揺れは許容し、10px超の移動後は元に戻っても開かない', () => {
    gesture.down(point(), true);
    gesture.move(point({ clientX: 110 }));
    vi.advanceTimersByTime(600);
    expect(hold).toHaveBeenCalledTimes(1);
    gesture.up(point());
    hold.mockClear();
    gesture.down(point(), true);
    gesture.move(point({ clientX: 108, clientY: 208 }));
    gesture.move(point());
    vi.advanceTimersByTime(600);
    expect(hold).not.toHaveBeenCalled();
  });
  it.each(['up', 'cancelPointer', 'cancel', 'reset'])('%sで待機を解除する', (action) => {
    gesture.down(point(), true);
    vi.advanceTimersByTime(300);
    gesture[action](point());
    vi.advanceTimersByTime(1000);
    expect(hold).not.toHaveBeenCalled();
  });
  it('2本目の指で解除し、片方を離しても全指を離すまで再開始しない', () => {
    gesture.down(point(), true);
    vi.advanceTimersByTime(400);
    gesture.down(point({ pointerId: 2, isPrimary: false }), true);
    gesture.up(point());
    vi.advanceTimersByTime(1000);
    expect(hold).not.toHaveBeenCalled();
    gesture.up(point({ pointerId: 2 }));
    gesture.down(point({ pointerId: 3 }), true);
    vi.advanceTimersByTime(600);
    expect(hold).toHaveBeenCalledTimes(1);
  });
  it('地図外で始まった指がある場合も複数指として扱う', () => {
    gesture.down(point(), false);
    gesture.down(point({ pointerId: 2 }), true);
    vi.advanceTimersByTime(600);
    expect(hold).not.toHaveBeenCalled();
  });
  it.each([{ button: 2 }, { isPrimary: false }])('右ボタンや非プライマリ接触を長押し登録しない: %s', (patch) => {
    gesture.down(point(patch), true);
    vi.advanceTimersByTime(600);
    expect(hold).not.toHaveBeenCalled();
  });
  it('タッチのcontextmenuは、キャンセル後・指を離した直後も抑止する', () => {
    gesture.down(point(), true);
    gesture.cancel();
    vi.advanceTimersByTime(2000);
    expect(gesture.suppressContextMenu()).toBe(true);
    gesture.up(point());
    expect(gesture.suppressContextMenu()).toBe(true);
    vi.advanceTimersByTime(1001);
    expect(gesture.suppressContextMenu()).toBe(false);
  });
  it('PCの通常の右クリックは抑止しない', () => {
    gesture.down(point({ pointerType: 'mouse', button: 2 }), true);
    expect(gesture.suppressContextMenu()).toBe(false);
  });
});

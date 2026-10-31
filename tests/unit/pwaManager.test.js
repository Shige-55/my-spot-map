import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPwaManager } from '../../src/pwa/pwaManager.js';

const scriptUrl = 'https://example.test/map/sw.js';
function target(properties = {}) { return Object.assign(new globalThis.EventTarget(), properties); }
function message(source, data) {
  const event = new globalThis.Event('message');
  Object.defineProperties(event, { source: { value: source }, data: { value: data } });
  return event;
}
function setup({ waiting = true, first = false } = {}) {
  const old = target({ scriptURL: scriptUrl, state: 'activated', postMessage: vi.fn() });
  const next = target({ scriptURL: scriptUrl, state: 'installed', postMessage: vi.fn() });
  const registration = target({ active: first ? null : old, waiting: waiting ? next : null, installing: null, update: vi.fn(async () => {}) });
  const serviceWorker = target({ controller: first ? null : old, register: vi.fn(async () => registration) });
  const canReload = vi.fn(() => true);
  const reload = vi.fn();
  const onChange = vi.fn();
  const onStatus = vi.fn();
  const manager = createPwaManager({ serviceWorker, scriptUrl, scope: 'https://example.test/map/', version: 'a', canReload, reload, onChange, onStatus });
  const activate = () => {
    registration.waiting = null;
    registration.active = next;
    serviceWorker.controller = next;
    serviceWorker.dispatchEvent(new globalThis.Event('controllerchange'));
  };
  return { manager, registration, serviceWorker, old, next, canReload, reload, onChange, onStatus, activate };
}
afterEach(() => vi.useRealTimers());

describe('PWAの更新同意と入力保護', () => {
  it('待機版は通知だけ行い、利用者操作後にだけ切り替えて再読み込みする', async () => {
    const app = setup();
    await app.manager.start();
    expect(app.next.postMessage).not.toHaveBeenCalled();
    expect(app.reload).not.toHaveBeenCalled();
    expect(app.manager.apply()).toBe(true);
    expect(app.next.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    app.activate();
    expect(app.reload).toHaveBeenCalledTimes(1);
    app.manager.destroy();
  });
  it('編集中・処理中は更新を受け付けない', async () => {
    const app = setup();
    await app.manager.start();
    app.canReload.mockReturnValue(false);
    expect(app.manager.apply()).toBe(false);
    expect(app.next.postMessage).not.toHaveBeenCalled();
    expect(app.reload).not.toHaveBeenCalled();
    app.manager.destroy();
  });
  it('更新操作後に新しい入力を始めた場合も、再読み込み直前に保護する', async () => {
    const app = setup();
    await app.manager.start();
    app.manager.apply();
    app.canReload.mockReturnValue(false);
    app.activate();
    expect(app.reload).not.toHaveBeenCalled();
    app.canReload.mockReturnValue(true);
    app.manager.apply();
    expect(app.reload).toHaveBeenCalledTimes(1);
    app.manager.destroy();
  });
  it('別タブで有効化されても自動再読み込みせず、同意を待つ', async () => {
    const app = setup();
    await app.manager.start();
    app.activate();
    expect(app.reload).not.toHaveBeenCalled();
    app.manager.apply();
    expect(app.reload).toHaveBeenCalledTimes(1);
    app.manager.destroy();
  });
  it('初回インストールでは自動再読み込みしない', async () => {
    const app = setup({ waiting: false, first: true });
    await app.manager.start();
    app.activate();
    expect(app.reload).not.toHaveBeenCalled();
    app.manager.destroy();
  });
  it('表示版と異なる有効版の通知を受けた場合も、同意後にだけ再読み込みする', async () => {
    const app = setup({ waiting: false });
    await app.manager.start();
    app.serviceWorker.dispatchEvent(message(app.old, { type: 'PWA_VERSION', version: 'b' }));
    expect(app.reload).not.toHaveBeenCalled();
    expect(app.manager.apply()).toBe(true);
    expect(app.reload).toHaveBeenCalledTimes(1);
    app.manager.destroy();
  });
  it('別scopeのWorkerからの通知は無視する', async () => {
    const app = setup({ waiting: false });
    await app.manager.start();
    app.serviceWorker.dispatchEvent(message({ scriptURL: 'https://example.test/other/sw.js' }, { type: 'PWA_VERSION', version: 'b' }));
    expect(app.manager.apply()).toBe(false);
    app.manager.destroy();
  });
  it('切り替え応答がなければ再試行でき、二重操作を防ぐ', async () => {
    vi.useFakeTimers();
    const app = setup();
    await app.manager.start();
    app.manager.apply();
    expect(app.manager.apply()).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    expect(app.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('確認できません'));
    expect(app.manager.apply()).toBe(true);
    app.manager.destroy();
  });
  it('登録・更新確認失敗でも勝手に再読み込みしない', async () => {
    const app = setup();
    app.serviceWorker.register.mockRejectedValueOnce(new Error('架空の登録失敗'));
    expect(await app.manager.start()).toBe(false);
    expect(app.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('準備ができません'));
    await app.manager.start();
    app.registration.update.mockRejectedValueOnce(new Error('架空の通信失敗'));
    await app.manager.check();
    expect(app.onStatus).toHaveBeenLastCalledWith(expect.stringContaining('更新を確認できません'));
    expect(app.reload).not.toHaveBeenCalled();
    app.manager.destroy();
  });
});

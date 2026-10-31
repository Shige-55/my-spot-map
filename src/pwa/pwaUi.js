import { createPwaManager } from './pwaManager.js';

export function createPwaUi({ root }) {
  const offline = root.querySelector('#offline-note');
  const banner = root.querySelector('#pwa-update');
  const message = root.querySelector('#pwa-update-message');
  const applyButton = root.querySelector('#apply-update');
  const checkButton = root.querySelector('#check-updates');
  const status = root.querySelector('#pwa-state');
  const events = new globalThis.AbortController();
  const options = { signal: events.signal };
  let state = { available: false, applying: false };
  let manager = null;
  let disposed = false;
  let checking = false;
  let lastCheck = 0;
  const canReload = () => !root.querySelector('dialog[open], [aria-busy="true"]')
    && !root.querySelector('#register-center').disabled;
  const render = () => {
    banner.hidden = !state.available;
    const blocked = !canReload();
    const disabled = blocked || state.applying;
    if (applyButton.disabled !== disabled) applyButton.disabled = disabled;
    message.textContent = state.applying ? '更新しています…'
      : blocked ? '更新版があります。入力を保存・キャンセルし、設定を閉じてから更新してください。'
        : '更新版を利用できます。';
  };
  const network = () => { offline.hidden = window.navigator.onLine; };
  const check = async (manual = false) => {
    if (!manager || checking) return;
    if (!window.navigator.onLine) {
      if (manual) status.textContent = 'オフラインのため更新を確認できません。オンラインで、もう一度試してください。';
      return;
    }
    if (!manual && Date.now() - lastCheck < 60000) return;
    checking = true;
    checkButton.disabled = true;
    lastCheck = Date.now();
    try { await manager.check(); }
    finally { if (!disposed) { checking = false; checkButton.disabled = false; } }
  };
  window.addEventListener('offline', network, options);
  window.addEventListener('online', () => { network(); void check(); }, options);
  window.addEventListener('focus', () => { void check(); }, options);
  root.addEventListener('visibilitychange', () => {
    if (root.visibilityState === 'visible') void check();
  }, options);
  const observer = new window.MutationObserver(render);
  observer.observe(root.body, { subtree: true, attributes: true, attributeFilter: ['open', 'aria-busy', 'disabled'] });
  applyButton.addEventListener('click', () => manager?.apply(), options);
  checkButton.addEventListener('click', () => { void check(true); }, options);
  network();
  render();
  if (import.meta.env.DEV) {
    status.textContent = '開発サーバーではオフライン機能は無効です。ビルド版で確認してください。';
  } else if (!window.isSecureContext || !('serviceWorker' in window.navigator)) {
    status.textContent = 'この環境ではオフライン機能を準備できません。対応ブラウザでHTTPS（開発時はlocalhost）のURLを開いてください。';
  } else {
    const scope = new URL(import.meta.env.BASE_URL, window.location.origin).href;
    manager = createPwaManager({
      serviceWorker: window.navigator.serviceWorker,
      scriptUrl: new URL('sw.js', scope).href,
      scope,
      version: root.querySelector('meta[name="app-version"]').content,
      canReload,
      reload: () => window.location.reload(),
      onChange: (next) => { state = next; render(); },
      onStatus: (text) => { status.textContent = text; },
    });
    void manager.start().then((registered) => { if (!disposed) checkButton.disabled = !registered; });
  }
  return {
    destroy() {
      disposed = true;
      events.abort();
      observer.disconnect();
      manager?.destroy();
    },
  };
}

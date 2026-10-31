export function createPwaManager({ serviceWorker, scriptUrl, scope, version, canReload, reload, onChange, onStatus }) {
  const events = new globalThis.AbortController();
  const options = { signal: events.signal };
  const workers = new Set();
  let registration = null;
  let previousController = serviceWorker.controller;
  let available = false;
  let applying = false;
  let activatedUpdate = false;
  let disposed = false;
  let reloading = false;
  let timeout;
  const ownWorker = (worker) => worker?.scriptURL === scriptUrl;
  const notify = () => onChange({ available, applying });
  const ready = () => {
    if (!available) onStatus('オフラインで地点を操作する準備ができました。背景地図の表示には通信が必要です。');
  };
  const found = () => {
    available = true;
    onStatus('更新版を利用できます。入力を保存・キャンセルし、設定を閉じてから「更新する」を押してください。');
    notify();
  };
  const reloadNow = () => {
    globalThis.clearTimeout(timeout);
    if (!canReload()) {
      applying = false;
      found();
      return;
    }
    reloading = true;
    try { reload(); }
    catch {
      reloading = false;
      applying = false;
      onStatus('画面を更新できませんでした。入力を保存してから、もう一度「更新する」を押してください。');
      notify();
    }
  };
  const track = (worker) => {
    if (!worker || workers.has(worker)) return;
    workers.add(worker);
    const changed = () => {
      if (disposed) return;
      if (worker.state === 'installed' && registration.active && worker !== registration.active) found();
      if (worker.state === 'activated') ready();
      if (worker.state === 'redundant') {
        onStatus('新しい版の準備に失敗しました。現在の画面はそのまま利用できます。オンラインで更新を確認してください。');
      }
    };
    worker.addEventListener('statechange', changed, options);
    changed();
  };
  serviceWorker.addEventListener('controllerchange', () => {
    const current = serviceWorker.controller;
    if (disposed || !ownWorker(current) || current === previousController) return;
    const updating = ownWorker(previousController);
    previousController = current;
    current.postMessage({ type: 'GET_VERSION' });
    if (updating) {
      activatedUpdate = true;
      if (applying) reloadNow();
      else found();
    } else ready();
  }, options);
  serviceWorker.addEventListener('message', (event) => {
    if (disposed || reloading || !ownWorker(event.source) || event.data?.type !== 'PWA_VERSION') return;
    if (event.data.version !== version) {
      activatedUpdate = event.source === serviceWorker.controller;
      found();
    } else ready();
  }, options);

  return {
    async start() {
      try {
        registration = await serviceWorker.register(scriptUrl, { scope, updateViaCache: 'none' });
        if (disposed) return false;
        registration.addEventListener('updatefound', () => track(registration.installing), options);
        track(registration.installing);
        if (registration.waiting) found();
        else if (registration.active?.state === 'activated') ready();
        serviceWorker.controller?.postMessage({ type: 'GET_VERSION' });
        return true;
      } catch {
        if (!disposed) onStatus('オフライン利用の準備ができませんでした。オンラインで画面を開き直してください。保存した地点は削除していません。');
        return false;
      }
    },
    async check() {
      if (!registration || disposed) return;
      try {
        await registration.update();
        if (!disposed) {
          track(registration.installing);
          if (registration.waiting) found();
          else if (!available) onStatus('更新を確認しました。新しい版があれば通知します。');
        }
      } catch {
        if (!disposed) onStatus('更新を確認できませんでした。オンラインで、もう一度試してください。現在の画面と保存地点はそのまま利用できます。');
      }
    },
    apply() {
      if (disposed || reloading || applying || !available || !canReload()) return false;
      applying = true;
      notify();
      if (activatedUpdate && !registration.waiting) { reloadNow(); return true; }
      if (!registration.waiting) { applying = false; notify(); return false; }
      timeout = globalThis.setTimeout(() => {
        applying = false;
        onStatus('更新の切り替えを確認できませんでした。入力を保存してから、もう一度試してください。');
        notify();
      }, 10000);
      registration.waiting.postMessage({ type: 'SKIP_WAITING' });
      return true;
    },
    destroy() {
      disposed = true;
      events.abort();
      globalThis.clearTimeout(timeout);
    },
  };
}

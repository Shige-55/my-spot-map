// ビルド時に同一originのアプリ資産だけを列挙する。タイルや利用者のJSONは扱わない。
const configuration = globalThis.__MY_SPOT_MAP_PRECACHE__;
const scope = new URL(configuration.base, globalThis.location.origin);
const prefix = `my-spot-map-shell:${encodeURIComponent(scope.pathname)}:`;
const cacheName = prefix + configuration.version;
const shellUrl = new URL('index.html', scope).href;
const assetUrls = configuration.assets.map((path) => new URL(path, scope).href);
const allowed = new Set(assetUrls);

globalThis.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await globalThis.caches.open(cacheName);
    try {
      await cache.addAll(assetUrls.map((url) => new globalThis.Request(url, { cache: 'reload', credentials: 'same-origin' })));
    } catch (error) {
      await globalThis.caches.delete(cacheName);
      throw error;
    }
    // 更新版のskipWaitingは、利用者が更新を選んだときだけ実行する。
  })());
});

globalThis.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await globalThis.caches.keys();
    await Promise.all(names.filter((name) => name.startsWith(prefix) && name !== cacheName)
      .map((name) => globalThis.caches.delete(name)));
    await globalThis.clients.claim();
    const clients = await globalThis.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of clients) {
      if (client.url.startsWith(scope.href)) client.postMessage({ type: 'PWA_VERSION', version: configuration.version });
    }
  })());
});

globalThis.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== scope.origin) return;
  const navigation = request.mode === 'navigate'
    && (url.pathname === scope.pathname || url.pathname === new URL(shellUrl).pathname);
  if (!navigation && !allowed.has(url.href)) return;
  const key = navigation ? shellUrl : request;
  event.respondWith((async () => {
    const cache = await globalThis.caches.open(cacheName);
    // 公開済みの静的資産は同一内容。配信サーバーのVary: Origin差で外れないようにする。
    const response = await cache.match(key, { ignoreVary: true });
    if (navigation && response?.redirected) {
      // index.html→/等を経たResponseをnavigateへ直接返すとERR_FAILEDになる。
      // 復号済み本文を合成Responseにし、転送履歴と元の圧縮サイズを引き継がない。
      const headers = new globalThis.Headers(response.headers);
      headers.delete('Content-Encoding'); headers.delete('Content-Length');
      return new globalThis.Response(response.body, { status: response.status, statusText: response.statusText, headers });
    }
    return response || globalThis.fetch(request);
  })());
});

globalThis.addEventListener('message', (event) => {
  if (!event.source?.url?.startsWith(scope.href)) return;
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(globalThis.skipWaiting());
  if (event.data?.type === 'GET_VERSION') {
    event.source.postMessage({ type: 'PWA_VERSION', version: configuration.version });
  }
});

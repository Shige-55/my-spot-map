// 修正前の、redirectedなキャッシュをnavigateへ返してしまう旧版を再現する固定fixture。
const configuration = globalThis.__MY_SPOT_MAP_PRECACHE__;
const scope = new URL(configuration.base, globalThis.location.origin);
const cacheName = `my-spot-map-shell:${encodeURIComponent(scope.pathname)}:legacy-${configuration.version}`;
const shell = new URL('index.html', scope).href;
const assets = configuration.assets.map((path) => new URL(path, scope).href);
globalThis.addEventListener('install', (event) => {
  event.waitUntil(globalThis.caches.open(cacheName).then((cache) => cache.addAll(assets)));
});
globalThis.addEventListener('activate', (event) => { event.waitUntil(globalThis.clients.claim()); });
globalThis.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const navigation = event.request.mode === 'navigate' && (url.pathname === '/' || url.pathname === '/index.html');
  if (event.request.method !== 'GET' || url.origin !== scope.origin || (!navigation && !assets.includes(url.href))) return;
  event.respondWith(globalThis.caches.open(cacheName).then(async (cache) => await cache.match(navigation ? shell : event.request) || globalThis.fetch(event.request)));
});
globalThis.addEventListener('message', (event) => {
  if (event.data?.type === 'GET_VERSION') event.source.postMessage({ type: 'PWA_VERSION', version: configuration.version });
});

import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = await readFile(new URL('../../src/pwa/service-worker.js', import.meta.url), 'utf8');
const base = 'https://example.test/map/';
const prefix = 'my-spot-map-shell:%2Fmap%2F:';

function worker({ failInstall = false } = {}) {
  const handlers = new Map();
  const stores = new Map();
  const added = [];
  const caches = {
    open: vi.fn(async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const contents = stores.get(name);
      return {
        async addAll(requests) {
          added.push(...requests);
          for (const request of requests) contents.set(request.url, new globalThis.Response('架空のアプリ資産'));
          if (failInstall) throw new Error('架空の通信失敗');
        },
        async match(key) { return contents.get(typeof key === 'string' ? key : key.url); },
      };
    }),
    keys: async () => [...stores.keys()],
    delete: vi.fn(async (name) => stores.delete(name)),
  };
  const client = { url: base, postMessage: vi.fn() };
  const outside = { url: 'https://example.test/other/', postMessage: vi.fn() };
  const env = {
    __MY_SPOT_MAP_PRECACHE__: { base: '/map/', version: 'new', assets: ['index.html', 'assets/main.js', 'manifest.webmanifest'] },
    location: { origin: 'https://example.test' },
    URL, Request: globalThis.Request, caches,
    fetch: vi.fn(async () => new globalThis.Response('ネットワーク')),
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}), matchAll: vi.fn(async () => [client, outside]) },
    indexedDB: { open: vi.fn(), deleteDatabase: vi.fn() },
    addEventListener: (name, handler) => handlers.set(name, handler),
  };
  runInNewContext(source, env);
  return {
    env, stores, added, client, outside,
    async dispatch(name, extra = {}) {
      const pending = [];
      let response;
      handlers.get(name)({ waitUntil: (promise) => pending.push(promise), respondWith: (promise) => { response = promise; }, ...extra });
      await Promise.all(pending);
      return response ? await response : undefined;
    },
  };
}

describe('Service Workerのキャッシュ境界', () => {
  it('列挙した同一origin資産だけを事前キャッシュし、自動でskipWaitingしない', async () => {
    const sw = worker();
    await sw.dispatch('install');
    expect(sw.added.map((request) => request.url)).toEqual([base + 'index.html', base + 'assets/main.js', base + 'manifest.webmanifest']);
    expect(sw.added.every((request) => request.cache === 'reload')).toBe(true);
    expect(sw.env.skipWaiting).not.toHaveBeenCalled();
  });
  it.each([
    ['https://tile.openstreetmap.org/13/1/1.png', 'GET', 'cors'],
    [base + 'my-spot-map-backup-test.json', 'GET', 'navigate'],
    ['https://example.test/other/', 'GET', 'navigate'],
    [base + 'api', 'POST', 'cors'],
    [base + 'assets/unknown.js', 'GET', 'cors'],
  ])('対象外の通信を横取りしない: %s', async (url, method, mode) => {
    const sw = worker();
    expect(await sw.dispatch('fetch', { request: { url, method, mode } })).toBeUndefined();
    expect(sw.env.caches.open).not.toHaveBeenCalled();
    expect(sw.env.fetch).not.toHaveBeenCalled();
  });
  it('アプリURLの再起動とJS資産はキャッシュから返す', async () => {
    const sw = worker();
    await sw.dispatch('install');
    const html = await sw.dispatch('fetch', { request: { url: base + '?view=list', method: 'GET', mode: 'navigate' } });
    expect(await html.text()).toBe('架空のアプリ資産');
    const js = await sw.dispatch('fetch', { request: { url: base + 'assets/main.js', method: 'GET', mode: 'cors' } });
    expect(await js.text()).toBe('架空のアプリ資産');
    expect(sw.env.fetch).not.toHaveBeenCalled();
  });
  it('インストール失敗で新キャッシュだけを破棄し、旧版を保持する', async () => {
    const sw = worker({ failInstall: true });
    sw.stores.set(prefix + 'old', new Map());
    await expect(sw.dispatch('install')).rejects.toThrow('通信失敗');
    expect([...sw.stores.keys()]).toEqual([prefix + 'old']);
    expect(sw.env.skipWaiting).not.toHaveBeenCalled();
  });
  it('旧シェルの整理は同じbase内に限定し、IndexedDBに触れない', async () => {
    const sw = worker();
    sw.stores.set(prefix + 'old', new Map());
    sw.stores.set('my-spot-map-shell:%2Fother%2F:old', new Map());
    sw.stores.set('別アプリのキャッシュ', new Map());
    await sw.dispatch('install');
    await sw.dispatch('activate');
    expect([...sw.stores.keys()]).toEqual(['my-spot-map-shell:%2Fother%2F:old', '別アプリのキャッシュ', prefix + 'new']);
    expect(sw.env.indexedDB.open).not.toHaveBeenCalled();
    expect(sw.env.indexedDB.deleteDatabase).not.toHaveBeenCalled();
    expect(sw.client.postMessage).toHaveBeenCalledWith({ type: 'PWA_VERSION', version: 'new' });
    expect(sw.outside.postMessage).not.toHaveBeenCalled();
  });
  it('同じscopeの利用者操作メッセージでだけskipWaitingする', async () => {
    const sw = worker();
    await sw.dispatch('message', { source: sw.outside, data: { type: 'SKIP_WAITING' } });
    await sw.dispatch('message', { source: sw.client, data: { type: 'unknown' } });
    expect(sw.env.skipWaiting).not.toHaveBeenCalled();
    await sw.dispatch('message', { source: sw.client, data: { type: 'SKIP_WAITING' } });
    expect(sw.env.skipWaiting).toHaveBeenCalledTimes(1);
    await sw.dispatch('message', { source: sw.client, data: { type: 'GET_VERSION' } });
    expect(sw.client.postMessage).toHaveBeenCalledWith({ type: 'PWA_VERSION', version: 'new' });
  });
});

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const publicAssets = [
  'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png',
];

export function pwaPlugin() {
  let config;
  return {
    name: 'my-spot-map-pwa',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) { config = resolved; },
    async generateBundle(_, bundle) {
      const base = config.base;
      if (!base.startsWith('/') || base.startsWith('//') || !base.endsWith('/')) {
        throw new Error('PWAのbaseは「/」または「/リポジトリ名/」のような同一origin内の絶対パスにしてください。');
      }
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') throw new Error('PWAのindex.htmlを生成できませんでした。');
      const worker = await readFile(new URL('../src/pwa/service-worker.js', import.meta.url), 'utf8');
      const hash = createHash('sha256').update(base).update(worker);
      const bundledAssets = Object.keys(bundle).filter((name) => /\.(html|js|css|png|svg|webp|woff2?)$/.test(name)).sort();
      for (const name of bundledAssets) {
        const asset = bundle[name];
        hash.update(name).update(asset.type === 'chunk' ? asset.code : asset.source);
      }
      for (const name of publicAssets) hash.update(name).update(await readFile(resolve(config.publicDir, name)));
      const version = hash.digest('hex').slice(0, 20);
      html.source = String(html.source).replace('</head>', `<meta name="app-version" content="${version}">\n  </head>`);
      const settings = { base, version, assets: [...new Set([...bundledAssets, ...publicAssets])] };
      this.emitFile({ type: 'asset', fileName: 'sw.js',
        source: `globalThis.__MY_SPOT_MAP_PRECACHE__ = ${JSON.stringify(settings)};\n${worker}` });
    },
  };
}

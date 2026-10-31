import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { loadPagesTarget } from '../../build/pagesConfig.js';
import { verifyPagesBuild } from '../../build/verifyPagesBuild.js';

export default async function buildFixtures() {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const testRoot = resolve(root, '.pwa-test');
  for (const [name, base] of [['a', '/pwa-check/'], ['b', '/pwa-check/'], ['root', '/'], ['pages', loadPagesTarget().base]]) {
    const outDir = resolve(testRoot, name);
    if (!outDir.startsWith(testRoot + sep)) throw new Error('PWA検証出力先が範囲外です。');
    await build({
      root, configFile: resolve(root, 'vite.config.js'), base, logLevel: 'silent',
      plugins: [{
        name: 'pwa-test-build-label',
        transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'pwa-test-build', content: name }, injectTo: 'head' }],
      }],
      build: { outDir, emptyOutDir: true },
    });
    if (name === 'pages') verifyPagesBuild(outDir, base);
  }
}

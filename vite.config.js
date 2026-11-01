import { defineConfig } from 'vite';
import { pwaPlugin } from './build/pwaPlugin.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

export default defineConfig(({ mode }) => ({
  base: '/',
  define: { 'import.meta.env.APP_TEST_PUBLIC': mode === 'test-public',
    'import.meta.env.VITE_OFFLINE_PUBLIC_JWK': JSON.stringify(process.env.VITE_OFFLINE_PUBLIC_JWK
      || (existsSync('.secrets/offline-public.json') ? readFileSync('.secrets/offline-public.json', 'utf8') : '')) },
  plugins: [pwaPlugin(), {
    name: 'require-private-production',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'access-mode', content: mode === 'test-public' ? 'test-public' : 'invite-only' }, injectTo: 'head' }],
    configResolved(config) {
      if (mode === 'test-public' && config.command === 'build'
        && !resolve(config.build.outDir).startsWith(resolve('.pwa-test') + sep)) {
        throw new Error('認証を省く検証ビルドは.pwa-test内だけに出力できます。');
      }
    },
  }],
  build: {
    target: ['es2022', 'safari16.4'],
  },
}));

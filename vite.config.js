import { defineConfig } from 'vite';
import { pwaPlugin } from './build/pwaPlugin.js';
import { loadPagesTarget } from './build/pagesConfig.js';

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'serve' && !isPreview ? '/' : loadPagesTarget().base,
  plugins: [pwaPlugin()],
  build: {
    target: ['es2022', 'safari16.4'],
  },
}));

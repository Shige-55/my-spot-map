// 検証専用サーバー。公開用コードへは含めず、架空の新旧ビルドを切り替える。
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPagesTarget } from '../../build/pagesConfig.js';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const root = resolve(workspace, '.pwa-test');
const pagesBase = loadPagesTarget().base;
let version = 'a';
let failAssets = false;
let previewServer;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4175');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
  if (url.pathname === '/_pwa-test/health') { response.end('ok'); return; }
  if (request.method === 'POST' && url.pathname === '/_pwa-test/reset') {
    version = 'a'; failAssets = false; response.end('ok'); return;
  }
  if (request.method === 'POST' && url.pathname === '/_pwa-test/build/b') { version = 'b'; response.end('ok'); return; }
  if (request.method === 'POST' && url.pathname === '/_pwa-test/fail-assets') { failAssets = true; response.end('ok'); return; }
  if (request.method === 'POST' && url.pathname === '/_pwa-test/start-preview') {
    try {
      if (!previewServer) {
        const { preview } = await import('vite');
        previewServer = await preview({ root: workspace, configFile: resolve(workspace, 'vite.config.js'),
          build: { outDir: resolve(root, 'pages') }, preview: { host: '127.0.0.1', port: 4176, strictPort: true } });
      }
      response.end('ok');
    } catch { response.writeHead(500).end('previewの起動に失敗しました。'); }
    return;
  }
  if (url.pathname.startsWith('/_pwa-test/')) { response.writeHead(404).end(); return; }
  if (url.pathname === '/pwa-check') { response.writeHead(302, { Location: '/pwa-check/' }).end(); return; }
  const subpath = url.pathname.startsWith('/pwa-check/');
  const pages = url.pathname.startsWith(pagesBase);
  const directory = resolve(root, subpath ? version : pages ? 'pages' : 'root');
  let relative;
  try { relative = decodeURIComponent(subpath ? url.pathname.slice('/pwa-check/'.length) : pages ? url.pathname.slice(pagesBase.length) : url.pathname.slice(1)); }
  catch { response.writeHead(400).end(); return; }
  if (!relative) relative = 'index.html';
  const file = resolve(directory, relative);
  if (!file.startsWith(directory + sep)) { response.writeHead(404).end(); return; }
  if (failAssets && subpath && extname(file) === '.js' && !file.endsWith('sw.js')) {
    failAssets = false;
    response.writeHead(503).end('架空の資産取得失敗'); return;
  }
  try {
    const bytes = await readFile(file);
    response.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    response.end(bytes);
  } catch { response.writeHead(404).end(); }
}).listen(4175, '127.0.0.1');

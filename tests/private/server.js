import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { build } from 'vite';
import { exportJWK, generateKeyPair } from 'jose';
import worker from '../../server/index.js';
import { digest } from '../../server/accessRepository.js';

// 実際の個人情報・秘密鍵・Cloudflareへ接続しない隔離統合環境。
const origin = 'http://localhost:4180';
const keys = await generateKeyPair('ES256', { extractable: true });
process.env.VITE_OFFLINE_PUBLIC_JWK = JSON.stringify(await exportJWK(keys.publicKey));
const directory = resolve('.pwa-test/private');
await build({ build: { outDir: directory, emptyOutDir: true }, logLevel: 'error' });
const sqlite = new DatabaseSync(':memory:');
for (const file of ['0001_access.sql', '0002_passkeys.sql']) sqlite.exec(readFileSync(resolve('server/migrations', file), 'utf8'));
const db = {
  prepare(sql) { return { bind(...values) { return {
    async first() { return sqlite.prepare(sql).get(...values) || null; },
    async all() { return { results: sqlite.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
  }; } }; },
  async batch(statements) {
    sqlite.exec('BEGIN');
    try { const results = []; for (const item of statements) results.push(await item.run()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
sqlite.prepare(`INSERT INTO app_members(id,email,name,role,status,invitation_hash,invitation_expires,created_at,updated_at)
  VALUES (?,?,?,'owner','invited',?,?,?,?)`).run('10000000-0000-4000-8000-000000000001', 'owner@example.test', '架空の管理者',
await digest('1'.repeat(64)), Date.now() + 86400000, Date.now(), Date.now());
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };
const env = { DB: db, APP_ORIGIN: origin, SESSION_SECRET: 'a'.repeat(64), OFFLINE_PRIVATE_JWK: JSON.stringify(await exportJWK(keys.privateKey)),
  ASSETS: { async fetch(request) {
    const path = new URL(request.url).pathname;
    const file = resolve(directory, '.' + (path === '/' ? '/index.html' : path));
    if (!file.startsWith(directory)) return new Response('', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'Content-Type': types[extname(file)] || 'application/octet-stream' } }); }
    catch { return new Response('', { status: 404 }); }
  } } };
// Node SQLiteの代替D1アダプターは同時batchを持たないので入口で直列化する。
let chain = Promise.resolve();
const server = createServer((incoming, outgoing) => {
  chain = chain.catch(() => {}).then(async () => {
    const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
    const request = new Request(origin + incoming.url, { method: incoming.method, headers: incoming.headers,
      ...(!['GET', 'HEAD'].includes(incoming.method) ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(Buffer.from(await response.arrayBuffer()));
  }).catch(() => { outgoing.writeHead(500); outgoing.end(); });
});
server.listen(4180);

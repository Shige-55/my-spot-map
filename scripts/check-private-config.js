import { readFileSync, readdirSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../wrangler.local.jsonc', import.meta.url), 'utf8'));
if (config.assets?.run_worker_first !== true || config.preview_urls !== false
  || config.observability?.enabled !== false || config.d1_databases?.length !== 1
  || !/^[a-f0-9-]{36}$/.test(config.d1_databases[0].database_id)
  || config.assets?.not_found_handling !== 'none' || config.routes || config.route
  || config.services || config.r2_buckets || config.unsafe
  || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/.test(config.vars?.APP_ORIGIN || '')) {
  throw new Error('招待制の設定が未完了です。デプロイを停止します。');
}
const publicJwk = JSON.parse(readFileSync(new URL('../.secrets/offline-public.json', import.meta.url), 'utf8'));
if (publicJwk.d || publicJwk.kty !== 'EC' || publicJwk.crv !== 'P-256') throw new Error('公開鍵の設定を確認してください。');
const privateJwk = JSON.parse(readFileSync(new URL('../.secrets/offline-private.json', import.meta.url), 'utf8'));
const bundles = readdirSync(new URL('../dist/assets/', import.meta.url)).filter((file) => file.endsWith('.js'))
  .map((file) => readFileSync(new URL('../dist/assets/' + file, import.meta.url), 'utf8')).join('');
if (privateJwk.x !== publicJwk.x || privateJwk.y !== publicJwk.y || !privateJwk.d
  || !bundles.includes(publicJwk.x) || !bundles.includes(publicJwk.y)) throw new Error('ビルドと署名鍵が一致しません。');
const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
if (!html.includes('name="access-mode" content="invite-only"')) throw new Error('招待制の本番ビルドが必要です。');
process.stdout.write('招待制の配信設定を確認しました。アカウントはFreeプランで運用し、有料機能を有効にしないでください。\n');

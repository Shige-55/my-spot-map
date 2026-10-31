import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const publicFiles = ['index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];

function requireValid(condition, message) {
  if (!condition) throw new Error(`公開資産の検証失敗: ${message}`);
}

// 公開する静的ファイルだけを検査する。DBや利用者のバックアップには触れない。
export function verifyPagesBuild(directory, base) {
  const files = [];
  function walk(relative = '') {
    const path = join(directory, relative);
    const stat = lstatSync(path);
    requireValid(!stat.isSymbolicLink(), 'シンボリックリンクは公開できません。');
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) walk(relative ? `${relative}/${entry}` : entry);
    } else {
      requireValid(stat.isFile() && stat.size > 0, '空または通常ファイル以外の資産があります。');
      files.push(relative);
    }
  }
  walk();
  for (const name of files) {
    requireValid(publicFiles.includes(name) || name === 'sw.js'
      || /^assets\/[A-Za-z0-9_-]+\.(js|css|png|svg|webp|woff2?)$/.test(name), `公開対象外のファイル: ${name}`);
  }
  const read = (name) => readFileSync(join(directory, name), 'utf8');
  const settingsLine = read('sw.js').split('\n', 1)[0];
  const match = /^globalThis\.__MY_SPOT_MAP_PRECACHE__ = (\{.*\});$/.exec(settingsLine);
  requireValid(match, 'Service Workerの設定を読み取れません。');
  const settings = JSON.parse(match[1]);
  requireValid(settings.base === base && /^[a-f0-9]{20}$/.test(settings.version), 'baseまたは版が設定と一致しません。');
  requireValid(Array.isArray(settings.assets) && settings.assets.every((name) => files.includes(name))
    && new Set(settings.assets).size === settings.assets.length, 'キャッシュ対象に不正なパスがあります。');
  requireValid(files.length === settings.assets.length + 1 && !settings.assets.includes('sw.js')
    && publicFiles.every((name) => settings.assets.includes(name)), '出力ファイルとキャッシュ対象が一致しません。');

  const html = read('index.html');
  const resources = [...html.matchAll(/<(?:link|script)\b[^>]*\b(?:href|src)="([^"]+)"/g)].map((entry) => entry[1]);
  requireValid(resources.length >= 5 && resources.every((url) => url.startsWith(base)
    && settings.assets.includes(url.slice(base.length))), 'HTMLの資産URLが公開baseと一致しません。');
  requireValid(html.includes(`name="app-version" content="${settings.version}"`), 'HTMLとSWの版が一致しません。');
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const manifestUrl = new URL(`${base}manifest.webmanifest`, 'https://pages.invalid');
  const start = new URL(base, manifestUrl).href;
  requireValid(['id', 'start_url', 'scope'].every((key) => typeof manifest[key] === 'string'
    && new URL(manifest[key], manifestUrl).href === start), 'manifestの開始URLまたはscopeが公開baseと一致しません。');
  requireValid(manifest.display === 'standalone' && Array.isArray(manifest.icons), 'manifestの表示設定が不正です。');
  for (const [name, size, purpose] of [['icon-192.png', 192, 'any'], ['icon-512.png', 512, 'any'], ['maskable-512.png', 512, 'maskable']]) {
    requireValid(manifest.icons.some((icon) => icon.src === `icons/${name}` && icon.sizes === `${size}x${size}`
      && icon.type === 'image/png' && icon.purpose === purpose), `manifestのアイコン設定が不正です: ${name}`);
  }
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['maskable-512.png', 512], ['apple-touch-icon.png', 180]]) {
    const bytes = readFileSync(join(directory, 'icons', name));
    requireValid(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      && bytes.readUInt32BE(16) === size && bytes.readUInt32BE(20) === size, `アイコンの寸法が不正です: ${name}`);
  }
  return { base, files: files.length, version: settings.version };
}

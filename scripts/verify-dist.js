import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { verifyPagesBuild } from '../build/verifyPagesBuild.js';

const result = verifyPagesBuild(fileURLToPath(new URL('../dist/', import.meta.url)), '/');
if (!readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8').includes('name="access-mode" content="invite-only"')) {
  throw new Error('招待制のビルドではありません。公開を停止します。');
}
process.stdout.write(`公開資産を検証しました: ${result.files}ファイル / base ${result.base} / 版 ${result.version}\n`);

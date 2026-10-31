import { fileURLToPath } from 'node:url';
import { loadPagesTarget } from '../build/pagesConfig.js';
import { verifyPagesBuild } from '../build/verifyPagesBuild.js';

const result = verifyPagesBuild(fileURLToPath(new URL('../dist/', import.meta.url)), loadPagesTarget().base);
process.stdout.write(`公開資産を検証しました: ${result.files}ファイル / base ${result.base} / 版 ${result.version}\n`);

import { mkdir, writeFile } from 'node:fs/promises';
import { exportJWK, generateKeyPair } from 'jose';

const directory = new URL('../.secrets/', import.meta.url);
await mkdir(directory, { recursive: true });
const pair = await generateKeyPair('ES256', { extractable: true });
await writeFile(new URL('offline-private.json', directory), JSON.stringify(await exportJWK(pair.privateKey)), { flag: 'wx', mode: 0o600 });
await writeFile(new URL('offline-public.json', directory), JSON.stringify(await exportJWK(pair.publicKey)), { flag: 'wx' });
process.stdout.write('署名鍵をGit対象外の.secretsへ作成しました。秘密鍵を公開・チャットへの貼り付け・上書きしないでください。\n');

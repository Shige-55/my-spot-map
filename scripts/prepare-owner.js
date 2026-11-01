import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes, randomUUID, createHash } from 'node:crypto';

// 個人メール・招待コードはignoredファイルだけに置く。CLIで認証した管理者が実行する。
const setup = JSON.parse(readFileSync('.secrets/setup.json', 'utf8'));
const config = JSON.parse(readFileSync('wrangler.local.jsonc', 'utf8'));
const email = setup.ownerEmail?.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '')) throw new Error('非公開の管理者設定を確認してください。');
const origin = new URL(config.vars.APP_ORIGIN).origin;
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
const time = Date.now();
const recovery = process.argv.includes('--recover-owner');
const sql = recovery
  ? `UPDATE app_members SET status='invited',subject=NULL,registration_id=NULL,version=version+1,invitation_hash='${hash}',invitation_expires=${time + 86400000},updated_at=${time} WHERE role='owner' AND email=${quote(email)};
DELETE FROM auth_credentials WHERE member_id IN(SELECT id FROM app_members WHERE role='owner' AND email=${quote(email)});
DELETE FROM auth_sessions WHERE member_id IN(SELECT id FROM app_members WHERE role='owner' AND email=${quote(email)});
DELETE FROM auth_challenges WHERE member_id IN(SELECT id FROM app_members WHERE role='owner' AND email=${quote(email)});`
  : `INSERT INTO app_members(id,email,name,role,status,invitation_hash,invitation_expires,created_at,updated_at)
VALUES('${randomUUID()}',${quote(email)},'管理者','owner','invited','${hash}',${time + 86400000},${time},${time});`;
mkdirSync('.secrets', { recursive: true });
writeFileSync('.secrets/owner-registration.sql', sql, { flag: recovery ? 'w' : 'wx' });
const url = `${origin}/auth/login#invite=${token}`;
writeFileSync('.secrets/owner-registration.html', `<!doctype html><html lang="ja"><meta charset="UTF-8"><meta name="referrer" content="no-referrer"><title>管理者の初期登録</title><h1>管理者専用の登録リンク</h1><p>24時間・1回限りです。このファイルを他人へ渡したりGitへ追加したりしないでください。</p><a href="${url}">My Spot Mapで管理者のパスキーを登録</a>`, { flag: recovery ? 'w' : 'wx' });
process.stdout.write('非公開の管理者登録SQLとリンクファイルを作成しました。SQLを適用後、.secrets/owner-registration.htmlから登録してください。\n');

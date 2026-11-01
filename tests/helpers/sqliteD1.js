import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export const migrations = ['0001_access.sql', '0002_passkeys.sql', '0003_device_enrollments.sql'];
export function sqliteD1(files = migrations) {
  const db = new DatabaseSync(':memory:');
  for (const file of files) db.exec(readFileSync(new URL('../../server/migrations/' + file, import.meta.url), 'utf8'));
  return { raw: db, prepare(sql) { return { bind(...values) { return {
    async first() { return db.prepare(sql).get(...values) || null; },
    async all() { return { results: db.prepare(sql).all(...values) }; },
    async run() { return { meta: { changes: Number(db.prepare(sql).run(...values).changes) } }; },
  }; } }; },
  async batch(statements) {
    db.exec('BEGIN');
    try { const results = []; for (const item of statements) results.push(await item.run()); db.exec('COMMIT'); return results; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  } };
}

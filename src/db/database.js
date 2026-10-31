import Dexie from 'dexie';

export function createDatabase(name = 'my-spot-map') {
  const db = new Dexie(name);
  // 初期スキーマ。今後の変更はversionを追加して移行し、既存DBを消さない。
  db.version(1).stores({ spots: 'id, updatedAt, category' });
  return db;
}

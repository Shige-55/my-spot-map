-- 地点・認証データは変更せず、外部検索の共有キャッシュと全体制限だけを追加する。
CREATE TABLE place_search_cache (
  cache_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX place_search_cache_expiry ON place_search_cache(expires_at);
CREATE TABLE place_search_gate (
  id INTEGER PRIMARY KEY CHECK(id=1),
  next_at INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL DEFAULT '',
  requests INTEGER NOT NULL DEFAULT 0
);
INSERT INTO place_search_gate(id) VALUES(1);

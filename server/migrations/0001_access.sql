-- 実際のアドレスや地点は含めない。D1のマイグレーションで適用する。
PRAGMA foreign_keys = ON;
CREATE TABLE app_members (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  subject TEXT UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  status TEXT NOT NULL CHECK (status IN ('invited', 'active', 'revoked')),
  invitation_hash TEXT,
  invitation_expires INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE contacts (
  requester TEXT NOT NULL REFERENCES app_members(id),
  recipient TEXT NOT NULL REFERENCES app_members(id),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (requester, recipient),
  CHECK (requester <> recipient)
);
CREATE TABLE shared_spots (
  owner_id TEXT NOT NULL REFERENCES app_members(id),
  spot_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  revision INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, spot_id)
);
CREATE TABLE spot_grants (
  owner_id TEXT NOT NULL,
  spot_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL REFERENCES app_members(id),
  PRIMARY KEY (owner_id, spot_id, recipient_id),
  FOREIGN KEY (owner_id, spot_id) REFERENCES shared_spots(owner_id, spot_id)
);
CREATE INDEX grants_recipient ON spot_grants(recipient_id);
CREATE TABLE live_sessions (
  owner_id TEXT PRIMARY KEY REFERENCES app_members(id),
  session_id TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  position TEXT,
  position_at INTEGER,
  last_position_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE live_recipients (
  session_id TEXT NOT NULL,
  recipient_id TEXT NOT NULL REFERENCES app_members(id),
  PRIMARY KEY (session_id, recipient_id),
  FOREIGN KEY (session_id) REFERENCES live_sessions(session_id) ON DELETE CASCADE
);
CREATE INDEX sessions_expiry ON live_sessions(expires_at);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

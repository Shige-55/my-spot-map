ALTER TABLE app_members ADD COLUMN registration_id TEXT;
CREATE UNIQUE INDEX one_app_owner ON app_members(role) WHERE role='owner';
CREATE TABLE auth_credentials (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX credentials_member ON auth_credentials(member_id);
CREATE TABLE auth_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('register','login','add')),
  member_id TEXT REFERENCES app_members(id),
  token_hash TEXT,
  session_id TEXT,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT
);
CREATE INDEX challenge_expiry ON auth_challenges(expires_at);
CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  member_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX auth_session_expiry ON auth_sessions(expires_at);

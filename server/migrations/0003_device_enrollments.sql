CREATE TABLE device_enrollments (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES app_members(id),
  member_version INTEGER NOT NULL,
  session_id TEXT NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('issued','registered','approved')),
  expires_at INTEGER NOT NULL,
  challenge TEXT,
  challenge_expires INTEGER,
  credential_id TEXT,
  public_key TEXT,
  counter INTEGER,
  transports TEXT,
  confirmation_code TEXT,
  approval_operation TEXT
);
CREATE INDEX device_member ON device_enrollments(member_id);
CREATE INDEX device_expiry ON device_enrollments(expires_at);

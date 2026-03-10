PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS login_rate_limits (
  rate_key TEXT PRIMARY KEY,
  window_started_ms INTEGER NOT NULL CHECK (window_started_ms >= 0),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  locked_until_ms INTEGER NOT NULL DEFAULT 0 CHECK (locked_until_ms >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_login_rate_limits_locked_until
ON login_rate_limits(locked_until_ms);


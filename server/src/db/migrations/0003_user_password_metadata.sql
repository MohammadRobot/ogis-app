PRAGMA foreign_keys = ON;

ALTER TABLE users ADD COLUMN password_changed_at TEXT;

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'supervisor', 'inspector')),
  team_id INTEGER,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS inspections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_no TEXT NOT NULL UNIQUE,
  site_name TEXT NOT NULL,
  team_id INTEGER NOT NULL,
  assigned_to INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'submitted', 'in_review', 'approved', 'rejected', 'reopened', 'closed')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inspections_team_id ON inspections(team_id);
CREATE INDEX IF NOT EXISTS idx_inspections_status ON inspections(status);
CREATE INDEX IF NOT EXISTS idx_inspections_assigned_to ON inspections(assigned_to);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  details_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

INSERT OR IGNORE INTO users (id, username, full_name, role, team_id, password_hash)
VALUES
  (1, 'admin', 'Admin User', 'admin', 1, 'local-seed'),
  (2, 'supervisor1', 'Supervisor One', 'supervisor', 1, 'local-seed'),
  (3, 'inspector1', 'Inspector One', 'inspector', 1, 'local-seed'),
  (4, 'inspector2', 'Inspector Two', 'inspector', 2, 'local-seed');

INSERT OR IGNORE INTO inspections (id, inspection_no, site_name, team_id, assigned_to, created_by, status, notes)
VALUES
  (1, 'INSP-0001', 'Warehouse A', 1, 3, 2, 'draft', 'Seed inspection for local testing');

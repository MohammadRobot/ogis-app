PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS checklist_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_key TEXT NOT NULL UNIQUE,
  item_label TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_checklist_templates_sort_order
ON checklist_templates(sort_order ASC, id ASC);

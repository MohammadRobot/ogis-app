PRAGMA foreign_keys = ON;

ALTER TABLE inspections
ADD COLUMN overall_result TEXT DEFAULT 'na';

UPDATE inspections
SET overall_result = 'na'
WHERE overall_result IS NULL;

CREATE TABLE IF NOT EXISTS inspection_item_responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  item_key TEXT NOT NULL,
  item_label TEXT,
  response_value TEXT,
  result TEXT CHECK (result IN ('pass', 'fail', 'na')),
  comment TEXT,
  answered_by INTEGER,
  answered_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (inspection_id, item_key),
  FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
  FOREIGN KEY (answered_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_item_responses_inspection_id
ON inspection_item_responses(inspection_id);

CREATE INDEX IF NOT EXISTS idx_item_responses_result
ON inspection_item_responses(result);

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS inspection_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('review', 'approve', 'reject', 'reopen')),
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_inspection_reviews_inspection_id
ON inspection_reviews(inspection_id);

CREATE INDEX IF NOT EXISTS idx_inspection_reviews_reviewer_id
ON inspection_reviews(reviewer_id);


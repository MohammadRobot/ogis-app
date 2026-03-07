PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS media_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  inspection_id INTEGER NOT NULL,
  item_response_id INTEGER,
  item_key TEXT,
  uploaded_by INTEGER NOT NULL,
  media_type TEXT NOT NULL CHECK (media_type IN ('photo', 'document')),
  original_file_name TEXT NOT NULL,
  stored_file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes INTEGER NOT NULL CHECK (file_size_bytes >= 0),
  storage_rel_path TEXT NOT NULL UNIQUE,
  checksum_sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (inspection_id) REFERENCES inspections(id) ON DELETE CASCADE,
  FOREIGN KEY (item_response_id) REFERENCES inspection_item_responses(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_media_files_inspection_id
ON media_files(inspection_id);

CREATE INDEX IF NOT EXISTS idx_media_files_item_response_id
ON media_files(item_response_id);

CREATE INDEX IF NOT EXISTS idx_media_files_uploaded_by
ON media_files(uploaded_by);

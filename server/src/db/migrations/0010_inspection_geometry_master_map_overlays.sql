ALTER TABLE inspections ADD COLUMN geometry_type TEXT;
ALTER TABLE inspections ADD COLUMN geometry_json TEXT;

-- Backfill existing inspections as point geometry from current lat/lng.
UPDATE inspections
SET
  geometry_type = 'point',
  geometry_json = '{"type":"Point","coordinates":[' || longitude || ',' || latitude || ']}'
WHERE
  geometry_json IS NULL
  AND latitude IS NOT NULL
  AND longitude IS NOT NULL;

CREATE TABLE IF NOT EXISTS master_map_overlays (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('zone', 'label')),
  title TEXT,
  label_text TEXT,
  geometry_json TEXT,
  latitude REAL,
  longitude REAL,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_master_map_overlays_kind ON master_map_overlays(kind);
CREATE INDEX IF NOT EXISTS idx_master_map_overlays_created_by ON master_map_overlays(created_by);

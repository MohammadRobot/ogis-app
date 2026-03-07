PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS query_perf_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  series_name TEXT NOT NULL CHECK (series_name IN ('list', 'timeline')),
  measured_at TEXT NOT NULL,
  duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
  filtered_total_items INTEGER NOT NULL DEFAULT 0 CHECK (filtered_total_items >= 0),
  returned_items INTEGER NOT NULL DEFAULT 0 CHECK (returned_items >= 0),
  filters_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_query_perf_samples_series_id
ON query_perf_samples(series_name, id DESC);

CREATE INDEX IF NOT EXISTS idx_query_perf_samples_series_measured_at
ON query_perf_samples(series_name, measured_at DESC);

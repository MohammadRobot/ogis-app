ALTER TABLE inspections ADD COLUMN latitude REAL;
ALTER TABLE inspections ADD COLUMN longitude REAL;

-- Backfill existing rows with deterministic local defaults so every inspection is mappable.
UPDATE inspections
SET
  latitude = 25.2048 + ((id % 11) * 0.0020),
  longitude = 55.2708 + ((id % 11) * 0.0020)
WHERE latitude IS NULL OR longitude IS NULL;

CREATE INDEX IF NOT EXISTS idx_inspections_lat_lng ON inspections(latitude, longitude);

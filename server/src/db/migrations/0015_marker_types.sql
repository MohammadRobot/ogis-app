ALTER TABLE inspections ADD COLUMN marker_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE master_map_overlays ADD COLUMN marker_type TEXT NOT NULL DEFAULT 'standard';

UPDATE inspections
SET marker_type = 'standard'
WHERE marker_type IS NULL OR TRIM(marker_type) = '';

UPDATE master_map_overlays
SET marker_type = 'standard'
WHERE marker_type IS NULL OR TRIM(marker_type) = '';

CREATE INDEX IF NOT EXISTS idx_inspections_marker_type ON inspections(marker_type);
CREATE INDEX IF NOT EXISTS idx_master_map_overlays_marker_type ON master_map_overlays(marker_type);

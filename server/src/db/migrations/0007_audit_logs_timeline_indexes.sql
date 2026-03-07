PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_ref
ON audit_logs(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_logs_inspection_timeline
ON audit_logs(entity_id, created_at DESC, id DESC)
WHERE entity_type = 'inspections'
  AND action LIKE 'inspection.%';

CREATE INDEX IF NOT EXISTS idx_audit_logs_media_inspection_timeline
ON audit_logs(json_extract(details_json, '$.inspection_id'), created_at DESC, id DESC)
WHERE entity_type = 'media_files'
  AND action LIKE 'inspection.%';

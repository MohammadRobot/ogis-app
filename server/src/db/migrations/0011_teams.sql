CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO teams (id, name)
SELECT
  team_id,
  'Field Team ' || team_id
FROM (
  SELECT team_id FROM users WHERE team_id IS NOT NULL
  UNION
  SELECT team_id FROM inspections WHERE team_id IS NOT NULL
)
ORDER BY team_id ASC;

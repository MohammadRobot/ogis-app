import fs from "node:fs";
import path from "node:path";

export function runMigrations(db, migrationsDir) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const hasMigrationStmt = db.prepare(
    "SELECT 1 FROM schema_migrations WHERE file_name = ? LIMIT 1"
  );
  const insertMigrationStmt = db.prepare(
    "INSERT INTO schema_migrations (file_name) VALUES (?)"
  );

  const migrationFiles = fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  for (const fileName of migrationFiles) {
    const alreadyApplied = hasMigrationStmt.get(fileName);
    if (alreadyApplied) continue;

    const migrationPath = path.resolve(migrationsDir, fileName);
    const migrationSql = fs.readFileSync(migrationPath, "utf8");

    const applyMigration = db.transaction(() => {
      db.exec(migrationSql);
      insertMigrationStmt.run(fileName);
    });

    applyMigration();
  }
}

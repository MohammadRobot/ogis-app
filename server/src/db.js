import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrate.js";

export function createDatabase(config) {
  fs.mkdirSync(config.dataDir, { recursive: true });

  const db = new Database(config.dbFile);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  const migrationsDir = path.resolve(config.rootDir, "src", "db", "migrations");
  runMigrations(db, migrationsDir);

  return db;
}

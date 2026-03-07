import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  rootDir,
  host: process.env.HOST || "0.0.0.0",
  port: parsePort(process.env.PORT, 8787),
  dataDir: process.env.OGIS_DATA_DIR || path.resolve(rootDir, "data"),
  sessionTtlHours: parsePositiveInt(process.env.OGIS_SESSION_TTL_HOURS, 12),
};

config.dbFile = process.env.OGIS_DB_FILE || path.resolve(config.dataDir, "ogis-local.sqlite");

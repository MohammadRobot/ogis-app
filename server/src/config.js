import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const defaultWebDistDir = path.resolve(rootDir, "..", "dist");

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseCsvList(value, fallback = []) {
  if (typeof value !== "string") return fallback;
  const list = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

function normalizeOrigin(origin) {
  const value = String(origin || "").trim();
  if (!value) return null;
  if (value === "*") return "*";
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(rawValue) {
  const origins = parseCsvList(rawValue, []);
  if (origins.includes("*")) return ["*"];

  const normalized = origins.map(normalizeOrigin).filter(Boolean);
  return Array.from(new Set(normalized));
}

function resolveOptionalPath(rootDirValue, rawValue) {
  if (typeof rawValue !== "string") return null;
  const trimmed = rawValue.trim();
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(rootDirValue, trimmed);
}

export const config = {
  rootDir,
  host: process.env.HOST || "0.0.0.0",
  port: parsePort(process.env.PORT, 8787),
  dataDir: process.env.OGIS_DATA_DIR || path.resolve(rootDir, "data"),
  webDistDir:
    process.env.OGIS_WEB_DIST_DIR === undefined
      ? defaultWebDistDir
      : resolveOptionalPath(rootDir, process.env.OGIS_WEB_DIST_DIR),
  sessionTtlHours: parsePositiveInt(process.env.OGIS_SESSION_TTL_HOURS, 12),
  allowDebugHeaderAuth: parseBoolean(process.env.OGIS_ALLOW_DEBUG_HEADER_AUTH, false),
  loginRateLimitWindowMs: parsePositiveInt(process.env.OGIS_LOGIN_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  loginRateLimitMaxAttempts: parsePositiveInt(process.env.OGIS_LOGIN_RATE_LIMIT_MAX_ATTEMPTS, 8),
  loginRateLimitLockMs: parsePositiveInt(process.env.OGIS_LOGIN_RATE_LIMIT_LOCK_MS, 15 * 60 * 1000),
  corsAllowedOrigins: parseAllowedOrigins(process.env.OGIS_CORS_ALLOWED_ORIGINS),
  corsAllowCredentials: parseBoolean(process.env.OGIS_CORS_ALLOW_CREDENTIALS, false),
  corsAllowedMethods: parseCsvList(process.env.OGIS_CORS_ALLOWED_METHODS, [
    "GET",
    "POST",
    "PATCH",
    "DELETE",
    "OPTIONS",
  ]),
  corsAllowedHeaders: parseCsvList(process.env.OGIS_CORS_ALLOWED_HEADERS, [
    "Authorization",
    "Content-Type",
  ]),
  corsMaxAgeSeconds: parseNonNegativeInt(process.env.OGIS_CORS_MAX_AGE_SECONDS, 600),
  apiCsp:
    process.env.OGIS_API_CSP ||
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  permissionsPolicy:
    process.env.OGIS_PERMISSIONS_POLICY || "camera=(), microphone=(), geolocation=()",
  tlsCertFile: resolveOptionalPath(rootDir, process.env.OGIS_TLS_CERT_FILE),
  tlsKeyFile: resolveOptionalPath(rootDir, process.env.OGIS_TLS_KEY_FILE),
  tlsCaFile: resolveOptionalPath(rootDir, process.env.OGIS_TLS_CA_FILE),
  tlsPassphrase: process.env.OGIS_TLS_PASSPHRASE,
};

config.dbFile = process.env.OGIS_DB_FILE || path.resolve(config.dataDir, "ogis-local.sqlite");

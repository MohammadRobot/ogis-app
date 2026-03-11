import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { Router } from "express";
import { requirePasswordChangeCompleted, requireUser, rolesFromUser } from "../middleware/auth.js";
import { can } from "../security/rbac.js";
import { isLegacyPasswordHash, hashPassword, verifyPassword } from "../security/password.js";
import { generateSessionToken, getSessionExpiryIso, hashSessionToken } from "../security/session.js";
import { writeAuditLog } from "../utils/audit.js";

const router = Router();
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const CHECKLIST_TEMPLATE_KEY_PATTERN = /^[A-Za-z0-9._-]{2,64}$/;
const USER_ROLES = new Set(["admin", "supervisor", "inspector"]);
const DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 8;
const DEFAULT_LOGIN_RATE_LIMIT_LOCK_MS = 15 * 60 * 1000;
const BACKUP_FORMAT = "ogis-local-backup";
const BACKUP_VERSION = 1;
const BACKUP_IMPORT_MAX_FILE_SIZE_BYTES = 250 * 1024 * 1024;
const BACKUP_TABLE_EXPORT_ORDER = Object.freeze([
  "teams",
  "users",
  "checklist_templates",
  "inspections",
  "inspection_item_responses",
  "inspection_reviews",
  "media_files",
  "master_map_overlays",
  "audit_logs",
  "query_perf_samples",
]);
const BACKUP_TABLE_CLEAR_ORDER = Object.freeze([
  "auth_sessions",
  "login_rate_limits",
  "query_perf_samples",
  "media_files",
  "inspection_reviews",
  "inspection_item_responses",
  "master_map_overlays",
  "audit_logs",
  "inspections",
  "checklist_templates",
  "users",
  "teams",
]);
const BACKUP_IMPORT_UPLOAD = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: BACKUP_IMPORT_MAX_FILE_SIZE_BYTES,
  },
});

class BackupValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "BackupValidationError";
    this.status = status;
  }
}

function quoteSqlIdentifier(identifier) {
  return `"${String(identifier || "").replace(/"/g, "\"\"")}"`;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function tableExists(db, tableName) {
  const row = db
    .prepare(
      `
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
      LIMIT 1
      `
    )
    .get(tableName);
  return Boolean(row);
}

function getTableColumns(db, tableName) {
  return db
    .prepare(`PRAGMA table_info(${quoteSqlIdentifier(tableName)})`)
    .all()
    .map((column) => column.name);
}

function createInsertRowHelper(db, tableName, tableColumns) {
  const statementCache = new Map();

  return (row) => {
    if (!isPlainObject(row)) {
      throw new BackupValidationError(`Backup table "${tableName}" contains an invalid row.`);
    }

    const columns = tableColumns.filter((columnName) =>
      Object.prototype.hasOwnProperty.call(row, columnName)
    );
    if (columns.length === 0) return;

    const cacheKey = columns.join(",");
    let statement = statementCache.get(cacheKey);
    if (!statement) {
      const columnsSql = columns.map((columnName) => quoteSqlIdentifier(columnName)).join(", ");
      const placeholders = columns.map(() => "?").join(", ");
      statement = db.prepare(
        `INSERT INTO ${quoteSqlIdentifier(tableName)} (${columnsSql}) VALUES (${placeholders})`
      );
      statementCache.set(cacheKey, statement);
    }

    statement.run(...columns.map((columnName) => row[columnName]));
  };
}

function resolvePathWithinRoot(rootDir, relativePath) {
  const resolvedRoot = path.resolve(String(rootDir || ""));
  const normalized = String(relativePath || "").trim();
  if (!normalized) return null;

  const absolute = path.resolve(resolvedRoot, normalized);
  const relative = path.relative(resolvedRoot, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return absolute;
}

function buildBackupFileName(isoDate) {
  const stamp = String(isoDate || "")
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  return `ogis-backup-${stamp || Date.now()}.json`;
}

function parseBackupPayload(rawBuffer) {
  let parsed;
  try {
    parsed = JSON.parse(rawBuffer.toString("utf8"));
  } catch (_error) {
    throw new BackupValidationError("Backup file must contain valid JSON.");
  }

  if (!isPlainObject(parsed)) {
    throw new BackupValidationError("Backup payload must be a JSON object.");
  }

  if (String(parsed.format || "") !== BACKUP_FORMAT) {
    throw new BackupValidationError(`Unsupported backup format. Expected "${BACKUP_FORMAT}".`);
  }

  if (Number(parsed.version) !== BACKUP_VERSION) {
    throw new BackupValidationError(`Unsupported backup version. Expected "${BACKUP_VERSION}".`);
  }

  return parsed;
}

function readBackupTableRows(payload, tableName) {
  const tableRoot = payload?.tables;
  if (!isPlainObject(tableRoot) || tableRoot[tableName] == null) return [];
  const rows = tableRoot[tableName];
  if (!Array.isArray(rows)) {
    throw new BackupValidationError(`Invalid backup payload: tables.${tableName} must be an array.`);
  }

  for (const row of rows) {
    if (!isPlainObject(row)) {
      throw new BackupValidationError(`Invalid backup payload: tables.${tableName} contains a non-object row.`);
    }
  }

  return rows;
}

function parseBackupMediaEntries(payload) {
  const media = payload?.files?.media;
  if (media == null) return [];
  if (!Array.isArray(media)) {
    throw new BackupValidationError("Invalid backup payload: files.media must be an array.");
  }

  const entries = [];
  for (const rawEntry of media) {
    if (!isPlainObject(rawEntry)) {
      throw new BackupValidationError("Invalid backup payload: files.media contains a non-object entry.");
    }

    const storageRelPath = String(rawEntry.storage_rel_path || "").trim();
    if (!storageRelPath) {
      throw new BackupValidationError("Invalid backup payload: media entry is missing storage_rel_path.");
    }
    if (!storageRelPath.startsWith("media/")) {
      throw new BackupValidationError(`Invalid media path "${storageRelPath}".`);
    }

    const rawBase64 = String(rawEntry.base64 || "");
    if (!rawBase64) {
      throw new BackupValidationError(`Media file "${storageRelPath}" is missing base64 data.`);
    }

    const fileBuffer = Buffer.from(rawBase64, "base64");
    const checksumSha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    entries.push({
      storage_rel_path: storageRelPath,
      buffer: fileBuffer,
      checksum_sha256: checksumSha256,
      size_bytes: fileBuffer.length,
    });
  }

  return entries;
}

function stageBackupMediaFiles(dataDir, mediaEntries) {
  const stagingRoot = path.resolve(
    dataDir,
    `.backup-import-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
  fs.mkdirSync(stagingRoot, { recursive: true });

  try {
    for (const entry of mediaEntries) {
      const absolutePath = resolvePathWithinRoot(stagingRoot, entry.storage_rel_path);
      if (!absolutePath) {
        throw new BackupValidationError(`Invalid media path "${entry.storage_rel_path}".`);
      }

      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, entry.buffer);
    }
  } catch (error) {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }

  return stagingRoot;
}

function validateRestoreUsers(rows) {
  const activeAdminCount = rows.filter((row) => {
    const role = String(row.role || "").toLowerCase();
    const isActive = Number(row.is_active ?? 1) === 1;
    return role === "admin" && isActive;
  }).length;

  if (activeAdminCount < 1) {
    throw new BackupValidationError("Backup must include at least one active admin user.");
  }
}

function applyBackupTables(db, rowsByTable) {
  const allTableNames = [...new Set([...BACKUP_TABLE_EXPORT_ORDER, ...BACKUP_TABLE_CLEAR_ORDER])];
  const existingColumnsByTable = new Map();

  for (const tableName of allTableNames) {
    if (!tableExists(db, tableName)) continue;
    existingColumnsByTable.set(tableName, getTableColumns(db, tableName));
  }

  const runImport = db.transaction(() => {
    for (const tableName of BACKUP_TABLE_CLEAR_ORDER) {
      if (!existingColumnsByTable.has(tableName)) continue;
      db.prepare(`DELETE FROM ${quoteSqlIdentifier(tableName)}`).run();
    }

    for (const tableName of BACKUP_TABLE_EXPORT_ORDER) {
      const columns = existingColumnsByTable.get(tableName);
      if (!columns) continue;

      const insertRow = createInsertRowHelper(db, tableName, columns);
      const rows = rowsByTable[tableName] || [];
      for (const row of rows) {
        insertRow(row);
      }
    }
  });

  runImport();
}

function replaceMediaDirectory(dataDir, stagedRootPath) {
  const finalMediaDir = path.resolve(dataDir, "media");
  const stagedMediaDir = path.resolve(stagedRootPath, "media");

  fs.rmSync(finalMediaDir, { recursive: true, force: true });
  if (fs.existsSync(stagedMediaDir)) {
    fs.renameSync(stagedMediaDir, finalMediaDir);
  } else {
    fs.mkdirSync(finalMediaDir, { recursive: true });
  }
}

function normalizeLoginRateLimitKey(username, ipAddress) {
  return `${String(username || "").trim().toLowerCase()}|${String(ipAddress || "").trim() || "unknown"}`;
}

function getLoginRateLimitConfig(req) {
  const config = req?.app?.locals?.config || {};
  const windowMs = Number(config.loginRateLimitWindowMs);
  const maxAttempts = Number(config.loginRateLimitMaxAttempts);
  const lockMs = Number(config.loginRateLimitLockMs);
  return {
    windowMs: Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_LOGIN_RATE_LIMIT_WINDOW_MS,
    maxAttempts:
      Number.isFinite(maxAttempts) && maxAttempts > 0
        ? Math.floor(maxAttempts)
        : DEFAULT_LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
    lockMs: Number.isFinite(lockMs) && lockMs > 0 ? lockMs : DEFAULT_LOGIN_RATE_LIMIT_LOCK_MS,
  };
}

function pruneLoginRateLimits(db, nowMs, windowMs) {
  db.prepare(
    `
    DELETE FROM login_rate_limits
    WHERE locked_until_ms <= ?
      AND window_started_ms < ?
    `
  ).run(nowMs, Math.max(0, nowMs - windowMs));
}

function getOrInitializeLoginRateLimitState(db, rateLimitKey, nowMs, windowMs) {
  const existing = db
    .prepare(
      `
      SELECT
        rate_key,
        window_started_ms,
        attempt_count,
        locked_until_ms
      FROM login_rate_limits
      WHERE rate_key = ?
      LIMIT 1
      `
    )
    .get(rateLimitKey);

  if (!existing) {
    const created = {
      rate_key: rateLimitKey,
      attemptCount: 0,
      windowStartedMs: nowMs,
      lockedUntilMs: 0,
    };
    db.prepare(
      `
      INSERT INTO login_rate_limits (
        rate_key,
        window_started_ms,
        attempt_count,
        locked_until_ms,
        updated_at
      )
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
    ).run(created.rate_key, created.windowStartedMs, created.attemptCount, created.lockedUntilMs);
    return created;
  }

  let attemptCount = Number(existing.attempt_count) || 0;
  let windowStartedMs = Number(existing.window_started_ms) || nowMs;
  let lockedUntilMs = Number(existing.locked_until_ms) || 0;

  if (lockedUntilMs <= nowMs && nowMs - windowStartedMs > windowMs) {
    attemptCount = 0;
    windowStartedMs = nowMs;
    lockedUntilMs = 0;
    db.prepare(
      `
      UPDATE login_rate_limits
      SET
        attempt_count = ?,
        window_started_ms = ?,
        locked_until_ms = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE rate_key = ?
      `
    ).run(attemptCount, windowStartedMs, lockedUntilMs, rateLimitKey);
  }

  return {
    rate_key: rateLimitKey,
    attemptCount,
    windowStartedMs,
    lockedUntilMs,
  };
}

function loginRateLimitRetrySeconds(state, nowMs) {
  if (!state || state.lockedUntilMs <= nowMs) return 0;
  return Math.max(1, Math.ceil((state.lockedUntilMs - nowMs) / 1000));
}

function loadLoginRateLimitState(req, username, nowMs) {
  const db = req.app.locals.db;
  const { windowMs } = getLoginRateLimitConfig(req);
  const rateLimitKey = normalizeLoginRateLimitKey(username, req.ip);

  return db.transaction(() => {
    pruneLoginRateLimits(db, nowMs, windowMs);
    return getOrInitializeLoginRateLimitState(db, rateLimitKey, nowMs, windowMs);
  })();
}

function noteFailedLoginAttempt(req, username, nowMs) {
  const db = req.app.locals.db;
  const { windowMs, maxAttempts, lockMs } = getLoginRateLimitConfig(req);
  const rateLimitKey = normalizeLoginRateLimitKey(username, req.ip);

  return db.transaction(() => {
    pruneLoginRateLimits(db, nowMs, windowMs);
    const state = getOrInitializeLoginRateLimitState(db, rateLimitKey, nowMs, windowMs);

    if (state.lockedUntilMs > nowMs) {
      return state;
    }

    const nextAttemptCount = state.attemptCount + 1;
    const nextLockedUntilMs = nextAttemptCount >= maxAttempts ? nowMs + lockMs : 0;
    db.prepare(
      `
      UPDATE login_rate_limits
      SET
        attempt_count = ?,
        locked_until_ms = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE rate_key = ?
      `
    ).run(nextAttemptCount, nextLockedUntilMs, rateLimitKey);

    return {
      rate_key: rateLimitKey,
      attemptCount: nextAttemptCount,
      windowStartedMs: state.windowStartedMs,
      lockedUntilMs: nextLockedUntilMs,
    };
  })();
}

function clearLoginRateLimit(req, username) {
  const db = req.app.locals.db;
  const rateLimitKey = normalizeLoginRateLimitKey(username, req.ip);
  db.prepare(
    `
    DELETE FROM login_rate_limits
    WHERE rate_key = ?
    `
  ).run(rateLimitKey);
}

function sanitizeUserRow(row) {
  if (!row) return null;
  const teamId = Number.isFinite(row.team_id) ? row.team_id : null;

  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    roles: [row.role],
    team_ids: teamId == null ? [] : [teamId],
    password_changed_at: row.password_changed_at ?? null,
    is_active: Number(row.is_active) === 1,
  };
}

function normalizeUsername(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim();
}

function normalizeFullName(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim();
}

function normalizeRole(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim().toLowerCase();
}

function normalizePassword(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue;
}

function normalizeChecklistTemplateKey(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim().toLowerCase();
}

function normalizeChecklistTemplateLabel(rawValue) {
  if (typeof rawValue !== "string") return "";
  return rawValue.trim();
}

function parseChecklistTemplateSortOrder(rawValue) {
  if (rawValue == null || rawValue === "") return null;
  const parsed = Number.parseInt(rawValue, 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function mustChangePasswordForUser(user) {
  return user?.password_changed_at == null;
}

function validateNewPassword(password) {
  if (!password || password.length < 8) {
    return { ok: false, message: "new_password must be at least 8 characters" };
  }

  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return {
      ok: false,
      message: "new_password must include at least one letter and one number",
    };
  }

  return { ok: true };
}

function validateUsername(username) {
  if (!USERNAME_PATTERN.test(username)) {
    return {
      ok: false,
      message: "username must be 3-32 characters using letters, numbers, dot, dash, or underscore",
    };
  }

  return { ok: true };
}

function validateFullName(fullName) {
  if (!fullName || fullName.length < 2) {
    return {
      ok: false,
      message: "full_name must be at least 2 characters",
    };
  }

  return { ok: true };
}

function validateChecklistTemplateKey(itemKey) {
  if (!CHECKLIST_TEMPLATE_KEY_PATTERN.test(itemKey)) {
    return {
      ok: false,
      message: "item_key must be 2-64 characters using letters, numbers, dot, dash, or underscore",
    };
  }
  return { ok: true };
}

function validateChecklistTemplateLabel(itemLabel) {
  if (!itemLabel || itemLabel.length < 2) {
    return {
      ok: false,
      message: "item_label must be at least 2 characters",
    };
  }
  return { ok: true };
}

function isValidRole(role) {
  return USER_ROLES.has(role);
}

function getActiveAdminCount(db) {
  return (
    Number(
      db.prepare("SELECT COUNT(*) AS total FROM users WHERE role = 'admin' AND is_active = 1").get()?.total
    ) || 0
  );
}

function mapDirectoryUser(row) {
  return {
    id: row.id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    team_id: Number.isFinite(row.team_id) ? row.team_id : null,
    team_name: row.team_name ?? null,
    is_active: Number(row.is_active) === 1,
    must_change_password: row.password_changed_at == null,
  };
}

function mapChecklistTemplateRow(row) {
  return {
    id: row.id,
    item_key: row.item_key,
    item_label: row.item_label,
    sort_order: Number.isFinite(row.sort_order) ? row.sort_order : Number(row.sort_order) || 0,
    created_by: row.created_by ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function loadChecklistTemplateRow(db, checklistTemplateId) {
  const row = db
    .prepare(
      `
      SELECT
        id,
        item_key,
        item_label,
        sort_order,
        created_by,
        created_at,
        updated_at
      FROM checklist_templates
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(checklistTemplateId);

  return row ? mapChecklistTemplateRow(row) : null;
}

function loadUserDirectoryRow(db, userId) {
  const row = db
    .prepare(
      `
      SELECT
        u.id,
        u.username,
        u.full_name,
        u.role,
        u.team_id,
        u.is_active,
        u.password_changed_at,
        t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.id = ?
      LIMIT 1
      `
    )
    .get(userId);

  return row ? mapDirectoryUser(row) : null;
}

function revokeUserSessions(db, userId, excludeSessionId) {
  const hasExcludeId = Number.isFinite(excludeSessionId);
  if (hasExcludeId) {
    return db
      .prepare(
        `
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
        WHERE user_id = ? AND revoked_at IS NULL AND id <> ?
        `
      )
      .run(userId, excludeSessionId).changes;
  }

  return db
    .prepare(
      `
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE user_id = ? AND revoked_at IS NULL
      `
    )
    .run(userId).changes;
}

function isAdmin(user) {
  const roles = rolesFromUser(user);
  return can(roles, "manage", "users", { actor: user });
}

function mapSessionRow(row, currentSessionId) {
  const isCurrent = Number.isFinite(currentSessionId) && row.id === currentSessionId;
  const revokedAtMs = row.revoked_at ? Date.parse(row.revoked_at) : NaN;
  const expiresAtMs = row.expires_at ? Date.parse(row.expires_at) : NaN;
  const now = Date.now();
  const isRevoked = Number.isFinite(revokedAtMs);
  const isExpired = Number.isFinite(expiresAtMs) ? expiresAtMs <= now : false;

  return {
    id: row.id,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
    revoked_at: row.revoked_at,
    ip_address: row.ip_address,
    user_agent: row.user_agent,
    is_current: isCurrent,
    is_revoked: isRevoked,
    is_expired: isExpired,
    is_active: !isRevoked && !isExpired,
  };
}

function normalizeBoolean(rawValue, defaultValue = false) {
  if (typeof rawValue === "boolean") return rawValue;
  if (typeof rawValue === "number") return rawValue !== 0;
  if (typeof rawValue !== "string") return defaultValue;

  const normalized = rawValue.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return defaultValue;
}

router.post("/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = normalizePassword(req.body?.password);

  if (!username || !password) {
    res.status(400).json({
      error: "Invalid request",
      message: "username and password are required",
    });
    return;
  }

  const nowMs = Date.now();
  const rateLimitState = loadLoginRateLimitState(req, username, nowMs);
  if (rateLimitState.lockedUntilMs > nowMs) {
    res.status(429).json({
      error: "Too many login attempts",
      retry_after_seconds: loginRateLimitRetrySeconds(rateLimitState, nowMs),
    });
    return;
  }

  const db = req.app.locals.db;
  const user = db
    .prepare(
      `
      SELECT id, username, full_name, role, team_id, password_hash, password_changed_at, is_active
      FROM users
      WHERE username = ?
      LIMIT 1
      `
    )
    .get(username);

  if (!user || !verifyPassword(password, user.password_hash)) {
    const updatedState = noteFailedLoginAttempt(req, username, nowMs);
    if (updatedState.lockedUntilMs > nowMs) {
      res.status(429).json({
        error: "Too many login attempts",
        retry_after_seconds: loginRateLimitRetrySeconds(updatedState, nowMs),
      });
      return;
    }
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  if (Number(user.is_active) !== 1) {
    res.status(403).json({
      error: "Account inactive",
      message: "This user account is inactive. Contact an administrator.",
    });
    return;
  }

  clearLoginRateLimit(req, username);

  let authenticatedUser = user;

  if (isLegacyPasswordHash(authenticatedUser.password_hash)) {
    const upgradedHash = hashPassword(password);
    db.prepare(
      `
      UPDATE users
      SET password_hash = ?, password_changed_at = NULL
      WHERE id = ?
      `
    ).run(upgradedHash, authenticatedUser.id);

    authenticatedUser = {
      ...authenticatedUser,
      password_hash: upgradedHash,
      password_changed_at: null,
    };
  }

  const sessionToken = generateSessionToken();
  const sessionTokenHash = hashSessionToken(sessionToken);
  const sessionTtlHours = req.app.locals.config?.sessionTtlHours ?? 12;
  const expiresAt = getSessionExpiryIso(sessionTtlHours);

  const sessionResult = db
    .prepare(
      `
      INSERT INTO auth_sessions (
        user_id,
        session_token_hash,
        expires_at,
        ip_address,
        user_agent,
        last_seen_at
      )
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `
    )
    .run(authenticatedUser.id, sessionTokenHash, expiresAt, req.ip ?? null, req.get("user-agent") ?? null);

  const mustChangePassword = mustChangePasswordForUser(authenticatedUser);
  writeAuditLog(
    db,
    authenticatedUser.id,
    "auth.login",
    "auth_sessions",
    Number(sessionResult.lastInsertRowid),
    {
      session_expires_at: expiresAt,
      must_change_password: mustChangePassword,
    }
  );

  res.json({
    token_type: "Bearer",
    access_token: sessionToken,
    expires_at: expiresAt,
    must_change_password: mustChangePassword,
    user: sanitizeUserRow(authenticatedUser),
  });
});

router.post("/logout", requireUser, (req, res) => {
  const db = req.app.locals.db;
  const sessionId = req.user?.session_id;

  if (Number.isFinite(sessionId)) {
    db.prepare(
      `
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE id = ?
      `
    ).run(sessionId);

    writeAuditLog(db, req.user.id, "auth.logout", "auth_sessions", sessionId, {});
  }

  res.json({ success: true });
});

router.get("/sessions", requireUser, (req, res) => {
  const db = req.app.locals.db;
  const sessions = db
    .prepare(
      `
      SELECT
        id,
        created_at,
        last_seen_at,
        expires_at,
        revoked_at,
        ip_address,
        user_agent
      FROM auth_sessions
      WHERE user_id = ?
      ORDER BY datetime(created_at) DESC, id DESC
      `
    )
    .all(req.user.id)
    .map((row) => mapSessionRow(row, req.user?.session_id));

  res.json({
    data: sessions,
    current_session_id: req.user?.session_id ?? null,
  });
});

router.post("/sessions/:id/revoke", requireUser, (req, res) => {
  const sessionId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(sessionId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "invalid session id",
    });
    return;
  }

  const db = req.app.locals.db;
  const session = db
    .prepare(
      `
      SELECT id, user_id, revoked_at
      FROM auth_sessions
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(sessionId);

  if (!session || session.user_id !== req.user.id) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const result = db
    .prepare(
      `
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
      WHERE id = ?
      `
    )
    .run(sessionId);

  const wasAlreadyRevoked = session.revoked_at != null;
  if (!wasAlreadyRevoked) {
    writeAuditLog(db, req.user.id, "auth.session_revoked", "auth_sessions", sessionId, {
      revoked_by_user_id: req.user.id,
    });
  }

  res.json({
    success: true,
    session_id: sessionId,
    already_revoked: wasAlreadyRevoked,
    changed: result.changes > 0 && !wasAlreadyRevoked,
    is_current_session: Number.isFinite(req.user?.session_id) && req.user.session_id === sessionId,
  });
});

router.post("/sessions/revoke-all", requireUser, (req, res) => {
  const includeCurrent = normalizeBoolean(req.body?.include_current, false);
  const currentSessionId = req.user?.session_id;

  let result;
  if (includeCurrent || !Number.isFinite(currentSessionId)) {
    result = req.app.locals.db
      .prepare(
        `
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
        WHERE user_id = ? AND revoked_at IS NULL
        `
      )
      .run(req.user.id);
  } else {
    result = req.app.locals.db
      .prepare(
        `
        UPDATE auth_sessions
        SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
        WHERE user_id = ? AND revoked_at IS NULL AND id <> ?
        `
      )
      .run(req.user.id, currentSessionId);
  }

  const db = req.app.locals.db;
  writeAuditLog(db, req.user.id, "auth.sessions_revoked_all", "users", req.user.id, {
    include_current: includeCurrent,
    revoked_count: result.changes,
  });

  res.json({
    success: true,
    include_current: includeCurrent,
    revoked_count: result.changes,
  });
});

router.post("/change-password", requireUser, (req, res) => {
  const currentPassword = normalizePassword(req.body?.current_password);
  const newPassword = normalizePassword(req.body?.new_password);

  if (!currentPassword || !newPassword) {
    res.status(400).json({
      error: "Invalid request",
      message: "current_password and new_password are required",
    });
    return;
  }

  if (currentPassword === newPassword) {
    res.status(400).json({
      error: "Invalid request",
      message: "new_password must be different from current_password",
    });
    return;
  }

  const passwordValidation = validateNewPassword(newPassword);
  if (!passwordValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: passwordValidation.message,
    });
    return;
  }

  const db = req.app.locals.db;
  const user = db
    .prepare(
      `
      SELECT id, password_hash
      FROM users
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(req.user.id);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (!verifyPassword(currentPassword, user.password_hash)) {
    res.status(401).json({
      error: "Invalid current password",
    });
    return;
  }

  const newPasswordHash = hashPassword(newPassword);
  const result = db.transaction(() => {
    db.prepare(
      `
      UPDATE users
      SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(newPasswordHash, user.id);

    const sessionsRevoked = revokeUserSessions(db, user.id, req.user?.session_id);
    writeAuditLog(db, user.id, "auth.password_changed", "users", user.id, {
      sessions_revoked: sessionsRevoked,
    });
    return sessionsRevoked;
  })();

  res.json({
    success: true,
    message: "Password changed successfully",
    sessions_revoked: result,
  });
});

router.post("/users", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const username = normalizeUsername(req.body?.username);
  const fullName = normalizeFullName(req.body?.full_name);
  const role = normalizeRole(req.body?.role);
  const teamId = Number.parseInt(req.body?.team_id, 10);
  const password = normalizePassword(req.body?.password);

  const usernameValidation = validateUsername(username);
  if (!usernameValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: usernameValidation.message,
    });
    return;
  }

  const nameValidation = validateFullName(fullName);
  if (!nameValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: nameValidation.message,
    });
    return;
  }

  if (!isValidRole(role)) {
    res.status(400).json({
      error: "Invalid request",
      message: "role must be admin, supervisor, or inspector",
    });
    return;
  }

  if (!Number.isFinite(teamId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "valid team_id is required",
    });
    return;
  }

  const passwordValidation = validateNewPassword(password);
  if (!passwordValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: passwordValidation.message,
    });
    return;
  }

  const db = req.app.locals.db;
  const existingUsername = db
    .prepare(
      `
      SELECT id
      FROM users
      WHERE lower(username) = lower(?)
      LIMIT 1
      `
    )
    .get(username);

  if (existingUsername) {
    res.status(409).json({
      error: "Conflict",
      message: "A user with that username already exists",
    });
    return;
  }

  const team = db
    .prepare(
      `
      SELECT id, name
      FROM teams
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(teamId);

  if (!team) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const passwordHash = hashPassword(password);
  const createdUser = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO users (username, full_name, role, team_id, password_hash, password_changed_at, is_active)
        VALUES (?, ?, ?, ?, ?, NULL, 1)
        `
      )
      .run(username, fullName, role, team.id, passwordHash);

    const createdUserId = Number(result.lastInsertRowid);
    writeAuditLog(db, req.user.id, "auth.user_created", "users", createdUserId, {
      after: {
        username,
        full_name: fullName,
        role,
        team_id: team.id,
        team_name: team.name,
      },
    });

    return loadUserDirectoryRow(db, createdUserId);
  })();

  res.status(201).json({ data: createdUser });
});

router.post("/users/:id/reset-password", requireUser, (req, res) => {
  if (req.user?.must_change_password) {
    res.status(403).json({
      error: "Password change required",
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "Change your password before accessing this resource.",
    });
    return;
  }

  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetUserId = Number.parseInt(req.params.id, 10);
  const newPassword = normalizePassword(req.body?.new_password);

  if (!Number.isFinite(targetUserId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "invalid user id",
    });
    return;
  }

  if (!newPassword) {
    res.status(400).json({
      error: "Invalid request",
      message: "new_password is required",
    });
    return;
  }

  const passwordValidation = validateNewPassword(newPassword);
  if (!passwordValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: passwordValidation.message,
    });
    return;
  }

  const db = req.app.locals.db;
  const targetUser = db
    .prepare(
      `
      SELECT id
      FROM users
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(targetUserId);

  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const newPasswordHash = hashPassword(newPassword);
  const sessionsRevoked = db.transaction(() => {
    db.prepare(
      `
      UPDATE users
      SET password_hash = ?, password_changed_at = NULL
      WHERE id = ?
      `
    ).run(newPasswordHash, targetUserId);

    const revokedCount = revokeUserSessions(db, targetUserId);
    writeAuditLog(db, req.user.id, "auth.password_reset", "users", targetUserId, {
      sessions_revoked: revokedCount,
    });
    return revokedCount;
  })();

  res.json({
    success: true,
    user_id: targetUserId,
    sessions_revoked: sessionsRevoked,
  });
});

router.get("/directory", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const teamIds = Array.isArray(req.user?.team_ids)
    ? req.user.team_ids.filter((teamId) => Number.isFinite(teamId))
    : [];

  let teams = [];
  let rows = [];
  if (isAdmin(req.user)) {
    teams = db
      .prepare(
        `
        SELECT t.id, t.name, SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS member_count
        FROM teams t
        LEFT JOIN users u ON u.team_id = t.id
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `
      )
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        label: row.name,
        member_count: Number(row.member_count) || 0,
      }));

    rows = db
      .prepare(
        `
        SELECT u.id, u.username, u.full_name, u.role, u.team_id, u.is_active, u.password_changed_at, t.name AS team_name
        FROM users u
        LEFT JOIN teams t ON t.id = u.team_id
        ORDER BY u.is_active DESC, u.team_id ASC, u.full_name ASC, u.username ASC
        `
      )
      .all();
  } else if (teamIds.length > 0) {
    teams = db
      .prepare(
        `
        SELECT t.id, t.name, SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS member_count
        FROM teams t
        LEFT JOIN users u ON u.team_id = t.id
        WHERE t.id IN (${teamIds.map(() => "?").join(",")})
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `
      )
      .all(...teamIds)
      .map((row) => ({
        id: row.id,
        name: row.name,
        label: row.name,
        member_count: Number(row.member_count) || 0,
      }));

    rows = db
      .prepare(
        `
        SELECT u.id, u.username, u.full_name, u.role, u.team_id, u.is_active, u.password_changed_at, t.name AS team_name
        FROM users u
        LEFT JOIN teams t ON t.id = u.team_id
        WHERE u.team_id IN (${teamIds.map(() => "?").join(",")}) AND u.is_active = 1
        ORDER BY u.team_id ASC, u.full_name ASC, u.username ASC
        `
      )
      .all(...teamIds);
  } else {
    teams = db
      .prepare(
        `
        SELECT t.id, t.name, SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS member_count
        FROM teams t
        LEFT JOIN users u ON u.team_id = t.id
        WHERE t.id IN (
          SELECT team_id
          FROM users
          WHERE id = ? AND team_id IS NOT NULL
        )
        GROUP BY t.id, t.name
        ORDER BY t.name ASC, t.id ASC
        `
      )
      .all(req.user.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        label: row.name,
        member_count: Number(row.member_count) || 0,
      }));

    rows = db
      .prepare(
        `
        SELECT u.id, u.username, u.full_name, u.role, u.team_id, u.is_active, u.password_changed_at, t.name AS team_name
        FROM users u
        LEFT JOIN teams t ON t.id = u.team_id
        WHERE u.id = ?
        ORDER BY u.full_name ASC, u.username ASC
        `
      )
      .all(req.user.id);
  }

  const users = rows.map((row) => mapDirectoryUser(row));

  res.json({
    data: {
      teams,
      users,
    },
  });
});

router.get("/checklist-templates", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  if (!tableExists(db, "checklist_templates")) {
    res.json({ data: [] });
    return;
  }

  const rows = db
    .prepare(
      `
      SELECT
        id,
        item_key,
        item_label,
        sort_order,
        created_by,
        created_at,
        updated_at
      FROM checklist_templates
      ORDER BY sort_order ASC, item_label ASC, id ASC
      `
    )
    .all();

  res.json({
    data: rows.map((row) => mapChecklistTemplateRow(row)),
  });
});

router.post("/checklist-templates", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const itemKey = normalizeChecklistTemplateKey(req.body?.item_key);
  const itemLabel = normalizeChecklistTemplateLabel(req.body?.item_label);
  const sortOrderParsed = parseChecklistTemplateSortOrder(req.body?.sort_order);

  const keyValidation = validateChecklistTemplateKey(itemKey);
  if (!keyValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: keyValidation.message,
    });
    return;
  }

  const labelValidation = validateChecklistTemplateLabel(itemLabel);
  if (!labelValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: labelValidation.message,
    });
    return;
  }

  if (sortOrderParsed != null && (!Number.isFinite(sortOrderParsed) || sortOrderParsed < 0)) {
    res.status(400).json({
      error: "Invalid request",
      message: "sort_order must be a non-negative integer",
    });
    return;
  }

  const db = req.app.locals.db;
  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM checklist_templates
      WHERE lower(item_key) = lower(?)
      LIMIT 1
      `
    )
    .get(itemKey);

  if (duplicate) {
    res.status(409).json({
      error: "Conflict",
      message: "A checklist item with that item_key already exists",
    });
    return;
  }

  const created = db.transaction(() => {
    const sortOrder =
      sortOrderParsed == null
        ? Number(
            db
              .prepare(
                `
                SELECT COALESCE(MAX(sort_order), -10) + 10 AS next_sort_order
                FROM checklist_templates
                `
              )
              .get()?.next_sort_order
          ) || 0
        : sortOrderParsed;

    const result = db
      .prepare(
        `
        INSERT INTO checklist_templates (
          item_key,
          item_label,
          sort_order,
          created_by
        )
        VALUES (?, ?, ?, ?)
        `
      )
      .run(itemKey, itemLabel, sortOrder, req.user.id);

    const checklistTemplateId = Number(result.lastInsertRowid);
    const row = loadChecklistTemplateRow(db, checklistTemplateId);
    writeAuditLog(db, req.user.id, "auth.checklist_template_created", "checklist_templates", checklistTemplateId, {
      after: row,
    });
    return row;
  })();

  res.status(201).json({ data: created });
});

router.patch("/checklist-templates/:id", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const checklistTemplateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(checklistTemplateId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "invalid checklist template id",
    });
    return;
  }

  const hasItemKey = Object.prototype.hasOwnProperty.call(req.body || {}, "item_key");
  const hasItemLabel = Object.prototype.hasOwnProperty.call(req.body || {}, "item_label");
  const hasSortOrder = Object.prototype.hasOwnProperty.call(req.body || {}, "sort_order");

  if (!hasItemKey && !hasItemLabel && !hasSortOrder) {
    res.status(400).json({
      error: "Invalid request",
      message: "Provide at least one of: item_key, item_label, sort_order",
    });
    return;
  }

  const db = req.app.locals.db;
  const existing = loadChecklistTemplateRow(db, checklistTemplateId);
  if (!existing) {
    res.status(404).json({ error: "Checklist template not found" });
    return;
  }

  const nextItemKey = hasItemKey ? normalizeChecklistTemplateKey(req.body?.item_key) : existing.item_key;
  const nextItemLabel = hasItemLabel ? normalizeChecklistTemplateLabel(req.body?.item_label) : existing.item_label;
  const nextSortOrder = hasSortOrder ? parseChecklistTemplateSortOrder(req.body?.sort_order) : existing.sort_order;

  const keyValidation = validateChecklistTemplateKey(nextItemKey);
  if (!keyValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: keyValidation.message,
    });
    return;
  }

  const labelValidation = validateChecklistTemplateLabel(nextItemLabel);
  if (!labelValidation.ok) {
    res.status(400).json({
      error: "Invalid request",
      message: labelValidation.message,
    });
    return;
  }

  if (!Number.isFinite(nextSortOrder) || nextSortOrder < 0) {
    res.status(400).json({
      error: "Invalid request",
      message: "sort_order must be a non-negative integer",
    });
    return;
  }

  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM checklist_templates
      WHERE lower(item_key) = lower(?) AND id <> ?
      LIMIT 1
      `
    )
    .get(nextItemKey, checklistTemplateId);
  if (duplicate) {
    res.status(409).json({
      error: "Conflict",
      message: "A checklist item with that item_key already exists",
    });
    return;
  }

  const changed =
    nextItemKey !== existing.item_key ||
    nextItemLabel !== existing.item_label ||
    nextSortOrder !== existing.sort_order;

  if (changed) {
    db.prepare(
      `
      UPDATE checklist_templates
      SET
        item_key = ?,
        item_label = ?,
        sort_order = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(nextItemKey, nextItemLabel, nextSortOrder, checklistTemplateId);

    writeAuditLog(db, req.user.id, "auth.checklist_template_updated", "checklist_templates", checklistTemplateId, {
      before: existing,
      after: {
        ...existing,
        item_key: nextItemKey,
        item_label: nextItemLabel,
        sort_order: nextSortOrder,
      },
    });
  }

  const updated = loadChecklistTemplateRow(db, checklistTemplateId);
  res.json({
    data: {
      ...updated,
      changed,
    },
  });
});

router.delete("/checklist-templates/:id", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const checklistTemplateId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(checklistTemplateId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "invalid checklist template id",
    });
    return;
  }

  const db = req.app.locals.db;
  const existing = loadChecklistTemplateRow(db, checklistTemplateId);
  if (!existing) {
    res.status(404).json({ error: "Checklist template not found" });
    return;
  }

  db.prepare(
    `
    DELETE FROM checklist_templates
    WHERE id = ?
    `
  ).run(checklistTemplateId);

  writeAuditLog(db, req.user.id, "auth.checklist_template_deleted", "checklist_templates", checklistTemplateId, {
    before: existing,
  });

  res.json({
    success: true,
    id: checklistTemplateId,
  });
});

router.post("/teams", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const name = String(req.body?.name || "").trim();
  if (!name || name.length < 2) {
    res.status(400).json({
      error: "Invalid request",
      message: "name must be at least 2 characters",
    });
    return;
  }

  const db = req.app.locals.db;
  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM teams
      WHERE lower(name) = lower(?)
      LIMIT 1
      `
    )
    .get(name);

  if (duplicate) {
    res.status(409).json({
      error: "Conflict",
      message: "A team with that name already exists",
    });
    return;
  }

  const created = db.transaction(() => {
    const result = db
      .prepare(
        `
        INSERT INTO teams (name)
        VALUES (?)
        `
      )
      .run(name);

    const teamId = Number(result.lastInsertRowid);
    writeAuditLog(db, req.user.id, "auth.team_created", "teams", teamId, {
      after: { name },
    });

    return {
      id: teamId,
      name,
      label: name,
      member_count: 0,
    };
  })();

  res.status(201).json({ data: created });
});

router.patch("/teams/:id", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const teamId = Number.parseInt(req.params.id, 10);
  const name = String(req.body?.name || "").trim();

  if (!Number.isFinite(teamId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "invalid team id",
    });
    return;
  }

  if (!name || name.length < 2) {
    res.status(400).json({
      error: "Invalid request",
      message: "name must be at least 2 characters",
    });
    return;
  }

  const db = req.app.locals.db;
  const existing = db
    .prepare(
      `
      SELECT id, name
      FROM teams
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(teamId);

  if (!existing) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const duplicate = db
    .prepare(
      `
      SELECT id
      FROM teams
      WHERE lower(name) = lower(?) AND id <> ?
      LIMIT 1
      `
    )
    .get(name, teamId);

  if (duplicate) {
    res.status(409).json({
      error: "Conflict",
      message: "A team with that name already exists",
    });
    return;
  }

  db.prepare(
    `
    UPDATE teams
    SET name = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  ).run(name, teamId);

  writeAuditLog(db, req.user.id, "auth.team_renamed", "teams", teamId, {
    before: { name: existing.name },
    after: { name },
  });

  const memberCount =
    db.prepare("SELECT COUNT(*) AS total FROM users WHERE team_id = ? AND is_active = 1").get(teamId)?.total ?? 0;

  res.json({
    data: {
      id: teamId,
      name,
      label: name,
      member_count: Number(memberCount) || 0,
    },
  });
});

router.patch("/users/:id/team", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetUserId = Number.parseInt(req.params.id, 10);
  const targetTeamId = Number.parseInt(req.body?.team_id, 10);

  if (!Number.isFinite(targetUserId) || !Number.isFinite(targetTeamId)) {
    res.status(400).json({
      error: "Invalid request",
      message: "valid user_id and team_id are required",
    });
    return;
  }

  const db = req.app.locals.db;
  const targetUser = db
    .prepare(
      `
      SELECT u.id, u.username, u.full_name, u.role, u.team_id, u.is_active, u.password_changed_at, t.name AS team_name
      FROM users u
      LEFT JOIN teams t ON t.id = u.team_id
      WHERE u.id = ?
      LIMIT 1
      `
    )
    .get(targetUserId);

  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const targetTeam = db
    .prepare(
      `
      SELECT id, name
      FROM teams
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(targetTeamId);

  if (!targetTeam) {
    res.status(404).json({ error: "Team not found" });
    return;
  }

  const previousTeamId = Number.isFinite(targetUser.team_id) ? targetUser.team_id : null;
  const previousTeamName = targetUser.team_name ?? null;
  const changed = previousTeamId !== targetTeam.id;

  if (changed) {
    db.transaction(() => {
      db.prepare(
        `
        UPDATE users
        SET team_id = ?
        WHERE id = ?
        `
      ).run(targetTeam.id, targetUserId);

      writeAuditLog(db, req.user.id, "auth.user_team_changed", "users", targetUserId, {
        before: {
          team_id: previousTeamId,
          team_name: previousTeamName,
        },
        after: {
          team_id: targetTeam.id,
          team_name: targetTeam.name,
        },
      });
    })();
  }

  res.json({
    data: {
      id: targetUser.id,
      username: targetUser.username,
      full_name: targetUser.full_name,
      role: targetUser.role,
      team_id: targetTeam.id,
      team_name: targetTeam.name,
      is_active: Number(targetUser.is_active) === 1,
      must_change_password: targetUser.password_changed_at == null,
      changed,
    },
  });
});

router.patch("/users/:id/role", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetUserId = Number.parseInt(req.params.id, 10);
  const nextRole = normalizeRole(req.body?.role);

  if (!Number.isFinite(targetUserId) || !isValidRole(nextRole)) {
    res.status(400).json({
      error: "Invalid request",
      message: "valid user_id and role are required",
    });
    return;
  }

  const db = req.app.locals.db;
  const targetUser = loadUserDirectoryRow(db, targetUserId);
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (targetUserId === req.user.id && targetUser.role !== nextRole) {
    res.status(400).json({
      error: "Invalid request",
      message: "Use another admin account to change your own role",
    });
    return;
  }

  const changed = targetUser.role !== nextRole;
  if (
    changed &&
    targetUser.role === "admin" &&
    targetUser.is_active &&
    nextRole !== "admin" &&
    getActiveAdminCount(db) <= 1
  ) {
    res.status(400).json({
      error: "Invalid request",
      message: "At least one active admin must remain in the system",
    });
    return;
  }

  if (changed) {
    db.prepare(
      `
      UPDATE users
      SET role = ?
      WHERE id = ?
      `
    ).run(nextRole, targetUserId);

    writeAuditLog(db, req.user.id, "auth.user_role_changed", "users", targetUserId, {
      before: { role: targetUser.role },
      after: { role: nextRole },
    });
  }

  const updatedUser = loadUserDirectoryRow(db, targetUserId);
  res.json({
    data: {
      ...updatedUser,
      changed,
    },
  });
});

router.patch("/users/:id/status", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const targetUserId = Number.parseInt(req.params.id, 10);
  const nextIsActive = normalizeBoolean(req.body?.is_active, null);

  if (!Number.isFinite(targetUserId) || nextIsActive == null) {
    res.status(400).json({
      error: "Invalid request",
      message: "valid user_id and is_active are required",
    });
    return;
  }

  const db = req.app.locals.db;
  const targetUser = loadUserDirectoryRow(db, targetUserId);
  if (!targetUser) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  if (targetUserId === req.user.id && targetUser.is_active && !nextIsActive) {
    res.status(400).json({
      error: "Invalid request",
      message: "You cannot deactivate your current account",
    });
    return;
  }

  const changed = targetUser.is_active !== nextIsActive;
  if (
    changed &&
    targetUser.role === "admin" &&
    targetUser.is_active &&
    !nextIsActive &&
    getActiveAdminCount(db) <= 1
  ) {
    res.status(400).json({
      error: "Invalid request",
      message: "At least one active admin must remain in the system",
    });
    return;
  }

  let sessionsRevoked = 0;
  if (changed) {
    const result = db.transaction(() => {
      db.prepare(
        `
        UPDATE users
        SET is_active = ?
        WHERE id = ?
        `
      ).run(nextIsActive ? 1 : 0, targetUserId);

      const revokedCount = nextIsActive ? 0 : revokeUserSessions(db, targetUserId);
      writeAuditLog(db, req.user.id, "auth.user_status_changed", "users", targetUserId, {
        before: { is_active: targetUser.is_active },
        after: { is_active: nextIsActive },
        sessions_revoked: revokedCount,
      });
      return revokedCount;
    })();

    sessionsRevoked = Number(result) || 0;
  }

  const updatedUser = loadUserDirectoryRow(db, targetUserId);
  res.json({
    data: {
      ...updatedUser,
      changed,
      sessions_revoked: sessionsRevoked,
    },
  });
});

router.get("/backup/export", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const db = req.app.locals.db;
  const dataDir = req.app.locals.config?.dataDir;
  if (!dataDir) {
    res.status(500).json({
      error: "Backup export failed",
      message: "Server data directory is not configured.",
    });
    return;
  }

  try {
    const tables = {};
    for (const tableName of BACKUP_TABLE_EXPORT_ORDER) {
      if (!tableExists(db, tableName)) {
        tables[tableName] = [];
        continue;
      }
      tables[tableName] = db.prepare(`SELECT * FROM ${quoteSqlIdentifier(tableName)}`).all();
    }

    const mediaRows = Array.isArray(tables.media_files) ? tables.media_files : [];
    const mediaEntries = [];
    for (const mediaRow of mediaRows) {
      const storageRelPath = String(mediaRow.storage_rel_path || "").trim();
      if (!storageRelPath) {
        throw new BackupValidationError("A media_files row is missing storage_rel_path.", 409);
      }

      const absolutePath = resolvePathWithinRoot(dataDir, storageRelPath);
      if (!absolutePath || !fs.existsSync(absolutePath)) {
        throw new BackupValidationError(`Media file is missing on disk: ${storageRelPath}`, 409);
      }

      const fileBuffer = fs.readFileSync(absolutePath);
      mediaEntries.push({
        storage_rel_path: storageRelPath,
        base64: fileBuffer.toString("base64"),
        size_bytes: fileBuffer.length,
        checksum_sha256: crypto.createHash("sha256").update(fileBuffer).digest("hex"),
      });
    }

    const generatedAt = new Date().toISOString();
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      generated_at: generatedAt,
      tables,
      files: {
        media: mediaEntries,
      },
    };

    const tableCounts = Object.fromEntries(
      BACKUP_TABLE_EXPORT_ORDER.map((tableName) => [tableName, (tables[tableName] || []).length])
    );
    writeAuditLog(db, req.user.id, "auth.backup_exported", "backup", null, {
      generated_at: generatedAt,
      table_counts: tableCounts,
      media_file_count: mediaEntries.length,
    });

    const backupFileName = buildBackupFileName(generatedAt);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${backupFileName}"`);
    res.send(JSON.stringify(payload));
  } catch (error) {
    const status = error instanceof BackupValidationError ? error.status : 500;
    const message = error instanceof BackupValidationError ? error.message : "Could not export backup.";
    res.status(status).json({
      error: status >= 500 ? "Backup export failed" : "Invalid backup state",
      message,
    });
  }
});

router.post("/backup/import", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdmin(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  BACKUP_IMPORT_UPLOAD.single("file")(req, res, (uploadError) => {
    if (uploadError) {
      if (uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({
          error: "Invalid request",
          message: `Backup file is too large. Maximum size is ${Math.floor(
            BACKUP_IMPORT_MAX_FILE_SIZE_BYTES / (1024 * 1024)
          )} MB.`,
        });
        return;
      }

      res.status(400).json({
        error: "Invalid request",
        message: uploadError.message || "Could not read the uploaded backup file.",
      });
      return;
    }

    const file = req.file;
    if (!file?.buffer || file.buffer.length === 0) {
      res.status(400).json({
        error: "Invalid request",
        message: "A backup file is required.",
      });
      return;
    }

    const db = req.app.locals.db;
    const dataDir = req.app.locals.config?.dataDir;
    if (!dataDir) {
      res.status(500).json({
        error: "Backup import failed",
        message: "Server data directory is not configured.",
      });
      return;
    }

    let stagedMediaRoot = null;
    try {
      const payload = parseBackupPayload(file.buffer);
      const rowsByTable = {};
      for (const tableName of BACKUP_TABLE_EXPORT_ORDER) {
        rowsByTable[tableName] = readBackupTableRows(payload, tableName);
      }

      validateRestoreUsers(rowsByTable.users || []);

      const mediaEntries = parseBackupMediaEntries(payload);
      const mediaEntriesByPath = new Map();
      for (const mediaEntry of mediaEntries) {
        if (mediaEntriesByPath.has(mediaEntry.storage_rel_path)) {
          throw new BackupValidationError(`Duplicate media path "${mediaEntry.storage_rel_path}" in backup.`);
        }
        mediaEntriesByPath.set(mediaEntry.storage_rel_path, mediaEntry);
      }

      const mediaRows = rowsByTable.media_files || [];
      for (const mediaRow of mediaRows) {
        const storageRelPath = String(mediaRow.storage_rel_path || "").trim();
        if (!storageRelPath) {
          throw new BackupValidationError("A media_files row is missing storage_rel_path.");
        }

        const mediaEntry = mediaEntriesByPath.get(storageRelPath);
        if (!mediaEntry) {
          throw new BackupValidationError(`Missing file payload for media path "${storageRelPath}".`);
        }

        const expectedSize = Number(mediaRow.file_size_bytes);
        if (Number.isFinite(expectedSize) && expectedSize >= 0 && expectedSize !== mediaEntry.size_bytes) {
          throw new BackupValidationError(`File size mismatch for media path "${storageRelPath}".`);
        }

        const expectedChecksum = String(mediaRow.checksum_sha256 || "").trim().toLowerCase();
        if (expectedChecksum && expectedChecksum !== mediaEntry.checksum_sha256) {
          throw new BackupValidationError(`Checksum mismatch for media path "${storageRelPath}".`);
        }
      }

      if (mediaEntriesByPath.size !== mediaRows.length) {
        throw new BackupValidationError(
          "Backup includes media file payloads that are not referenced in media_files."
        );
      }

      stagedMediaRoot = stageBackupMediaFiles(dataDir, mediaEntries);
      applyBackupTables(db, rowsByTable);
      replaceMediaDirectory(dataDir, stagedMediaRoot);

      fs.rmSync(stagedMediaRoot, { recursive: true, force: true });
      stagedMediaRoot = null;

      const tableCounts = Object.fromEntries(
        BACKUP_TABLE_EXPORT_ORDER.map((tableName) => [tableName, (rowsByTable[tableName] || []).length])
      );

      if (tableExists(db, "audit_logs")) {
        const actorExists = db
          .prepare(
            `
            SELECT id
            FROM users
            WHERE id = ?
            LIMIT 1
            `
          )
          .get(req.user.id);
        writeAuditLog(db, actorExists ? req.user.id : null, "auth.backup_imported", "backup", null, {
          table_counts: tableCounts,
          media_file_count: mediaEntries.length,
        });
      }

      res.json({
        success: true,
        requires_relogin: true,
        restored: {
          table_counts: tableCounts,
          media_file_count: mediaEntries.length,
        },
      });
    } catch (error) {
      if (stagedMediaRoot) {
        fs.rmSync(stagedMediaRoot, { recursive: true, force: true });
      }

      const status = error instanceof BackupValidationError ? error.status : 500;
      const message = error instanceof BackupValidationError ? error.message : "Could not import backup.";
      res.status(status).json({
        error: status >= 500 ? "Backup import failed" : "Invalid backup file",
        message,
      });
    }
  });
});

router.get("/me", requireUser, (req, res) => {
  const db = req.app.locals.db;
  const user = db
    .prepare(
      `
      SELECT id, username, full_name, role, team_id, password_changed_at, is_active
      FROM users
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(req.user.id);

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  res.json({
    user: sanitizeUserRow(user),
    must_change_password: req.user?.must_change_password ?? mustChangePasswordForUser(user),
    session: {
      id: req.user?.session_id ?? null,
      expires_at: req.user?.session_expires_at ?? null,
    },
  });
});

export default router;

import { Router } from "express";
import { requirePasswordChangeCompleted, requireUser, rolesFromUser } from "../middleware/auth.js";
import { can } from "../security/rbac.js";
import { isLegacyPasswordHash, hashPassword, verifyPassword } from "../security/password.js";
import { generateSessionToken, getSessionExpiryIso, hashSessionToken } from "../security/session.js";
import { writeAuditLog } from "../utils/audit.js";

const router = Router();
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const USER_ROLES = new Set(["admin", "supervisor", "inspector"]);

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

import { hashSessionToken } from "../security/session.js";

function parseTeamIds(rawValue) {
  if (!rawValue) return [];

  return String(rawValue)
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isFinite(value));
}

function parseRoles(rawValue) {
  if (!rawValue) return [];

  return String(rawValue)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function rolesFromUser(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length > 0) return user.roles;
  if (typeof user.role === "string" && user.role.trim()) return [user.role.trim()];
  return [];
}

function parseBearerToken(rawAuthorization) {
  if (!rawAuthorization) return null;

  const value = String(rawAuthorization).trim();
  const match = value.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) return null;

  return match[1].trim();
}

function mapSessionUser(row) {
  const teamId = Number.isFinite(row.team_id) ? row.team_id : null;
  const mustChangePassword = row.password_changed_at == null;
  return {
    id: row.user_id,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    roles: [row.role],
    team_ids: teamId == null ? [] : [teamId],
    password_changed_at: row.password_changed_at ?? null,
    is_active: Number(row.is_active) === 1,
    must_change_password: mustChangePassword,
    session_id: row.session_id,
    session_expires_at: row.expires_at,
  };
}

function getSessionUser(req, token) {
  const db = req?.app?.locals?.db;
  if (!db || !token) return null;

  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(
      `
      SELECT
        s.id AS session_id,
        s.user_id,
        s.expires_at,
        s.revoked_at,
        u.username,
        u.full_name,
        u.role,
        u.team_id,
        u.is_active,
        u.password_changed_at
      FROM auth_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.session_token_hash = ?
      LIMIT 1
      `
    )
    .get(tokenHash);

  if (!row || row.revoked_at) return null;
  if (Number(row.is_active) !== 1) return null;

  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) return null;

  db.prepare(
    `
    UPDATE auth_sessions
    SET last_seen_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  ).run(row.session_id);

  return mapSessionUser(row);
}

export function attachActorFromHeaders(req, _res, next) {
  const bearerToken = parseBearerToken(req.get("authorization"));
  if (bearerToken) {
    const sessionUser = getSessionUser(req, bearerToken);
    if (sessionUser) {
      req.user = sessionUser;
      next();
      return;
    }

    req.user = { roles: [] };
    next();
    return;
  }

  const userId = Number.parseInt(req.get("x-user-id"), 10);
  const roles = parseRoles(req.get("x-user-role"));
  const teamIds = parseTeamIds(req.get("x-team-ids"));

  if (!Number.isFinite(userId) || roles.length === 0) {
    req.user = { roles: [] };
    next();
    return;
  }

  req.user = {
    id: userId,
    role: roles[0],
    roles,
    team_ids: teamIds,
    must_change_password: false,
  };

  next();
}

export function requireUser(req, res, next) {
  const userId = req?.user?.id;
  const roles = rolesFromUser(req?.user);

  if (!Number.isFinite(userId) || roles.length === 0) {
    res.status(401).json({
      error: "Unauthorized",
      hint: "Send Authorization: Bearer <token> or debug x-user-id/x-user-role/x-team-ids headers.",
    });
    return;
  }

  next();
}

export function requirePasswordChangeCompleted(req, res, next) {
  if (req?.user?.must_change_password) {
    res.status(403).json({
      error: "Password change required",
      code: "PASSWORD_CHANGE_REQUIRED",
      message: "Change your password before accessing this resource.",
    });
    return;
  }

  next();
}

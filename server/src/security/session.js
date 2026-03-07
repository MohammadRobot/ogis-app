import crypto from "node:crypto";

export function generateSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getSessionExpiryIso(ttlHours) {
  const expiryMs = Date.now() + ttlHours * 60 * 60 * 1000;
  return new Date(expiryMs).toISOString();
}

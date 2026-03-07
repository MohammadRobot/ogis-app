import crypto from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;

function toBase64Url(buffer) {
  return buffer.toString("base64url");
}

function fromBase64Url(value) {
  return Buffer.from(value, "base64url");
}

function constantTimeEqualText(a, b) {
  const aBuffer = Buffer.from(String(a));
  const bBuffer = Buffer.from(String(b));
  if (aBuffer.length !== bBuffer.length) return false;
  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

export function isLegacyPasswordHash(storedHash) {
  return typeof storedHash === "string" && !storedHash.startsWith("scrypt$");
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });

  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    toBase64Url(salt),
    toBase64Url(derived),
  ].join("$");
}

export function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string" || storedHash.length === 0) return false;

  if (!storedHash.startsWith("scrypt$")) {
    return constantTimeEqualText(password, storedHash);
  }

  const parts = storedHash.split("$");
  if (parts.length !== 6) return false;

  const [, rawN, rawR, rawP, saltValue, expectedValue] = parts;
  const n = Number.parseInt(rawN, 10);
  const r = Number.parseInt(rawR, 10);
  const p = Number.parseInt(rawP, 10);

  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  try {
    const salt = fromBase64Url(saltValue);
    const expected = fromBase64Url(expectedValue);
    const derived = crypto.scryptSync(password, salt, expected.length, { N: n, r, p });

    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

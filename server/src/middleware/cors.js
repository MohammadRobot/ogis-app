function normalizeOrigin(origin) {
  const value = String(origin || "").trim();
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function appendVary(existing, value) {
  const currentValues = String(existing || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (currentValues.includes(value)) return currentValues.join(", ");
  currentValues.push(value);
  return currentValues.join(", ");
}

function isOriginAllowed(config, normalizedOrigin) {
  const allowedOrigins = Array.isArray(config?.corsAllowedOrigins) ? config.corsAllowedOrigins : [];
  if (allowedOrigins.length === 0 || !normalizedOrigin) return null;
  if (allowedOrigins.includes("*")) return "*";
  return allowedOrigins.includes(normalizedOrigin) ? normalizedOrigin : null;
}

export function corsMiddleware(req, res, next) {
  const config = req?.app?.locals?.config || {};
  const requestOrigin = req.get("origin");
  const normalizedOrigin = normalizeOrigin(requestOrigin);
  const allowedOrigin = isOriginAllowed(config, normalizedOrigin);

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin === "*" ? "*" : normalizedOrigin);
    res.setHeader("Vary", appendVary(res.getHeader("Vary"), "Origin"));
    res.setHeader(
      "Access-Control-Allow-Methods",
      (config.corsAllowedMethods || ["GET", "POST", "PATCH", "DELETE", "OPTIONS"]).join(", ")
    );
    res.setHeader(
      "Access-Control-Allow-Headers",
      (config.corsAllowedHeaders || ["Authorization", "Content-Type"]).join(", ")
    );
    res.setHeader("Access-Control-Max-Age", String(config.corsMaxAgeSeconds ?? 600));

    const allowCredentials = config.corsAllowCredentials === true && allowedOrigin !== "*";
    if (allowCredentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }
  }

  if (req.method === "OPTIONS") {
    if (requestOrigin && !allowedOrigin) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    res.status(204).end();
    return;
  }

  next();
}

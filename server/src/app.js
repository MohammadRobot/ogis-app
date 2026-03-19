import fs from "node:fs";
import path from "node:path";
import express from "express";
import { attachActorFromHeaders } from "./middleware/auth.js";
import { corsMiddleware } from "./middleware/cors.js";
import healthRoutes from "./routes/health.js";
import inspectionRoutes from "./routes/inspections.js";
import authRoutes from "./routes/auth.js";

function applyApiSecurityHeaders(req, res, next, config) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Content-Security-Policy", config.apiCsp);
  res.setHeader("Permissions-Policy", config.permissionsPolicy);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  next();
}

export function createApp(db, config) {
  const app = express();
  app.disable("x-powered-by");
  app.locals.db = db;
  app.locals.config = config;

  app.use("/api", (req, res, next) => {
    applyApiSecurityHeaders(req, res, next, config);
  });
  app.use("/api", corsMiddleware);
  app.use("/api", express.json({ limit: "10mb" }));
  app.use("/api", attachActorFromHeaders);

  app.use("/api/auth", authRoutes);
  app.use("/api/health", healthRoutes);
  app.use("/api/inspections", inspectionRoutes);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  const spaIndexFile = config.webDistDir ? path.resolve(config.webDistDir, "index.html") : null;

  if (spaIndexFile && fs.existsSync(spaIndexFile)) {
    app.use(express.static(config.webDistDir, { index: false }));
    app.get("*", (_req, res) => {
      res.sendFile(spaIndexFile);
    });
  } else {
    app.use((_req, res) => {
      res.status(404).json({ error: "Not found" });
    });
  }

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

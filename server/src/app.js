import express from "express";
import { attachActorFromHeaders } from "./middleware/auth.js";
import healthRoutes from "./routes/health.js";
import inspectionRoutes from "./routes/inspections.js";
import authRoutes from "./routes/auth.js";

export function createApp(db, config) {
  const app = express();
  app.disable("x-powered-by");
  app.locals.db = db;
  app.locals.config = config;

  app.use(express.json({ limit: "10mb" }));
  app.use(attachActorFromHeaders);

  app.use("/api/auth", authRoutes);
  app.use("/api/health", healthRoutes);
  app.use("/api/inspections", inspectionRoutes);

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

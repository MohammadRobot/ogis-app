import { Router } from "express";

const router = Router();

router.get("/", (req, res) => {
  const db = req.app.locals.db;
  const probe = db.prepare("SELECT 1 AS ok").get();

  res.json({
    status: "ok",
    db: probe?.ok === 1 ? "ok" : "unknown",
    timestamp: new Date().toISOString(),
  });
});

export default router;

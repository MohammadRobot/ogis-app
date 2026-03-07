export function loadInspection(req, res, next) {
  const inspectionId = Number.parseInt(req.params.id, 10);
  if (!Number.isFinite(inspectionId)) {
    res.status(400).json({ error: "Invalid inspection id" });
    return;
  }

  const db = req.app.locals.db;
  const inspection = db
    .prepare(
      `
      SELECT
        id,
        inspection_no,
        site_name,
        team_id,
        assigned_to,
        created_by,
        status,
        overall_result,
        latitude,
        longitude,
        geometry_type,
        geometry_json,
        notes,
        created_at,
        updated_at
      FROM inspections
      WHERE id = ?
      `
    )
    .get(inspectionId);

  if (!inspection) {
    res.status(404).json({ error: "Inspection not found" });
    return;
  }

  req.inspection = inspection;
  next();
}

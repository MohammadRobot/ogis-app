export function writeAuditLog(db, actorUserId, action, entityType, entityId, details) {
  db.prepare(
    `
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, details_json)
    VALUES (?, ?, ?, ?, ?)
    `
  ).run(actorUserId ?? null, action, entityType, entityId ?? null, JSON.stringify(details || {}));
}

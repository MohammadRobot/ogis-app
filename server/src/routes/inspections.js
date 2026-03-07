import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import {
  requirePasswordChangeCompleted,
  requireUser,
  rolesFromUser,
} from "../middleware/auth.js";
import { loadInspection } from "../middleware/loadInspection.js";
import { authorize, can, canTransition } from "../security/rbac.js";
import { writeAuditLog } from "../utils/audit.js";

const router = Router();
const VALID_REVIEW_DECISIONS = new Set(["review", "approve", "reject", "reopen"]);
const VALID_ITEM_RESULTS = new Set(["pass", "fail", "na"]);
const VALID_INSPECTION_STATUSES = new Set([
  "draft",
  "submitted",
  "in_review",
  "approved",
  "rejected",
  "reopened",
  "closed",
]);
const MAX_MEDIA_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;
const DEFAULT_TIMELINE_LIMIT = 50;
const MAX_TIMELINE_LIMIT = 200;
const MAX_PERF_DB_HISTORY_ITEMS = 5000;
const DEFAULT_PERF_RECENT_LIMIT = 10;
const MAX_PERF_RECENT_LIMIT = 50;
const VALID_INSPECTION_GEOMETRY_TYPES = new Set(["point", "area"]);
const VALID_MASTER_OVERLAY_KINDS = new Set(["zone", "label"]);
const VALID_TIMELINE_CATEGORIES = new Set([
  "lifecycle",
  "status",
  "inspection",
  "items",
  "media",
  "review",
]);

function normalizeNullableText(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseCoordinate(value, min, max) {
  const normalized = normalizeNullableText(value);
  if (normalized == null) return null;

  const parsed = Number.parseFloat(normalized);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < min || parsed > max) return null;
  return parsed;
}

function parseJsonLike(value) {
  if (value == null) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }
  if (typeof value === "object") return value;
  return null;
}

function safeStringifyJson(value) {
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return null;
  }
}

function parseGeometryJson(rawValue) {
  const parsed = parseJsonLike(rawValue);
  return parsed && typeof parsed === "object" ? parsed : null;
}

function normalizeLngLatPair(rawPair) {
  if (!Array.isArray(rawPair) || rawPair.length < 2) return null;
  const lng = Number(rawPair[0]);
  const lat = Number(rawPair[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lng, lat];
}

function normalizePolygonRing(rawRing) {
  if (!Array.isArray(rawRing) || rawRing.length < 3) return null;
  const points = [];
  for (const pair of rawRing) {
    const normalizedPair = normalizeLngLatPair(pair);
    if (!normalizedPair) return null;
    points.push(normalizedPair);
  }

  if (points.length < 3) return null;
  const [firstLng, firstLat] = points[0];
  const [lastLng, lastLat] = points[points.length - 1];
  const isClosed = firstLng === lastLng && firstLat === lastLat;
  if (!isClosed) {
    points.push([firstLng, firstLat]);
  }
  return points;
}

function centroidFromRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const vertices = [...ring];
  const [firstLng, firstLat] = vertices[0];
  const [lastLng, lastLat] = vertices[vertices.length - 1];
  if (firstLng === lastLng && firstLat === lastLat) {
    vertices.pop();
  }
  if (vertices.length < 3) return null;

  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of vertices) {
    lngSum += lng;
    latSum += lat;
  }

  return {
    longitude: Number((lngSum / vertices.length).toFixed(6)),
    latitude: Number((latSum / vertices.length).toFixed(6)),
  };
}

function buildPointGeometry(longitude, latitude) {
  return {
    type: "Point",
    coordinates: [Number(longitude), Number(latitude)],
  };
}

function normalizeInspectionGeometry(rawGeometry) {
  const parsed = parseJsonLike(rawGeometry);
  if (!parsed || typeof parsed !== "object") {
    return { error: "geometry must be a valid GeoJSON object" };
  }

  let geometry = parsed;
  if (geometry?.type === "Feature" && geometry?.geometry && typeof geometry.geometry === "object") {
    geometry = geometry.geometry;
  }

  const geometryType = String(geometry?.type || "");
  if (geometryType === "Point") {
    const pointPair = normalizeLngLatPair(geometry?.coordinates);
    if (!pointPair) {
      return { error: "Point geometry must include valid coordinates [longitude, latitude]" };
    }

    const [longitude, latitude] = pointPair;
    return {
      geometry_type: "point",
      geometry: buildPointGeometry(longitude, latitude),
      latitude,
      longitude,
    };
  }

  if (geometryType === "Polygon") {
    if (!Array.isArray(geometry?.coordinates) || geometry.coordinates.length === 0) {
      return { error: "Polygon geometry must include at least one ring" };
    }

    const normalizedRings = [];
    for (const rawRing of geometry.coordinates) {
      const normalizedRing = normalizePolygonRing(rawRing);
      if (!normalizedRing) {
        return { error: "Polygon geometry contains invalid coordinates" };
      }
      normalizedRings.push(normalizedRing);
    }

    const centroid = centroidFromRing(normalizedRings[0]);
    if (!centroid) {
      return { error: "Polygon geometry must contain at least three valid points" };
    }

    return {
      geometry_type: "area",
      geometry: {
        type: "Polygon",
        coordinates: normalizedRings,
      },
      latitude: centroid.latitude,
      longitude: centroid.longitude,
    };
  }

  if (geometryType === "MultiPolygon") {
    if (!Array.isArray(geometry?.coordinates) || geometry.coordinates.length === 0) {
      return { error: "MultiPolygon geometry must include polygons" };
    }

    const normalizedPolygons = [];
    for (const rawPolygon of geometry.coordinates) {
      if (!Array.isArray(rawPolygon) || rawPolygon.length === 0) {
        return { error: "MultiPolygon geometry contains invalid polygons" };
      }

      const normalizedRings = [];
      for (const rawRing of rawPolygon) {
        const normalizedRing = normalizePolygonRing(rawRing);
        if (!normalizedRing) {
          return { error: "MultiPolygon geometry contains invalid coordinates" };
        }
        normalizedRings.push(normalizedRing);
      }
      normalizedPolygons.push(normalizedRings);
    }

    const centroid = centroidFromRing(normalizedPolygons[0][0]);
    if (!centroid) {
      return { error: "MultiPolygon geometry must contain at least three valid points" };
    }

    return {
      geometry_type: "area",
      geometry: {
        type: "MultiPolygon",
        coordinates: normalizedPolygons,
      },
      latitude: centroid.latitude,
      longitude: centroid.longitude,
    };
  }

  return { error: "geometry.type must be one of: Point, Polygon, MultiPolygon" };
}

function parseStringList(value) {
  if (value == null) return [];

  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((entry) => String(entry).split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseDateFilter(value) {
  const text = normalizeNullableText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  return text;
}

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  const text = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(text)) return true;
  if (["0", "false", "no", "off"].includes(text)) return false;
  return fallback;
}

function normalizeItemResult(value) {
  const text = normalizeNullableText(value);
  if (!text) return null;
  return text.toLowerCase();
}

function parseItemsPayload(body) {
  if (Array.isArray(body?.items)) return body.items;
  if (body && typeof body === "object" && "item_key" in body) return [body];
  return [];
}

function sanitizeFileName(fileName) {
  const name = String(fileName || "").trim();
  if (!name) return "upload.bin";

  const baseName = path.basename(name);
  const safe = baseName.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "upload.bin";
}

function detectMediaType(mimeType) {
  const value = String(mimeType || "").toLowerCase();
  if (value.startsWith("image/")) return "photo";
  return "document";
}

function toPosixRelativePath(fromDir, targetPath) {
  const relative = path.relative(fromDir, targetPath);
  if (!relative || relative.startsWith("..")) return null;
  return relative.split(path.sep).join("/");
}

function resolveStoragePathWithinDataDir(dataDir, storageRelPath) {
  const rootDir = path.resolve(String(dataDir || ""));
  const absolutePath = path.resolve(rootDir, String(storageRelPath || ""));
  const relative = path.relative(rootDir, absolutePath);

  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolutePath;
}

function computeFileSha256(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(fileBuffer).digest("hex");
}

function createMediaUploadMiddleware(config) {
  const dataDir = config?.dataDir;
  if (!dataDir) {
    throw new Error("Missing app data directory configuration");
  }

  const baseMediaDir = path.resolve(dataDir, "media");
  fs.mkdirSync(baseMediaDir, { recursive: true });

  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, callback) => {
        const inspectionId = req?.inspection?.id;
        if (!Number.isFinite(inspectionId)) {
          callback(new Error("Inspection context is required before upload"));
          return;
        }

        const inspectionMediaDir = path.resolve(baseMediaDir, String(inspectionId));
        fs.mkdirSync(inspectionMediaDir, { recursive: true });
        callback(null, inspectionMediaDir);
      },
      filename: (_req, file, callback) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        const safeExt = /^[.][a-z0-9]{1,12}$/.test(ext) ? ext : "";
        const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${safeExt}`;
        callback(null, uniqueName);
      },
    }),
    limits: {
      fileSize: MAX_MEDIA_FILE_SIZE_BYTES,
      files: 1,
    },
  });
}

function getMediaUploadMiddleware(req) {
  const app = req.app;
  if (!app.locals.mediaUploadMiddleware) {
    app.locals.mediaUploadMiddleware = createMediaUploadMiddleware(app.locals.config);
  }
  return app.locals.mediaUploadMiddleware;
}

function normalizeReviewDecision(value) {
  const text = normalizeNullableText(value);
  if (!text) return null;
  if (text === "in_review") return "review";
  return text;
}

function reviewDecisionToStatus(decision) {
  if (decision === "review") return "in_review";
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  if (decision === "reopen") return "reopened";
  return null;
}

function createInspectionNumber() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  const random = Math.floor(Math.random() * 900 + 100);
  return `INSP-${stamp}-${random}`;
}

function buildSelectInspectionByIdQuery() {
  return `
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
  `;
}

function fetchInspectionById(db, inspectionId) {
  return db.prepare(buildSelectInspectionByIdQuery()).get(inspectionId);
}

function fetchInspectionItems(db, inspectionId) {
  return db
    .prepare(
      `
      SELECT
        id,
        inspection_id,
        item_key,
        item_label,
        response_value,
        result,
        comment,
        answered_by,
        answered_at,
        created_at,
        updated_at
      FROM inspection_item_responses
      WHERE inspection_id = ?
      ORDER BY item_key ASC
      `
    )
    .all(inspectionId);
}

function fetchInspectionMedia(db, inspectionId) {
  return db
    .prepare(
      `
      SELECT
        id,
        inspection_id,
        item_response_id,
        item_key,
        uploaded_by,
        media_type,
        original_file_name,
        stored_file_name,
        mime_type,
        file_size_bytes,
        storage_rel_path,
        checksum_sha256,
        created_at
      FROM media_files
      WHERE inspection_id = ?
      ORDER BY datetime(created_at) ASC, id ASC
      `
    )
    .all(inspectionId);
}

function fetchInspectionMediaById(db, inspectionId, mediaId) {
  return db
    .prepare(
      `
      SELECT
        id,
        inspection_id,
        item_response_id,
        item_key,
        uploaded_by,
        media_type,
        original_file_name,
        stored_file_name,
        mime_type,
        file_size_bytes,
        storage_rel_path,
        checksum_sha256,
        created_at
      FROM media_files
      WHERE inspection_id = ? AND id = ?
      LIMIT 1
      `
    )
    .get(inspectionId, mediaId);
}

function parseAuditDetails(rawDetails) {
  if (!rawDetails) return {};

  try {
    const parsed = JSON.parse(rawDetails);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function timelineCategoryFromAction(action) {
  if (action === "inspection.created") return "lifecycle";
  if (action === "inspection.submitted") return "status";
  if (action === "inspection.updated") return "inspection";
  if (action === "inspection.items_upserted") return "items";
  if (action.startsWith("inspection.media_")) return "media";
  if (
    action === "inspection.review" ||
    action === "inspection.approve" ||
    action === "inspection.reject" ||
    action === "inspection.reopen"
  ) {
    return "review";
  }
  return "inspection";
}

function normalizeTimelineEntry(row) {
  const details = parseAuditDetails(row.details_json);
  return {
    id: row.id,
    action: row.action,
    category: timelineCategoryFromAction(row.action),
    actor: {
      id: row.actor_user_id ?? null,
      username: row.actor_username ?? null,
      full_name: row.actor_name ?? null,
    },
    entity: {
      type: row.entity_type,
      id: row.entity_id ?? null,
    },
    details,
    created_at: row.created_at,
  };
}

function normalizeInspectionMapRow(row) {
  const geometry = parseGeometryJson(row.geometry_json);
  const rawGeometryType = String(row.geometry_type || "").toLowerCase();
  const geometryType = VALID_INSPECTION_GEOMETRY_TYPES.has(rawGeometryType)
    ? rawGeometryType
    : geometry?.type === "Point"
      ? "point"
      : geometry
        ? "area"
        : null;

  return {
    id: row.id,
    inspection_no: row.inspection_no,
    site_name: row.site_name,
    team_id: row.team_id,
    assigned_to: row.assigned_to,
    created_by: row.created_by,
    status: row.status,
    overall_result: row.overall_result,
    latitude: row.latitude,
    longitude: row.longitude,
    geometry_type: geometryType,
    geometry,
    notes: row.notes ?? null,
    updated_at: row.updated_at,
  };
}

function normalizeMasterOverlayRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title ?? null,
    label_text: row.label_text ?? null,
    geometry: parseGeometryJson(row.geometry_json),
    latitude: row.latitude,
    longitude: row.longitude,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function timelineCategoryToSqlCondition(category) {
  if (category === "lifecycle") return "a.action = 'inspection.created'";
  if (category === "status") return "a.action = 'inspection.submitted'";
  if (category === "inspection") return "a.action = 'inspection.updated'";
  if (category === "items") return "a.action = 'inspection.items_upserted'";
  if (category === "media") return "a.action LIKE 'inspection.media_%'";
  if (category === "review") {
    return "a.action IN ('inspection.review', 'inspection.approve', 'inspection.reject', 'inspection.reopen')";
  }
  return null;
}

function calculateOverallResultFromCounts(counts) {
  const failCount = counts.fail_count ?? 0;
  const passCount = counts.pass_count ?? 0;
  const naCount = counts.na_count ?? 0;

  if (failCount > 0) return "fail";
  if (passCount > 0) return "pass";
  if (naCount > 0) return "na";
  return "na";
}

function recalculateInspectionOverallResult(db, inspectionId) {
  const counts = db
    .prepare(
      `
      SELECT
        SUM(CASE WHEN result = 'fail' THEN 1 ELSE 0 END) AS fail_count,
        SUM(CASE WHEN result = 'pass' THEN 1 ELSE 0 END) AS pass_count,
        SUM(CASE WHEN result = 'na' THEN 1 ELSE 0 END) AS na_count
      FROM inspection_item_responses
      WHERE inspection_id = ?
      `
    )
    .get(inspectionId);

  const overallResult = calculateOverallResultFromCounts(counts || {});
  db.prepare(
    `
    UPDATE inspections
    SET overall_result = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
    `
  ).run(overallResult, inspectionId);

  return overallResult;
}

function buildTeamContextFromBody(req) {
  const teamId = parseInteger(req.body?.team_id);
  return {
    target: { team_id: teamId },
    inspection: { team_id: teamId },
  };
}

function buildInspectionContext(req) {
  return {
    inspection: req.inspection,
    target: { team_id: req.inspection.team_id },
    patchFields: Object.keys(req.body || {}),
  };
}

function buildInspectionListScope(user, roles) {
  if (roles.includes("admin")) {
    return { allowed: true, whereClauses: [], params: [] };
  }

  const whereClauses = [];
  const params = [];
  const teamIds = Array.isArray(user?.team_ids)
    ? user.team_ids.filter((teamId) => Number.isFinite(teamId))
    : [];
  const actorId = Number.isFinite(user?.id) ? user.id : null;

  if (roles.includes("supervisor") && teamIds.length > 0) {
    whereClauses.push(`inspections.team_id IN (${teamIds.map(() => "?").join(",")})`);
    params.push(...teamIds);
  }

  if (roles.includes("inspector") && actorId != null) {
    whereClauses.push("(inspections.assigned_to = ? OR inspections.created_by = ?)");
    params.push(actorId, actorId);
  }

  if (whereClauses.length === 0) {
    return { allowed: false, whereClauses: [], params: [] };
  }

  return { allowed: true, whereClauses: [`(${whereClauses.join(" OR ")})`], params };
}

function buildInspectionListQueryContext(req) {
  const roles = rolesFromUser(req.user);
  const scope = buildInspectionListScope(req.user, roles);
  if (!scope.allowed) {
    return {
      errorStatus: 403,
      errorBody: { error: "Forbidden" },
    };
  }

  const statusFilter = parseStringList(req.query?.status).map((status) => status.toLowerCase());
  const invalidStatus = statusFilter.find((status) => !VALID_INSPECTION_STATUSES.has(status));
  if (invalidStatus) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: `Unknown status: ${invalidStatus}`,
      },
    };
  }

  const teamIdRaw = normalizeNullableText(req.query?.team_id);
  const teamId = teamIdRaw == null ? null : parseInteger(teamIdRaw);
  if (teamIdRaw != null && teamId == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "team_id must be an integer",
      },
    };
  }

  const assignedToRaw = normalizeNullableText(req.query?.assigned_to);
  const assignedTo = assignedToRaw == null ? null : parseInteger(assignedToRaw);
  if (assignedToRaw != null && assignedTo == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "assigned_to must be an integer",
      },
    };
  }

  const createdByRaw = normalizeNullableText(req.query?.created_by);
  const createdBy = createdByRaw == null ? null : parseInteger(createdByRaw);
  if (createdByRaw != null && createdBy == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "created_by must be an integer",
      },
    };
  }

  const dateFromRaw = normalizeNullableText(req.query?.date_from);
  const dateToRaw = normalizeNullableText(req.query?.date_to);
  const dateFrom = parseDateFilter(dateFromRaw);
  const dateTo = parseDateFilter(dateToRaw);
  if (dateFromRaw != null && dateFrom == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "date_from must be in YYYY-MM-DD format",
      },
    };
  }
  if (dateToRaw != null && dateTo == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "date_to must be in YYYY-MM-DD format",
      },
    };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "date_from must be earlier than or equal to date_to",
      },
    };
  }

  const requestedLimitRaw = normalizeNullableText(req.query?.limit);
  const requestedPageRaw = normalizeNullableText(req.query?.page);
  const requestedLimit = requestedLimitRaw == null ? null : parsePositiveInteger(requestedLimitRaw);
  const requestedPage = requestedPageRaw == null ? null : parsePositiveInteger(requestedPageRaw);

  if (requestedLimitRaw != null && requestedLimit == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "limit must be a positive integer",
      },
    };
  }
  if (requestedPageRaw != null && requestedPage == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "page must be a positive integer",
      },
    };
  }

  const limit = Math.min(requestedLimit ?? DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT);
  const page = requestedPage ?? 1;
  const offset = (page - 1) * limit;

  const requestedSort = normalizeNullableText(req.query?.sort);
  const requestedOrder = normalizeNullableText(req.query?.order);
  let sortField = requestedSort || "created_at";
  let sortDirection = "DESC";

  if (sortField.startsWith("-")) {
    sortField = sortField.slice(1);
    sortDirection = "DESC";
  }

  if (requestedOrder) {
    const lowered = requestedOrder.toLowerCase();
    if (lowered !== "asc" && lowered !== "desc") {
      return {
        errorStatus: 400,
        errorBody: {
          error: "Invalid request",
          message: "order must be either asc or desc",
        },
      };
    }
    sortDirection = lowered.toUpperCase();
  }

  const sortMap = {
    created_at: "inspections.created_at",
    updated_at: "inspections.updated_at",
    inspection_no: "inspections.inspection_no",
    site_name: "inspections.site_name",
    status: "inspections.status",
    overall_result: "inspections.overall_result",
  };
  const sortColumn = sortMap[sortField];
  if (!sortColumn) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message:
          "sort must be one of: created_at, updated_at, inspection_no, site_name, status, overall_result",
      },
    };
  }

  const search = normalizeNullableText(req.query?.search);
  const whereClauses = [...scope.whereClauses];
  const whereParams = [...scope.params];

  if (statusFilter.length > 0) {
    whereClauses.push(`inspections.status IN (${statusFilter.map(() => "?").join(",")})`);
    whereParams.push(...statusFilter);
  }

  if (teamId != null) {
    whereClauses.push("inspections.team_id = ?");
    whereParams.push(teamId);
  }

  if (assignedTo != null) {
    whereClauses.push("inspections.assigned_to = ?");
    whereParams.push(assignedTo);
  }

  if (createdBy != null) {
    whereClauses.push("inspections.created_by = ?");
    whereParams.push(createdBy);
  }

  if (search) {
    const pattern = `%${search}%`;
    whereClauses.push(
      "(inspections.inspection_no LIKE ? OR inspections.site_name LIKE ? OR COALESCE(inspections.notes, '') LIKE ?)"
    );
    whereParams.push(pattern, pattern, pattern);
  }

  if (dateFrom) {
    whereClauses.push("DATE(inspections.created_at) >= DATE(?)");
    whereParams.push(dateFrom);
  }

  if (dateTo) {
    whereClauses.push("DATE(inspections.created_at) <= DATE(?)");
    whereParams.push(dateTo);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return {
    roles,
    whereSql,
    whereParams,
    page,
    limit,
    offset,
    sortColumn,
    sortDirection,
    filters: {
      status: statusFilter,
      team_id: teamId,
      assigned_to: assignedTo,
      created_by: createdBy,
      search,
      date_from: dateFrom,
      date_to: dateTo,
      sort: sortField,
      order: sortDirection.toLowerCase(),
    },
  };
}

function isAdminUser(user) {
  const roles = rolesFromUser(user);
  return can(roles, "manage", "users", { actor: user });
}

function explainQueryPlan(db, sql, params = []) {
  return db
    .prepare(`EXPLAIN QUERY PLAN ${sql}`)
    .all(...params)
    .map((row) => ({
      id: row.id,
      parent: row.parent,
      detail: row.detail,
    }));
}

function roundDurationMs(value) {
  return Number.parseFloat(Number(value || 0).toFixed(3));
}

function measureDurationMs(fn) {
  const startedAt = process.hrtime.bigint();
  const result = fn();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  return {
    result,
    durationMs: roundDurationMs(elapsedMs),
  };
}

function parseJsonObject(rawValue) {
  if (!rawValue) return {};

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function safeStringifyObject(value) {
  try {
    return JSON.stringify(value && typeof value === "object" ? value : {});
  } catch (_error) {
    return "{}";
  }
}

function recordPerfSample(db, seriesName, sample, retentionLimit = MAX_PERF_DB_HISTORY_ITEMS) {
  const insertAndTrim = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO query_perf_samples (
        series_name,
        measured_at,
        duration_ms,
        filtered_total_items,
        returned_items,
        filters_json
      )
      VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(
      String(seriesName),
      String(sample?.measured_at || new Date().toISOString()),
      Number(sample?.duration_ms) || 0,
      Number(sample?.filtered_total_items) || 0,
      Number(sample?.returned_items) || 0,
      safeStringifyObject(sample?.filters)
    );

    const limit = Number.isFinite(retentionLimit) && retentionLimit > 0 ? retentionLimit : 0;
    if (limit <= 0) return;

    db.prepare(
      `
      DELETE FROM query_perf_samples
      WHERE series_name = ?
        AND id NOT IN (
          SELECT id
          FROM query_perf_samples
          WHERE series_name = ?
          ORDER BY id DESC
          LIMIT ?
        )
      `
    ).run(seriesName, seriesName, limit);
  });

  insertAndTrim();
}

function summarizePerfSeries(db, seriesName) {
  const aggregates = db
    .prepare(
      `
      SELECT
        COUNT(*) AS samples,
        MIN(duration_ms) AS min_ms,
        MAX(duration_ms) AS max_ms,
        AVG(duration_ms) AS avg_ms
      FROM query_perf_samples
      WHERE series_name = ?
      `
    )
    .get(seriesName);

  const last = db
    .prepare(
      `
      SELECT duration_ms AS last_ms, measured_at AS last_measured_at
      FROM query_perf_samples
      WHERE series_name = ?
      ORDER BY id DESC
      LIMIT 1
      `
    )
    .get(seriesName);

  const sampleCount = Number(aggregates?.samples) || 0;
  if (sampleCount === 0) {
    return {
      samples: 0,
      min_ms: 0,
      max_ms: 0,
      avg_ms: 0,
      last_ms: 0,
      last_measured_at: null,
    };
  }

  return {
    samples: sampleCount,
    min_ms: roundDurationMs(aggregates?.min_ms || 0),
    max_ms: roundDurationMs(aggregates?.max_ms || 0),
    avg_ms: roundDurationMs(aggregates?.avg_ms || 0),
    last_ms: roundDurationMs(last?.last_ms || 0),
    last_measured_at: last?.last_measured_at || null,
  };
}

function recentPerfSeries(db, seriesName, limit) {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_PERF_RECENT_LIMIT;
  const rows = db
    .prepare(
      `
      SELECT
        measured_at,
        duration_ms,
        filtered_total_items,
        returned_items,
        filters_json
      FROM query_perf_samples
      WHERE series_name = ?
      ORDER BY id DESC
      LIMIT ?
      `
    )
    .all(seriesName, safeLimit);

  return rows.map((entry) => ({
    measured_at: entry.measured_at,
    duration_ms: roundDurationMs(entry.duration_ms),
    filtered_total_items: Number(entry.filtered_total_items) || 0,
    returned_items: Number(entry.returned_items) || 0,
    filters: parseJsonObject(entry.filters_json),
  }));
}

function parsePerfSeriesFilter(value) {
  const rawSeries = parseStringList(value).map((entry) => entry.toLowerCase());
  if (rawSeries.length === 0) return ["list", "timeline"];

  const unique = [];
  const seen = new Set();
  for (const entry of rawSeries) {
    if (!["list", "timeline"].includes(entry) || seen.has(entry)) continue;
    seen.add(entry);
    unique.push(entry);
  }
  return unique;
}

function planPerfPurgeForSeries(db, seriesName, options) {
  const beforeCount =
    db.prepare("SELECT COUNT(*) AS total FROM query_perf_samples WHERE series_name = ?").get(seriesName)
      ?.total ?? 0;

  if (options?.reset) {
    return {
      before_count: Number(beforeCount) || 0,
      after_count: 0,
      would_delete_count: Number(beforeCount) || 0,
    };
  }

  let eligibleWhereSql = "series_name = ?";
  const eligibleParams = [seriesName];

  if (options?.olderThanDays != null) {
    eligibleWhereSql += " AND datetime(measured_at) >= datetime('now', ?)";
    eligibleParams.push(`-${options.olderThanDays} days`);
  }

  let remainingCount =
    db.prepare(`SELECT COUNT(*) AS total FROM query_perf_samples WHERE ${eligibleWhereSql}`).get(
      ...eligibleParams
    )?.total ?? 0;

  if (options?.keepLatest != null) {
    remainingCount =
      db.prepare(
        `
        SELECT COUNT(*) AS total
        FROM (
          SELECT id
          FROM query_perf_samples
          WHERE ${eligibleWhereSql}
          ORDER BY id DESC
          LIMIT ?
        ) kept
        `
      ).get(...eligibleParams, options.keepLatest)?.total ?? 0;
  }

  const before = Number(beforeCount) || 0;
  const after = Number(remainingCount) || 0;
  const wouldDelete = Math.max(0, before - after);

  return {
    before_count: before,
    after_count: after,
    would_delete_count: wouldDelete,
  };
}

function buildTimelineDebugQueryContext(req) {
  const inspectionIdRaw = normalizeNullableText(req.query?.tl_inspection_id);
  const inspectionId = inspectionIdRaw == null ? 1 : parseInteger(inspectionIdRaw);
  if (inspectionId == null || inspectionId <= 0) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "tl_inspection_id must be a positive integer",
      },
    };
  }

  const requestedLimitRaw = normalizeNullableText(req.query?.tl_limit);
  const requestedPageRaw = normalizeNullableText(req.query?.tl_page);
  const requestedDateFromRaw = normalizeNullableText(req.query?.tl_date_from);
  const requestedDateToRaw = normalizeNullableText(req.query?.tl_date_to);
  const requestedActions = parseStringList(req.query?.tl_action).map((value) => value.toLowerCase());
  const requestedCategories = parseStringList(req.query?.tl_category).map((value) =>
    value.toLowerCase()
  );
  const requestedLimit = requestedLimitRaw == null ? null : parsePositiveInteger(requestedLimitRaw);
  const requestedPage = requestedPageRaw == null ? null : parsePositiveInteger(requestedPageRaw);
  const dateFrom = parseDateFilter(requestedDateFromRaw);
  const dateTo = parseDateFilter(requestedDateToRaw);

  if (requestedLimitRaw != null && requestedLimit == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "tl_limit must be a positive integer",
      },
    };
  }
  if (requestedPageRaw != null && requestedPage == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "tl_page must be a positive integer",
      },
    };
  }
  if (requestedDateFromRaw != null && dateFrom == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "tl_date_from must be in YYYY-MM-DD format",
      },
    };
  }
  if (requestedDateToRaw != null && dateTo == null) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "tl_date_to must be in YYYY-MM-DD format",
      },
    };
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: "tl_date_from must be earlier than or equal to tl_date_to",
      },
    };
  }

  const invalidAction = requestedActions.find((action) => !/^inspection\.[a-z0-9_]+$/.test(action));
  if (invalidAction) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: `Unknown tl_action value: ${invalidAction}`,
      },
    };
  }

  const invalidCategory = requestedCategories.find(
    (category) => !VALID_TIMELINE_CATEGORIES.has(category)
  );
  if (invalidCategory) {
    return {
      errorStatus: 400,
      errorBody: {
        error: "Invalid request",
        message: `Unknown tl_category value: ${invalidCategory}`,
      },
    };
  }

  const includeReads = parseBoolean(req.query?.tl_include_reads, false);
  const limit = Math.min(requestedLimit ?? DEFAULT_TIMELINE_LIMIT, MAX_TIMELINE_LIMIT);
  const page = requestedPage ?? 1;
  const offset = (page - 1) * limit;

  const whereClauses = [
    `
    (
      (
        a.entity_type = 'inspections'
        AND a.entity_id = ?
      )
      OR (
        a.entity_type = 'media_files'
        AND json_extract(a.details_json, '$.inspection_id') = ?
      )
    )
  `,
    "a.action LIKE 'inspection.%'",
  ];
  const whereParams = [inspectionId, inspectionId];

  if (!includeReads) {
    whereClauses.push("a.action != 'inspection.media_file_read'");
  }

  if (requestedActions.length > 0) {
    whereClauses.push(`a.action IN (${requestedActions.map(() => "?").join(",")})`);
    whereParams.push(...requestedActions);
  }

  if (requestedCategories.length > 0) {
    const categoryConditions = requestedCategories
      .map((category) => timelineCategoryToSqlCondition(category))
      .filter(Boolean);
    if (categoryConditions.length > 0) {
      whereClauses.push(`(${categoryConditions.join(" OR ")})`);
    }
  }

  if (dateFrom) {
    whereClauses.push("DATE(a.created_at) >= DATE(?)");
    whereParams.push(dateFrom);
  }

  if (dateTo) {
    whereClauses.push("DATE(a.created_at) <= DATE(?)");
    whereParams.push(dateTo);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  return {
    inspectionId,
    whereSql,
    whereParams,
    limit,
    offset,
    filters: {
      tl_inspection_id: inspectionId,
      tl_include_reads: includeReads,
      tl_action: requestedActions,
      tl_category: requestedCategories,
      tl_date_from: dateFrom,
      tl_date_to: dateTo,
      tl_limit: limit,
      tl_page: page,
    },
  };
}

function buildListQuerySql(query) {
  return `
    SELECT
      inspections.id,
      inspections.inspection_no,
      inspections.site_name,
      inspections.team_id,
      inspections.assigned_to,
      assignee.full_name AS assigned_to_name,
      inspections.created_by,
      creator.full_name AS created_by_name,
      inspections.status,
      inspections.overall_result,
      inspections.latitude,
      inspections.longitude,
      inspections.geometry_type,
      inspections.geometry_json,
      inspections.notes,
      inspections.created_at,
      inspections.updated_at
    FROM inspections
    LEFT JOIN users assignee ON assignee.id = inspections.assigned_to
    LEFT JOIN users creator ON creator.id = inspections.created_by
    ${query.whereSql}
    ORDER BY ${query.sortColumn} ${query.sortDirection}, inspections.id DESC
    LIMIT ? OFFSET ?
  `;
}

function buildTimelineQuerySql(query) {
  return `
    SELECT
      a.id,
      a.actor_user_id,
      actor.username AS actor_username,
      actor.full_name AS actor_name,
      a.action,
      a.entity_type,
      a.entity_id,
      a.details_json,
      a.created_at
    FROM audit_logs a
    LEFT JOIN users actor ON actor.id = a.actor_user_id
    ${query.whereSql}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ? OFFSET ?
  `;
}

router.get("/", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const query = buildInspectionListQueryContext(req);
  if (query.errorStatus) {
    res.status(query.errorStatus).json(query.errorBody);
    return;
  }

  const total = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM inspections
      ${query.whereSql}
      `
    )
    .get(...query.whereParams)?.total;

  const rows = db
    .prepare(
      buildListQuerySql(query)
    )
    .all(...query.whereParams, query.limit, query.offset)
    .filter((inspection) =>
      can(query.roles, "read", "inspections", {
        actor: req.user,
        inspection,
        target: { team_id: inspection.team_id },
      })
    );

  const totalItems = Number.isFinite(total) ? total : 0;
  const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / query.limit);

  res.json({
    data: rows,
    pagination: {
      page: query.page,
      limit: query.limit,
      total_items: totalItems,
      total_pages: totalPages,
      has_next: query.page < totalPages,
      has_prev: query.page > 1,
    },
    filters: query.filters,
  });
});

router.get("/summary", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const query = buildInspectionListQueryContext(req);
  if (query.errorStatus) {
    res.status(query.errorStatus).json(query.errorBody);
    return;
  }

  const total = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM inspections
      ${query.whereSql}
      `
    )
    .get(...query.whereParams)?.total;

  const rows = db
    .prepare(
      `
      SELECT inspections.status, COUNT(*) AS count
      FROM inspections
      ${query.whereSql}
      GROUP BY inspections.status
      `
    )
    .all(...query.whereParams);

  const byStatus = {};
  for (const status of VALID_INSPECTION_STATUSES) {
    byStatus[status] = 0;
  }
  for (const row of rows) {
    const status = String(row.status || "");
    if (!VALID_INSPECTION_STATUSES.has(status)) continue;
    byStatus[status] = Number(row.count) || 0;
  }

  res.json({
    data: {
      total_items: Number.isFinite(total) ? total : 0,
      by_status: byStatus,
    },
    filters: query.filters,
  });
});

router.get("/summary/by-assignee", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const query = buildInspectionListQueryContext(req);
  if (query.errorStatus) {
    res.status(query.errorStatus).json(query.errorBody);
    return;
  }

  const total = db
    .prepare(
      `
      SELECT COUNT(*) AS total
      FROM inspections
      ${query.whereSql}
      `
    )
    .get(...query.whereParams)?.total;

  const rows = db
    .prepare(
      `
      SELECT
        inspections.assigned_to,
        assignee.full_name AS assigned_to_name,
        COUNT(*) AS count
      FROM inspections
      LEFT JOIN users assignee ON assignee.id = inspections.assigned_to
      ${query.whereSql}
      GROUP BY inspections.assigned_to, assignee.full_name
      ORDER BY count DESC, assigned_to_name ASC, inspections.assigned_to ASC
      `
    )
    .all(...query.whereParams);

  const byAssignee = rows.map((row) => ({
    assigned_to: row.assigned_to,
    assigned_to_name: row.assigned_to_name ?? null,
    count: Number(row.count) || 0,
  }));

  res.json({
    data: {
      total_items: Number.isFinite(total) ? total : 0,
      total_assignees: byAssignee.length,
      by_assignee: byAssignee,
    },
    filters: query.filters,
  });
});

router.get("/map", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const query = buildInspectionListQueryContext(req);
  if (query.errorStatus) {
    res.status(query.errorStatus).json(query.errorBody);
    return;
  }

  const rows = db
    .prepare(
      `
      SELECT
        inspections.id,
        inspections.inspection_no,
        inspections.site_name,
        inspections.team_id,
        inspections.assigned_to,
        inspections.created_by,
        inspections.status,
        inspections.overall_result,
        inspections.latitude,
        inspections.longitude,
        inspections.geometry_type,
        inspections.geometry_json,
        inspections.notes,
        inspections.updated_at
      FROM inspections
      ${query.whereSql}
      ORDER BY inspections.site_name ASC, inspections.id ASC
      `
    )
    .all(...query.whereParams)
    .map(normalizeInspectionMapRow);

  const withLocation = rows.filter(
    (row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude)
  ).length;

  res.json({
    data: rows,
    meta: {
      total_items: rows.length,
      with_location: withLocation,
      without_location: rows.length - withLocation,
    },
    filters: query.filters,
  });
});

router.get("/master-map", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const query = buildInspectionListQueryContext(req);
  if (query.errorStatus) {
    res.status(query.errorStatus).json(query.errorBody);
    return;
  }

  const inspections = db
    .prepare(
      `
      SELECT
        inspections.id,
        inspections.inspection_no,
        inspections.site_name,
        inspections.team_id,
        inspections.assigned_to,
        inspections.created_by,
        inspections.status,
        inspections.overall_result,
        inspections.latitude,
        inspections.longitude,
        inspections.geometry_type,
        inspections.geometry_json,
        inspections.notes,
        inspections.updated_at
      FROM inspections
      ${query.whereSql}
      ORDER BY inspections.site_name ASC, inspections.id ASC
      `
    )
    .all(...query.whereParams)
    .map(normalizeInspectionMapRow);

  const overlays = db
    .prepare(
      `
      SELECT
        id,
        kind,
        title,
        label_text,
        geometry_json,
        latitude,
        longitude,
        created_by,
        created_at,
        updated_at
      FROM master_map_overlays
      ORDER BY datetime(created_at) ASC, id ASC
      `
    )
    .all()
    .map(normalizeMasterOverlayRow);

  const withLocation = inspections.filter(
    (inspection) => Number.isFinite(inspection.latitude) && Number.isFinite(inspection.longitude)
  ).length;

  res.json({
    data: {
      inspections,
      overlays,
    },
    meta: {
      total_inspections: inspections.length,
      with_location: withLocation,
      without_location: inspections.length - withLocation,
      total_overlays: overlays.length,
    },
    filters: query.filters,
  });
});

router.post("/master-map/overlays", requireUser, requirePasswordChangeCompleted, (req, res) => {
  const db = req.app.locals.db;
  const kind = normalizeNullableText(req.body?.kind)?.toLowerCase();
  if (!kind || !VALID_MASTER_OVERLAY_KINDS.has(kind)) {
    res.status(400).json({
      error: "Invalid request",
      message: "kind must be one of: zone, label",
    });
    return;
  }

  const title = normalizeNullableText(req.body?.title);
  const labelText = normalizeNullableText(req.body?.label_text);

  let latitude = null;
  let longitude = null;
  let geometryJson = null;

  if (kind === "zone") {
    const normalizedGeometry = normalizeInspectionGeometry(req.body?.geometry);
    if (normalizedGeometry.error || normalizedGeometry.geometry_type !== "area") {
      res.status(400).json({
        error: "Invalid request",
        message: normalizedGeometry.error || "zone requires Polygon or MultiPolygon geometry",
      });
      return;
    }

    const serializedGeometry = safeStringifyJson(normalizedGeometry.geometry);
    if (!serializedGeometry) {
      res.status(400).json({
        error: "Invalid request",
        message: "Could not serialize zone geometry",
      });
      return;
    }

    geometryJson = serializedGeometry;
    latitude = normalizedGeometry.latitude;
    longitude = normalizedGeometry.longitude;
  } else {
    latitude = parseCoordinate(req.body?.latitude, -90, 90);
    longitude = parseCoordinate(req.body?.longitude, -180, 180);
    if (latitude == null || longitude == null || !labelText) {
      res.status(400).json({
        error: "Invalid request",
        message: "label overlays require label_text, latitude, and longitude",
      });
      return;
    }
  }

  const result = db
    .prepare(
      `
      INSERT INTO master_map_overlays (
        kind,
        title,
        label_text,
        geometry_json,
        latitude,
        longitude,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `
    )
    .run(kind, title, labelText, geometryJson, latitude, longitude, req.user.id);

  const created = db
    .prepare(
      `
      SELECT
        id,
        kind,
        title,
        label_text,
        geometry_json,
        latitude,
        longitude,
        created_by,
        created_at,
        updated_at
      FROM master_map_overlays
      WHERE id = ?
      LIMIT 1
      `
    )
    .get(Number(result.lastInsertRowid));

  writeAuditLog(
    db,
    req.user.id,
    "master_map.overlay_created",
    "master_map_overlays",
    created.id,
    {
      kind: created.kind,
      title: created.title,
      label_text: created.label_text,
    }
  );

  res.status(201).json({ data: normalizeMasterOverlayRow(created) });
});

router.patch(
  "/master-map/overlays/:overlayId",
  requireUser,
  requirePasswordChangeCompleted,
  (req, res) => {
    const overlayId = parseInteger(req.params?.overlayId);
    if (overlayId == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "overlayId must be an integer",
      });
      return;
    }

    const db = req.app.locals.db;
    const existing = db
      .prepare(
        `
        SELECT
          id,
          kind,
          title,
          label_text,
          geometry_json,
          latitude,
          longitude,
          created_by,
          created_at,
          updated_at
        FROM master_map_overlays
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(overlayId);

    if (!existing) {
      res.status(404).json({ error: "Overlay not found" });
      return;
    }

    const hasTitle = Object.prototype.hasOwnProperty.call(req.body || {}, "title");
    const hasLabelText = Object.prototype.hasOwnProperty.call(req.body || {}, "label_text");
    const hasLatitude = Object.prototype.hasOwnProperty.call(req.body || {}, "latitude");
    const hasLongitude = Object.prototype.hasOwnProperty.call(req.body || {}, "longitude");
    const hasGeometry = Object.prototype.hasOwnProperty.call(req.body || {}, "geometry");

    let nextTitle = hasTitle ? normalizeNullableText(req.body?.title) : existing.title;
    let nextLabelText = hasLabelText ? normalizeNullableText(req.body?.label_text) : existing.label_text;
    let nextLatitude = hasLatitude ? parseCoordinate(req.body?.latitude, -90, 90) : existing.latitude;
    let nextLongitude = hasLongitude ? parseCoordinate(req.body?.longitude, -180, 180) : existing.longitude;
    let nextGeometryJson = existing.geometry_json;

    if (existing.kind === "zone") {
      if (hasGeometry) {
        const normalizedGeometry = normalizeInspectionGeometry(req.body?.geometry);
        if (normalizedGeometry.error || normalizedGeometry.geometry_type !== "area") {
          res.status(400).json({
            error: "Invalid request",
            message: normalizedGeometry.error || "zone requires Polygon or MultiPolygon geometry",
          });
          return;
        }

        const serializedGeometry = safeStringifyJson(normalizedGeometry.geometry);
        if (!serializedGeometry) {
          res.status(400).json({
            error: "Invalid request",
            message: "Could not serialize zone geometry",
          });
          return;
        }

        nextGeometryJson = serializedGeometry;
        nextLatitude = normalizedGeometry.latitude;
        nextLongitude = normalizedGeometry.longitude;
      }

      if (!nextGeometryJson) {
        res.status(400).json({
          error: "Invalid request",
          message: "zone geometry is required",
        });
        return;
      }
    } else {
      if ((hasLatitude && nextLatitude == null) || (hasLongitude && nextLongitude == null)) {
        res.status(400).json({
          error: "Invalid request",
          message: "latitude must be between -90 and 90 and longitude between -180 and 180",
        });
        return;
      }
      if (!nextLabelText || nextLatitude == null || nextLongitude == null) {
        res.status(400).json({
          error: "Invalid request",
          message: "label overlays require label_text, latitude, and longitude",
        });
        return;
      }
      nextGeometryJson = null;
    }

    db.prepare(
      `
      UPDATE master_map_overlays
      SET
        title = ?,
        label_text = ?,
        geometry_json = ?,
        latitude = ?,
        longitude = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(nextTitle, nextLabelText, nextGeometryJson, nextLatitude, nextLongitude, overlayId);

    const updated = db
      .prepare(
        `
        SELECT
          id,
          kind,
          title,
          label_text,
          geometry_json,
          latitude,
          longitude,
          created_by,
          created_at,
          updated_at
        FROM master_map_overlays
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(overlayId);

    writeAuditLog(
      db,
      req.user.id,
      "master_map.overlay_updated",
      "master_map_overlays",
      overlayId,
      {
        kind: existing.kind,
      }
    );

    res.json({ data: normalizeMasterOverlayRow(updated) });
  }
);

router.delete(
  "/master-map/overlays/:overlayId",
  requireUser,
  requirePasswordChangeCompleted,
  (req, res) => {
    const overlayId = parseInteger(req.params?.overlayId);
    if (overlayId == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "overlayId must be an integer",
      });
      return;
    }

    const db = req.app.locals.db;
    const existing = db
      .prepare(
        `
        SELECT id, kind, title, label_text
        FROM master_map_overlays
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(overlayId);

    if (!existing) {
      res.status(404).json({ error: "Overlay not found" });
      return;
    }

    db.prepare(
      `
      DELETE FROM master_map_overlays
      WHERE id = ?
      `
    ).run(overlayId);

    writeAuditLog(
      db,
      req.user.id,
      "master_map.overlay_deleted",
      "master_map_overlays",
      overlayId,
      {
        kind: existing.kind,
        title: existing.title,
      }
    );

    res.json({ success: true, id: overlayId });
  }
);

router.get("/debug/index-plan", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdminUser(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const db = req.app.locals.db;
  const listQuery = buildInspectionListQueryContext(req);
  if (listQuery.errorStatus) {
    res.status(listQuery.errorStatus).json(listQuery.errorBody);
    return;
  }

  const timelineQuery = buildTimelineDebugQueryContext(req);
  if (timelineQuery.errorStatus) {
    res.status(timelineQuery.errorStatus).json(timelineQuery.errorBody);
    return;
  }

  const listSql = buildListQuerySql(listQuery);
  const listParams = [...listQuery.whereParams, listQuery.limit, listQuery.offset];
  const listPlan = explainQueryPlan(db, listSql, listParams);

  const timelineSql = buildTimelineQuerySql(timelineQuery);
  const timelineParams = [...timelineQuery.whereParams, timelineQuery.limit, timelineQuery.offset];
  const timelinePlan = explainQueryPlan(db, timelineSql, timelineParams);

  const indexes = db
    .prepare(
      `
      SELECT name, tbl_name, sql
      FROM sqlite_master
      WHERE type = 'index'
        AND tbl_name IN ('inspections', 'audit_logs')
      ORDER BY tbl_name ASC, name ASC
      `
    )
    .all();

  res.json({
    data: {
      indexes,
      list: {
        filters: listQuery.filters,
        explain_query_plan: listPlan,
      },
      timeline: {
        filters: timelineQuery.filters,
        explain_query_plan: timelinePlan,
      },
    },
  });
});

router.get("/debug/perf-snapshot", requireUser, requirePasswordChangeCompleted, (req, res) => {
  if (!isAdminUser(req.user)) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const db = req.app.locals.db;
  const listQuery = buildInspectionListQueryContext(req);
  if (listQuery.errorStatus) {
    res.status(listQuery.errorStatus).json(listQuery.errorBody);
    return;
  }

  const timelineQuery = buildTimelineDebugQueryContext(req);
  if (timelineQuery.errorStatus) {
    res.status(timelineQuery.errorStatus).json(timelineQuery.errorBody);
    return;
  }

  const recentLimitRaw = normalizeNullableText(req.query?.recent_limit);
  const recentLimitParsed = recentLimitRaw == null ? null : parsePositiveInteger(recentLimitRaw);
  if (recentLimitRaw != null && recentLimitParsed == null) {
    res.status(400).json({
      error: "Invalid request",
      message: "recent_limit must be a positive integer",
    });
    return;
  }
  const recentLimit = Math.min(recentLimitParsed ?? DEFAULT_PERF_RECENT_LIMIT, MAX_PERF_RECENT_LIMIT);

  const tableCounts = db
    .prepare(
      `
      SELECT
        (SELECT COUNT(*) FROM inspections) AS inspections,
        (SELECT COUNT(*) FROM inspection_item_responses) AS inspection_item_responses,
        (SELECT COUNT(*) FROM media_files) AS media_files,
        (SELECT COUNT(*) FROM audit_logs) AS audit_logs
      `
    )
    .get();

  const listCountSql = `
    SELECT COUNT(*) AS total
    FROM inspections
    ${listQuery.whereSql}
  `;
  const listDataSql = buildListQuerySql(listQuery);
  const measuredList = measureDurationMs(() => {
    const filteredTotal = db.prepare(listCountSql).get(...listQuery.whereParams)?.total ?? 0;
    const rows = db
      .prepare(listDataSql)
      .all(...listQuery.whereParams, listQuery.limit, listQuery.offset);
    return {
      filtered_total_items: Number(filteredTotal) || 0,
      returned_items: rows.length,
    };
  });

  const timelineCountSql = `
    SELECT COUNT(*) AS total
    FROM audit_logs a
    ${timelineQuery.whereSql}
  `;
  const timelineDataSql = buildTimelineQuerySql(timelineQuery);
  const measuredTimeline = measureDurationMs(() => {
    const filteredTotal = db.prepare(timelineCountSql).get(...timelineQuery.whereParams)?.total ?? 0;
    const rows = db
      .prepare(timelineDataSql)
      .all(...timelineQuery.whereParams, timelineQuery.limit, timelineQuery.offset);
    return {
      filtered_total_items: Number(filteredTotal) || 0,
      returned_items: rows.length,
    };
  });

  const measuredAt = new Date().toISOString();
  recordPerfSample(db, "list", {
    measured_at: measuredAt,
    duration_ms: measuredList.durationMs,
    ...measuredList.result,
    filters: listQuery.filters,
  });
  recordPerfSample(db, "timeline", {
    measured_at: measuredAt,
    duration_ms: measuredTimeline.durationMs,
    ...measuredTimeline.result,
    filters: timelineQuery.filters,
  });
  const listSummary = summarizePerfSeries(db, "list");
  const timelineSummary = summarizePerfSeries(db, "timeline");
  const listRecent = recentPerfSeries(db, "list", recentLimit);
  const timelineRecent = recentPerfSeries(db, "timeline", recentLimit);

  res.json({
    data: {
      measured_at: measuredAt,
      retention: {
        max_samples_per_series: MAX_PERF_DB_HISTORY_ITEMS,
      },
      row_counts: {
        inspections: Number(tableCounts?.inspections) || 0,
        inspection_item_responses: Number(tableCounts?.inspection_item_responses) || 0,
        media_files: Number(tableCounts?.media_files) || 0,
        audit_logs: Number(tableCounts?.audit_logs) || 0,
      },
      probes: {
        list: {
          duration_ms: measuredList.durationMs,
          ...measuredList.result,
          filters: listQuery.filters,
        },
        timeline: {
          duration_ms: measuredTimeline.durationMs,
          inspection_id: timelineQuery.inspectionId,
          ...measuredTimeline.result,
          filters: timelineQuery.filters,
        },
      },
      recent_timings: {
        list: {
          summary: listSummary,
          recent: listRecent,
        },
        timeline: {
          summary: timelineSummary,
          recent: timelineRecent,
        },
      },
    },
  });
});

router.post(
  "/debug/perf-snapshot/purge",
  requireUser,
  requirePasswordChangeCompleted,
  (req, res) => {
    if (!isAdminUser(req.user)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const db = req.app.locals.db;
    const series = parsePerfSeriesFilter(req.body?.series);
    if (series.length === 0) {
      res.status(400).json({
        error: "Invalid request",
        message: "series must include at least one of: list, timeline",
      });
      return;
    }

    const reset = parseBoolean(req.body?.reset, false);
    const dryRun = parseBoolean(req.body?.dry_run, false);
    const olderThanDaysRaw = normalizeNullableText(req.body?.older_than_days);
    const keepLatestRaw = normalizeNullableText(req.body?.keep_latest);
    const olderThanDays = olderThanDaysRaw == null ? null : parsePositiveInteger(olderThanDaysRaw);
    const keepLatestParsed = keepLatestRaw == null ? null : parseInteger(keepLatestRaw);
    const keepLatest =
      Number.isFinite(keepLatestParsed) && keepLatestParsed >= 0 ? keepLatestParsed : null;

    if (olderThanDaysRaw != null && olderThanDays == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "older_than_days must be a positive integer",
      });
      return;
    }

    if (keepLatestRaw != null && keepLatest == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "keep_latest must be a non-negative integer",
      });
      return;
    }

    if (!reset && olderThanDays == null && keepLatest == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "Provide at least one purge option: reset, older_than_days, or keep_latest",
      });
      return;
    }

    const beforeCounts = {};
    const projectedAfterCounts = {};
    const wouldDeleteCounts = {};
    for (const name of series) {
      const plan = planPerfPurgeForSeries(db, name, {
        reset,
        olderThanDays,
        keepLatest,
      });
      beforeCounts[name] = plan.before_count;
      projectedAfterCounts[name] = plan.after_count;
      wouldDeleteCounts[name] = plan.would_delete_count;
    }

    const deletedCounts = {};
    for (const name of series) {
      deletedCounts[name] = 0;
    }

    if (!dryRun) {
      const purgeResult = db.transaction(() => {
        for (const name of series) {
          let deletedForSeries = 0;

          if (reset) {
            deletedForSeries += db
              .prepare(
                `
                DELETE FROM query_perf_samples
                WHERE series_name = ?
                `
              )
              .run(name).changes;
          } else {
            if (olderThanDays != null) {
              deletedForSeries += db
                .prepare(
                  `
                  DELETE FROM query_perf_samples
                  WHERE series_name = ?
                    AND datetime(measured_at) < datetime('now', ?)
                  `
                )
                .run(name, `-${olderThanDays} days`).changes;
            }

            if (keepLatest != null) {
              deletedForSeries += db
                .prepare(
                  `
                  DELETE FROM query_perf_samples
                  WHERE series_name = ?
                    AND id NOT IN (
                      SELECT id
                      FROM query_perf_samples
                      WHERE series_name = ?
                      ORDER BY id DESC
                      LIMIT ?
                    )
                  `
                )
                .run(name, name, keepLatest).changes;
            }
          }

          deletedCounts[name] = deletedForSeries;
        }

        writeAuditLog(db, req.user.id, "inspection.debug_perf_purged", "query_perf_samples", null, {
          series,
          dry_run: false,
          reset,
          older_than_days: olderThanDays,
          keep_latest: keepLatest,
          deleted_counts: deletedCounts,
        });
      });

      purgeResult();
    }

    const afterCounts = {};
    for (const name of series) {
      afterCounts[name] = dryRun
        ? projectedAfterCounts[name]
        : db.prepare("SELECT COUNT(*) AS total FROM query_perf_samples WHERE series_name = ?").get(name)
            ?.total ?? 0;
    }

    const totalWouldDelete = Object.values(wouldDeleteCounts).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0
    );
    const totalDeleted = Object.values(deletedCounts).reduce(
      (sum, value) => sum + (Number(value) || 0),
      0
    );

    res.json({
      data: {
        series,
        options: {
          dry_run: dryRun,
          reset,
          older_than_days: olderThanDays,
          keep_latest: keepLatest,
        },
        before_counts: beforeCounts,
        would_delete_counts: wouldDeleteCounts,
        deleted_counts: deletedCounts,
        after_counts: afterCounts,
        total_would_delete: totalWouldDelete,
        total_deleted: totalDeleted,
      },
    });
  }
);

router.post(
  "/",
  requireUser,
  requirePasswordChangeCompleted,
  authorize("create", "inspections", {
    contextResolver: buildTeamContextFromBody,
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const siteName = normalizeNullableText(req.body?.site_name);
    const teamId = parseInteger(req.body?.team_id);
    const assignedTo = parseInteger(req.body?.assigned_to);
    const latitudeInput = parseCoordinate(req.body?.latitude, -90, 90);
    const longitudeInput = parseCoordinate(req.body?.longitude, -180, 180);
    const geometryPayload = req.body?.geometry ?? req.body?.geometry_json;
    const notes = normalizeNullableText(req.body?.notes);

    let latitude = latitudeInput;
    let longitude = longitudeInput;
    let geometryType = "point";
    let geometry = null;

    if (geometryPayload != null) {
      const normalizedGeometry = normalizeInspectionGeometry(geometryPayload);
      if (normalizedGeometry.error) {
        res.status(400).json({
          error: "Invalid request",
          message: normalizedGeometry.error,
        });
        return;
      }
      latitude = normalizedGeometry.latitude;
      longitude = normalizedGeometry.longitude;
      geometryType = normalizedGeometry.geometry_type;
      geometry = normalizedGeometry.geometry;
    } else if (latitude != null && longitude != null) {
      geometry = buildPointGeometry(longitude, latitude);
      geometryType = "point";
    }

    if (!siteName || teamId == null || assignedTo == null || latitude == null || longitude == null) {
      res.status(400).json({
        error: "Invalid request",
        message:
          "site_name, team_id, assigned_to, and a valid location are required (Point lat/lng or Polygon area)",
      });
      return;
    }

    const geometryJson = safeStringifyJson(geometry);
    if (!geometryJson) {
      res.status(400).json({
        error: "Invalid request",
        message: "Could not serialize inspection geometry",
      });
      return;
    }

    const assignedUser = db
      .prepare(
        `
        SELECT id, team_id
        FROM users
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(assignedTo);

    if (!assignedUser) {
      res.status(400).json({
        error: "Invalid request",
        message: "assigned_to user not found",
      });
      return;
    }

    if (assignedUser.team_id !== teamId) {
      res.status(400).json({
        error: "Invalid request",
        message: "assigned_to must belong to the same team_id",
      });
      return;
    }

    let createdInspectionId = null;
    let inspectionNo = null;
    const insertStmt = db.prepare(
      `
      INSERT INTO inspections (
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
        notes
      )
      VALUES (?, ?, ?, ?, ?, 'draft', 'na', ?, ?, ?, ?, ?)
      `
    );

    for (let attempts = 0; attempts < 8; attempts += 1) {
      try {
        inspectionNo = createInspectionNumber();
        const result = insertStmt.run(
          inspectionNo,
          siteName,
          teamId,
          assignedTo,
          req.user.id,
          latitude,
          longitude,
          geometryType,
          geometryJson,
          notes
        );
        createdInspectionId = Number(result.lastInsertRowid);
        break;
      } catch (error) {
        if (String(error?.message || "").includes("UNIQUE constraint failed: inspections.inspection_no")) {
          continue;
        }
        throw error;
      }
    }

    if (!Number.isFinite(createdInspectionId)) {
      res.status(500).json({
        error: "Could not create inspection number",
      });
      return;
    }

    const created = fetchInspectionById(db, createdInspectionId);
    writeAuditLog(db, req.user.id, "inspection.created", "inspections", createdInspectionId, {
      inspection_no: inspectionNo,
      team_id: teamId,
      assigned_to: assignedTo,
      latitude,
      longitude,
      geometry_type: geometryType,
    });

    res.status(201).json({ data: created });
  }
);

router.get(
  "/:id",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("read", "inspections", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    res.json({ data: req.inspection });
  }
);

router.get(
  "/:id/timeline",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("read", "inspections", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const inspectionId = req.inspection.id;

    const requestedLimitRaw = normalizeNullableText(req.query?.limit);
    const requestedPageRaw = normalizeNullableText(req.query?.page);
    const requestedDateFromRaw = normalizeNullableText(req.query?.date_from);
    const requestedDateToRaw = normalizeNullableText(req.query?.date_to);
    const requestedActions = parseStringList(req.query?.action).map((value) => value.toLowerCase());
    const requestedCategories = parseStringList(req.query?.category).map((value) =>
      value.toLowerCase()
    );
    const requestedLimit = requestedLimitRaw == null ? null : parsePositiveInteger(requestedLimitRaw);
    const requestedPage = requestedPageRaw == null ? null : parsePositiveInteger(requestedPageRaw);
    const dateFrom = parseDateFilter(requestedDateFromRaw);
    const dateTo = parseDateFilter(requestedDateToRaw);

    if (requestedLimitRaw != null && requestedLimit == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "limit must be a positive integer",
      });
      return;
    }
    if (requestedPageRaw != null && requestedPage == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "page must be a positive integer",
      });
      return;
    }
    if (requestedDateFromRaw != null && dateFrom == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "date_from must be in YYYY-MM-DD format",
      });
      return;
    }
    if (requestedDateToRaw != null && dateTo == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "date_to must be in YYYY-MM-DD format",
      });
      return;
    }
    if (dateFrom && dateTo && dateFrom > dateTo) {
      res.status(400).json({
        error: "Invalid request",
        message: "date_from must be earlier than or equal to date_to",
      });
      return;
    }

    const invalidAction = requestedActions.find(
      (action) => !/^inspection\.[a-z0-9_]+$/.test(action)
    );
    if (invalidAction) {
      res.status(400).json({
        error: "Invalid request",
        message: `Unknown action filter value: ${invalidAction}`,
      });
      return;
    }

    const invalidCategory = requestedCategories.find(
      (category) => !VALID_TIMELINE_CATEGORIES.has(category)
    );
    if (invalidCategory) {
      res.status(400).json({
        error: "Invalid request",
        message: `Unknown category filter value: ${invalidCategory}`,
      });
      return;
    }

    const includeReads = parseBoolean(req.query?.include_reads, false);
    const limit = Math.min(requestedLimit ?? DEFAULT_TIMELINE_LIMIT, MAX_TIMELINE_LIMIT);
    const page = requestedPage ?? 1;
    const offset = (page - 1) * limit;
    const whereClauses = [
      `
      (
        (
          a.entity_type = 'inspections'
          AND a.entity_id = ?
        )
        OR (
          a.entity_type = 'media_files'
          AND json_extract(a.details_json, '$.inspection_id') = ?
        )
      )
    `,
      "a.action LIKE 'inspection.%'",
    ];
    const whereParams = [inspectionId, inspectionId];

    if (!includeReads) {
      whereClauses.push("a.action != 'inspection.media_file_read'");
    }

    if (requestedActions.length > 0) {
      whereClauses.push(`a.action IN (${requestedActions.map(() => "?").join(",")})`);
      whereParams.push(...requestedActions);
    }

    if (requestedCategories.length > 0) {
      const categoryConditions = requestedCategories
        .map((category) => timelineCategoryToSqlCondition(category))
        .filter(Boolean);
      if (categoryConditions.length > 0) {
        whereClauses.push(`(${categoryConditions.join(" OR ")})`);
      }
    }

    if (dateFrom) {
      whereClauses.push("DATE(a.created_at) >= DATE(?)");
      whereParams.push(dateFrom);
    }

    if (dateTo) {
      whereClauses.push("DATE(a.created_at) <= DATE(?)");
      whereParams.push(dateTo);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

    const total = db
      .prepare(
        `
        SELECT COUNT(*) AS total
        FROM audit_logs a
        ${whereSql}
        `
      )
      .get(...whereParams)?.total;

    const rows = db
      .prepare(
        `
        SELECT
          a.id,
          a.actor_user_id,
          actor.username AS actor_username,
          actor.full_name AS actor_name,
          a.action,
          a.entity_type,
          a.entity_id,
          a.details_json,
          a.created_at
        FROM audit_logs a
        LEFT JOIN users actor ON actor.id = a.actor_user_id
        ${whereSql}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(...whereParams, limit, offset);

    const events = rows.map(normalizeTimelineEntry);
    const totalItems = Number.isFinite(total) ? total : 0;
    const totalPages = totalItems === 0 ? 0 : Math.ceil(totalItems / limit);

    res.json({
      data: events,
      pagination: {
        page,
        limit,
        total_items: totalItems,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
      filters: {
        include_reads: includeReads,
        action: requestedActions,
        category: requestedCategories,
        date_from: dateFrom,
        date_to: dateTo,
      },
    });
  }
);

router.get(
  "/:id/items",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("read", "inspection_item_responses", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const items = fetchInspectionItems(db, req.inspection.id);

    res.json({
      data: items,
      overall_result: req.inspection.overall_result ?? "na",
    });
  }
);

router.post(
  "/:id/items",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  (req, res) => {
    const db = req.app.locals.db;
    const inspection = req.inspection;
    const roles = rolesFromUser(req.user);
    const incomingItems = parseItemsPayload(req.body);

    if (incomingItems.length === 0) {
      res.status(400).json({
        error: "Invalid request",
        message: "Provide at least one item in request body as { items: [...] }",
      });
      return;
    }

    const normalizedItems = [];
    const seenKeys = new Set();
    for (const rawItem of incomingItems) {
      const itemKey = normalizeNullableText(rawItem?.item_key);
      if (!itemKey) {
        res.status(400).json({
          error: "Invalid request",
          message: "Each item must include item_key",
        });
        return;
      }

      if (seenKeys.has(itemKey)) {
        res.status(400).json({
          error: "Invalid request",
          message: `Duplicate item_key in request: ${itemKey}`,
        });
        return;
      }
      seenKeys.add(itemKey);

      const result = normalizeItemResult(rawItem?.result);
      if (result != null && !VALID_ITEM_RESULTS.has(result)) {
        res.status(400).json({
          error: "Invalid request",
          message: "item.result must be one of: pass, fail, na",
        });
        return;
      }

      normalizedItems.push({
        item_key: itemKey,
        item_label: normalizeNullableText(rawItem?.item_label),
        response_value: rawItem?.response_value == null ? null : String(rawItem.response_value),
        result,
        comment: normalizeNullableText(rawItem?.comment),
      });
    }

    const keys = normalizedItems.map((item) => item.item_key);
    const placeholders = keys.map(() => "?").join(",");
    const existingRows = db
      .prepare(
        `
        SELECT item_key
        FROM inspection_item_responses
        WHERE inspection_id = ? AND item_key IN (${placeholders})
        `
      )
      .all(inspection.id, ...keys);
    const existingKeys = new Set(existingRows.map((row) => row.item_key));

    for (const item of normalizedItems) {
      const action = existingKeys.has(item.item_key) ? "update" : "create";
      const allowed = can(roles, action, "inspection_item_responses", {
        actor: req.user,
        inspection,
        target: { team_id: inspection.team_id },
      });

      if (!allowed) {
        res.status(403).json({
          error: "Forbidden",
          message: `Not allowed to ${action} item responses for this inspection`,
        });
        return;
      }
    }

    const upsertItemStmt = db.prepare(
      `
      INSERT INTO inspection_item_responses (
        inspection_id,
        item_key,
        item_label,
        response_value,
        result,
        comment,
        answered_by,
        answered_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(inspection_id, item_key)
      DO UPDATE SET
        item_label = COALESCE(excluded.item_label, inspection_item_responses.item_label),
        response_value = COALESCE(excluded.response_value, inspection_item_responses.response_value),
        result = COALESCE(excluded.result, inspection_item_responses.result),
        comment = COALESCE(excluded.comment, inspection_item_responses.comment),
        answered_by = excluded.answered_by,
        answered_at = excluded.answered_at,
        updated_at = CURRENT_TIMESTAMP
      `
    );

    const answeredAt = new Date().toISOString();
    const result = db.transaction(() => {
      for (const item of normalizedItems) {
        upsertItemStmt.run(
          inspection.id,
          item.item_key,
          item.item_label,
          item.response_value,
          item.result,
          item.comment,
          req.user.id,
          answeredAt
        );
      }

      const overallResult = recalculateInspectionOverallResult(db, inspection.id);
      const updatedInspection = fetchInspectionById(db, inspection.id);
      const updatedItems = fetchInspectionItems(db, inspection.id);

      writeAuditLog(db, req.user.id, "inspection.items_upserted", "inspections", inspection.id, {
        item_keys: keys,
        upserted_count: normalizedItems.length,
        overall_result: overallResult,
      });

      return {
        overallResult,
        updatedInspection,
        updatedItems,
      };
    })();

    res.json({
      data: result.updatedItems,
      overall_result: result.overallResult,
      inspection: result.updatedInspection,
    });
  }
);

router.get(
  "/:id/media",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("read", "media_files", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const media = fetchInspectionMedia(db, req.inspection.id);
    res.json({ data: media });
  }
);

router.get(
  "/:id/media/:mediaId/file",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("read", "media_files", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const mediaId = parseInteger(req.params?.mediaId);
    if (mediaId == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "mediaId must be an integer",
      });
      return;
    }

    const db = req.app.locals.db;
    const config = req.app.locals.config;
    const media = fetchInspectionMediaById(db, req.inspection.id, mediaId);
    if (!media) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    const filePath = resolveStoragePathWithinDataDir(config.dataDir, media.storage_rel_path);
    if (!filePath) {
      res.status(500).json({ error: "Could not resolve media path" });
      return;
    }

    let stat = null;
    try {
      stat = fs.statSync(filePath);
    } catch (_error) {
      res.status(404).json({ error: "Media file missing on disk" });
      return;
    }

    if (!stat.isFile()) {
      res.status(404).json({ error: "Media file missing on disk" });
      return;
    }

    const download = String(req.query?.download || "").toLowerCase();
    const disposition = download === "1" || download === "true" ? "attachment" : "inline";
    const downloadName = sanitizeFileName(
      media.original_file_name || media.stored_file_name || `media-${media.id}`
    );

    res.setHeader("Content-Type", media.mime_type || "application/octet-stream");
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("Content-Disposition", `${disposition}; filename=\"${downloadName}\"`);

    writeAuditLog(db, req.user.id, "inspection.media_file_read", "media_files", media.id, {
      inspection_id: req.inspection.id,
      disposition,
      media_type: media.media_type,
    });

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      if (res.headersSent) {
        res.destroy();
        return;
      }

      res.status(500).json({ error: "Could not read media file" });
    });
    stream.pipe(res);
  }
);

router.delete(
  "/:id/media/:mediaId",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("update", "media_files", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const mediaId = parseInteger(req.params?.mediaId);
    if (mediaId == null) {
      res.status(400).json({
        error: "Invalid request",
        message: "mediaId must be an integer",
      });
      return;
    }

    const db = req.app.locals.db;
    const config = req.app.locals.config;
    const media = fetchInspectionMediaById(db, req.inspection.id, mediaId);
    if (!media) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    let diskStatus = "path_invalid";
    const filePath = resolveStoragePathWithinDataDir(config.dataDir, media.storage_rel_path);
    if (filePath) {
      try {
        fs.unlinkSync(filePath);
        diskStatus = "deleted";
      } catch (error) {
        if (error?.code === "ENOENT") {
          diskStatus = "missing";
        } else {
          res.status(500).json({
            error: "Could not delete media file",
            message: String(error?.message || "Unknown file delete error"),
          });
          return;
        }
      }
    }

    const deletedMedia = db.transaction(() => {
      const deleteResult = db
        .prepare(
          `
          DELETE FROM media_files
          WHERE id = ? AND inspection_id = ?
          `
        )
        .run(media.id, req.inspection.id);

      if (deleteResult.changes === 0) {
        return null;
      }

      writeAuditLog(db, req.user.id, "inspection.media_deleted", "media_files", media.id, {
        inspection_id: req.inspection.id,
        item_response_id: media.item_response_id,
        item_key: media.item_key,
        media_type: media.media_type,
        disk_status: diskStatus,
      });

      return {
        id: media.id,
        inspection_id: media.inspection_id,
        item_response_id: media.item_response_id,
        item_key: media.item_key,
        media_type: media.media_type,
        storage_rel_path: media.storage_rel_path,
        disk_status: diskStatus,
      };
    })();

    if (!deletedMedia) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    res.json({ data: deletedMedia });
  }
);

router.post(
  "/:id/media",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("create", "media_files", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res, next) => {
    const upload = getMediaUploadMiddleware(req);
    upload.single("file")(req, res, (error) => {
      if (!error) {
        next();
        return;
      }

      if (error.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({
          error: "File too large",
          max_bytes: MAX_MEDIA_FILE_SIZE_BYTES,
        });
        return;
      }

      res.status(400).json({
        error: "Upload failed",
        message: error.message || "Invalid multipart payload",
      });
    });
  },
  (req, res) => {
    if (!req.file) {
      res.status(400).json({
        error: "Invalid request",
        message: "Attach file in multipart field 'file'",
      });
      return;
    }

    const db = req.app.locals.db;
    const config = req.app.locals.config;
    const inspection = req.inspection;
    const uploadedFile = req.file;
    const cleanupUploadedFile = () => {
      try {
        fs.unlinkSync(uploadedFile.path);
      } catch (_error) {
        // best-effort cleanup
      }
    };

    const itemResponseId = parseInteger(req.body?.item_response_id);
    let itemKey = normalizeNullableText(req.body?.item_key);

    if (itemResponseId != null) {
      const linkedResponse = db
        .prepare(
          `
          SELECT id, inspection_id, item_key
          FROM inspection_item_responses
          WHERE id = ?
          LIMIT 1
          `
        )
        .get(itemResponseId);

      if (!linkedResponse || linkedResponse.inspection_id !== inspection.id) {
        cleanupUploadedFile();
        res.status(400).json({
          error: "Invalid request",
          message: "item_response_id does not belong to this inspection",
        });
        return;
      }

      if (itemKey && linkedResponse.item_key && itemKey !== linkedResponse.item_key) {
        cleanupUploadedFile();
        res.status(400).json({
          error: "Invalid request",
          message: "item_key does not match item_response_id",
        });
        return;
      }

      if (!itemKey && linkedResponse.item_key) {
        itemKey = linkedResponse.item_key;
      }
    }

    const relativePath = toPosixRelativePath(config.dataDir, uploadedFile.path);
    if (!relativePath) {
      cleanupUploadedFile();
      res.status(500).json({ error: "Could not resolve upload path" });
      return;
    }

    const originalFileName = sanitizeFileName(uploadedFile.originalname);
    const storedFileName = sanitizeFileName(uploadedFile.filename);
    const mimeType = uploadedFile.mimetype || "application/octet-stream";
    const mediaType = detectMediaType(mimeType);
    const fileSizeBytes = uploadedFile.size || 0;
    const checksumSha256 = computeFileSha256(uploadedFile.path);

    try {
      const insertResult = db
        .prepare(
          `
          INSERT INTO media_files (
            inspection_id,
            item_response_id,
            item_key,
            uploaded_by,
            media_type,
            original_file_name,
            stored_file_name,
            mime_type,
            file_size_bytes,
            storage_rel_path,
            checksum_sha256
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `
        )
        .run(
          inspection.id,
          itemResponseId,
          itemKey,
          req.user.id,
          mediaType,
          originalFileName,
          storedFileName,
          mimeType,
          fileSizeBytes,
          relativePath,
          checksumSha256
        );

      const createdMedia = db
        .prepare(
          `
          SELECT
            id,
            inspection_id,
            item_response_id,
            item_key,
            uploaded_by,
            media_type,
            original_file_name,
            stored_file_name,
            mime_type,
            file_size_bytes,
            storage_rel_path,
            checksum_sha256,
            created_at
          FROM media_files
          WHERE id = ?
          LIMIT 1
          `
        )
        .get(Number(insertResult.lastInsertRowid));

      writeAuditLog(db, req.user.id, "inspection.media_uploaded", "media_files", createdMedia.id, {
        inspection_id: inspection.id,
        item_response_id: itemResponseId,
        item_key: itemKey,
        media_type: mediaType,
        file_size_bytes: fileSizeBytes,
      });

      res.status(201).json({ data: createdMedia });
    } catch (error) {
      cleanupUploadedFile();
      throw error;
    }
  }
);

router.patch(
  "/:id",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("update", "inspections", {
    contextResolver: buildInspectionContext,
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const previous = req.inspection;
    const nextStatus = typeof req.body?.status === "string" ? req.body.status : previous.status;
    const nextNotes = typeof req.body?.notes === "string" ? req.body.notes : previous.notes;

    const hasLatitude = Object.prototype.hasOwnProperty.call(req.body || {}, "latitude");
    const hasLongitude = Object.prototype.hasOwnProperty.call(req.body || {}, "longitude");
    const hasGeometry =
      Object.prototype.hasOwnProperty.call(req.body || {}, "geometry") ||
      Object.prototype.hasOwnProperty.call(req.body || {}, "geometry_json");

    const parsedLatitude = hasLatitude ? parseCoordinate(req.body?.latitude, -90, 90) : previous.latitude;
    const parsedLongitude = hasLongitude
      ? parseCoordinate(req.body?.longitude, -180, 180)
      : previous.longitude;

    if ((hasLatitude && parsedLatitude == null) || (hasLongitude && parsedLongitude == null)) {
      res.status(400).json({
        error: "Invalid request",
        message: "latitude must be between -90 and 90, longitude must be between -180 and 180",
      });
      return;
    }

    if (nextStatus !== previous.status) {
      const actorRoles = rolesFromUser(req.user);
      const statusAllowed = canTransition(actorRoles, previous.status, nextStatus);
      if (!statusAllowed) {
        res.status(403).json({
          error: "Status transition not allowed",
          from: previous.status,
          to: nextStatus,
        });
        return;
      }
    }

    let nextLatitude = parsedLatitude;
    let nextLongitude = parsedLongitude;
    let nextGeometryType = previous.geometry_type ?? null;
    let nextGeometryJson = previous.geometry_json ?? null;

    if (hasGeometry) {
      const rawGeometry = req.body?.geometry ?? req.body?.geometry_json;
      const normalizedGeometry = normalizeInspectionGeometry(rawGeometry);
      if (normalizedGeometry.error) {
        res.status(400).json({
          error: "Invalid request",
          message: normalizedGeometry.error,
        });
        return;
      }

      const serializedGeometry = safeStringifyJson(normalizedGeometry.geometry);
      if (!serializedGeometry) {
        res.status(400).json({
          error: "Invalid request",
          message: "Could not serialize geometry",
        });
        return;
      }

      nextLatitude = normalizedGeometry.latitude;
      nextLongitude = normalizedGeometry.longitude;
      nextGeometryType = normalizedGeometry.geometry_type;
      nextGeometryJson = serializedGeometry;
    } else if (hasLatitude || hasLongitude) {
      if (nextLatitude == null || nextLongitude == null) {
        res.status(400).json({
          error: "Invalid request",
          message: "both latitude and longitude are required when updating point location",
        });
        return;
      }

      const previousGeometryType = String(previous.geometry_type || "").toLowerCase();
      if (previousGeometryType !== "area") {
        nextGeometryType = "point";
        nextGeometryJson = safeStringifyJson(buildPointGeometry(nextLongitude, nextLatitude));
      }
    }

    db.prepare(
      `
      UPDATE inspections
      SET
        status = ?,
        notes = ?,
        latitude = ?,
        longitude = ?,
        geometry_type = ?,
        geometry_json = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(
      nextStatus,
      nextNotes,
      nextLatitude,
      nextLongitude,
      nextGeometryType,
      nextGeometryJson,
      previous.id
    );

    const updated = fetchInspectionById(db, previous.id);

    writeAuditLog(db, req.user.id, "inspection.updated", "inspections", previous.id, {
      before: {
        status: previous.status,
        notes: previous.notes,
        latitude: previous.latitude,
        longitude: previous.longitude,
        geometry_type: previous.geometry_type ?? null,
      },
      after: {
        status: updated.status,
        notes: updated.notes,
        latitude: updated.latitude,
        longitude: updated.longitude,
        geometry_type: updated.geometry_type ?? null,
      },
    });

    res.json({ data: updated });
  }
);

router.get(
  "/:id/reviews",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("read", "inspection_reviews", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const rows = db
      .prepare(
        `
        SELECT
          r.id,
          r.inspection_id,
          r.reviewer_id,
          u.full_name AS reviewer_name,
          r.decision,
          r.from_status,
          r.to_status,
          r.comment,
          r.created_at
        FROM inspection_reviews r
        JOIN users u ON u.id = r.reviewer_id
        WHERE r.inspection_id = ?
        ORDER BY datetime(r.created_at) ASC, r.id ASC
        `
      )
      .all(req.inspection.id);

    res.json({ data: rows });
  }
);

router.post(
  "/:id/submit",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  authorize("submit", "inspections", {
    contextResolver: (req) => ({
      inspection: req.inspection,
      target: { team_id: req.inspection.team_id },
    }),
  }),
  (req, res) => {
    const db = req.app.locals.db;
    const actorRoles = rolesFromUser(req.user);
    const previous = req.inspection;
    const targetStatus = "submitted";
    const statusAllowed = canTransition(actorRoles, previous.status, targetStatus);

    if (!statusAllowed) {
      res.status(403).json({
        error: "Status transition not allowed",
        from: previous.status,
        to: targetStatus,
      });
      return;
    }

    db.prepare(
      `
      UPDATE inspections
      SET status = 'submitted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `
    ).run(previous.id);

    const updated = fetchInspectionById(db, previous.id);

    writeAuditLog(db, req.user.id, "inspection.submitted", "inspections", previous.id, {
      from: previous.status,
      to: updated.status,
    });

    res.json({ data: updated });
  }
);

router.post(
  "/:id/review",
  requireUser,
  requirePasswordChangeCompleted,
  loadInspection,
  (req, res) => {
    const decision = normalizeReviewDecision(req.body?.decision);
    const comment = normalizeNullableText(req.body?.comment);
    const inspection = req.inspection;
    const roles = rolesFromUser(req.user);
    const action = decision;

    if (!decision || !VALID_REVIEW_DECISIONS.has(decision)) {
      res.status(400).json({
        error: "Invalid request",
        message: "decision must be one of: review, approve, reject, reopen",
      });
      return;
    }

    const allowedByRole = can(roles, action, "inspection_reviews", {
      actor: req.user,
      target: { team_id: inspection.team_id },
      inspection,
    });
    if (!allowedByRole) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const nextStatus = reviewDecisionToStatus(decision);
    const statusAllowed = canTransition(roles, inspection.status, nextStatus);
    if (!statusAllowed) {
      res.status(403).json({
        error: "Status transition not allowed",
        from: inspection.status,
        to: nextStatus,
      });
      return;
    }

    const db = req.app.locals.db;
    const reviewResult = db.transaction(() => {
      db.prepare(
        `
        INSERT INTO inspection_reviews (
          inspection_id,
          reviewer_id,
          decision,
          from_status,
          to_status,
          comment
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `
      ).run(inspection.id, req.user.id, decision, inspection.status, nextStatus, comment);

      db.prepare(
        `
        UPDATE inspections
        SET status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `
      ).run(nextStatus, inspection.id);

      writeAuditLog(db, req.user.id, `inspection.${decision}`, "inspections", inspection.id, {
        from: inspection.status,
        to: nextStatus,
        comment,
      });

      return fetchInspectionById(db, inspection.id);
    })();

    res.json({
      data: reviewResult,
      review: {
        decision,
        from_status: inspection.status,
        to_status: nextStatus,
        comment,
      },
    });
  }
);

export default router;

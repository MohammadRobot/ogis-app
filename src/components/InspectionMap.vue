<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const props = defineProps({
  inspections: {
    type: Array,
    default: () => [],
  },
  overlays: {
    type: Array,
    default: () => [],
  },
  teams: {
    type: Array,
    default: () => [],
  },
  selectedInspectionId: {
    type: Number,
    default: null,
  },
  createPlacementActive: {
    type: Boolean,
    default: false,
  },
  createPlacementKind: {
    type: String,
    default: "point",
  },
  createInspectionDraft: {
    type: Object,
    default: null,
  },
  busy: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "select-inspection",
  "save-inspection-geometry",
  "create-overlay",
  "delete-overlay",
  "pick-create-location",
  "pick-create-area",
  "cancel-create-location",
]);

const DEFAULT_VIEW = [25.2048, 55.2708];
const OSM_MIN_ZOOM = 12;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const OSM_CATEGORY_FILTERS = {
  all: [
    { key: "amenity" },
    { key: "shop" },
    { key: "tourism" },
    { key: "leisure" },
    { key: "highway", value: "bus_stop" },
    { key: "highway", value: "traffic_signals" },
    { key: "railway" },
    { key: "healthcare" },
    { key: "office" },
  ],
  amenities: [
    { key: "amenity" },
    { key: "shop" },
    { key: "healthcare" },
  ],
  transport: [
    { key: "highway", value: "bus_stop" },
    { key: "highway", value: "traffic_signals" },
    { key: "public_transport", value: "platform" },
    { key: "railway", value: "station" },
    { key: "railway", value: "halt" },
    { key: "aeroway", value: "terminal" },
  ],
  infrastructure: [
    { key: "power" },
    { key: "man_made" },
    { key: "emergency" },
    { key: "waterway" },
  ],
};

const OSM_CATEGORY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "amenities", label: "Amenities" },
  { value: "transport", label: "Transport" },
  { value: "infrastructure", label: "Infrastructure" },
];

const mapEl = ref(null);
const activeMode = ref("none");
const activeDrawer = ref("none");
const toolError = ref("");
const toolNotice = ref("");

const draft = reactive({
  points: [],
  point: null,
  zoneTitle: "",
  labelText: "",
});
const createDraft = reactive({
  points: [],
});

const osm = reactive({
  enabled: true,
  category: "all",
  busy: false,
  error: "",
  count: 0,
  lastUpdated: "",
  limitNotice: "",
});

let map = null;
let inspectionLayer = null;
let overlayLayer = null;
let osmLayer = null;
let draftLayer = null;
let hasAutoFit = false;
let moveDebounceTimer = null;
let osmAbortController = null;
let lastOsmQueryKey = "";

function invalidateMapSize() {
  if (!map) return;
  setTimeout(() => map?.invalidateSize(), 0);
}

const inspectionRows = computed(() => (Array.isArray(props.inspections) ? props.inspections : []));
const overlayRows = computed(() => (Array.isArray(props.overlays) ? props.overlays : []));
const teamRows = computed(() => (Array.isArray(props.teams) ? props.teams : []));
const selectedInspection = computed(
  () => inspectionRows.value.find((inspection) => inspection.id === props.selectedInspectionId) || null
);
const createInspectionDraftGeometry = computed(() => parseGeometry(props.createInspectionDraft?.geometry));
const createInspectionDraftPoint = computed(() => {
  const geometry = createInspectionDraftGeometry.value;
  if (geometry?.type === "Point" && isLngLatPair(geometry.coordinates)) {
    return {
      lat: Number(geometry.coordinates[1]),
      lng: Number(geometry.coordinates[0]),
    };
  }

  const latitude = Number.parseFloat(String(props.createInspectionDraft?.latitude ?? "").trim());
  const longitude = Number.parseFloat(String(props.createInspectionDraft?.longitude ?? "").trim());

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
});

const mappableInspectionCount = computed(
  () =>
    inspectionRows.value.filter((inspection) => {
      const point = inspectionPoint(inspection);
      return point != null;
    }).length
);
const areaBoundaryCount = computed(() => {
  let total = 0;

  for (const inspection of inspectionRows.value) {
    const geometry = parseGeometry(inspection?.geometry);
    if (geometry?.type === "Polygon" || geometry?.type === "MultiPolygon") {
      total += 1;
    }
  }

  for (const overlay of overlayRows.value) {
    if (overlay?.kind !== "zone") continue;
    const geometry = parseGeometry(overlay?.geometry);
    if (geometry?.type === "Polygon" || geometry?.type === "MultiPolygon") {
      total += 1;
    }
  }

  return total;
});
const createAreaPointCount = computed(() => createDraft.points.length);

const modeHint = computed(() => {
  if (activeMode.value === "inspection_point") {
    return "Click the map to place a single inspection point.";
  }
  if (activeMode.value === "inspection_area") {
    return "Click to add area vertices, then save.";
  }
  if (activeMode.value === "overlay_zone") {
    return "Create a collaborative zone polygon on the master map.";
  }
  if (activeMode.value === "overlay_label") {
    return "Place a collaborative label marker.";
  }
  return "Select a tool to edit inspection geometry or add team overlays.";
});

const osmUpdatedLabel = computed(() => {
  if (!osm.lastUpdated) return "Not loaded";
  const date = new Date(osm.lastUpdated);
  if (Number.isNaN(date.getTime())) return "Not loaded";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
});

function toggleDrawer(drawer) {
  activeDrawer.value = activeDrawer.value === drawer ? "none" : drawer;
}

function closeDrawer() {
  activeDrawer.value = "none";
}

function clearToolMessages() {
  toolError.value = "";
  toolNotice.value = "";
}

function setToolError(message) {
  toolError.value = message;
  toolNotice.value = "";
}

function setToolNotice(message) {
  toolNotice.value = message;
  toolError.value = "";
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusColor(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "approved") return "#2aa56f";
  if (normalized === "rejected") return "#d86d6d";
  if (normalized === "in_review") return "#4f9fc5";
  if (normalized === "submitted") return "#f29f4b";
  if (normalized === "reopened") return "#5d94d7";
  if (normalized === "closed") return "#9ca8b7";
  return "#1f8ea1";
}

function parseGeometry(value) {
  if (!value) return null;
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

function isLngLatPair(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function ringToLeafletLatLngs(ring) {
  if (!Array.isArray(ring)) return [];
  return ring.filter(isLngLatPair).map((pair) => [Number(pair[1]), Number(pair[0])]);
}

function geometryToLeafletLatLngs(geometry) {
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates.map((ring) => ringToLeafletLatLngs(ring)).filter((ring) => ring.length >= 3);
  }
  if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates
      .map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map((ring) => ringToLeafletLatLngs(ring)).filter((ring) => ring.length >= 3)
          : []
      )
      .filter((polygon) => polygon.length > 0);
  }
  return null;
}

function centroidFromCoordinates(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const vertices = [...ring];
  const [firstLng, firstLat] = vertices[0] || [];
  const [lastLng, lastLat] = vertices[vertices.length - 1] || [];
  if (firstLng === lastLng && firstLat === lastLat) {
    vertices.pop();
  }

  if (vertices.length < 3) return null;

  let lngSum = 0;
  let latSum = 0;
  for (const pair of vertices) {
    if (!isLngLatPair(pair)) return null;
    lngSum += Number(pair[0]);
    latSum += Number(pair[1]);
  }

  return {
    lat: latSum / vertices.length,
    lng: lngSum / vertices.length,
  };
}

function inspectionPoint(inspection) {
  const geometry = parseGeometry(inspection?.geometry);
  if (geometry?.type === "Point" && isLngLatPair(geometry.coordinates)) {
    return {
      lat: Number(geometry.coordinates[1]),
      lng: Number(geometry.coordinates[0]),
    };
  }

  if (geometry?.type === "Polygon" && Array.isArray(geometry.coordinates)) {
    const centroid = centroidFromCoordinates(geometry.coordinates[0]);
    if (centroid) return centroid;
  }

  if (geometry?.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
    const centroid = centroidFromCoordinates(geometry.coordinates[0]?.[0]);
    if (centroid) return centroid;
  }

  const lat = Number(inspection?.latitude);
  const lng = Number(inspection?.longitude);
  if (Number.isFinite(lat) && Number.isFinite(lng)) {
    return { lat, lng };
  }

  return null;
}

function clearDraftGeometry() {
  draft.points = [];
  draft.point = null;
  drawDraftLayer();
}

function clearCreateDraftGeometry() {
  createDraft.points = [];
  drawDraftLayer();
}

function resetMode() {
  activeMode.value = "none";
  clearDraftGeometry();
}

function startMode(mode) {
  clearToolMessages();
  if (mode.startsWith("inspection") && !props.selectedInspectionId) {
    setToolError("Select an inspection first.");
    return;
  }

  activeMode.value = mode;
  clearDraftGeometry();

  if (mode === "overlay_label") {
    setToolNotice("Click map to place the label.");
  } else if (mode === "inspection_point") {
    setToolNotice("Click map to place inspection point.");
  } else if (mode === "inspection_area") {
    setToolNotice("Click map to add area vertices.");
  } else if (mode === "overlay_zone") {
    setToolNotice("Click map to add zone vertices.");
  }
}

function ensureMapReady() {
  return Boolean(map && inspectionLayer && overlayLayer && osmLayer && draftLayer);
}

function popupHtml(inspection) {
  const notes = String(inspection.notes || "").trim();
  const safeNotes = notes.length > 150 ? `${notes.slice(0, 147)}...` : notes;
  const team = teamRows.value.find((row) => Number(row.id) === Number(inspection.team_id));
  const teamLabel = team?.label || `Field Team ${inspection.team_id}`;

  return `
    <div class="inspection-popup">
      <h4>${escapeHtml(inspection.site_name || "Inspection")}</h4>
      <p><strong>No:</strong> ${escapeHtml(inspection.inspection_no || "-")}</p>
      <p><strong>Status:</strong> ${escapeHtml(inspection.status || "-")}</p>
      <p><strong>Result:</strong> ${escapeHtml(inspection.overall_result || "na")}</p>
      <p><strong>Team:</strong> ${escapeHtml(teamLabel)}</p>
      ${safeNotes ? `<p><strong>Notes:</strong> ${escapeHtml(safeNotes)}</p>` : ""}
    </div>
  `;
}

function addInspectionPointLayer(inspection, lat, lng, bounds) {
  const isSelected = inspection.id === props.selectedInspectionId;
  const marker = L.circleMarker([lat, lng], {
    pane: "inspectionPane",
    radius: isSelected ? 9 : 7,
    weight: isSelected ? 3 : 2,
    color: isSelected ? "#ffffff" : "#d6e9fa",
    fillColor: statusColor(inspection.status),
    fillOpacity: 0.95,
  });

  marker.bindPopup(popupHtml(inspection), { maxWidth: 300 });
  marker.bindTooltip(String(inspection.site_name || inspection.inspection_no || inspection.id), {
    direction: "top",
    offset: [0, -6],
  });
  marker.on("click", () => emit("select-inspection", inspection.id));
  inspectionLayer.addLayer(marker);
  bounds.push([lat, lng]);
}

function addInspectionAreaLayer(inspection, geometry, bounds) {
  const latLngs = geometryToLeafletLatLngs(geometry);
  if (!latLngs) return;

  const isSelected = inspection.id === props.selectedInspectionId;
  const color = statusColor(inspection.status);

  const layer = L.polygon(latLngs, {
    pane: "inspectionPane",
    color: isSelected ? "#ffffff" : color,
    weight: isSelected ? 3 : 2,
    fillColor: color,
    fillOpacity: isSelected ? 0.31 : 0.18,
  });

  layer.bindPopup(popupHtml(inspection), { maxWidth: 300 });
  layer.on("click", () => emit("select-inspection", inspection.id));
  inspectionLayer.addLayer(layer);

  const layerBounds = layer.getBounds();
  if (layerBounds.isValid()) {
    bounds.push(layerBounds.getCenter());
  }
}

function drawInspections({ fitToBounds = false } = {}) {
  if (!ensureMapReady()) return;
  inspectionLayer.clearLayers();
  const bounds = [];

  for (const inspection of inspectionRows.value) {
    const geometry = parseGeometry(inspection.geometry);

    if (geometry?.type === "Point" && isLngLatPair(geometry.coordinates)) {
      addInspectionPointLayer(
        inspection,
        Number(geometry.coordinates[1]),
        Number(geometry.coordinates[0]),
        bounds
      );
      continue;
    }

    if (geometry && (geometry.type === "Polygon" || geometry.type === "MultiPolygon")) {
      addInspectionAreaLayer(inspection, geometry, bounds);
      continue;
    }

    const point = inspectionPoint(inspection);
    if (!point) continue;
    addInspectionPointLayer(inspection, point.lat, point.lng, bounds);
  }

  if (fitToBounds && bounds.length > 0) {
    const latLngBounds = L.latLngBounds(bounds);
    map.fitBounds(latLngBounds, {
      padding: [34, 34],
      maxZoom: 15,
    });
  }
}

function drawOverlays() {
  if (!ensureMapReady()) return;
  overlayLayer.clearLayers();

  for (const overlay of overlayRows.value) {
    if (overlay.kind === "label") {
      const lat = Number(overlay.latitude);
      const lng = Number(overlay.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

      const marker = L.circleMarker([lat, lng], {
        pane: "overlayPane",
        radius: 6,
        weight: 2,
        color: "#092435",
        fillColor: "#5fb5ff",
        fillOpacity: 0.95,
      });
      marker.bindTooltip(String(overlay.label_text || overlay.title || "Label"), {
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: "master-map-label",
      });
      marker.bindPopup(
        `<div><strong>Label</strong><p>${escapeHtml(overlay.label_text || overlay.title || "-")}</p></div>`
      );
      overlayLayer.addLayer(marker);
      continue;
    }

    if (overlay.kind === "zone") {
      const geometry = parseGeometry(overlay.geometry);
      if (!geometry) continue;
      const latLngs = geometryToLeafletLatLngs(geometry);
      if (!latLngs) continue;

      const zoneLayer = L.polygon(latLngs, {
        pane: "overlayPane",
        color: "#0ebac7",
        weight: 2,
        dashArray: "8 5",
        fillColor: "#2ecad3",
        fillOpacity: 0.14,
      });
      zoneLayer.bindPopup(
        `<div><strong>Zone</strong><p>${escapeHtml(overlay.title || "Untitled zone")}</p></div>`
      );
      overlayLayer.addLayer(zoneLayer);
    }
  }
}

function extendBoundsWithLatLngs(bounds, latLngs) {
  if (!Array.isArray(latLngs) || latLngs.length === 0) return;

  const first = latLngs[0];
  if (Array.isArray(first) && typeof first[0] === "number" && typeof first[1] === "number") {
    for (const pair of latLngs) {
      if (Array.isArray(pair) && pair.length >= 2) {
        bounds.extend(pair);
      }
    }
    return;
  }

  for (const child of latLngs) {
    extendBoundsWithLatLngs(bounds, child);
  }
}

function drawDraftLayer() {
  if (!ensureMapReady()) return;
  draftLayer.clearLayers();

  if (
    createInspectionDraftGeometry.value?.type === "Polygon" &&
    Array.isArray(createInspectionDraftGeometry.value.coordinates)
  ) {
    const latLngs = geometryToLeafletLatLngs(createInspectionDraftGeometry.value);
    if (latLngs) {
      const polygon = L.polygon(latLngs, {
        pane: "draftPane",
        color: "#f29f4b",
        weight: 3,
        fillOpacity: 0.18,
      });
      draftLayer.addLayer(polygon);
    }
  } else if (createInspectionDraftPoint.value) {
    const marker = L.circleMarker([createInspectionDraftPoint.value.lat, createInspectionDraftPoint.value.lng], {
      pane: "draftPane",
      radius: 9,
      weight: 3,
      color: "#ffffff",
      fillColor: "#f29f4b",
      fillOpacity: 0.92,
    });
    marker.bindTooltip("New inspection", {
      direction: "top",
      offset: [0, -6],
    });
    draftLayer.addLayer(marker);
  }

  if (props.createPlacementActive && props.createPlacementKind === "area" && createDraft.points.length > 0) {
    const latLngs = createDraft.points.map((point) => [point.lat, point.lng]);
    const line = L.polyline(latLngs, {
      pane: "draftPane",
      color: "#f29f4b",
      weight: 3,
      dashArray: "6 4",
    });
    draftLayer.addLayer(line);

    if (createDraft.points.length >= 3) {
      const polygon = L.polygon(latLngs, {
        pane: "draftPane",
        color: "#f29f4b",
        weight: 3,
        fillOpacity: 0.12,
      });
      draftLayer.addLayer(polygon);
    }
  }

  if (draft.point && (activeMode.value === "inspection_point" || activeMode.value === "overlay_label")) {
    const marker = L.circleMarker([draft.point.lat, draft.point.lng], {
      pane: "draftPane",
      radius: 8,
      weight: 2,
      color: "#ffffff",
      fillColor: activeMode.value === "inspection_point" ? "#1f8ea1" : "#5fb5ff",
      fillOpacity: 0.98,
    });
    draftLayer.addLayer(marker);
  }

  if (
    draft.points.length > 0 &&
    (activeMode.value === "inspection_area" || activeMode.value === "overlay_zone")
  ) {
    const latLngs = draft.points.map((point) => [point.lat, point.lng]);
    const color = activeMode.value === "inspection_area" ? "#1f8ea1" : "#5fb5ff";

    const line = L.polyline(latLngs, {
      pane: "draftPane",
      color,
      weight: 2,
      dashArray: "6 4",
    });
    draftLayer.addLayer(line);

    if (draft.points.length >= 3) {
      const polygon = L.polygon(latLngs, {
        pane: "draftPane",
        color,
        weight: 2,
        fillOpacity: 0.12,
      });
      draftLayer.addLayer(polygon);
    }
  }
}

function onMapClick(event) {
  const lat = Number(event.latlng?.lat);
  const lng = Number(event.latlng?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

  if (props.createPlacementActive) {
    clearToolMessages();
    if (props.createPlacementKind === "area") {
      createDraft.points.push({
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
      });
      drawDraftLayer();
      setToolNotice("Area vertex added.");
      return;
    }

    emit("pick-create-location", {
      latitude: Number(lat.toFixed(6)),
      longitude: Number(lng.toFixed(6)),
    });
    setToolNotice("New inspection point set.");
    return;
  }

  if (!activeMode.value || activeMode.value === "none") return;
  clearToolMessages();

  if (activeMode.value === "inspection_point" || activeMode.value === "overlay_label") {
    draft.point = { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) };
    drawDraftLayer();
    return;
  }

  if (activeMode.value === "inspection_area" || activeMode.value === "overlay_zone") {
    draft.points.push({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    });
    drawDraftLayer();
  }
}

function pointsToPolygonGeometry(points) {
  const coords = points.map((point) => [point.lng, point.lat]);
  if (coords.length < 3) return null;
  const [firstLng, firstLat] = coords[0];
  const [lastLng, lastLat] = coords[coords.length - 1];
  if (firstLng !== lastLng || firstLat !== lastLat) {
    coords.push([firstLng, firstLat]);
  }
  return {
    type: "Polygon",
    coordinates: [coords],
  };
}

function undoCreateDraftPoint() {
  if (createDraft.points.length === 0) return;
  createDraft.points.pop();
  drawDraftLayer();
}

function saveCreateArea() {
  clearToolMessages();
  const geometry = pointsToPolygonGeometry(createDraft.points);
  if (!geometry) {
    setToolError("Add at least 3 points to create an area.");
    return;
  }

  emit("pick-create-area", { geometry });
  clearCreateDraftGeometry();
}

function undoDraftPoint() {
  if (draft.points.length === 0) return;
  draft.points.pop();
  drawDraftLayer();
}

function saveInspectionPoint() {
  clearToolMessages();
  if (!props.selectedInspectionId) {
    setToolError("Select an inspection first.");
    return;
  }
  if (!draft.point) {
    setToolError("Click map to set point location.");
    return;
  }

  emit("save-inspection-geometry", {
    inspection_id: props.selectedInspectionId,
    geometry: {
      type: "Point",
      coordinates: [draft.point.lng, draft.point.lat],
    },
  });

  setToolNotice("Inspection point saved.");
  resetMode();
  closeDrawer();
}

function saveInspectionArea() {
  clearToolMessages();
  if (!props.selectedInspectionId) {
    setToolError("Select an inspection first.");
    return;
  }

  const geometry = pointsToPolygonGeometry(draft.points);
  if (!geometry) {
    setToolError("Add at least 3 points to create an area.");
    return;
  }

  emit("save-inspection-geometry", {
    inspection_id: props.selectedInspectionId,
    geometry,
  });
  setToolNotice("Inspection area saved.");
  resetMode();
  closeDrawer();
}

function createZoneOverlay() {
  clearToolMessages();
  const geometry = pointsToPolygonGeometry(draft.points);
  if (!geometry) {
    setToolError("Add at least 3 points to create a zone.");
    return;
  }

  const title = String(draft.zoneTitle || "").trim();
  if (!title) {
    setToolError("Zone title is required.");
    return;
  }

  emit("create-overlay", {
    kind: "zone",
    title,
    geometry,
  });

  setToolNotice("Zone created.");
  draft.zoneTitle = "";
  resetMode();
  closeDrawer();
}

function createLabelOverlay() {
  clearToolMessages();
  if (!draft.point) {
    setToolError("Click map to place label.");
    return;
  }

  const labelText = String(draft.labelText || "").trim();
  if (!labelText) {
    setToolError("Label text is required.");
    return;
  }

  emit("create-overlay", {
    kind: "label",
    label_text: labelText,
    latitude: draft.point.lat,
    longitude: draft.point.lng,
  });

  setToolNotice("Label created.");
  draft.labelText = "";
  resetMode();
  closeDrawer();
}

function requestOverlayDelete(overlayId) {
  if (!Number.isFinite(Number(overlayId))) return;
  if (!window.confirm("Delete this master map layer?")) return;
  emit("delete-overlay", Number(overlayId));
}

function fitAllData() {
  if (!ensureMapReady()) return;

  const bounds = L.latLngBounds([]);

  [inspectionLayer, overlayLayer].forEach((layerGroup) => {
    layerGroup?.eachLayer((layer) => {
      if (typeof layer.getBounds === "function") {
        const layerBounds = layer.getBounds();
        if (layerBounds?.isValid?.()) bounds.extend(layerBounds);
      } else if (typeof layer.getLatLng === "function") {
        const latLng = layer.getLatLng();
        if (latLng) bounds.extend(latLng);
      }
    });
  });

  if (!bounds.isValid()) return;
  map.fitBounds(bounds, { padding: [34, 34], maxZoom: 16 });
}

function fitAreaBoundaries() {
  if (!ensureMapReady()) return;

  const bounds = L.latLngBounds([]);
  let areaCount = 0;

  for (const inspection of inspectionRows.value) {
    const geometry = parseGeometry(inspection?.geometry);
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;

    const latLngs = geometryToLeafletLatLngs(geometry);
    if (!latLngs) continue;

    extendBoundsWithLatLngs(bounds, latLngs);
    areaCount += 1;
  }

  for (const overlay of overlayRows.value) {
    if (overlay?.kind !== "zone") continue;
    const geometry = parseGeometry(overlay?.geometry);
    if (!geometry || (geometry.type !== "Polygon" && geometry.type !== "MultiPolygon")) continue;

    const latLngs = geometryToLeafletLatLngs(geometry);
    if (!latLngs) continue;

    extendBoundsWithLatLngs(bounds, latLngs);
    areaCount += 1;
  }

  if (!bounds.isValid() || areaCount === 0) {
    setToolError("No mapped area boundaries are available.");
    return;
  }

  map.fitBounds(bounds, { padding: [36, 36], maxZoom: 16 });
  setToolNotice(`Showing ${areaCount} mapped area boundar${areaCount === 1 ? "y" : "ies"}.`);
}

function focusSelectedInspection() {
  if (!map || !selectedInspection.value) return;
  const point = inspectionPoint(selectedInspection.value);
  if (!point) return;
  map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 14), {
    duration: 0.7,
  });
}

function overpassBBox(bounds) {
  const south = bounds.getSouth().toFixed(5);
  const west = bounds.getWest().toFixed(5);
  const north = bounds.getNorth().toFixed(5);
  const east = bounds.getEast().toFixed(5);
  return `${south},${west},${north},${east}`;
}

function buildOverpassQuery(bounds, category) {
  const bbox = overpassBBox(bounds);
  const filters = OSM_CATEGORY_FILTERS[category] || OSM_CATEGORY_FILTERS.all;
  const statements = [];

  for (const filter of filters) {
    const condition = filter.value
      ? `["${filter.key}"="${filter.value}"]`
      : `["${filter.key}"]`;
    statements.push(`node${condition}(${bbox});`);
    statements.push(`way${condition}(${bbox});`);
    statements.push(`relation${condition}(${bbox});`);
  }

  return `[out:json][timeout:20];\n(\n${statements.join("\n")}\n);\nout tags center;`;
}

async function fetchOverpass(query, signal) {
  let lastError = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain;charset=UTF-8",
        },
        body: query,
        signal,
      });

      if (!response.ok) {
        throw new Error(`OSM endpoint ${response.status}`);
      }

      const payload = await response.json();
      if (!payload || !Array.isArray(payload.elements)) {
        throw new Error("Invalid OSM payload");
      }
      return payload;
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }

  throw lastError || new Error("OSM service unavailable");
}

function primaryFeatureInfo(tags) {
  if (!tags || typeof tags !== "object") return { kind: "feature", label: "OSM feature" };

  const keys = ["amenity", "shop", "tourism", "leisure", "highway", "railway", "man_made", "power"];
  for (const key of keys) {
    if (tags[key]) {
      return {
        kind: key,
        label: `${key}: ${tags[key]}`,
      };
    }
  }

  return { kind: "feature", label: "OSM feature" };
}

function osmFeatureColor(kind) {
  if (kind === "amenity") return "#f29f4b";
  if (kind === "shop") return "#db7a68";
  if (kind === "highway" || kind === "railway") return "#6cb2ff";
  if (kind === "power" || kind === "man_made") return "#9faec6";
  return "#5ab79f";
}

function normalizeOsmElement(element) {
  if (!element || typeof element !== "object") return null;

  let lat = Number.NaN;
  let lng = Number.NaN;

  if (element.type === "node") {
    lat = Number(element.lat);
    lng = Number(element.lon);
  } else if (element.center) {
    lat = Number(element.center.lat);
    lng = Number(element.center.lon);
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const tags = element.tags && typeof element.tags === "object" ? element.tags : {};
  const primary = primaryFeatureInfo(tags);
  const name = String(tags.name || tags.brand || tags.operator || primary.label || "OSM feature");

  return {
    id: `${element.type}/${element.id}`,
    lat,
    lng,
    name,
    kind: primary.kind,
    label: primary.label,
    tags,
    osmType: element.type,
    osmId: element.id,
  };
}

function osmPopupHtml(feature) {
  const tagPairs = Object.entries(feature.tags || {}).slice(0, 6);
  const tagsHtml =
    tagPairs.length > 0
      ? `<ul>${tagPairs
          .map(([key, value]) => `<li><strong>${escapeHtml(key)}</strong>: ${escapeHtml(value)}</li>`)
          .join("")}</ul>`
      : "";

  const osmUrl = `https://www.openstreetmap.org/${feature.osmType}/${feature.osmId}`;
  const editUrl = `https://www.openstreetmap.org/edit?${feature.osmType}=${feature.osmId}`;

  return `
    <div class="osm-popup">
      <h4>${escapeHtml(feature.name)}</h4>
      <p>${escapeHtml(feature.label)}</p>
      ${tagsHtml}
      <p><a href="${osmUrl}" target="_blank" rel="noopener noreferrer">Open in OpenStreetMap</a></p>
      <p><a href="${editUrl}" target="_blank" rel="noopener noreferrer">Contribute/Edit in OSM</a></p>
    </div>
  `;
}

function drawOsmFeatures(elements) {
  if (!ensureMapReady()) return;
  osmLayer.clearLayers();
  osm.limitNotice = "";

  const features = [];
  for (const element of elements) {
    const feature = normalizeOsmElement(element);
    if (feature) features.push(feature);
  }

  const uniqueById = new Map();
  for (const feature of features) {
    if (!uniqueById.has(feature.id)) {
      uniqueById.set(feature.id, feature);
    }
  }

  const renderLimit = 900;
  const uniqueFeatures = Array.from(uniqueById.values());
  const renderFeatures = uniqueFeatures.slice(0, renderLimit);
  if (uniqueFeatures.length > renderLimit) {
    osm.limitNotice = `Showing first ${renderLimit} features in this area. Zoom in for more detail.`;
  }

  for (const feature of renderFeatures) {
    const marker = L.circleMarker([feature.lat, feature.lng], {
      pane: "osmPane",
      radius: 4,
      weight: 1,
      color: "#d8ecfa",
      fillColor: osmFeatureColor(feature.kind),
      fillOpacity: 0.88,
    });
    marker.bindPopup(osmPopupHtml(feature), { maxWidth: 320 });
    marker.bindTooltip(feature.name, {
      direction: "top",
      offset: [0, -5],
    });
    osmLayer.addLayer(marker);
  }

  osm.count = renderFeatures.length;
}

function clearOsmLayer() {
  if (osmLayer) {
    osmLayer.clearLayers();
  }
  osm.count = 0;
  osm.limitNotice = "";
}

function mapQueryKey(bounds) {
  return [
    osm.category,
    map.getZoom(),
    bounds.getSouth().toFixed(3),
    bounds.getWest().toFixed(3),
    bounds.getNorth().toFixed(3),
    bounds.getEast().toFixed(3),
  ].join(":");
}

async function loadOsmFeatures({ force = false } = {}) {
  if (!map || !osm.enabled) return;

  if (map.getZoom() < OSM_MIN_ZOOM) {
    clearOsmLayer();
    osm.error = `Zoom in to level ${OSM_MIN_ZOOM}+ to load OSM features.`;
    osm.busy = false;
    return;
  }

  const bounds = map.getBounds();
  const queryKey = mapQueryKey(bounds);
  if (!force && queryKey === lastOsmQueryKey) {
    return;
  }
  lastOsmQueryKey = queryKey;

  if (osmAbortController) {
    osmAbortController.abort();
  }

  osmAbortController = new AbortController();
  osm.busy = true;
  osm.error = "";

  try {
    const query = buildOverpassQuery(bounds, osm.category);
    const payload = await fetchOverpass(query, osmAbortController.signal);
    drawOsmFeatures(payload.elements || []);
    osm.lastUpdated = new Date().toISOString();
  } catch (error) {
    if (osmAbortController?.signal?.aborted) return;
    clearOsmLayer();
    osm.error = String(error?.message || "Could not load OSM features.");
  } finally {
    osm.busy = false;
  }
}

function scheduleOsmRefresh(force = false) {
  if (!map) return;
  if (!osm.enabled) {
    clearOsmLayer();
    osm.error = "";
    return;
  }

  if (moveDebounceTimer) {
    clearTimeout(moveDebounceTimer);
  }

  moveDebounceTimer = setTimeout(() => {
    loadOsmFeatures({ force });
  }, 450);
}

onMounted(async () => {
  if (!mapEl.value) return;

  map = L.map(mapEl.value, {
    zoomControl: true,
    minZoom: 2,
    maxZoom: 19,
    dragging: true,
    touchZoom: true,
  });

  map.getContainer().style.touchAction = "none";
  map.getContainer().style.webkitTouchCallout = "none";
  map.getContainer().style.webkitUserSelect = "none";

  map.createPane("osmPane");
  map.getPane("osmPane").style.zIndex = 350;
  map.createPane("overlayPane");
  map.getPane("overlayPane").style.zIndex = 400;
  map.createPane("inspectionPane");
  map.getPane("inspectionPane").style.zIndex = 440;
  map.createPane("draftPane");
  map.getPane("draftPane").style.zIndex = 500;

  const osmStandard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  });

  const osmHumanitarian = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors, Humanitarian style",
  });

  osmStandard.addTo(map);

  inspectionLayer = L.layerGroup().addTo(map);
  overlayLayer = L.layerGroup().addTo(map);
  osmLayer = L.layerGroup().addTo(map);
  draftLayer = L.layerGroup().addTo(map);

  L.control
    .layers(
      {
        "OSM Standard": osmStandard,
        "OSM Humanitarian": osmHumanitarian,
      },
      {
        Inspections: inspectionLayer,
        "Master Overlays": overlayLayer,
        "OSM Features": osmLayer,
      },
      {
        position: "bottomleft",
      }
    )
    .addTo(map);

  map.setView(DEFAULT_VIEW, 6);
  map.on("click", onMapClick);
  map.on("moveend", () => scheduleOsmRefresh(false));

  await nextTick();
  drawInspections({ fitToBounds: inspectionRows.value.length > 0 });
  drawOverlays();
  drawDraftLayer();
  hasAutoFit = inspectionRows.value.length > 0;
  scheduleOsmRefresh(true);
  window.addEventListener("resize", invalidateMapSize);
  window.addEventListener("orientationchange", invalidateMapSize);
});

watch(
  inspectionRows,
  (rows) => {
    const shouldFit = !hasAutoFit && rows.length > 0;
    drawInspections({ fitToBounds: shouldFit });
    if (shouldFit) hasAutoFit = true;
  },
  { deep: true }
);

watch(
  overlayRows,
  () => {
    drawOverlays();
  },
  { deep: true }
);

watch(
  () => props.selectedInspectionId,
  () => {
    drawInspections({ fitToBounds: false });
    focusSelectedInspection();
  }
);

watch(
  () => props.createInspectionDraft,
  () => {
    drawDraftLayer();
  },
  { deep: true }
);

watch(
  () => props.busy,
  (busy) => {
    if (!busy && map) {
      setTimeout(() => map?.invalidateSize(), 0);
    }
  }
);

watch(
  () => [osm.enabled, osm.category],
  () => {
    lastOsmQueryKey = "";
    scheduleOsmRefresh(true);
  }
);

watch(
  () => props.createPlacementActive,
  (active) => {
    if (active) {
      activeDrawer.value = "none";
      resetMode();
      clearCreateDraftGeometry();
      setToolNotice(
        props.createPlacementKind === "area"
          ? "Click the map to add area vertices, then save the area."
          : "Click the map to place the new inspection."
      );
    } else {
      clearCreateDraftGeometry();
      drawDraftLayer();
    }
  }
);

watch(
  () => props.createPlacementKind,
  (kind) => {
    if (props.createPlacementActive) {
      clearCreateDraftGeometry();
      setToolNotice(
        kind === "area"
          ? "Click the map to add area vertices, then save the area."
          : "Click the map to place the new inspection."
      );
    }
  }
);

onBeforeUnmount(() => {
  window.removeEventListener("resize", invalidateMapSize);
  window.removeEventListener("orientationchange", invalidateMapSize);

  if (moveDebounceTimer) {
    clearTimeout(moveDebounceTimer);
    moveDebounceTimer = null;
  }

  if (osmAbortController) {
    osmAbortController.abort();
    osmAbortController = null;
  }

  if (map) {
    map.off("click", onMapClick);
    map.remove();
    map = null;
  }

  inspectionLayer = null;
  overlayLayer = null;
  osmLayer = null;
  draftLayer = null;
});
</script>

<template>
  <div class="gis-map-root">
    <div class="map-canvas" ref="mapEl" />

    <div v-if="toolError" class="floating-banner error">{{ toolError }}</div>
    <div v-if="toolNotice" class="floating-banner notice">{{ toolNotice }}</div>

    <div v-if="createPlacementActive" class="create-picker-banner">
      <div>
        <strong>Create inspection from map</strong>
        <p v-if="createPlacementKind === 'area'">
          Click to add area vertices. Save the polygon when the shape is complete.
        </p>
        <p v-else>Click one point on the map to set the new inspection location.</p>
      </div>
      <div class="hud-actions">
        <button
          v-if="createPlacementKind === 'area'"
          type="button"
          class="tool-btn muted"
          :disabled="createAreaPointCount === 0"
          @click="undoCreateDraftPoint"
        >
          Undo
        </button>
        <button
          v-if="createPlacementKind === 'area'"
          type="button"
          class="tool-btn primary"
          :disabled="createAreaPointCount < 3"
          @click="saveCreateArea"
        >
          Save area
        </button>
        <button type="button" class="tool-btn muted" @click="$emit('cancel-create-location')">Cancel</button>
      </div>
    </div>

    <div class="map-toolbar toolbar-left">
      <div class="toolbar-group">
        <button
          type="button"
          :class="['tool-btn', { active: activeDrawer === 'layers' }]"
          :disabled="createPlacementActive"
          @click="toggleDrawer('layers')"
        >
          Layers
        </button>
        <button
          type="button"
          :class="['tool-btn', { active: activeDrawer === 'edit' }]"
          :disabled="createPlacementActive"
          @click="toggleDrawer('edit')"
        >
          Edit
        </button>
        <button
          type="button"
          :class="['tool-btn', { active: activeDrawer === 'contribute' }]"
          :disabled="createPlacementActive"
          @click="toggleDrawer('contribute')"
        >
          Contribute
        </button>
      </div>
    </div>

    <div class="map-toolbar toolbar-right">
      <div class="toolbar-group">
        <button type="button" class="tool-btn" @click="fitAllData">Fit</button>
        <button type="button" class="tool-btn" :disabled="areaBoundaryCount === 0" @click="fitAreaBoundaries">
          Areas
        </button>
        <button type="button" class="tool-btn" :disabled="!selectedInspection" @click="focusSelectedInspection">
          Focus
        </button>
        <button
          type="button"
          :class="['tool-btn', { active: activeDrawer === 'team' }]"
          :disabled="createPlacementActive"
          @click="toggleDrawer('team')"
        >
          Team Layers
        </button>
      </div>
    </div>

    <section v-if="activeDrawer === 'layers'" class="map-drawer left">
      <article class="hud-card">
        <div class="drawer-head">
          <div>
            <p class="drawer-eyebrow">Map Layers</p>
            <h4>OpenStreetMap Data</h4>
          </div>
          <button type="button" class="tool-btn muted" @click="closeDrawer">Close</button>
        </div>
        <label class="hud-check">
          <input v-model="osm.enabled" type="checkbox" />
          Show OpenStreetMap live features
        </label>
        <label>
          Category
          <select v-model="osm.category" :disabled="!osm.enabled">
            <option v-for="option in OSM_CATEGORY_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </label>
        <div class="hud-actions">
          <button
            type="button"
            class="tool-btn"
            :disabled="!osm.enabled || osm.busy"
            @click="scheduleOsmRefresh(true)"
          >
            {{ osm.busy ? "Loading..." : "Reload OSM" }}
          </button>
          <button type="button" class="tool-btn" :disabled="areaBoundaryCount === 0" @click="fitAreaBoundaries">
            Fit areas
          </button>
          <button type="button" class="tool-btn" :disabled="!selectedInspection" @click="focusSelectedInspection">
            Focus selected
          </button>
        </div>
        <p class="hud-meta">
          OSM features: <strong>{{ osm.count }}</strong> | Last update: {{ osmUpdatedLabel }}
        </p>
        <p class="hud-meta">
          Mapped inspections: <strong>{{ mappableInspectionCount }}</strong> / {{ inspectionRows.length }}
        </p>
        <p class="hud-meta">
          Area boundaries: <strong>{{ areaBoundaryCount }}</strong>
        </p>
        <p v-if="osm.error" class="hud-error">{{ osm.error }}</p>
        <p v-else-if="osm.limitNotice" class="hud-warning">{{ osm.limitNotice }}</p>
      </article>
    </section>

    <section v-if="activeDrawer === 'edit'" class="map-drawer left">
      <article class="hud-card">
        <div class="drawer-head">
          <div>
            <p class="drawer-eyebrow">Inspection Geometry</p>
            <h4>{{ selectedInspection?.site_name || "Select an inspection" }}</h4>
          </div>
          <button type="button" class="tool-btn muted" @click="closeDrawer">Close</button>
        </div>
        <p class="hud-meta">
          {{ selectedInspection ? modeHint : "Select an inspection from the list or map before editing geometry." }}
        </p>
        <div class="mode-grid">
          <button
            type="button"
            :class="['tool-btn', { active: activeMode === 'inspection_point' }]"
            :disabled="!selectedInspection"
            @click="startMode('inspection_point')"
          >
            Point
          </button>
          <button
            type="button"
            :class="['tool-btn', { active: activeMode === 'inspection_area' }]"
            :disabled="!selectedInspection"
            @click="startMode('inspection_area')"
          >
            Area
          </button>
          <button type="button" class="tool-btn muted" @click="undoDraftPoint" :disabled="draft.points.length === 0">
            Undo
          </button>
          <button type="button" class="tool-btn muted" @click="resetMode">Clear</button>
        </div>

        <div v-if="activeMode === 'inspection_point'" class="hud-actions">
          <button type="button" class="tool-btn primary" :disabled="!selectedInspection" @click="saveInspectionPoint">
            Save point
          </button>
        </div>

        <div v-else-if="activeMode === 'inspection_area'" class="hud-actions">
          <span class="counter">Area points: {{ draft.points.length }}</span>
          <button type="button" class="tool-btn primary" :disabled="!selectedInspection" @click="saveInspectionArea">
            Save area
          </button>
        </div>
      </article>
    </section>

    <section v-if="activeDrawer === 'contribute'" class="map-drawer left">
      <article class="hud-card">
        <div class="drawer-head">
          <div>
            <p class="drawer-eyebrow">Master Map</p>
            <h4>Team Contributions</h4>
          </div>
          <button type="button" class="tool-btn muted" @click="closeDrawer">Close</button>
        </div>
        <p class="hud-meta">Create shared zones and labels visible to all local users.</p>
        <div class="mode-grid">
          <button
            type="button"
            :class="['tool-btn', { active: activeMode === 'overlay_zone' }]"
            @click="startMode('overlay_zone')"
          >
            New zone
          </button>
          <button
            type="button"
            :class="['tool-btn', { active: activeMode === 'overlay_label' }]"
            @click="startMode('overlay_label')"
          >
            New label
          </button>
        </div>

        <template v-if="activeMode === 'overlay_zone'">
          <label>
            Zone title
            <input v-model="draft.zoneTitle" placeholder="Restricted access" />
          </label>
          <div class="hud-actions">
            <span class="counter">Zone points: {{ draft.points.length }}</span>
            <button type="button" class="tool-btn primary" @click="createZoneOverlay">Create zone</button>
          </div>
        </template>

        <template v-else-if="activeMode === 'overlay_label'">
          <label>
            Label text
            <input v-model="draft.labelText" placeholder="Gate A / Hazard area" />
          </label>
          <div class="hud-actions">
            <button type="button" class="tool-btn primary" @click="createLabelOverlay">Create label</button>
          </div>
        </template>
      </article>
    </section>

    <section v-if="activeDrawer === 'team'" class="map-drawer right">
      <article class="hud-card overlay-list">
        <div class="drawer-head">
          <div>
            <p class="drawer-eyebrow">Shared Layers</p>
            <h4>Team Layers ({{ overlayRows.length }})</h4>
          </div>
          <button type="button" class="tool-btn muted" @click="closeDrawer">Close</button>
        </div>
        <p v-if="overlayRows.length === 0" class="hud-meta">No zones or labels yet.</p>
        <ul v-else>
          <li v-for="overlay in overlayRows" :key="overlay.id">
            <span>{{ overlay.kind }}: {{ overlay.title || overlay.label_text || "Untitled" }}</span>
            <button type="button" class="tool-btn danger" @click="requestOverlayDelete(overlay.id)">Delete</button>
          </li>
        </ul>
      </article>
    </section>

    <div v-if="inspectionRows.length === 0" class="map-empty">No inspections available.</div>
  </div>
</template>

<style scoped>
.gis-map-root {
  position: absolute;
  inset: 0;
  background: #0b2030;
}

.map-canvas {
  position: absolute;
  inset: 0;
}

:deep(.leaflet-container) {
  height: 100%;
  width: 100%;
  overscroll-behavior: contain;
}

.floating-banner {
  position: absolute;
  z-index: 620;
  left: 16px;
  right: 16px;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: 13px;
  max-width: 560px;
}

.floating-banner.error {
  top: 12px;
  background: rgba(153, 61, 61, 0.9);
  border: 1px solid rgba(255, 173, 173, 0.48);
  color: #ffe2e2;
}

.floating-banner.notice {
  top: 12px;
  background: rgba(21, 104, 84, 0.9);
  border: 1px solid rgba(134, 221, 191, 0.5);
  color: #d9fff2;
}

.create-picker-banner {
  position: absolute;
  z-index: 620;
  top: 58px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: min(560px, calc(100% - 28px));
  border: 1px solid rgba(242, 159, 75, 0.55);
  border-radius: 12px;
  background: rgba(34, 22, 10, 0.9);
  color: #fff2df;
  padding: 9px 10px;
}

.create-picker-banner p {
  margin: 2px 0 0;
  font-size: 0.8rem;
  color: #f1d8b9;
}

.map-toolbar {
  position: absolute;
  z-index: 610;
  top: 14px;
}

.toolbar-left {
  left: 14px;
}

.toolbar-right {
  right: 14px;
}

.toolbar-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  border: 1px solid rgba(35, 66, 90, 0.92);
  border-radius: 12px;
  background: rgba(7, 20, 31, 0.82);
  backdrop-filter: blur(6px);
  padding: 6px;
}

.map-drawer {
  position: absolute;
  z-index: 610;
  top: 62px;
  width: min(360px, 40vw);
  max-height: calc(100% - 76px);
  overflow: auto;
  scrollbar-width: thin;
}

.map-drawer.left {
  left: 14px;
}

.map-drawer.right {
  right: 14px;
  width: min(320px, 34vw);
}

.hud-card {
  border: 1px solid rgba(35, 66, 90, 0.92);
  border-radius: 12px;
  background: rgba(7, 20, 31, 0.86);
  backdrop-filter: blur(6px);
  padding: 10px;
  display: grid;
  gap: 8px;
}

.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.drawer-eyebrow {
  margin: 0 0 3px;
  color: #8db1c8;
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.hud-card h4 {
  margin: 0;
  color: #ecf5ff;
  font-size: 0.95rem;
}

.hud-card label {
  display: grid;
  gap: 4px;
  font-size: 0.78rem;
  color: #abcae0;
}

.hud-check {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hud-check input {
  width: auto;
}

.hud-card input,
.hud-card select {
  border: 1px solid #31516d;
  border-radius: 8px;
  background: #10293c;
  color: #ebf4fd;
  padding: 6px 8px;
}

.hud-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.mode-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.tool-btn {
  border: 1px solid #385a75;
  border-radius: 8px;
  background: #12334a;
  color: #deedf9;
  padding: 6px 9px;
  font-size: 0.78rem;
  cursor: pointer;
}

.tool-btn.active {
  border-color: #3ec3d6;
  background: #1b506a;
}

.tool-btn.primary {
  border-color: #2491a3;
  background: #1f8ea1;
  color: #f3fdff;
}

.tool-btn.muted {
  background: #243948;
  border-color: #485f72;
}

.tool-btn.danger {
  background: #5a2b2b;
  border-color: #8b4747;
  color: #ffd7d7;
}

.tool-btn:disabled {
  opacity: 0.54;
  cursor: not-allowed;
}

.hud-meta {
  margin: 0;
  font-size: 0.76rem;
  color: #9cb7cb;
}

.hud-error {
  margin: 0;
  color: #ffc9c9;
  font-size: 0.76rem;
}

.hud-warning {
  margin: 0;
  color: #ffdba9;
  font-size: 0.76rem;
}

.counter {
  color: #acd0e8;
  font-size: 0.76rem;
}

.overlay-list ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.overlay-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  border: 1px solid #33536c;
  border-radius: 8px;
  background: #102839;
  padding: 6px 7px;
  font-size: 0.76rem;
}

.map-empty {
  position: absolute;
  z-index: 620;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  border-radius: 999px;
  background: rgba(7, 20, 31, 0.92);
  border: 1px solid #30516c;
  color: #dceaf6;
  padding: 8px 12px;
  font-size: 12px;
  text-align: center;
}

:deep(.inspection-popup h4),
:deep(.osm-popup h4) {
  margin: 0 0 6px;
}

:deep(.inspection-popup p),
:deep(.osm-popup p) {
  margin: 0 0 5px;
}

:deep(.osm-popup ul) {
  margin: 0 0 8px;
  padding-left: 16px;
}

:deep(.osm-popup li) {
  margin: 0 0 3px;
}

:deep(.master-map-label) {
  background: rgba(8, 24, 35, 0.86);
  border: 1px solid #3a6380;
  color: #e0f1ff;
  border-radius: 999px;
  padding: 2px 8px;
}

@media (max-width: 1100px) {
  .map-drawer.left {
    width: min(320px, 46vw);
  }

  .map-drawer.right {
    width: min(290px, 38vw);
  }
}

@media (max-width: 900px) {
  .map-toolbar {
    top: 12px;
  }

  .toolbar-left {
    left: 12px;
  }

  .toolbar-right {
    right: 12px;
  }

  .map-drawer {
    top: 60px;
    width: min(340px, 52vw);
    max-height: calc(100% - 74px);
  }

  .map-drawer.left {
    left: 12px;
  }

  .map-drawer.right {
    right: 12px;
    width: min(310px, 46vw);
  }

  .floating-banner {
    left: 12px;
    right: 12px;
    max-width: none;
  }

  .create-picker-banner {
    width: calc(100% - 24px);
  }
}

@media (max-width: 640px) {
  .map-toolbar {
    top: auto;
    left: 6px;
    right: 6px;
  }

  .toolbar-left {
    bottom: calc(126px + env(safe-area-inset-bottom));
  }

  .toolbar-right {
    bottom: calc(70px + env(safe-area-inset-bottom));
  }

  .toolbar-group {
    width: 100%;
    justify-content: space-between;
  }

  .create-picker-banner {
    top: 12px;
    left: 6px;
    right: 6px;
    width: auto;
    transform: none;
    flex-direction: column;
    align-items: stretch;
  }

  .map-drawer {
    left: 6px;
    right: 6px;
    top: auto;
    bottom: calc(158px + env(safe-area-inset-bottom));
    width: auto;
    max-height: 48%;
  }

  .map-drawer.right,
  .map-drawer.left {
    left: 6px;
    right: 6px;
    width: auto;
  }

  .overlay-list li {
    align-items: stretch;
    flex-direction: column;
  }

  .mode-grid {
    grid-template-columns: 1fr 1fr;
  }

  .map-empty {
    bottom: calc(76px + env(safe-area-inset-bottom));
  }
}
</style>

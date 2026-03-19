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
  mapOnlyActive: {
    type: Boolean,
    default: false,
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
  apiBase: {
    type: String,
    default: "/api",
  },
  authToken: {
    type: String,
    default: "",
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
  "toggle-map-only",
]);

const DEFAULT_VIEW = [25.2048, 55.2708];
const OSM_MIN_ZOOM = 12;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const NOMINATIM_SEARCH_ENDPOINT = "https://nominatim.openstreetmap.org/search";
const MAX_SEARCH_RESULTS_WITH_FILTERS = 8;
const DUBAI_SEARCH_BOUNDS = {
  south: 24.90,
  west: 54.95,
  north: 25.36,
  east: 55.60,
};
const PLACE_CATEGORY_OPTIONS = [
  { value: "all", label: "Any category", query: "" },
  { value: "hotel", label: "Hotels", query: "hotel" },
  { value: "mall", label: "Malls", query: "mall" },
  { value: "restaurant", label: "Restaurants", query: "restaurant" },
  { value: "hospital", label: "Hospitals", query: "hospital" },
  { value: "school", label: "Schools", query: "school" },
  { value: "supermarket", label: "Supermarkets", query: "supermarket" },
  { value: "pharmacy", label: "Pharmacies", query: "pharmacy" },
  { value: "park", label: "Parks", query: "park" },
];
const DUBAI_AREA_OPTIONS = [
  { value: "all", label: "All Dubai", center: [25.2048, 55.2708], zoom: 11, bounds: DUBAI_SEARCH_BOUNDS },
  {
    value: "downtown_dubai",
    label: "Downtown Dubai",
    center: [25.1948, 55.2744],
    zoom: 14,
    bounds: { south: 25.176, west: 55.252, north: 25.215, east: 55.306 },
  },
  {
    value: "business_bay",
    label: "Business Bay",
    center: [25.1868, 55.2725],
    zoom: 14,
    bounds: { south: 25.173, west: 55.245, north: 25.2, east: 55.292 },
  },
  {
    value: "difc",
    label: "DIFC",
    center: [25.2125, 55.2791],
    zoom: 14,
    bounds: { south: 25.202, west: 55.266, north: 25.224, east: 55.293 },
  },
  {
    value: "city_walk",
    label: "City Walk",
    center: [25.2056, 55.2644],
    zoom: 15,
    bounds: { south: 25.198, west: 55.255, north: 25.213, east: 55.274 },
  },
  {
    value: "jumeirah",
    label: "Jumeirah",
    center: [25.2042, 55.2476],
    zoom: 13,
    bounds: { south: 25.17, west: 55.188, north: 25.235, east: 55.273 },
  },
  {
    value: "umm_suqeim",
    label: "Umm Suqeim",
    center: [25.1526, 55.2208],
    zoom: 13,
    bounds: { south: 25.128, west: 55.178, north: 25.173, east: 55.249 },
  },
  {
    value: "al_sufouh",
    label: "Al Sufouh",
    center: [25.1115, 55.1708],
    zoom: 13,
    bounds: { south: 25.092, west: 55.141, north: 25.134, east: 55.197 },
  },
  {
    value: "palm_jumeirah",
    label: "Palm Jumeirah",
    center: [25.1124, 55.139],
    zoom: 13,
    bounds: { south: 25.094, west: 55.117, north: 25.146, east: 55.166 },
  },
  {
    value: "dubai_marina",
    label: "Dubai Marina",
    center: [25.0806, 55.1413],
    zoom: 14,
    bounds: { south: 25.055, west: 55.116, north: 25.108, east: 55.169 },
  },
  {
    value: "jbr",
    label: "JBR",
    center: [25.0776, 55.1337],
    zoom: 15,
    bounds: { south: 25.069, west: 55.124, north: 25.086, east: 55.145 },
  },
  {
    value: "bluewaters",
    label: "Bluewaters",
    center: [25.0804, 55.1198],
    zoom: 15,
    bounds: { south: 25.074, west: 55.113, north: 25.086, east: 55.127 },
  },
  {
    value: "jlt",
    label: "JLT",
    center: [25.0733, 55.1436],
    zoom: 14,
    bounds: { south: 25.061, west: 55.128, north: 25.094, east: 55.17 },
  },
  {
    value: "the_greens",
    label: "The Greens",
    center: [25.0944, 55.1713],
    zoom: 14,
    bounds: { south: 25.086, west: 55.161, north: 25.101, east: 55.18 },
  },
  {
    value: "barsha_heights",
    label: "Barsha Heights (Tecom)",
    center: [25.0967, 55.1751],
    zoom: 14,
    bounds: { south: 25.087, west: 55.162, north: 25.106, east: 55.186 },
  },
  {
    value: "al_barsha",
    label: "Al Barsha",
    center: [25.1094, 55.2017],
    zoom: 13,
    bounds: { south: 25.074, west: 55.162, north: 25.125, east: 55.246 },
  },
  {
    value: "jvc",
    label: "JVC",
    center: [25.0551, 55.2093],
    zoom: 13,
    bounds: { south: 25.033, west: 55.185, north: 25.074, east: 55.232 },
  },
  {
    value: "jvt",
    label: "JVT",
    center: [25.047, 55.1728],
    zoom: 13,
    bounds: { south: 25.028, west: 55.152, north: 25.064, east: 55.197 },
  },
  {
    value: "sports_city",
    label: "Dubai Sports City",
    center: [25.0398, 55.2194],
    zoom: 14,
    bounds: { south: 25.029, west: 55.206, north: 25.049, east: 55.232 },
  },
  {
    value: "motor_city",
    label: "Motor City",
    center: [25.0464, 55.2431],
    zoom: 14,
    bounds: { south: 25.034, west: 55.231, north: 25.058, east: 55.257 },
  },
  {
    value: "arabian_ranches",
    label: "Arabian Ranches",
    center: [25.0579, 55.2798],
    zoom: 13,
    bounds: { south: 25.038, west: 55.251, north: 25.082, east: 55.302 },
  },
  {
    value: "arabian_ranches_2",
    label: "Arabian Ranches 2",
    center: [25.0433, 55.3148],
    zoom: 13,
    bounds: { south: 25.029, west: 55.293, north: 25.063, east: 55.335 },
  },
  {
    value: "damac_hills",
    label: "DAMAC Hills",
    center: [25.0324, 55.2454],
    zoom: 13,
    bounds: { south: 25.013, west: 55.221, north: 25.052, east: 55.271 },
  },
  {
    value: "dubai_hills_estate",
    label: "Dubai Hills Estate",
    center: [25.1072, 55.2441],
    zoom: 13,
    bounds: { south: 25.086, west: 55.215, north: 25.13, east: 55.275 },
  },
  {
    value: "mbr_city",
    label: "MBR City",
    center: [25.1664, 55.2732],
    zoom: 13,
    bounds: { south: 25.144, west: 55.244, north: 25.19, east: 55.299 },
  },
  {
    value: "meydan_nad_al_sheba",
    label: "Meydan / Nad Al Sheba",
    center: [25.1679, 55.3114],
    zoom: 12,
    bounds: { south: 25.133, west: 55.273, north: 25.204, east: 55.347 },
  },
  {
    value: "satwa",
    label: "Satwa",
    center: [25.2205, 55.2724],
    zoom: 14,
    bounds: { south: 25.208, west: 55.257, north: 25.232, east: 55.286 },
  },
  {
    value: "bur_dubai",
    label: "Bur Dubai",
    center: [25.2523, 55.2925],
    zoom: 13,
    bounds: { south: 25.235, west: 55.268, north: 25.266, east: 55.317 },
  },
  {
    value: "al_karama",
    label: "Al Karama",
    center: [25.2512, 55.3036],
    zoom: 14,
    bounds: { south: 25.241, west: 55.291, north: 25.261, east: 55.315 },
  },
  {
    value: "oud_metha",
    label: "Oud Metha",
    center: [25.2419, 55.319],
    zoom: 14,
    bounds: { south: 25.233, west: 55.307, north: 25.251, east: 55.331 },
  },
  {
    value: "deira",
    label: "Deira",
    center: [25.2681, 55.3206],
    zoom: 13,
    bounds: { south: 25.245, west: 55.283, north: 25.293, east: 55.36 },
  },
  {
    value: "al_nahda",
    label: "Al Nahda",
    center: [25.2924, 55.3663],
    zoom: 13,
    bounds: { south: 25.277, west: 55.334, north: 25.307, east: 55.387 },
  },
  {
    value: "al_qusais",
    label: "Al Qusais",
    center: [25.2787, 55.3884],
    zoom: 13,
    bounds: { south: 25.258, west: 55.357, north: 25.301, east: 55.421 },
  },
  {
    value: "muhaisnah",
    label: "Muhaisnah",
    center: [25.2804, 55.4371],
    zoom: 13,
    bounds: { south: 25.258, west: 55.402, north: 25.305, east: 55.468 },
  },
  {
    value: "al_twar",
    label: "Al Twar",
    center: [25.2653, 55.3615],
    zoom: 13,
    bounds: { south: 25.25, west: 55.342, north: 25.283, east: 55.384 },
  },
  {
    value: "mirdif",
    label: "Mirdif",
    center: [25.2311, 55.4267],
    zoom: 13,
    bounds: { south: 25.216, west: 55.399, north: 25.252, east: 55.454 },
  },
  {
    value: "al_mizhar",
    label: "Al Mizhar",
    center: [25.2511, 55.441],
    zoom: 13,
    bounds: { south: 25.236, west: 55.419, north: 25.266, east: 55.46 },
  },
  {
    value: "al_warqa",
    label: "Al Warqa",
    center: [25.1778, 55.4353],
    zoom: 13,
    bounds: { south: 25.157, west: 55.404, north: 25.199, east: 55.466 },
  },
  {
    value: "international_city",
    label: "International City",
    center: [25.1674, 55.4267],
    zoom: 13,
    bounds: { south: 25.153, west: 55.4, north: 25.184, east: 55.446 },
  },
  {
    value: "silicon_oasis",
    label: "Dubai Silicon Oasis",
    center: [25.1245, 55.3941],
    zoom: 13,
    bounds: { south: 25.109, west: 55.361, north: 25.14, east: 55.42 },
  },
  {
    value: "liwan",
    label: "Liwan",
    center: [25.1119, 55.3578],
    zoom: 13,
    bounds: { south: 25.096, west: 55.336, north: 25.128, east: 55.381 },
  },
  {
    value: "al_barari",
    label: "Al Barari",
    center: [25.1104, 55.2998],
    zoom: 13,
    bounds: { south: 25.095, west: 55.281, north: 25.126, east: 55.319 },
  },
  {
    value: "al_quoz",
    label: "Al Quoz",
    center: [25.1502, 55.2524],
    zoom: 13,
    bounds: { south: 25.123, west: 55.221, north: 25.178, east: 55.292 },
  },
  {
    value: "ras_al_khor",
    label: "Ras Al Khor",
    center: [25.1708, 55.3373],
    zoom: 12,
    bounds: { south: 25.14, west: 55.299, north: 25.203, east: 55.377 },
  },
  {
    value: "dubai_creek_harbour",
    label: "Dubai Creek Harbour",
    center: [25.2067, 55.3471],
    zoom: 13,
    bounds: { south: 25.186, west: 55.328, north: 25.227, east: 55.369 },
  },
  {
    value: "festival_city",
    label: "Dubai Festival City",
    center: [25.2232, 55.3617],
    zoom: 14,
    bounds: { south: 25.211, west: 55.343, north: 25.236, east: 55.38 },
  },
  {
    value: "discovery_gardens",
    label: "Discovery Gardens",
    center: [25.0404, 55.1345],
    zoom: 14,
    bounds: { south: 25.024, west: 55.116, north: 25.053, east: 55.154 },
  },
  {
    value: "al_furjan",
    label: "Al Furjan",
    center: [25.0318, 55.1529],
    zoom: 14,
    bounds: { south: 25.015, west: 55.133, north: 25.048, east: 55.173 },
  },
  {
    value: "dip",
    label: "Dubai Investment Park (DIP)",
    center: [24.9918, 55.1609],
    zoom: 12,
    bounds: { south: 24.956, west: 55.114, north: 25.028, east: 55.207 },
  },
  {
    value: "jebel_ali",
    label: "Jebel Ali",
    center: [25.0089, 55.0904],
    zoom: 12,
    bounds: { south: 24.937, west: 55.005, north: 25.063, east: 55.151 },
  },
  {
    value: "jafza",
    label: "JAFZA",
    center: [24.9991, 55.093],
    zoom: 12,
    bounds: { south: 24.964, west: 55.038, north: 25.039, east: 55.142 },
  },
  {
    value: "dubai_south",
    label: "Dubai South",
    center: [24.9144, 55.1106],
    zoom: 11,
    bounds: { south: 24.84, west: 54.99, north: 24.99, east: 55.2 },
  },
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
const TOOL_NOTICE_AUTO_HIDE_MS = 3000;
const DEFAULT_MARKER_TYPE = "standard";
const MARKER_TYPE_OPTIONS = [
  { value: "standard", label: "Standard" },
  { value: "info", label: "Info" },
  { value: "warning", label: "Warning" },
  { value: "critical", label: "Critical" },
];
const MARKER_ICON_GLYPH_BY_TYPE = {
  standard: "•",
  info: "i",
  warning: "!",
  critical: "×",
};

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
  inspectionMarkerType: DEFAULT_MARKER_TYPE,
  labelMarkerType: DEFAULT_MARKER_TYPE,
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
const mapSearch = reactive({
  query: "",
  category: "all",
  area: "all",
  busy: false,
  results: [],
});
const gallery = reactive({
  open: false,
  loading: false,
  error: "",
  inspectionId: null,
  inspectionTitle: "",
  items: [],
  requestToken: 0,
});

let map = null;
let inspectionLayer = null;
let overlayLayer = null;
let osmLayer = null;
let draftLayer = null;
let searchResultMarker = null;
let hasAutoFit = false;
let moveDebounceTimer = null;
let osmAbortController = null;
let lastOsmQueryKey = "";
let toolNoticeTimer = null;
const mediaThumbObjectUrls = new Map();
const mediaThumbPending = new Map();

function clearToolNoticeTimer() {
  if (toolNoticeTimer) {
    clearTimeout(toolNoticeTimer);
    toolNoticeTimer = null;
  }
}

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
const createInspectionDraftMarkerType = computed(() =>
  normalizeMarkerType(props.createInspectionDraft?.marker_type)
);
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

function normalizeMarkerType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized in MARKER_ICON_GLYPH_BY_TYPE) return normalized;
  return DEFAULT_MARKER_TYPE;
}

function markerGlyphForType(markerType) {
  const normalized = normalizeMarkerType(markerType);
  return MARKER_ICON_GLYPH_BY_TYPE[normalized] || MARKER_ICON_GLYPH_BY_TYPE[DEFAULT_MARKER_TYPE];
}

function mapMarkerIcon(markerType, options = {}) {
  const normalizedType = normalizeMarkerType(markerType);
  const glyph = markerGlyphForType(normalizedType);
  const iconKind = options.kind === "label" ? "label" : "inspection";
  const selectedClass = options.selected ? "is-selected" : "";
  const draftClass = options.draft ? "is-draft" : "";

  return L.divIcon({
    className: "map-marker-shell",
    html: `<span class="map-marker-icon map-marker-icon--${iconKind} map-marker-icon--${normalizedType} ${selectedClass} ${draftClass}">${glyph}</span>`,
    iconSize: [24, 30],
    iconAnchor: [12, 24],
    popupAnchor: [0, -20],
    tooltipAnchor: [12, -18],
  });
}

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
const mapSearchCanSubmit = computed(() => {
  if (mapSearch.busy) return false;
  const hasQuery = String(mapSearch.query || "").trim().length > 0;
  const hasCategory = String(mapSearch.category || "all") !== "all";
  return hasQuery || hasCategory;
});

function placeCategoryOption(value) {
  return (
    PLACE_CATEGORY_OPTIONS.find((option) => option.value === value) ||
    PLACE_CATEGORY_OPTIONS[0]
  );
}

function dubaiAreaOption(value) {
  return DUBAI_AREA_OPTIONS.find((option) => option.value === value) || DUBAI_AREA_OPTIONS[0];
}

function toggleDrawer(drawer) {
  activeDrawer.value = activeDrawer.value === drawer ? "none" : drawer;
}

function closeDrawer() {
  activeDrawer.value = "none";
}

function clearToolMessages() {
  clearToolNoticeTimer();
  toolError.value = "";
  toolNotice.value = "";
}

function setToolError(message) {
  clearToolNoticeTimer();
  toolError.value = message;
  toolNotice.value = "";
}

function setToolNotice(message) {
  clearToolNoticeTimer();
  toolNotice.value = message;
  toolError.value = "";
  toolNoticeTimer = setTimeout(() => {
    toolNotice.value = "";
    toolNoticeTimer = null;
  }, TOOL_NOTICE_AUTO_HIDE_MS);
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
    draft.inspectionMarkerType = normalizeMarkerType(selectedInspection.value?.marker_type);
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
  const mediaCount = Number(inspection.media_count) || 0;
  const mediaPhotoCount = Number(inspection.media_photo_count) || 0;
  const mediaDocumentCount = Number(inspection.media_document_count) || 0;
  const mediaCoverFileName = String(inspection.media_cover_file_name || "").trim();
  const mediaSummaryText =
    mediaCount > 0
      ? `${mediaCount} file${mediaCount === 1 ? "" : "s"} (${mediaPhotoCount} photos, ${mediaDocumentCount} docs)`
      : "No media uploaded";
  const mediaCoverRow = mediaCoverFileName
    ? `<p><strong>Cover:</strong> ${escapeHtml(mediaCoverFileName)}</p>`
    : "";
  const mediaActionButton =
    mediaCount > 0
      ? `<button type="button" class="popup-media-btn" data-action="open-media" data-inspection-id="${escapeHtml(inspection.id)}">Open Gallery</button>`
      : "";
  const mediaCoverId = Number(inspection.media_cover_media_id);
  const hasCover = Number.isFinite(mediaCoverId) && mediaCoverId > 0;
  const mediaThumbnail = hasCover
    ? `
      <figure class="popup-media-cover">
        <img
          class="popup-media-thumb"
          alt="Cover photo"
          data-action="media-thumb"
          data-inspection-id="${escapeHtml(inspection.id)}"
          data-media-id="${escapeHtml(mediaCoverId)}"
        />
        <figcaption class="popup-media-thumb-status" data-action="media-thumb-status">Loading preview...</figcaption>
      </figure>
    `
    : "";

  return `
    <div class="inspection-popup">
      <h4>${escapeHtml(inspection.site_name || "Inspection")}</h4>
      <p><strong>No:</strong> ${escapeHtml(inspection.inspection_no || "-")}</p>
      <p><strong>Status:</strong> ${escapeHtml(inspection.status || "-")}</p>
      <p><strong>Result:</strong> ${escapeHtml(inspection.overall_result || "na")}</p>
      <p><strong>Team:</strong> ${escapeHtml(teamLabel)}</p>
      <p><strong>Media:</strong> ${escapeHtml(mediaSummaryText)}</p>
      ${mediaThumbnail}
      ${mediaCoverRow}
      ${safeNotes ? `<p><strong>Notes:</strong> ${escapeHtml(safeNotes)}</p>` : ""}
      ${mediaActionButton}
    </div>
  `;
}

function mediaFileUrl(inspectionId, mediaId) {
  const base = String(props.apiBase || "/api").replace(/\/$/, "");
  return `${base}/inspections/${inspectionId}/media/${mediaId}/file`;
}

function authHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = String(props.authToken || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchMediaThumbnailUrl(inspectionId, mediaId) {
  const key = `${inspectionId}:${mediaId}`;
  const cached = mediaThumbObjectUrls.get(key);
  if (cached) return cached;

  const pending = mediaThumbPending.get(key);
  if (pending) return pending;

  const request = (async () => {
    const response = await fetch(mediaFileUrl(inspectionId, mediaId), {
      method: "GET",
      headers: authHeaders({ Accept: "image/*" }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) {
      throw new Error("Not an image");
    }

    const blob = await response.blob();
    if (!String(blob.type || "").toLowerCase().startsWith("image/")) {
      throw new Error("Invalid image payload");
    }

    const objectUrl = URL.createObjectURL(blob);
    mediaThumbObjectUrls.set(key, objectUrl);
    return objectUrl;
  })();

  mediaThumbPending.set(key, request);

  try {
    return await request;
  } finally {
    mediaThumbPending.delete(key);
  }
}

function setPopupThumbStatus(container, message) {
  const status = container?.querySelector('[data-action="media-thumb-status"]');
  if (!status) return;
  status.textContent = message;
}

async function loadPopupThumbnail(container, inspectionId, mediaId) {
  const image = container?.querySelector(
    `[data-action="media-thumb"][data-inspection-id="${inspectionId}"][data-media-id="${mediaId}"]`
  );
  if (!image || image.dataset.loaded === "1") return;

  setPopupThumbStatus(container, "Loading preview...");
  try {
    const objectUrl = await fetchMediaThumbnailUrl(inspectionId, mediaId);
    image.src = objectUrl;
    image.dataset.loaded = "1";
    image.style.display = "block";
    setPopupThumbStatus(container, "");
  } catch (_error) {
    setPopupThumbStatus(container, "Preview unavailable");
  }
}

function formatMediaFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function closeInspectionGallery() {
  gallery.open = false;
  gallery.loading = false;
  gallery.error = "";
  gallery.inspectionId = null;
  gallery.inspectionTitle = "";
  gallery.items = [];
  gallery.requestToken += 1;
}

async function loadGalleryPreviews(items, inspectionId, requestToken) {
  const rows = Array.isArray(items) ? items : [];
  for (const row of rows) {
    if (row?.media_type !== "photo") continue;
    if (requestToken !== gallery.requestToken) return;
    const mediaId = Number(row?.id);
    if (!Number.isFinite(mediaId)) {
      row.preview_url = "";
      row.preview_failed = true;
      continue;
    }
    try {
      const previewUrl = await fetchMediaThumbnailUrl(inspectionId, mediaId);
      row.preview_url = previewUrl;
      row.preview_failed = false;
    } catch (_error) {
      row.preview_url = "";
      row.preview_failed = true;
    }
  }
}

async function openInspectionGallery(inspection) {
  const inspectionId = Number(inspection?.id);
  if (!Number.isFinite(inspectionId)) return;

  gallery.open = true;
  gallery.loading = true;
  gallery.error = "";
  gallery.inspectionId = inspectionId;
  gallery.inspectionTitle = String(inspection?.site_name || inspection?.inspection_no || `Inspection #${inspectionId}`);
  gallery.items = [];
  const requestToken = gallery.requestToken + 1;
  gallery.requestToken = requestToken;

  try {
    const base = String(props.apiBase || "/api").replace(/\/$/, "");
    const response = await fetch(`${base}/inspections/${inspectionId}/media`, {
      method: "GET",
      headers: authHeaders({ Accept: "application/json" }),
    });
    if (!response.ok) {
      throw new Error(`Media API returned HTTP ${response.status}`);
    }

    const payload = await response.json();
    const rows = Array.isArray(payload?.data)
      ? payload.data
          .slice()
          .sort((left, right) => Number(right?.id || 0) - Number(left?.id || 0))
          .map((row) => ({
            ...row,
            preview_url: "",
            preview_failed: false,
          }))
      : [];

    if (requestToken !== gallery.requestToken) return;
    gallery.items = rows;
    gallery.loading = false;
    loadGalleryPreviews(gallery.items, inspectionId, requestToken);
  } catch (error) {
    if (requestToken !== gallery.requestToken) return;
    gallery.loading = false;
    gallery.error = String(error?.message || "Could not load inspection media.");
  }
}

async function openGalleryFile(item, download = false) {
  const inspectionId = Number(gallery.inspectionId);
  const mediaId = Number(item?.id);
  if (!Number.isFinite(inspectionId) || !Number.isFinite(mediaId)) return;

  try {
    const response = await fetch(mediaFileUrl(inspectionId, mediaId), {
      method: "GET",
      headers: authHeaders({ Accept: "*/*" }),
    });
    if (!response.ok) {
      throw new Error(`Media API returned HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    if (download) {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = String(item?.original_file_name || item?.stored_file_name || `media-${mediaId}`);
      anchor.rel = "noopener";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
      return;
    }

    window.open(objectUrl, "_blank", "noopener,noreferrer");
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    setToolError(String(error?.message || "Could not open media file."));
  }
}

function bindInspectionPopupActions(layer, inspection) {
  layer.on("popupopen", (event) => {
    const popupElement = event?.popup?.getElement?.();
    if (!popupElement) return;

    const inspectionId = Number(inspection.id);
    const mediaCoverId = Number(inspection.media_cover_media_id);
    if (Number.isFinite(inspectionId) && Number.isFinite(mediaCoverId) && mediaCoverId > 0) {
      loadPopupThumbnail(popupElement, inspectionId, mediaCoverId);
    }

    const button = popupElement.querySelector(`[data-action="open-media"][data-inspection-id="${inspection.id}"]`);
    if (!button || button.dataset.bound === "1") return;
    button.dataset.bound = "1";
    button.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
      openInspectionGallery(inspection);
    });
  });
}

function addInspectionPointLayer(inspection, lat, lng, bounds) {
  const isSelected = inspection.id === props.selectedInspectionId;
  const marker = L.marker([lat, lng], {
    pane: "inspectionPane",
    icon: mapMarkerIcon(inspection?.marker_type, {
      kind: "inspection",
      selected: isSelected,
    }),
  });

  marker.bindPopup(popupHtml(inspection), { maxWidth: 300 });
  marker.bindTooltip(String(inspection.site_name || inspection.inspection_no || inspection.id), {
    direction: "top",
    offset: [0, -6],
  });
  bindInspectionPopupActions(marker, inspection);
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
  bindInspectionPopupActions(layer, inspection);
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
      const markerType = normalizeMarkerType(overlay?.marker_type);

      const marker = L.marker([lat, lng], {
        pane: "overlayPane",
        icon: mapMarkerIcon(markerType, {
          kind: "label",
        }),
      });
      marker.bindTooltip(String(overlay.label_text || overlay.title || "Label"), {
        permanent: true,
        direction: "right",
        offset: [8, 0],
        className: `master-map-label master-map-label--${markerType}`,
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
    const marker = L.marker([createInspectionDraftPoint.value.lat, createInspectionDraftPoint.value.lng], {
      pane: "draftPane",
      icon: mapMarkerIcon(createInspectionDraftMarkerType.value, {
        kind: "inspection",
        draft: true,
      }),
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
    const markerType =
      activeMode.value === "inspection_point" ? draft.inspectionMarkerType : draft.labelMarkerType;
    const marker = L.marker([draft.point.lat, draft.point.lng], {
      pane: "draftPane",
      icon: mapMarkerIcon(markerType, {
        kind: activeMode.value === "inspection_point" ? "inspection" : "label",
        draft: true,
      }),
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
    marker_type: normalizeMarkerType(draft.inspectionMarkerType),
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
    marker_type: normalizeMarkerType(draft.labelMarkerType),
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

function clearSearchMarker() {
  if (searchResultMarker && map) {
    map.removeLayer(searchResultMarker);
  }
  searchResultMarker = null;
}

function areaBoundsLatLng(area) {
  const bounds = area?.bounds;
  if (
    !bounds ||
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.west) ||
    !Number.isFinite(bounds.north) ||
    !Number.isFinite(bounds.east)
  ) {
    return null;
  }

  return L.latLngBounds(
    [Number(bounds.south), Number(bounds.west)],
    [Number(bounds.north), Number(bounds.east)]
  );
}

function clearSearchAreaBoundary() {
  // Area boundary overlay intentionally disabled.
}

function drawSearchAreaBoundary({ fitToBounds = false, announce = false } = {}) {
  if (!map) return;
  const area = dubaiAreaOption(mapSearch.area);
  const latLngBounds = areaBoundsLatLng(area);

  clearSearchAreaBoundary();

  if (fitToBounds) {
    if (latLngBounds) {
      map.fitBounds(latLngBounds, {
        padding: [30, 30],
        maxZoom: Number(area?.zoom) || 13,
      });
    } else {
      const [latitude, longitude] = Array.isArray(area?.center) ? area.center : DEFAULT_VIEW;
      map.flyTo([latitude, longitude], Number(area?.zoom) || 12, {
        duration: 0.6,
      });
    }
  }

  if (announce) {
    setToolNotice(`Focused on ${area?.label || "Dubai"}.`);
  }
}

function focusSearchResult(result) {
  if (!map || !result) return;

  const latitude = Number(result.lat);
  const longitude = Number(result.lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  clearSearchMarker();
  searchResultMarker = L.circleMarker([latitude, longitude], {
    pane: "overlayPane",
    radius: 8,
    weight: 2,
    color: "#ffffff",
    fillColor: "#f29f4b",
    fillOpacity: 0.95,
  }).addTo(map);
  searchResultMarker.bindPopup(
    `<div class="osm-popup"><h4>Search result</h4><p>${escapeHtml(result.label || "Location")}</p></div>`,
    { maxWidth: 320 }
  );
  searchResultMarker.openPopup();

  map.flyTo([latitude, longitude], Math.max(map.getZoom(), 14), {
    duration: 0.7,
  });
}

function clearMapSearchResults() {
  mapSearch.results = [];
  clearSearchMarker();
}

function focusDubaiArea() {
  if (!map) return;
  drawSearchAreaBoundary({ fitToBounds: true, announce: true });
}

async function searchMapLocation() {
  if (!map) return;

  const queryText = String(mapSearch.query || "").trim();
  const category = placeCategoryOption(mapSearch.category);
  const area = dubaiAreaOption(mapSearch.area);
  const categoryQuery = String(category?.query || "").trim();

  if (!queryText && !categoryQuery) {
    setToolError("Type a place name or choose a category.");
    return;
  }

  clearToolMessages();
  mapSearch.busy = true;

  try {
    const queryParts = [];
    if (queryText) queryParts.push(queryText);
    if (categoryQuery) queryParts.push(categoryQuery);
    if (area?.value && area.value !== "all") queryParts.push(area.label);
    queryParts.push("Dubai", "United Arab Emirates");

    const searchBounds = area?.bounds || DUBAI_SEARCH_BOUNDS;
    drawSearchAreaBoundary({ fitToBounds: false, announce: false });
    const params = new URLSearchParams({
      format: "jsonv2",
      q: queryParts.join(", "),
      limit: String(MAX_SEARCH_RESULTS_WITH_FILTERS),
      addressdetails: "1",
      countrycodes: "ae",
    });
    if (searchBounds) {
      params.set(
        "viewbox",
        `${searchBounds.west},${searchBounds.north},${searchBounds.east},${searchBounds.south}`
      );
      params.set("bounded", "1");
    }

    const response = await fetch(`${NOMINATIM_SEARCH_ENDPOINT}?${params.toString()}`, {
      headers: {
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      throw new Error(`Search service returned HTTP ${response.status}.`);
    }

    const payload = await response.json();
    const results = Array.isArray(payload)
      ? payload
          .map((entry, index) => {
            const latitude = Number(entry?.lat);
            const longitude = Number(entry?.lon);
            const label = String(entry?.display_name || "").trim();
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || !label) return null;

            const parts = label.split(",").map((part) => part.trim()).filter(Boolean);
            return {
              id: String(entry?.place_id || `${index}`),
              lat: latitude,
              lng: longitude,
              label,
              title: parts[0] || label,
              subtitle: parts.slice(1).join(", "),
            };
          })
          .filter(Boolean)
      : [];

    if (results.length === 0) {
      clearMapSearchResults();
      setToolError("No matching location found. Try another search term.");
      return;
    }

    mapSearch.results = results;
    focusSearchResult(results[0]);
    setToolNotice(`Found ${results.length} location${results.length === 1 ? "" : "s"}.`);
  } catch (error) {
    clearMapSearchResults();
    setToolError(String(error?.message || "Could not search location."));
  } finally {
    mapSearch.busy = false;
  }
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

  const osmAttribution = "&copy; OpenStreetMap contributors";

  const osmStandard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: osmAttribution,
  });

  const osmHumanitarian = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: `${osmAttribution}, Humanitarian style`,
  });

  const osmFrance = L.tileLayer("https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: `${osmAttribution}, style by OpenStreetMap France`,
  });

  const osmGermany = L.tileLayer("https://tile.openstreetmap.de/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: `${osmAttribution}, style by openstreetmap.de`,
  });

  const osmCyclOSM = L.tileLayer("https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png", {
    maxZoom: 20,
    attribution: `${osmAttribution}, style by CyclOSM`,
  });

  const osmTopo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
    maxZoom: 17,
    attribution: `${osmAttribution}, SRTM | OpenTopoMap`,
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
        "OSM France": osmFrance,
        "OSM Germany": osmGermany,
        CyclOSM: osmCyclOSM,
        OpenTopoMap: osmTopo,
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
    if (activeMode.value === "inspection_point") {
      draft.inspectionMarkerType = normalizeMarkerType(selectedInspection.value?.marker_type);
      drawDraftLayer();
    }
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
  () => mapSearch.area,
  (nextArea, prevArea) => {
    if (!map) return;
    if (nextArea === prevArea) return;
    clearMapSearchResults();
    drawSearchAreaBoundary({ fitToBounds: true, announce: true });
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
  clearToolNoticeTimer();
  clearSearchMarker();
  clearSearchAreaBoundary();
  for (const objectUrl of mediaThumbObjectUrls.values()) {
    URL.revokeObjectURL(objectUrl);
  }
  mediaThumbObjectUrls.clear();
  mediaThumbPending.clear();

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
  searchResultMarker = null;
});
</script>

<template>
  <div class="gis-map-root">
    <div class="map-canvas" ref="mapEl" />

    <div v-if="toolError" class="floating-banner error">{{ toolError }}</div>
    <div v-if="toolNotice" class="floating-banner notice">{{ toolNotice }}</div>

    <div v-if="gallery.open" class="gallery-backdrop" @click.self="closeInspectionGallery">
      <article class="gallery-modal">
        <div class="drawer-head">
          <div>
            <p class="drawer-eyebrow">Inspection Media</p>
            <h4>{{ gallery.inspectionTitle }}</h4>
          </div>
          <button type="button" class="tool-btn muted" @click="closeInspectionGallery">Close</button>
        </div>

        <p v-if="gallery.loading" class="hud-meta">Loading media...</p>
        <p v-else-if="gallery.error" class="hud-error">{{ gallery.error }}</p>
        <p v-else-if="gallery.items.length === 0" class="hud-meta">No media uploaded for this inspection.</p>
        <ul v-else class="gallery-list">
          <li v-for="item in gallery.items" :key="item.id" class="gallery-item">
            <div class="gallery-preview">
              <img v-if="item.preview_url" :src="item.preview_url" :alt="item.original_file_name || `Media ${item.id}`" />
              <div v-else class="gallery-placeholder">
                {{
                  item.media_type === "photo"
                    ? item.preview_failed
                      ? "Preview unavailable"
                      : "Loading preview..."
                    : "Document"
                }}
              </div>
            </div>
            <div class="gallery-meta">
              <h5>{{ item.original_file_name || item.stored_file_name || `Media ${item.id}` }}</h5>
              <p>{{ item.media_type }} | {{ formatMediaFileSize(item.file_size_bytes) }}</p>
            </div>
            <div class="gallery-actions">
              <button type="button" class="tool-btn" @click="openGalleryFile(item, false)">Open</button>
              <button type="button" class="tool-btn muted" @click="openGalleryFile(item, true)">Download</button>
            </div>
          </li>
        </ul>
      </article>
    </div>

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
        <button
          type="button"
          :class="['tool-btn', { active: activeDrawer === 'search' }]"
          :disabled="createPlacementActive"
          @click="toggleDrawer('search')"
        >
          Search
        </button>
        <button type="button" :class="['tool-btn', { active: mapOnlyActive }]" @click="$emit('toggle-map-only')">
          {{ mapOnlyActive ? "Exit map only" : "Map only" }}
        </button>
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

    <section v-if="activeDrawer === 'search'" class="map-drawer right">
      <article class="hud-card">
        <div class="drawer-head">
          <div>
            <p class="drawer-eyebrow">Map Search</p>
            <h4>Find place or address</h4>
          </div>
          <button type="button" class="tool-btn muted" @click="closeDrawer">Close</button>
        </div>
        <form class="map-search-form" @submit.prevent="searchMapLocation">
          <label>
            Category
            <select v-model="mapSearch.category" :disabled="mapSearch.busy">
              <option v-for="option in PLACE_CATEGORY_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            Dubai area
            <select v-model="mapSearch.area" :disabled="mapSearch.busy">
              <option v-for="option in DUBAI_AREA_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
          <label>
            Search term
            <input
              v-model.trim="mapSearch.query"
              :disabled="mapSearch.busy"
              placeholder="Optional: Mall of the Emirates, clinic, cafe..."
            />
          </label>
          <div class="hud-actions">
            <button type="submit" class="tool-btn" :disabled="!mapSearchCanSubmit">
              {{ mapSearch.busy ? "Searching..." : "Search" }}
            </button>
            <button type="button" class="tool-btn muted" :disabled="mapSearch.busy" @click="focusDubaiArea">
              Focus area
            </button>
            <button type="button" class="tool-btn muted" :disabled="mapSearch.busy" @click="clearMapSearchResults">
              Clear
            </button>
          </div>
        </form>
        <p class="hud-meta">Selecting a Dubai area focuses the map to that area.</p>
        <p v-if="mapSearch.results.length === 0" class="hud-meta">No search results yet.</p>
        <ul v-else class="search-results">
          <li v-for="result in mapSearch.results" :key="result.id">
            <button type="button" class="tool-btn muted search-result-btn" @click="focusSearchResult(result)">
              <strong>{{ result.title }}</strong>
              <span>{{ result.subtitle || result.label }}</span>
            </button>
          </li>
        </ul>
      </article>
    </section>

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
          <label class="marker-type-field">
            Marker type
            <select v-model="draft.inspectionMarkerType">
              <option v-for="option in MARKER_TYPE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </label>
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
          <label>
            Marker type
            <select v-model="draft.labelMarkerType">
              <option v-for="option in MARKER_TYPE_OPTIONS" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
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
            <span>
              {{ overlay.kind }}: {{ overlay.title || overlay.label_text || "Untitled" }}
              <template v-if="overlay.kind === 'label'">
                ({{ normalizeMarkerType(overlay.marker_type) }})
              </template>
            </span>
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
  pointer-events: none;
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

.gallery-backdrop {
  position: absolute;
  inset: 0;
  z-index: 640;
  background: rgba(4, 13, 20, 0.72);
  display: grid;
  place-items: center;
  padding: 14px;
}

.gallery-modal {
  width: min(760px, 100%);
  max-height: min(82vh, calc(100% - 28px));
  overflow: auto;
  border: 1px solid rgba(35, 66, 90, 0.92);
  border-radius: 12px;
  background: rgba(7, 20, 31, 0.95);
  backdrop-filter: blur(6px);
  padding: 10px;
  display: grid;
  gap: 8px;
}

.gallery-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.gallery-item {
  border: 1px solid #33536c;
  border-radius: 10px;
  background: #102839;
  padding: 7px;
  display: grid;
  grid-template-columns: 132px minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
}

.gallery-preview img,
.gallery-placeholder {
  width: 126px;
  height: 80px;
  border-radius: 8px;
  border: 1px solid #2f5f7d;
  object-fit: cover;
  background: #0f2739;
}

.gallery-placeholder {
  display: grid;
  place-items: center;
  color: #a9c6da;
  font-size: 0.72rem;
  text-align: center;
  padding: 6px;
}

.gallery-meta h5 {
  margin: 0 0 4px;
  color: #e7f4ff;
  font-size: 0.82rem;
}

.gallery-meta p {
  margin: 0;
  color: #9cb7cb;
  font-size: 0.74rem;
}

.gallery-actions {
  display: grid;
  gap: 6px;
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

.marker-type-field {
  min-width: 132px;
}

.map-search-form {
  display: grid;
  gap: 8px;
}

.search-results {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
  max-height: 220px;
  overflow: auto;
}

.search-result-btn {
  width: 100%;
  text-align: left;
  display: grid;
  gap: 2px;
}

.search-result-btn strong {
  font-size: 0.8rem;
  color: #ecf5ff;
}

.search-result-btn span {
  font-size: 0.72rem;
  color: #a5c2d8;
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

:deep(.popup-media-btn) {
  border: 1px solid #2f5f7d;
  background: #103048;
  color: #e3f2ff;
  border-radius: 8px;
  padding: 5px 8px;
  cursor: pointer;
  font-size: 12px;
}

:deep(.popup-media-cover) {
  margin: 0 0 6px;
  display: grid;
  gap: 4px;
}

:deep(.popup-media-thumb) {
  width: 156px;
  height: 102px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid #2f5f7d;
  background: #0f2739;
  display: none;
}

:deep(.popup-media-thumb-status) {
  margin: 0;
  font-size: 11px;
  color: #9db8cd;
}

:deep(.osm-popup ul) {
  margin: 0 0 8px;
  padding-left: 16px;
}

:deep(.osm-popup li) {
  margin: 0 0 3px;
}

:deep(.map-marker-shell) {
  background: transparent;
  border: none;
}

:deep(.map-marker-icon) {
  --marker-bg: #5fb5ff;
  position: relative;
  display: inline-grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border-radius: 999px;
  border: 2px solid #e7f1fa;
  background: var(--marker-bg);
  color: #f8fcff;
  font-size: 12px;
  font-weight: 800;
  line-height: 1;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.35);
  box-shadow: 0 3px 9px rgba(0, 0, 0, 0.42);
  transition: transform 120ms ease;
}

:deep(.map-marker-icon::after) {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -7px;
  transform: translateX(-50%);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 8px solid var(--marker-bg);
}

:deep(.map-marker-icon--inspection) {
  border-color: #e9f4ff;
}

:deep(.map-marker-icon--label) {
  width: 22px;
  height: 22px;
  border-color: #0f3046;
}

:deep(.map-marker-icon--label::after) {
  border-left-width: 5px;
  border-right-width: 5px;
}

:deep(.map-marker-icon--standard) {
  --marker-bg: #5fb5ff;
}

:deep(.map-marker-icon--info) {
  --marker-bg: #35c0f2;
}

:deep(.map-marker-icon--warning) {
  --marker-bg: #f29f4b;
}

:deep(.map-marker-icon--critical) {
  --marker-bg: #d86d6d;
}

:deep(.map-marker-icon.is-selected) {
  transform: scale(1.12);
  box-shadow:
    0 0 0 3px rgba(255, 255, 255, 0.36),
    0 4px 11px rgba(0, 0, 0, 0.45);
}

:deep(.map-marker-icon.is-draft) {
  border-style: dashed;
  opacity: 0.96;
}

:deep(.master-map-label) {
  background: rgba(8, 24, 35, 0.86);
  border: 1px solid #3a6380;
  color: #e0f1ff;
  border-radius: 999px;
  padding: 2px 8px;
}

:deep(.master-map-label--info) {
  border-color: #4faeda;
}

:deep(.master-map-label--warning) {
  border-color: #c98c43;
}

:deep(.master-map-label--critical) {
  border-color: #b35a5a;
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

  .gallery-backdrop {
    padding: 8px;
  }

  .gallery-modal {
    width: 100%;
    max-height: calc(100% - 16px);
  }

  .gallery-item {
    grid-template-columns: 1fr;
  }

  .gallery-preview img,
  .gallery-placeholder {
    width: 100%;
    height: 96px;
  }

  .gallery-actions {
    grid-template-columns: 1fr 1fr;
  }

  .map-empty {
    bottom: calc(76px + env(safe-area-inset-bottom));
  }
}
</style>

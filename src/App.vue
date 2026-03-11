<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import InspectionMap from "@/components/InspectionMap.vue";

const API_BASE = String(import.meta.env.VITE_API_BASE || "/api").replace(/\/$/, "");
const LOCAL_TOKEN_KEY = "ogis.local.access_token";
const MOBILE_BREAKPOINT = 980;

const userRoleOptions = [
  { value: "inspector", label: "Inspector" },
  { value: "supervisor", label: "Supervisor" },
  { value: "admin", label: "Admin" },
];

function readStoredToken() {
  if (typeof window === "undefined") return "";

  const sessionToken = sessionStorage.getItem(LOCAL_TOKEN_KEY) || "";
  if (sessionToken) return sessionToken;

  const legacyToken = localStorage.getItem(LOCAL_TOKEN_KEY) || "";
  if (legacyToken) {
    sessionStorage.setItem(LOCAL_TOKEN_KEY, legacyToken);
    localStorage.removeItem(LOCAL_TOKEN_KEY);
  }
  return legacyToken;
}

const authToken = ref(readStoredToken());
const currentUser = ref(null);
const mustChangePassword = ref(false);

const authBusy = ref(false);
const appBusy = ref(false);
const inspectionBusy = ref(false);
const inspectionDeleteBusy = ref(false);
const checklistBusy = ref(false);
const mediaBusy = ref(false);
const timelineBusy = ref(false);
const reviewBusy = ref(false);
const notesBusy = ref(false);
const directoryBusy = ref(false);
const teamAdminBusyId = ref(null);
const teamCreateBusy = ref(false);
const userCreateBusy = ref(false);
const userTeamBusyId = ref(null);
const userRoleBusyId = ref(null);
const userStatusBusyId = ref(null);
const userPasswordBusyId = ref(null);
const backupExportBusy = ref(false);
const backupImportBusy = ref(false);
const backupImportFile = ref(null);
const backupImportInputRef = ref(null);
const checklistTemplateBusy = ref(false);
const checklistTemplateSaveBusyId = ref(null);
const checklistTemplateDeleteBusyId = ref(null);
const checklistTemplateApplyBusy = ref(false);
const checklistTemplateSelection = ref("");

const notice = ref("");
const errorMessage = ref("");

const loginForm = reactive({
  username: "",
  password: "",
});
const passwordForm = reactive({
  current_password: "",
  new_password: "",
});

const listFilters = reactive({
  search: "",
  status: "",
  team_id: "",
  page: 1,
  limit: 12,
  sort: "-updated_at",
});

const summary = ref({
  total_items: 0,
  by_status: {
    draft: 0,
    submitted: 0,
    in_review: 0,
    approved: 0,
    rejected: 0,
    reopened: 0,
    closed: 0,
  },
});

const inspections = ref([]);
const teamDirectory = ref([]);
const userDirectory = ref([]);
const checklistTemplateDirectory = ref([]);
const listPagination = ref({
  page: 1,
  limit: 12,
  total_items: 0,
  total_pages: 0,
  has_next: false,
  has_prev: false,
});
const mapInspections = ref([]);
const masterMapOverlays = ref([]);
const mapBusy = ref(false);
const mapMeta = ref({
  total_inspections: 0,
  with_location: 0,
  without_location: 0,
  total_overlays: 0,
});

const selectedInspectionId = ref(null);
const selectedInspection = ref(null);
const activeTab = ref("overview");
const workspaceRef = ref(null);
const leftPanelOpen = ref(false);
const rightPanelOpen = ref(false);
const leftPanelExpanded = ref(false);
const rightPanelExpanded = ref(false);
const mapExpanded = ref(false);
const isMobileViewport = ref(false);
const leftRailTab = ref("list");
const createPlacementActive = ref(false);
const createPlacementKind = ref("point");
const createGeometryDraft = ref(null);
const leftPanelWidth = ref(340);
const rightPanelWidth = ref(420);
const panelResizeState = reactive({
  side: "",
  startX: 0,
  startLeft: 340,
  startRight: 420,
});
const PANEL_GAP = 12;
const PANEL_RESIZER_WIDTH = 10;
const MIN_MAP_WIDTH = 360;
const MIN_LEFT_PANEL_WIDTH = 260;
const MAX_LEFT_PANEL_WIDTH = 520;
const MIN_RIGHT_PANEL_WIDTH = 300;
const MAX_RIGHT_PANEL_WIDTH = 620;
const teamNameDrafts = reactive({});
const userTeamDrafts = reactive({});
const userRoleDrafts = reactive({});
const userPasswordDrafts = reactive({});
const checklistTemplateKeyDrafts = reactive({});
const checklistTemplateLabelDrafts = reactive({});
const checklistTemplateOrderDrafts = reactive({});
const newTeamForm = reactive({
  name: "",
});
const newUserForm = reactive({
  username: "",
  full_name: "",
  role: "inspector",
  team_id: "",
  password: "",
});
const newChecklistTemplateForm = reactive({
  item_key: "",
  item_label: "",
  sort_order: "",
});

const timelineFilters = reactive({
  includeReads: false,
  page: 1,
  limit: 20,
});

const timelineData = ref([]);
const timelinePagination = ref({
  page: 1,
  limit: 20,
  total_items: 0,
  total_pages: 0,
  has_next: false,
  has_prev: false,
});

const checklistData = ref([]);
const checklistOverallResult = ref("na");
const checklistForm = reactive({
  item_key: "",
  item_label: "",
  response_value: "",
  result: "na",
  comment: "",
});

const mediaData = ref([]);
const mediaForm = reactive({
  item_key: "",
  item_response_id: "",
  file: null,
});

const notesDraft = ref("");
const locationDraft = reactive({
  latitude: "",
  longitude: "",
});

const reviewData = ref([]);
const reviewForm = reactive({
  decision: "review",
  comment: "",
});

const newInspectionForm = reactive({
  site_name: "",
  team_id: "",
  assigned_to: "",
  latitude: "",
  longitude: "",
  notes: "",
});

const isLoggedIn = computed(() => Boolean(authToken.value && currentUser.value));
const userRoles = computed(() => currentUser.value?.roles || []);
const isAdminUser = computed(() => userRoles.value.includes("admin"));
const hasSupervisorPrivileges = computed(
  () => userRoles.value.includes("supervisor") || userRoles.value.includes("admin")
);
const workspaceStyle = computed(() => {
  if (isMobileViewport.value) return {};
  return {
    "--workspace-left": `${leftPanelWidth.value}px`,
    "--workspace-right": `${rightPanelWidth.value}px`,
    "--workspace-resizer": `${PANEL_RESIZER_WIDTH}px`,
  };
});
const showPanelResizers = computed(
  () =>
    !isMobileViewport.value &&
    !mapExpanded.value &&
    !leftPanelExpanded.value &&
    !rightPanelExpanded.value
);
const canSubmitFromCurrentStatus = computed(() =>
  ["draft", "reopened"].includes(String(selectedInspection.value?.status || "").toLowerCase())
);
const canPatchInspection = computed(() =>
  ["draft", "reopened"].includes(String(selectedInspection.value?.status || "").toLowerCase()) ||
  hasSupervisorPrivileges.value
);
const canUpdateChecklist = computed(() =>
  ["draft", "reopened", "submitted", "in_review"].includes(
    String(selectedInspection.value?.status || "").toLowerCase()
  )
);
const canUploadMedia = computed(() =>
  ["draft", "reopened", "submitted", "in_review"].includes(
    String(selectedInspection.value?.status || "").toLowerCase()
  )
);
const createGeometryTypeLabel = computed(() => {
  const type = String(createGeometryDraft.value?.type || "").toLowerCase();
  if (type === "point") return "Point";
  if (type === "polygon") return "Area";
  return "Not set";
});
const createAreaVertexCount = computed(() => {
  if (String(createGeometryDraft.value?.type || "").toLowerCase() !== "polygon") return 0;
  const ring = createGeometryDraft.value?.coordinates?.[0];
  if (!Array.isArray(ring)) return 0;
  return Math.max(ring.length - 1, 0);
});
const hasCreateCoordinates = computed(() => {
  const latitude = Number.parseFloat(String(newInspectionForm.latitude || "").trim());
  const longitude = Number.parseFloat(String(newInspectionForm.longitude || "").trim());
  return Number.isFinite(latitude) && Number.isFinite(longitude);
});
const hasCreateGeometry = computed(() => Boolean(createGeometryDraft.value && hasCreateCoordinates.value));
const createAssignableUsers = computed(() => {
  const teamId = Number.parseInt(String(newInspectionForm.team_id || "").trim(), 10);
  if (!Number.isFinite(teamId)) return [];
  return userDirectory.value.filter((user) => Number(user.team_id) === teamId && user.is_active !== false);
});
const teamLabelMap = computed(
  () => new Map(teamDirectory.value.map((team) => [Number(team.id), String(team.label || `Field Team ${team.id}`)]))
);
const currentUserTeamLabels = computed(() => {
  const labels = (currentUser.value?.team_ids || [])
    .map((teamId) => teamLabelMap.value.get(Number(teamId)) || `Field Team ${teamId}`)
    .filter(Boolean);
  return labels.join(", ") || "-";
});
const leftRailStats = computed(() => [
  { key: "total", label: "Total", value: summary.value.total_items },
  { key: "mapped", label: "Mapped", value: mapMeta.value.with_location },
  { key: "layers", label: "Layers", value: mapMeta.value.total_overlays },
  {
    key: "active",
    label: "Active",
    value:
      Number(summary.value.by_status.draft || 0) +
      Number(summary.value.by_status.submitted || 0) +
      Number(summary.value.by_status.in_review || 0) +
      Number(summary.value.by_status.reopened || 0),
  },
]);
const statusBreakdown = computed(() => [
  { key: "draft", label: "Draft", value: summary.value.by_status.draft },
  { key: "submitted", label: "Submitted", value: summary.value.by_status.submitted },
  { key: "in_review", label: "In Review", value: summary.value.by_status.in_review },
  { key: "approved", label: "Approved", value: summary.value.by_status.approved },
  { key: "rejected", label: "Rejected", value: summary.value.by_status.rejected },
  { key: "reopened", label: "Reopened", value: summary.value.by_status.reopened },
  { key: "closed", label: "Closed", value: summary.value.by_status.closed },
]);
const activeFilterSummary = computed(() => {
  const tokens = [];
  const search = String(listFilters.search || "").trim();
  const status = String(listFilters.status || "").trim();
  const teamId = String(listFilters.team_id || "").trim();

  if (search) tokens.push(`Search: ${search}`);
  if (status) tokens.push(`Status: ${status}`);
  if (teamId) tokens.push(`Team: ${teamLabelMap.value.get(Number(teamId)) || teamId}`);

  return tokens;
});

function teamLabel(teamId) {
  const parsed = Number(teamId);
  if (!Number.isFinite(parsed)) return "-";
  return teamLabelMap.value.get(parsed) || `Field Team ${parsed}`;
}

function syncTeamNameDrafts() {
  for (const key of Object.keys(teamNameDrafts)) {
    delete teamNameDrafts[key];
  }

  for (const team of teamDirectory.value) {
    teamNameDrafts[team.id] = team.name || team.label || `Field Team ${team.id}`;
  }
}

function syncUserTeamDrafts() {
  for (const key of Object.keys(userTeamDrafts)) {
    delete userTeamDrafts[key];
  }

  for (const user of userDirectory.value) {
    userTeamDrafts[user.id] = user.team_id == null ? "" : String(user.team_id);
  }
}

function syncUserRoleDrafts() {
  for (const key of Object.keys(userRoleDrafts)) {
    delete userRoleDrafts[key];
  }

  for (const user of userDirectory.value) {
    userRoleDrafts[user.id] = user.role || "inspector";
  }
}

function syncUserPasswordDrafts() {
  for (const key of Object.keys(userPasswordDrafts)) {
    delete userPasswordDrafts[key];
  }

  for (const user of userDirectory.value) {
    userPasswordDrafts[user.id] = "";
  }
}

function syncChecklistTemplateDrafts() {
  for (const key of Object.keys(checklistTemplateKeyDrafts)) {
    delete checklistTemplateKeyDrafts[key];
  }
  for (const key of Object.keys(checklistTemplateLabelDrafts)) {
    delete checklistTemplateLabelDrafts[key];
  }
  for (const key of Object.keys(checklistTemplateOrderDrafts)) {
    delete checklistTemplateOrderDrafts[key];
  }

  for (const item of checklistTemplateDirectory.value) {
    checklistTemplateKeyDrafts[item.id] = item.item_key || "";
    checklistTemplateLabelDrafts[item.id] = item.item_label || "";
    checklistTemplateOrderDrafts[item.id] = String(Number(item.sort_order) || 0);
  }
}

function hasTeamNameChanged(team) {
  const currentName = String(team?.name || team?.label || "").trim();
  const draftName = String(teamNameDrafts[team?.id] || "").trim();
  return draftName.length > 0 && draftName !== currentName;
}

function hasUserTeamChanged(user) {
  const currentTeamId = user?.team_id == null ? "" : String(user.team_id);
  const draftTeamId = String(userTeamDrafts[user?.id] || "").trim();
  return draftTeamId.length > 0 && draftTeamId !== currentTeamId;
}

function hasUserRoleChanged(user) {
  const currentRole = String(user?.role || "").trim();
  const draftRole = String(userRoleDrafts[user?.id] || "").trim();
  return draftRole.length > 0 && draftRole !== currentRole;
}

function hasUserPasswordDraft(userId) {
  return String(userPasswordDrafts[userId] || "").trim().length > 0;
}

function hasChecklistTemplateChanged(item) {
  const nextKey = String(checklistTemplateKeyDrafts[item?.id] || "").trim().toLowerCase();
  const nextLabel = String(checklistTemplateLabelDrafts[item?.id] || "").trim();
  const nextOrder = parseInteger(checklistTemplateOrderDrafts[item?.id]);
  const currentKey = String(item?.item_key || "").trim().toLowerCase();
  const currentLabel = String(item?.item_label || "").trim();
  const currentOrder = Number(item?.sort_order || 0);

  if (!nextKey || !nextLabel || !Number.isFinite(nextOrder) || nextOrder < 0) return false;
  return nextKey !== currentKey || nextLabel !== currentLabel || nextOrder !== currentOrder;
}

function clearMessages() {
  notice.value = "";
  errorMessage.value = "";
}

function syncViewportState() {
  if (typeof window === "undefined") return;
  isMobileViewport.value = window.innerWidth <= MOBILE_BREAKPOINT;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getWorkspaceContentWidth() {
  const width = Number(workspaceRef.value?.clientWidth || 0);
  if (Number.isFinite(width) && width > 0) return width;
  if (typeof window === "undefined") return 0;
  return Math.max(window.innerWidth - 28, 0);
}

function getLeftPanelWidthBounds() {
  const workspaceWidth = getWorkspaceContentWidth();
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return { min: MIN_LEFT_PANEL_WIDTH, max: MAX_LEFT_PANEL_WIDTH };
  }

  const reservedWidth = MIN_MAP_WIDTH + rightPanelWidth.value + PANEL_RESIZER_WIDTH * 2 + PANEL_GAP * 4;
  const computedMax = workspaceWidth - reservedWidth;
  return {
    min: MIN_LEFT_PANEL_WIDTH,
    max: Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(MAX_LEFT_PANEL_WIDTH, computedMax)),
  };
}

function getRightPanelWidthBounds() {
  const workspaceWidth = getWorkspaceContentWidth();
  if (!Number.isFinite(workspaceWidth) || workspaceWidth <= 0) {
    return { min: MIN_RIGHT_PANEL_WIDTH, max: MAX_RIGHT_PANEL_WIDTH };
  }

  const reservedWidth = MIN_MAP_WIDTH + leftPanelWidth.value + PANEL_RESIZER_WIDTH * 2 + PANEL_GAP * 4;
  const computedMax = workspaceWidth - reservedWidth;
  return {
    min: MIN_RIGHT_PANEL_WIDTH,
    max: Math.max(MIN_RIGHT_PANEL_WIDTH, Math.min(MAX_RIGHT_PANEL_WIDTH, computedMax)),
  };
}

function normalizePanelWidths() {
  if (isMobileViewport.value || mapExpanded.value) return;

  const leftBounds = getLeftPanelWidthBounds();
  leftPanelWidth.value = clampNumber(leftPanelWidth.value, leftBounds.min, leftBounds.max);

  const rightBounds = getRightPanelWidthBounds();
  rightPanelWidth.value = clampNumber(rightPanelWidth.value, rightBounds.min, rightBounds.max);

  const leftBoundsAfterRight = getLeftPanelWidthBounds();
  leftPanelWidth.value = clampNumber(leftPanelWidth.value, leftBoundsAfterRight.min, leftBoundsAfterRight.max);
}

function onPanelResizeMove(event) {
  if (!panelResizeState.side) return;
  const delta = Number(event?.clientX || 0) - panelResizeState.startX;

  if (panelResizeState.side === "left") {
    const nextLeft = panelResizeState.startLeft + delta;
    const bounds = getLeftPanelWidthBounds();
    leftPanelWidth.value = clampNumber(nextLeft, bounds.min, bounds.max);
    return;
  }

  if (panelResizeState.side === "right") {
    const nextRight = panelResizeState.startRight - delta;
    const bounds = getRightPanelWidthBounds();
    rightPanelWidth.value = clampNumber(nextRight, bounds.min, bounds.max);
  }
}

function stopPanelResize() {
  if (!panelResizeState.side) return;
  panelResizeState.side = "";
  window.removeEventListener("mousemove", onPanelResizeMove);
  window.removeEventListener("mouseup", stopPanelResize);
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

function startPanelResize(side, event) {
  if (isMobileViewport.value || mapExpanded.value || leftPanelExpanded.value || rightPanelExpanded.value) return;
  if (side !== "left" && side !== "right") return;

  panelResizeState.side = side;
  panelResizeState.startX = Number(event?.clientX || 0);
  panelResizeState.startLeft = leftPanelWidth.value;
  panelResizeState.startRight = rightPanelWidth.value;

  window.addEventListener("mousemove", onPanelResizeMove);
  window.addEventListener("mouseup", stopPanelResize);
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";
  event?.preventDefault?.();
}

function setNotice(message) {
  notice.value = message;
  errorMessage.value = "";
}

function setError(message) {
  errorMessage.value = message;
}

function saveToken(token) {
  authToken.value = token || "";
  if (authToken.value) {
    sessionStorage.setItem(LOCAL_TOKEN_KEY, authToken.value);
    localStorage.removeItem(LOCAL_TOKEN_KEY);
  } else {
    sessionStorage.removeItem(LOCAL_TOKEN_KEY);
    localStorage.removeItem(LOCAL_TOKEN_KEY);
  }
}

function resetWorkspace() {
  selectedInspectionId.value = null;
  selectedInspection.value = null;
  inspections.value = [];
  teamDirectory.value = [];
  userDirectory.value = [];
  checklistTemplateDirectory.value = [];
  for (const key of Object.keys(teamNameDrafts)) {
    delete teamNameDrafts[key];
  }
  for (const key of Object.keys(userTeamDrafts)) {
    delete userTeamDrafts[key];
  }
  for (const key of Object.keys(userRoleDrafts)) {
    delete userRoleDrafts[key];
  }
  for (const key of Object.keys(userPasswordDrafts)) {
    delete userPasswordDrafts[key];
  }
  for (const key of Object.keys(checklistTemplateKeyDrafts)) {
    delete checklistTemplateKeyDrafts[key];
  }
  for (const key of Object.keys(checklistTemplateLabelDrafts)) {
    delete checklistTemplateLabelDrafts[key];
  }
  for (const key of Object.keys(checklistTemplateOrderDrafts)) {
    delete checklistTemplateOrderDrafts[key];
  }
  mapInspections.value = [];
  mapMeta.value = {
    total_inspections: 0,
    with_location: 0,
    without_location: 0,
    total_overlays: 0,
  };
  masterMapOverlays.value = [];
  checklistData.value = [];
  timelineData.value = [];
  mediaData.value = [];
  reviewData.value = [];
  notesDraft.value = "";
  locationDraft.latitude = "";
  locationDraft.longitude = "";
  activeTab.value = "overview";
  leftPanelExpanded.value = false;
  rightPanelExpanded.value = false;
  mapExpanded.value = false;
  createPlacementActive.value = false;
  createPlacementKind.value = "point";
  createGeometryDraft.value = null;
  teamAdminBusyId.value = null;
  teamCreateBusy.value = false;
  userCreateBusy.value = false;
  userTeamBusyId.value = null;
  userRoleBusyId.value = null;
  userStatusBusyId.value = null;
  userPasswordBusyId.value = null;
  inspectionDeleteBusy.value = false;
  backupExportBusy.value = false;
  backupImportBusy.value = false;
  backupImportFile.value = null;
  checklistTemplateBusy.value = false;
  checklistTemplateSaveBusyId.value = null;
  checklistTemplateDeleteBusyId.value = null;
  checklistTemplateApplyBusy.value = false;
  checklistTemplateSelection.value = "";
  if (backupImportInputRef.value) {
    backupImportInputRef.value.value = "";
  }
  newTeamForm.name = "";
  newUserForm.username = "";
  newUserForm.full_name = "";
  newUserForm.role = "inspector";
  newUserForm.team_id = "";
  newUserForm.password = "";
  newChecklistTemplateForm.item_key = "";
  newChecklistTemplateForm.item_label = "";
  newChecklistTemplateForm.sort_order = "";
}

function logout(resetNotice = true) {
  saveToken("");
  currentUser.value = null;
  mustChangePassword.value = false;
  passwordForm.current_password = "";
  passwordForm.new_password = "";
  resetWorkspace();
  if (resetNotice) {
    setNotice("Logged out.");
  }
}

function formatApiError(error, fallback = "Request failed") {
  if (!error) return fallback;
  if (typeof error === "string") return error;

  const payload = error.payload || {};
  if (payload?.message) return payload.message;
  if (payload?.error) return payload.error;
  if (error.message) return error.message;
  return fallback;
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function isLngLatPair(value) {
  if (!Array.isArray(value) || value.length < 2) return false;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  return Number.isFinite(lng) && Number.isFinite(lat);
}

function centroidFromRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;

  const points = [...ring];
  const [firstLng, firstLat] = points[0] || [];
  const [lastLng, lastLat] = points[points.length - 1] || [];
  if (firstLng === lastLng && firstLat === lastLat) {
    points.pop();
  }

  if (points.length < 3 || !points.every(isLngLatPair)) return null;

  let lngSum = 0;
  let latSum = 0;
  for (const [lng, lat] of points) {
    lngSum += Number(lng);
    latSum += Number(lat);
  }

  return {
    latitude: latSum / points.length,
    longitude: lngSum / points.length,
  };
}

async function apiRequest(path, options = {}) {
  const { method = "GET", body, headers = {}, auth = true } = options;

  const requestHeaders = { ...headers };
  const init = {
    method,
    headers: requestHeaders,
  };

  if (auth && authToken.value) {
    requestHeaders.Authorization = `Bearer ${authToken.value}`;
  }

  if (body != null) {
    if (body instanceof FormData) {
      init.body = body;
    } else {
      requestHeaders["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
  }

  const response = await fetch(`${API_BASE}${path}`, init);
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    if (response.status === 401) {
      logout(false);
    }
    throw error;
  }

  return payload;
}

async function loadCurrentUser() {
  const response = await apiRequest("/auth/me");
  currentUser.value = response?.user || null;
  mustChangePassword.value = Boolean(response?.must_change_password);
  return response;
}

function syncCreateAssigneeForTeam(preferCurrentUser = true) {
  const availableUsers = createAssignableUsers.value;

  if (availableUsers.length === 0) {
    newInspectionForm.assigned_to = "";
    return;
  }

  const currentAssigned = Number.parseInt(String(newInspectionForm.assigned_to || "").trim(), 10);
  if (availableUsers.some((user) => user.id === currentAssigned)) {
    return;
  }

  const currentUserOption = preferCurrentUser
    ? availableUsers.find((user) => user.id === currentUser.value?.id)
    : null;
  newInspectionForm.assigned_to = String(currentUserOption?.id ?? availableUsers[0].id);
}

function seedCreateFormDirectoryDefaults() {
  if (!newInspectionForm.team_id) {
    const currentTeamId = currentUser.value?.team_ids?.[0];
    const currentTeamExists = teamDirectory.value.some((team) => team.id === currentTeamId);
    if (Number.isFinite(currentTeamId) && currentTeamExists) {
      newInspectionForm.team_id = String(currentTeamId);
    } else if (teamDirectory.value.length > 0) {
      newInspectionForm.team_id = String(teamDirectory.value[0].id);
    }
  }

  syncCreateAssigneeForTeam(true);
}

function seedNewUserFormDirectoryDefaults() {
  if (newUserForm.team_id) return;

  const currentTeamId = currentUser.value?.team_ids?.[0];
  const currentTeamExists = teamDirectory.value.some((team) => team.id === currentTeamId);
  if (Number.isFinite(currentTeamId) && currentTeamExists) {
    newUserForm.team_id = String(currentTeamId);
  } else if (teamDirectory.value.length > 0) {
    newUserForm.team_id = String(teamDirectory.value[0].id);
  }
}

async function loadDirectory() {
  directoryBusy.value = true;
  try {
    const response = await apiRequest("/auth/directory");
    teamDirectory.value = Array.isArray(response?.data?.teams) ? response.data.teams : [];
    userDirectory.value = Array.isArray(response?.data?.users) ? response.data.users : [];
    syncTeamNameDrafts();
    syncUserTeamDrafts();
    syncUserRoleDrafts();
    syncUserPasswordDrafts();
    seedCreateFormDirectoryDefaults();
    seedNewUserFormDirectoryDefaults();
    if (isAdminUser.value) {
      await loadChecklistTemplates();
    } else {
      checklistTemplateDirectory.value = [];
      syncChecklistTemplateDrafts();
    }
  } finally {
    directoryBusy.value = false;
  }
}

async function loadChecklistTemplates() {
  checklistTemplateBusy.value = true;
  try {
    const response = await apiRequest("/auth/checklist-templates");
    checklistTemplateDirectory.value = Array.isArray(response?.data) ? response.data : [];
    if (
      checklistTemplateSelection.value &&
      !checklistTemplateDirectory.value.some((item) => item.item_key === checklistTemplateSelection.value)
    ) {
      checklistTemplateSelection.value = "";
    }
    syncChecklistTemplateDrafts();
  } finally {
    checklistTemplateBusy.value = false;
  }
}

async function createChecklistTemplate() {
  clearMessages();
  const itemKey = String(newChecklistTemplateForm.item_key || "").trim().toLowerCase();
  const itemLabel = String(newChecklistTemplateForm.item_label || "").trim();
  const sortOrderRaw = String(newChecklistTemplateForm.sort_order || "").trim();
  const sortOrder = sortOrderRaw ? parseInteger(sortOrderRaw) : null;

  if (!itemKey) {
    setError("Checklist item key is required.");
    return;
  }
  if (!itemLabel) {
    setError("Checklist item label is required.");
    return;
  }
  if (sortOrderRaw && (!Number.isFinite(sortOrder) || sortOrder < 0)) {
    setError("Sort order must be a non-negative integer.");
    return;
  }

  checklistTemplateBusy.value = true;
  try {
    await apiRequest("/auth/checklist-templates", {
      method: "POST",
      body: {
        item_key: itemKey,
        item_label: itemLabel,
        sort_order: sortOrder,
      },
    });
    newChecklistTemplateForm.item_key = "";
    newChecklistTemplateForm.item_label = "";
    newChecklistTemplateForm.sort_order = "";
    await loadChecklistTemplates();
    setNotice(`Checklist template added: ${itemLabel}.`);
  } catch (error) {
    setError(formatApiError(error, "Could not create checklist template"));
  } finally {
    checklistTemplateBusy.value = false;
  }
}

async function saveChecklistTemplate(itemId) {
  clearMessages();
  const parsedId = Number(itemId);
  if (!Number.isFinite(parsedId)) return;

  const itemKey = String(checklistTemplateKeyDrafts[parsedId] || "").trim().toLowerCase();
  const itemLabel = String(checklistTemplateLabelDrafts[parsedId] || "").trim();
  const sortOrder = parseInteger(checklistTemplateOrderDrafts[parsedId]);
  if (!itemKey) {
    setError("Checklist item key is required.");
    return;
  }
  if (!itemLabel) {
    setError("Checklist item label is required.");
    return;
  }
  if (!Number.isFinite(sortOrder) || sortOrder < 0) {
    setError("Sort order must be a non-negative integer.");
    return;
  }

  checklistTemplateSaveBusyId.value = parsedId;
  try {
    const response = await apiRequest(`/auth/checklist-templates/${parsedId}`, {
      method: "PATCH",
      body: {
        item_key: itemKey,
        item_label: itemLabel,
        sort_order: sortOrder,
      },
    });
    await loadChecklistTemplates();
    const changed = Boolean(response?.data?.changed);
    setNotice(changed ? `Checklist item "${itemKey}" saved.` : `Checklist item "${itemKey}" unchanged.`);
  } catch (error) {
    setError(formatApiError(error, "Could not update checklist template"));
  } finally {
    checklistTemplateSaveBusyId.value = null;
  }
}

async function deleteChecklistTemplate(item) {
  clearMessages();
  const parsedId = Number(item?.id);
  if (!Number.isFinite(parsedId)) return;

  checklistTemplateDeleteBusyId.value = parsedId;
  try {
    await apiRequest(`/auth/checklist-templates/${parsedId}`, {
      method: "DELETE",
    });
    await loadChecklistTemplates();
    setNotice(`Checklist item removed: ${item?.item_label || item?.item_key || parsedId}.`);
  } catch (error) {
    setError(formatApiError(error, "Could not remove checklist template"));
  } finally {
    checklistTemplateDeleteBusyId.value = null;
  }
}

function applyChecklistTemplateSelection() {
  const selectedKey = String(checklistTemplateSelection.value || "").trim();
  if (!selectedKey) return;

  const template = checklistTemplateDirectory.value.find((item) => item.item_key === selectedKey);
  if (!template) return;

  checklistForm.item_key = template.item_key;
  checklistForm.item_label = template.item_label || checklistForm.item_label;
}

async function applyChecklistTemplatesToInspection() {
  if (!selectedInspectionId.value) return;
  clearMessages();

  if (checklistTemplateDirectory.value.length === 0) {
    setError("No checklist templates are configured.");
    return;
  }

  checklistTemplateApplyBusy.value = true;
  try {
    const response = await apiRequest(`/inspections/${selectedInspectionId.value}/items/apply-templates`, {
      method: "POST",
    });

    checklistData.value = Array.isArray(response?.data) ? response.data : checklistData.value;
    checklistOverallResult.value = response?.overall_result || checklistOverallResult.value;
    await Promise.all([
      loadInspectionCore(selectedInspectionId.value),
      loadInspections(false),
      loadSummary(),
      loadInspectionMapData(),
    ]);

    const appliedCount = Number(response?.applied_count || 0);
    setNotice(
      appliedCount > 0
        ? `Added ${appliedCount} checklist template item(s) to this inspection.`
        : "All checklist template items are already present in this inspection."
    );
  } catch (error) {
    setError(formatApiError(error, "Could not apply checklist templates"));
  } finally {
    checklistTemplateApplyBusy.value = false;
  }
}

async function createTeam() {
  clearMessages();
  const nextName = String(newTeamForm.name || "").trim();
  if (!nextName) {
    setError("Team name is required.");
    return;
  }

  teamCreateBusy.value = true;
  try {
    await apiRequest("/auth/teams", {
      method: "POST",
      body: { name: nextName },
    });
    newTeamForm.name = "";
    await loadDirectory();
    setNotice(`Team created: ${nextName}.`);
  } catch (error) {
    setError(formatApiError(error, "Could not create team"));
  } finally {
    teamCreateBusy.value = false;
  }
}

async function createUser() {
  clearMessages();
  const username = String(newUserForm.username || "").trim();
  const fullName = String(newUserForm.full_name || "").trim();
  const role = String(newUserForm.role || "").trim();
  const teamId = parseInteger(newUserForm.team_id);
  const password = String(newUserForm.password || "");

  if (!username) {
    setError("Username is required.");
    return;
  }
  if (!fullName) {
    setError("Full name is required.");
    return;
  }
  if (!role) {
    setError("Role is required.");
    return;
  }
  if (!Number.isFinite(teamId)) {
    setError("Select a valid team.");
    return;
  }
  if (!password) {
    setError("Temporary password is required.");
    return;
  }

  userCreateBusy.value = true;
  try {
    await apiRequest("/auth/users", {
      method: "POST",
      body: {
        username,
        full_name: fullName,
        role,
        team_id: teamId,
        password,
      },
    });
    newUserForm.username = "";
    newUserForm.full_name = "";
    newUserForm.role = "inspector";
    newUserForm.password = "";
    seedNewUserFormDirectoryDefaults();
    await loadDirectory();
    setNotice(`User created: ${fullName} (@${username}).`);
  } catch (error) {
    setError(formatApiError(error, "Could not create user"));
  } finally {
    userCreateBusy.value = false;
  }
}

async function renameTeam(teamId) {
  const parsedTeamId = Number(teamId);
  if (!Number.isFinite(parsedTeamId)) return;

  clearMessages();
  const nextName = String(teamNameDrafts[parsedTeamId] || "").trim();
  if (!nextName) {
    setError("Team name is required.");
    return;
  }

  teamAdminBusyId.value = parsedTeamId;
  try {
    await apiRequest(`/auth/teams/${parsedTeamId}`, {
      method: "PATCH",
      body: { name: nextName },
    });
    await loadDirectory();
    setNotice(`Team renamed to ${nextName}.`);
  } catch (error) {
    setError(formatApiError(error, "Could not rename team"));
  } finally {
    teamAdminBusyId.value = null;
  }
}

async function reassignUserTeam(userId) {
  clearMessages();
  const parsedUserId = Number(userId);
  const parsedTeamId = parseInteger(userTeamDrafts[userId]);

  if (!Number.isFinite(parsedUserId) || !Number.isFinite(parsedTeamId)) {
    setError("Select a valid team before saving.");
    return;
  }

  const targetUser = userDirectory.value.find((user) => user.id === parsedUserId);
  userTeamBusyId.value = parsedUserId;
  try {
    const response = await apiRequest(`/auth/users/${parsedUserId}/team`, {
      method: "PATCH",
      body: { team_id: parsedTeamId },
    });

    if (currentUser.value?.id === parsedUserId) {
      await loadCurrentUser();
    }
    await loadDirectory();

    const savedTeamName = response?.data?.team_name || teamLabel(parsedTeamId);
    const displayName = targetUser?.full_name || targetUser?.username || `User ${parsedUserId}`;
    const changed = Boolean(response?.data?.changed);
    setNotice(
      changed
        ? `${displayName} moved to ${savedTeamName}.`
        : `${displayName} is already assigned to ${savedTeamName}.`
    );
  } catch (error) {
    setError(formatApiError(error, "Could not update user team"));
  } finally {
    userTeamBusyId.value = null;
  }
}

async function changeUserRole(userId) {
  clearMessages();
  const parsedUserId = Number(userId);
  const nextRole = String(userRoleDrafts[userId] || "").trim();

  if (!Number.isFinite(parsedUserId) || !nextRole) {
    setError("Select a valid role before saving.");
    return;
  }

  const targetUser = userDirectory.value.find((user) => user.id === parsedUserId);
  userRoleBusyId.value = parsedUserId;
  try {
    const response = await apiRequest(`/auth/users/${parsedUserId}/role`, {
      method: "PATCH",
      body: { role: nextRole },
    });
    await loadDirectory();

    const displayName = targetUser?.full_name || targetUser?.username || `User ${parsedUserId}`;
    const savedRole = response?.data?.role || nextRole;
    const changed = Boolean(response?.data?.changed);
    setNotice(
      changed
        ? `${displayName} role changed to ${savedRole}.`
        : `${displayName} already has the ${savedRole} role.`
    );
  } catch (error) {
    setError(formatApiError(error, "Could not update user role"));
  } finally {
    userRoleBusyId.value = null;
  }
}

async function setUserActiveState(user, nextIsActive) {
  clearMessages();
  const parsedUserId = Number(user?.id);
  if (!Number.isFinite(parsedUserId)) return;

  userStatusBusyId.value = parsedUserId;
  try {
    const response = await apiRequest(`/auth/users/${parsedUserId}/status`, {
      method: "PATCH",
      body: { is_active: Boolean(nextIsActive) },
    });
    await loadDirectory();

    const displayName = user?.full_name || user?.username || `User ${parsedUserId}`;
    const changed = Boolean(response?.data?.changed);
    const sessionsRevoked = Number(response?.data?.sessions_revoked || 0);
    if (changed) {
      setNotice(
        nextIsActive
          ? `${displayName} reactivated.`
          : `${displayName} deactivated.${sessionsRevoked > 0 ? ` ${sessionsRevoked} session(s) revoked.` : ""}`
      );
    } else {
      setNotice(`${displayName} is already ${nextIsActive ? "active" : "inactive"}.`);
    }
  } catch (error) {
    setError(formatApiError(error, "Could not update user status"));
  } finally {
    userStatusBusyId.value = null;
  }
}

async function resetUserPassword(user) {
  clearMessages();
  const parsedUserId = Number(user?.id);
  const nextPassword = String(userPasswordDrafts[parsedUserId] || "");

  if (!Number.isFinite(parsedUserId)) return;
  if (!nextPassword.trim()) {
    setError("Temporary password is required.");
    return;
  }

  userPasswordBusyId.value = parsedUserId;
  try {
    const response = await apiRequest(`/auth/users/${parsedUserId}/reset-password`, {
      method: "POST",
      body: { new_password: nextPassword },
    });
    userPasswordDrafts[parsedUserId] = "";
    await loadDirectory();

    const displayName = user?.full_name || user?.username || `User ${parsedUserId}`;
    const sessionsRevoked = Number(response?.sessions_revoked || 0);
    setNotice(
      `${displayName} password reset.${sessionsRevoked > 0 ? ` ${sessionsRevoked} session(s) revoked.` : ""}`
    );
  } catch (error) {
    setError(formatApiError(error, "Could not reset user password"));
  } finally {
    userPasswordBusyId.value = null;
  }
}

function parseContentDispositionFileName(value) {
  const headerValue = String(value || "").trim();
  if (!headerValue) return "";

  const utf8Match = headerValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1]);
    } catch (_error) {
      return utf8Match[1];
    }
  }

  const basicMatch = headerValue.match(/filename="?([^";]+)"?/i);
  return basicMatch?.[1] ? basicMatch[1].trim() : "";
}

async function apiBinaryRequest(path, options = {}) {
  const { method = "GET", body, headers = {}, auth = true } = options;
  const requestHeaders = { ...headers };
  const init = {
    method,
    headers: requestHeaders,
  };

  if (auth && authToken.value) {
    requestHeaders.Authorization = `Bearer ${authToken.value}`;
  }

  if (body != null) {
    init.body = body;
  }

  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const payload = isJson ? await response.json() : null;
    const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    if (response.status === 401) {
      logout(false);
    }
    throw error;
  }

  return response;
}

async function exportBackup() {
  clearMessages();
  backupExportBusy.value = true;

  try {
    const response = await apiBinaryRequest("/auth/backup/export");
    const blob = await response.blob();
    const fileNameFromHeader = parseContentDispositionFileName(response.headers.get("content-disposition"));
    const fallbackName = `ogis-backup-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.json`;
    const fileName = fileNameFromHeader || fallbackName;

    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
    setNotice(`Backup exported: ${fileName}.`);
  } catch (error) {
    setError(formatApiError(error, "Could not export backup"));
  } finally {
    backupExportBusy.value = false;
  }
}

function onBackupFileChange(event) {
  backupImportFile.value = event?.target?.files?.[0] || null;
}

function clearBackupImportSelection() {
  backupImportFile.value = null;
  if (backupImportInputRef.value) {
    backupImportInputRef.value.value = "";
  }
}

async function importBackup() {
  clearMessages();
  if (!backupImportFile.value) {
    setError("Choose a backup file first.");
    return;
  }

  backupImportBusy.value = true;
  try {
    const formData = new FormData();
    formData.append("file", backupImportFile.value);
    await apiRequest("/auth/backup/import", {
      method: "POST",
      body: formData,
    });

    clearBackupImportSelection();
    logout(false);
    setNotice("Backup restored. Sign in again to continue.");
  } catch (error) {
    setError(formatApiError(error, "Could not import backup"));
  } finally {
    backupImportBusy.value = false;
  }
}

async function runLogin() {
  clearMessages();
  authBusy.value = true;

  try {
    const response = await apiRequest("/auth/login", {
      method: "POST",
      body: {
        username: loginForm.username,
        password: loginForm.password,
      },
      auth: false,
    });

    saveToken(response?.access_token || "");
    currentUser.value = response?.user || null;
    mustChangePassword.value = Boolean(response?.must_change_password);
    passwordForm.current_password = loginForm.password;

    if (mustChangePassword.value) {
      setNotice("Password update is required before using the app.");
      return;
    }

    await refreshDashboard();
    setNotice(`Welcome back, ${currentUser.value?.full_name || currentUser.value?.username || "user"}.`);
  } catch (error) {
    setError(formatApiError(error, "Login failed"));
  } finally {
    authBusy.value = false;
  }
}

async function runPasswordChange() {
  clearMessages();
  authBusy.value = true;

  try {
    await apiRequest("/auth/change-password", {
      method: "POST",
      body: {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      },
    });

    passwordForm.new_password = "";
    await loadCurrentUser();
    await refreshDashboard();
    setNotice("Password changed. Access unlocked.");
  } catch (error) {
    setError(formatApiError(error, "Password change failed"));
  } finally {
    authBusy.value = false;
  }
}

async function runLogout() {
  clearMessages();
  try {
    if (authToken.value) {
      await apiRequest("/auth/logout", {
        method: "POST",
      });
    }
  } catch (_error) {
    // ignore logout transport failures
  } finally {
    logout();
  }
}

function buildListQueryString() {
  const params = new URLSearchParams();
  params.set("page", String(listFilters.page));
  params.set("limit", String(listFilters.limit));
  params.set("sort", listFilters.sort);

  const search = String(listFilters.search || "").trim();
  if (search) params.set("search", search);

  const status = String(listFilters.status || "").trim();
  if (status) params.set("status", status);

  const teamId = String(listFilters.team_id || "").trim();
  if (teamId) params.set("team_id", teamId);

  return params.toString();
}

function buildMapQueryString() {
  const params = new URLSearchParams();

  const search = String(listFilters.search || "").trim();
  if (search) params.set("search", search);

  const status = String(listFilters.status || "").trim();
  if (status) params.set("status", status);

  const teamId = String(listFilters.team_id || "").trim();
  if (teamId) params.set("team_id", teamId);

  return params.toString();
}

async function loadSummary() {
  const params = new URLSearchParams();
  const search = String(listFilters.search || "").trim();
  const status = String(listFilters.status || "").trim();
  const teamId = String(listFilters.team_id || "").trim();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (teamId) params.set("team_id", teamId);

  const response = await apiRequest(`/inspections/summary?${params.toString()}`);
  if (response?.data) {
    summary.value = {
      ...summary.value,
      ...response.data,
      by_status: {
        ...summary.value.by_status,
        ...(response.data.by_status || {}),
      },
    };
  }
}

async function loadInspectionMapData() {
  const queryString = buildMapQueryString();
  mapBusy.value = true;
  try {
    const response = await apiRequest(
      `/inspections/master-map${queryString ? `?${queryString}` : ""}`
    );
    mapInspections.value = Array.isArray(response?.data?.inspections)
      ? response.data.inspections
      : [];
    masterMapOverlays.value = Array.isArray(response?.data?.overlays)
      ? response.data.overlays
      : [];
    mapMeta.value = response?.meta || {
      total_inspections: mapInspections.value.length,
      with_location: mapInspections.value.filter(
        (inspection) =>
          Number.isFinite(Number(inspection?.latitude)) &&
          Number.isFinite(Number(inspection?.longitude))
      ).length,
      without_location: 0,
      total_overlays: masterMapOverlays.value.length,
    };
  } finally {
    mapBusy.value = false;
  }
}

async function createInspection() {
  clearMessages();
  const teamId = parseInteger(newInspectionForm.team_id);
  const assignedTo = parseInteger(newInspectionForm.assigned_to);
  const latitude = Number.parseFloat(String(newInspectionForm.latitude || "").trim());
  const longitude = Number.parseFloat(String(newInspectionForm.longitude || "").trim());

  if (!newInspectionForm.site_name.trim()) {
    setError("Site name is required.");
    return;
  }
  if (!Number.isFinite(teamId)) {
    setError("Team ID must be a number.");
    return;
  }
  if (!Number.isFinite(assignedTo)) {
    setError("Assigned user ID must be a number.");
    return;
  }
  if (!hasCreateGeometry.value || !createGeometryDraft.value) {
    setError("Pick a point or draw an area on the map before creating the inspection.");
    return;
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    setError("Selected latitude is invalid.");
    return;
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    setError("Selected longitude is invalid.");
    return;
  }

  try {
    const response = await apiRequest("/inspections", {
      method: "POST",
      body: {
        site_name: newInspectionForm.site_name.trim(),
        team_id: teamId,
        assigned_to: assignedTo,
        geometry: createGeometryDraft.value,
        notes: newInspectionForm.notes.trim() || undefined,
      },
    });

    newInspectionForm.site_name = "";
    newInspectionForm.team_id = "";
    newInspectionForm.assigned_to = "";
    newInspectionForm.latitude = "";
    newInspectionForm.longitude = "";
    newInspectionForm.notes = "";
    leftRailTab.value = "list";
    createPlacementActive.value = false;
    createPlacementKind.value = "point";
    createGeometryDraft.value = null;

    await Promise.all([loadInspections(false), loadSummary(), loadInspectionMapData()]);
    const seededChecklistItems = Number(response?.meta?.seeded_checklist_items || 0);
    setNotice(
      seededChecklistItems > 0
        ? `Inspection created. ${seededChecklistItems} checklist template item(s) added.`
        : "Inspection created."
    );
  } catch (error) {
    setError(formatApiError(error, "Could not create inspection"));
  }
}

async function loadInspections(selectFirstWhenEmpty = true) {
  const queryString = buildListQueryString();
  const response = await apiRequest(`/inspections?${queryString}`);
  inspections.value = Array.isArray(response?.data) ? response.data : [];
  listPagination.value = response?.pagination || listPagination.value;

  if (inspections.value.length === 0) {
    selectedInspectionId.value = null;
    selectedInspection.value = null;
    checklistData.value = [];
    timelineData.value = [];
    mediaData.value = [];
    reviewData.value = [];
    return;
  }

  const hasSelection = inspections.value.some((item) => item.id === selectedInspectionId.value);
  if (!hasSelection || (selectFirstWhenEmpty && selectedInspectionId.value == null)) {
    await selectInspection(inspections.value[0].id);
  } else if (selectedInspectionId.value != null) {
    await loadInspectionCore(selectedInspectionId.value);
  }
}

async function refreshDashboard() {
  appBusy.value = true;
  clearMessages();
  try {
    await Promise.all([loadSummary(), loadInspections(true), loadInspectionMapData(), loadDirectory()]);
    if (isMobileViewport.value && selectedInspectionId.value == null) {
      leftPanelOpen.value = true;
      rightPanelOpen.value = false;
    }
  } catch (error) {
    setError(formatApiError(error, "Could not load dashboard"));
  } finally {
    appBusy.value = false;
  }
}

async function loadInspectionCore(inspectionId) {
  const response = await apiRequest(`/inspections/${inspectionId}`);
  selectedInspection.value = response?.data || null;
  notesDraft.value = selectedInspection.value?.notes || "";
  locationDraft.latitude =
    selectedInspection.value?.latitude == null ? "" : String(selectedInspection.value.latitude);
  locationDraft.longitude =
    selectedInspection.value?.longitude == null ? "" : String(selectedInspection.value.longitude);
}

async function loadChecklist(inspectionId) {
  checklistBusy.value = true;
  try {
    const response = await apiRequest(`/inspections/${inspectionId}/items`);
    checklistData.value = Array.isArray(response?.data) ? response.data : [];
    checklistOverallResult.value = response?.overall_result || "na";
  } finally {
    checklistBusy.value = false;
  }
}

function buildTimelineQueryString() {
  const params = new URLSearchParams();
  params.set("page", String(timelineFilters.page));
  params.set("limit", String(timelineFilters.limit));
  if (timelineFilters.includeReads) {
    params.set("include_reads", "1");
  }
  return params.toString();
}

async function loadTimeline(inspectionId) {
  timelineBusy.value = true;
  try {
    const response = await apiRequest(
      `/inspections/${inspectionId}/timeline?${buildTimelineQueryString()}`
    );
    timelineData.value = Array.isArray(response?.data) ? response.data : [];
    timelinePagination.value = response?.pagination || timelinePagination.value;
  } finally {
    timelineBusy.value = false;
  }
}

async function loadMedia(inspectionId) {
  mediaBusy.value = true;
  try {
    const response = await apiRequest(`/inspections/${inspectionId}/media`);
    mediaData.value = Array.isArray(response?.data) ? response.data : [];
  } finally {
    mediaBusy.value = false;
  }
}

async function loadReviews(inspectionId) {
  reviewBusy.value = true;
  try {
    const response = await apiRequest(`/inspections/${inspectionId}/reviews`);
    reviewData.value = Array.isArray(response?.data) ? response.data : [];
  } catch (error) {
    if (error?.status === 403) {
      reviewData.value = [];
      return;
    }
    throw error;
  } finally {
    reviewBusy.value = false;
  }
}

async function loadInspectionWorkspace(inspectionId) {
  inspectionBusy.value = true;
  clearMessages();

  try {
    await loadInspectionCore(inspectionId);
    await Promise.all([
      loadChecklist(inspectionId),
      loadTimeline(inspectionId),
      loadMedia(inspectionId),
      loadReviews(inspectionId),
    ]);
  } catch (error) {
    setError(formatApiError(error, "Could not load inspection workspace"));
  } finally {
    inspectionBusy.value = false;
  }
}

async function selectInspection(inspectionId) {
  if (!Number.isFinite(Number(inspectionId))) return;
  createPlacementActive.value = false;
  checklistTemplateSelection.value = "";
  selectedInspectionId.value = Number(inspectionId);
  timelineFilters.page = 1;
  await loadInspectionWorkspace(selectedInspectionId.value);
}

async function submitInspection() {
  if (!selectedInspectionId.value) return;
  clearMessages();

  try {
    await apiRequest(`/inspections/${selectedInspectionId.value}/submit`, {
      method: "POST",
    });
    await loadInspectionWorkspace(selectedInspectionId.value);
    await Promise.all([loadInspections(false), loadSummary(), loadInspectionMapData()]);
    setNotice("Inspection submitted.");
  } catch (error) {
    setError(formatApiError(error, "Could not submit inspection"));
  }
}

async function deleteInspectionAsAdmin() {
  if (!selectedInspectionId.value || !isAdminUser.value) return;

  const inspectionId = Number(selectedInspectionId.value);
  const inspectionLabel = selectedInspection.value?.inspection_no || `#${inspectionId}`;
  const shouldDelete =
    typeof window === "undefined"
      ? true
      : window.confirm(
          `Delete inspection ${inspectionLabel}? This will remove checklist items, media, timeline, and review records.`
        );
  if (!shouldDelete) return;

  clearMessages();
  inspectionDeleteBusy.value = true;
  try {
    await apiRequest(`/inspections/${inspectionId}`, {
      method: "DELETE",
    });

    if (selectedInspectionId.value === inspectionId) {
      selectedInspectionId.value = null;
      selectedInspection.value = null;
      checklistData.value = [];
      timelineData.value = [];
      mediaData.value = [];
      reviewData.value = [];
      activeTab.value = "overview";
      checklistTemplateSelection.value = "";
    }

    await Promise.all([loadInspections(true), loadSummary(), loadInspectionMapData()]);
    setNotice(`Inspection ${inspectionLabel} deleted.`);
  } catch (error) {
    setError(formatApiError(error, "Could not delete inspection"));
  } finally {
    inspectionDeleteBusy.value = false;
  }
}

async function saveInspectionNotes() {
  if (!selectedInspectionId.value) return;
  clearMessages();

  const parsedLatitude = Number.parseFloat(String(locationDraft.latitude || "").trim());
  const parsedLongitude = Number.parseFloat(String(locationDraft.longitude || "").trim());
  if (!Number.isFinite(parsedLatitude) || parsedLatitude < -90 || parsedLatitude > 90) {
    setError("Latitude must be a valid number between -90 and 90.");
    return;
  }
  if (!Number.isFinite(parsedLongitude) || parsedLongitude < -180 || parsedLongitude > 180) {
    setError("Longitude must be a valid number between -180 and 180.");
    return;
  }

  notesBusy.value = true;
  try {
    await apiRequest(`/inspections/${selectedInspectionId.value}`, {
      method: "PATCH",
      body: {
        notes: notesDraft.value,
        latitude: parsedLatitude,
        longitude: parsedLongitude,
      },
    });
    await Promise.all([
      loadInspectionCore(selectedInspectionId.value),
      loadInspections(false),
      loadInspectionMapData(),
    ]);
    setNotice("Inspection details updated.");
  } catch (error) {
    setError(formatApiError(error, "Could not update inspection details"));
  } finally {
    notesBusy.value = false;
  }
}

async function saveInspectionGeometry(payload) {
  const inspectionId = Number(payload?.inspection_id);
  const geometry = payload?.geometry;
  if (!Number.isFinite(inspectionId) || !geometry) {
    setError("Invalid geometry payload.");
    return;
  }

  clearMessages();
  mapBusy.value = true;
  try {
    await apiRequest(`/inspections/${inspectionId}`, {
      method: "PATCH",
      body: { geometry },
    });

    if (selectedInspectionId.value === inspectionId) {
      await loadInspectionCore(inspectionId);
    }

    await Promise.all([loadInspections(false), loadInspectionMapData(), loadSummary()]);
    setNotice("Inspection map geometry saved.");
  } catch (error) {
    setError(formatApiError(error, "Could not save inspection geometry"));
  } finally {
    mapBusy.value = false;
  }
}

async function createMasterOverlay(payload) {
  clearMessages();
  mapBusy.value = true;
  try {
    await apiRequest("/inspections/master-map/overlays", {
      method: "POST",
      body: payload,
    });
    await loadInspectionMapData();
    setNotice("Master map overlay created.");
  } catch (error) {
    setError(formatApiError(error, "Could not create overlay"));
  } finally {
    mapBusy.value = false;
  }
}

async function deleteMasterOverlay(overlayId) {
  const parsedId = Number(overlayId);
  if (!Number.isFinite(parsedId)) return;

  clearMessages();
  mapBusy.value = true;
  try {
    await apiRequest(`/inspections/master-map/overlays/${parsedId}`, {
      method: "DELETE",
    });
    await loadInspectionMapData();
    setNotice("Master map overlay deleted.");
  } catch (error) {
    setError(formatApiError(error, "Could not delete overlay"));
  } finally {
    mapBusy.value = false;
  }
}

async function upsertChecklistItem() {
  if (!selectedInspectionId.value) return;
  clearMessages();

  const itemKey = String(checklistForm.item_key || "").trim();
  if (!itemKey) {
    setError("item_key is required.");
    return;
  }

  checklistBusy.value = true;
  try {
    await apiRequest(`/inspections/${selectedInspectionId.value}/items`, {
      method: "POST",
      body: {
        items: [
          {
            item_key: itemKey,
            item_label: String(checklistForm.item_label || "").trim() || null,
            response_value: String(checklistForm.response_value || "").trim() || null,
            result: checklistForm.result || "na",
            comment: String(checklistForm.comment || "").trim() || null,
          },
        ],
      },
    });

    checklistForm.item_key = "";
    checklistForm.item_label = "";
    checklistForm.response_value = "";
    checklistForm.result = "na";
    checklistForm.comment = "";

    await Promise.all([
      loadChecklist(selectedInspectionId.value),
      loadInspectionCore(selectedInspectionId.value),
      loadInspections(false),
      loadSummary(),
    ]);
    setNotice("Checklist item saved.");
  } catch (error) {
    setError(formatApiError(error, "Could not save checklist item"));
  } finally {
    checklistBusy.value = false;
  }
}

function onMediaFileChange(event) {
  mediaForm.file = event?.target?.files?.[0] || null;
}

async function uploadMedia() {
  if (!selectedInspectionId.value || !mediaForm.file) {
    setError("Choose a file before uploading.");
    return;
  }
  clearMessages();
  mediaBusy.value = true;

  try {
    const formData = new FormData();
    formData.append("file", mediaForm.file);

    const itemKey = String(mediaForm.item_key || "").trim();
    if (itemKey) formData.append("item_key", itemKey);

    const itemResponseId = String(mediaForm.item_response_id || "").trim();
    if (itemResponseId) formData.append("item_response_id", itemResponseId);

    await apiRequest(`/inspections/${selectedInspectionId.value}/media`, {
      method: "POST",
      body: formData,
    });

    mediaForm.file = null;
    mediaForm.item_key = "";
    mediaForm.item_response_id = "";

    await Promise.all([loadMedia(selectedInspectionId.value), loadTimeline(selectedInspectionId.value)]);
    setNotice("Media uploaded.");
  } catch (error) {
    setError(formatApiError(error, "Could not upload media"));
  } finally {
    mediaBusy.value = false;
  }
}

async function deleteMedia(mediaId) {
  if (!selectedInspectionId.value || !mediaId) return;
  clearMessages();
  mediaBusy.value = true;
  try {
    await apiRequest(`/inspections/${selectedInspectionId.value}/media/${mediaId}`, {
      method: "DELETE",
    });
    await Promise.all([loadMedia(selectedInspectionId.value), loadTimeline(selectedInspectionId.value)]);
    setNotice("Media deleted.");
  } catch (error) {
    setError(formatApiError(error, "Could not delete media"));
  } finally {
    mediaBusy.value = false;
  }
}

async function openMedia(media, download = false) {
  if (!selectedInspectionId.value || !media?.id) return;
  clearMessages();

  try {
    const url = new URL(
      `${API_BASE}/inspections/${selectedInspectionId.value}/media/${media.id}/file`,
      window.location.origin
    );
    if (download) {
      url.searchParams.set("download", "1");
    }

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${authToken.value}`,
      },
    });

    if (!response.ok) {
      let payload = {};
      try {
        payload = await response.json();
      } catch (_error) {
        payload = {};
      }
      const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }

    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);

    if (download) {
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = media.original_file_name || `media-${media.id}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } else {
      window.open(objectUrl, "_blank", "noopener,noreferrer");
    }

    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    setError(formatApiError(error, "Could not open media file"));
  }
}

async function createReviewDecision() {
  if (!selectedInspectionId.value) return;
  clearMessages();
  reviewBusy.value = true;
  try {
    await apiRequest(`/inspections/${selectedInspectionId.value}/review`, {
      method: "POST",
      body: {
        decision: reviewForm.decision,
        comment: String(reviewForm.comment || "").trim() || null,
      },
    });
    reviewForm.comment = "";
    await Promise.all([
      loadInspectionWorkspace(selectedInspectionId.value),
      loadInspections(false),
      loadSummary(),
      loadInspectionMapData(),
    ]);
    setNotice(`Review action "${reviewForm.decision}" saved.`);
  } catch (error) {
    setError(formatApiError(error, "Could not submit review decision"));
  } finally {
    reviewBusy.value = false;
  }
}

function changeListPage(direction) {
  const nextPage = listFilters.page + direction;
  if (nextPage < 1 || nextPage > (listPagination.value.total_pages || 1)) return;
  listFilters.page = nextPage;
  loadInspections(false);
}

function applyListFilters() {
  listFilters.page = 1;
  leftRailTab.value = "list";
  refreshDashboard();
}

function clearListFilters() {
  listFilters.search = "";
  listFilters.status = "";
  listFilters.team_id = "";
  listFilters.page = 1;
  leftRailTab.value = "list";
  refreshDashboard();
}

function setLeftRailTab(tab) {
  leftRailTab.value = tab;
}

function beginCreatePlacement(kind = "point") {
  clearMessages();
  leftRailTab.value = "create";
  createPlacementKind.value = kind === "area" ? "area" : "point";
  createGeometryDraft.value = null;
  newInspectionForm.latitude = "";
  newInspectionForm.longitude = "";
  createPlacementActive.value = true;
  closePanels();
  setNotice(
    createPlacementKind.value === "area"
      ? "Click the map to add area vertices, then save the area."
      : "Click the map to place the new inspection location."
  );
}

function cancelCreatePlacement() {
  createPlacementActive.value = false;
}

function clearCreateLocation() {
  newInspectionForm.latitude = "";
  newInspectionForm.longitude = "";
  createGeometryDraft.value = null;
  createPlacementKind.value = "point";
  createPlacementActive.value = false;
}

function setCreateLocation(payload) {
  const latitude = Number(payload?.latitude);
  const longitude = Number(payload?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  newInspectionForm.latitude = latitude.toFixed(6);
  newInspectionForm.longitude = longitude.toFixed(6);
  createGeometryDraft.value = {
    type: "Point",
    coordinates: [longitude, latitude],
  };
  createPlacementKind.value = "point";
  createPlacementActive.value = false;
  leftRailTab.value = "create";
  leftPanelOpen.value = true;
  rightPanelOpen.value = false;
  setNotice("New inspection location selected from the map.");
}

function setCreateArea(payload) {
  const geometry = payload?.geometry;
  if (!geometry || geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates?.[0])) {
    return;
  }

  const centroid = centroidFromRing(geometry.coordinates[0]);
  if (!centroid) {
    setError("Could not compute area center from the selected polygon.");
    return;
  }

  newInspectionForm.latitude = centroid.latitude.toFixed(6);
  newInspectionForm.longitude = centroid.longitude.toFixed(6);
  createGeometryDraft.value = geometry;
  createPlacementKind.value = "area";
  createPlacementActive.value = false;
  leftRailTab.value = "create";
  leftPanelOpen.value = true;
  rightPanelOpen.value = false;
  setNotice("New inspection area selected from the map.");
}

async function openInspectionFromList(inspectionId) {
  await selectInspection(inspectionId);
  rightPanelOpen.value = true;
}

function toggleLeftPanel() {
  const nextState = !leftPanelOpen.value;
  leftPanelOpen.value = nextState;
  if (isMobileViewport.value && nextState) {
    rightPanelOpen.value = false;
  }
}

function toggleRightPanel() {
  if (!selectedInspectionId.value) return;
  const nextState = !rightPanelOpen.value;
  rightPanelOpen.value = nextState;
  if (!nextState) {
    rightPanelExpanded.value = false;
  }
  if (isMobileViewport.value && nextState) {
    leftPanelOpen.value = false;
  }
}

function clearExpandedPanels() {
  leftPanelExpanded.value = false;
  rightPanelExpanded.value = false;
  mapExpanded.value = false;
}

function requestMapResize() {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));
  });
}

function toggleLeftPanelExpanded() {
  if (isMobileViewport.value) return;
  const nextState = !leftPanelExpanded.value;
  clearExpandedPanels();
  leftPanelExpanded.value = nextState;
}

function toggleRightPanelExpanded() {
  if (isMobileViewport.value || !selectedInspectionId.value) return;
  const nextState = !rightPanelExpanded.value;
  clearExpandedPanels();
  rightPanelExpanded.value = nextState;
}

function toggleMapExpanded() {
  const nextState = !mapExpanded.value;
  clearExpandedPanels();
  mapExpanded.value = nextState;
  if (nextState) {
    leftPanelOpen.value = false;
    rightPanelOpen.value = false;
  }
}

function closePanels() {
  leftPanelOpen.value = false;
  rightPanelOpen.value = false;
  clearExpandedPanels();
}

function changeTimelinePage(direction) {
  const nextPage = timelineFilters.page + direction;
  if (nextPage < 1 || nextPage > (timelinePagination.value.total_pages || 1)) return;
  timelineFilters.page = nextPage;
  if (selectedInspectionId.value) {
    loadTimeline(selectedInspectionId.value);
  }
}

function refreshTimeline() {
  timelineFilters.page = 1;
  if (selectedInspectionId.value) {
    loadTimeline(selectedInspectionId.value);
  }
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatBytes(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let size = numeric;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function statusChipClass(status) {
  const normalized = String(status || "").toLowerCase();
  return {
    "status-chip": true,
    "status-draft": normalized === "draft",
    "status-submitted": normalized === "submitted",
    "status-in_review": normalized === "in_review",
    "status-approved": normalized === "approved",
    "status-rejected": normalized === "rejected",
    "status-reopened": normalized === "reopened",
    "status-closed": normalized === "closed",
  };
}

function resultChipClass(result) {
  const normalized = String(result || "").toLowerCase();
  return {
    "result-chip": true,
    "result-pass": normalized === "pass",
    "result-fail": normalized === "fail",
    "result-na": normalized === "na",
  };
}

onMounted(async () => {
  syncViewportState();
  window.addEventListener("resize", syncViewportState);
  window.addEventListener("resize", normalizePanelWidths);
  window.requestAnimationFrame(() => {
    normalizePanelWidths();
  });

  if (!authToken.value) return;

  appBusy.value = true;
  try {
    await loadCurrentUser();
    if (!mustChangePassword.value) {
      await refreshDashboard();
    }
  } catch (_error) {
    logout(false);
  } finally {
    appBusy.value = false;
  }
});

onBeforeUnmount(() => {
  stopPanelResize();
  window.removeEventListener("resize", syncViewportState);
  window.removeEventListener("resize", normalizePanelWidths);
});

watch(selectedInspectionId, (inspectionId) => {
  if (inspectionId != null) {
    rightPanelOpen.value = true;
    if (isMobileViewport.value) {
      leftPanelOpen.value = false;
    }
    return;
  }

  rightPanelExpanded.value = false;
});

watch(isMobileViewport, (mobile) => {
  if (mobile) {
    stopPanelResize();
    clearExpandedPanels();
  }

  if (!mobile) {
    leftPanelOpen.value = false;
    rightPanelOpen.value = false;
    return;
  }

  if (!leftPanelOpen.value && !rightPanelOpen.value) {
    if (selectedInspectionId.value != null) {
      rightPanelOpen.value = true;
    } else {
      leftPanelOpen.value = true;
    }
  }

  window.requestAnimationFrame(() => {
    normalizePanelWidths();
  });
});

watch(mapExpanded, () => {
  stopPanelResize();
  requestMapResize();
  window.requestAnimationFrame(() => {
    normalizePanelWidths();
  });
});

watch(leftRailTab, (tab) => {
  if (tab !== "create") {
    createPlacementActive.value = false;
  }
});

watch(
  () => newInspectionForm.team_id,
  () => {
    syncCreateAssigneeForTeam(false);
  }
);
</script>

<template>
  <div class="gis-app">
    <header class="topbar">
      <div>
        <p class="eyebrow">OGIS Local GIS</p>
        <h1>Inspection Intelligence Map</h1>
      </div>
      <div class="topbar-actions">
        <span class="backend-chip">API <code>{{ API_BASE }}</code></span>
        <button
          v-if="isLoggedIn"
          type="button"
          class="ghost-btn small-btn"
          :disabled="appBusy"
          @click="refreshDashboard"
        >
          {{ appBusy ? "Refreshing..." : "Refresh" }}
        </button>
      </div>
    </header>

    <div v-if="notice" class="banner success">{{ notice }}</div>
    <div v-if="errorMessage" class="banner error">{{ errorMessage }}</div>

    <section v-if="!isLoggedIn" class="auth-shell">
      <article class="auth-story">
        <p class="eyebrow">Local-Only Deployment</p>
        <h2>GIS-ready field inspections for teams</h2>
        <p>
          Map-first workflow for site survey, checklists, media evidence, and role-based approvals.
          Data stays on your local server and local storage.
        </p>
      </article>

      <article class="auth-card">
        <h2>Sign in</h2>
        <form class="form-grid" @submit.prevent="runLogin">
          <label>
            Username
            <input v-model.trim="loginForm.username" autocomplete="username" required />
          </label>
          <label>
            Password
            <input
              v-model="loginForm.password"
              type="password"
              autocomplete="current-password"
              required
            />
          </label>
          <button class="primary-btn" type="submit" :disabled="authBusy">
            {{ authBusy ? "Signing in..." : "Login" }}
          </button>
        </form>
      </article>
    </section>

    <section v-else-if="mustChangePassword" class="auth-card password-card">
      <h2>Password change required</h2>
      <p>Set a new password once to unlock this account.</p>
      <form class="form-grid" @submit.prevent="runPasswordChange">
        <label>
          Current password
          <input
            v-model="passwordForm.current_password"
            type="password"
            autocomplete="current-password"
            required
          />
        </label>
        <label>
          New password
          <input
            v-model="passwordForm.new_password"
            type="password"
            minlength="8"
            autocomplete="new-password"
            required
          />
        </label>
        <button class="primary-btn" type="submit" :disabled="authBusy">
          {{ authBusy ? "Saving..." : "Change password" }}
        </button>
      </form>
      <button type="button" class="ghost-btn" @click="runLogout">Logout</button>
    </section>

    <section
      v-else
      ref="workspaceRef"
      :class="['workspace', { 'map-only': mapExpanded }]"
      :style="workspaceStyle"
    >
      <nav v-show="!mapExpanded" class="mobile-dock" aria-label="Mobile workspace navigation">
        <button
          type="button"
          :class="['ghost-btn', { active: leftPanelOpen }]"
          @click="toggleLeftPanel"
        >
          Browse
        </button>
        <button
          type="button"
          :class="['ghost-btn', { active: !leftPanelOpen && !rightPanelOpen }]"
          @click="closePanels"
        >
          Map
        </button>
        <button type="button" class="ghost-btn" @click="toggleMapExpanded">Map only</button>
        <button
          type="button"
          :class="['ghost-btn', { active: rightPanelOpen }]"
          :disabled="!selectedInspectionId"
          @click="toggleRightPanel"
        >
          Details
        </button>
      </nav>

      <button
        v-if="!isMobileViewport && (leftPanelExpanded || rightPanelExpanded)"
        type="button"
        class="popup-backdrop"
        aria-label="Close expanded popup"
        @click="clearExpandedPanels"
      />

      <aside v-show="!mapExpanded" :class="['panel', 'left-panel', { open: leftPanelOpen, expanded: leftPanelExpanded }]">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Workspace</p>
            <h2>Inspections</h2>
          </div>
          <div class="panel-head-actions">
            <button type="button" class="ghost-btn small-btn desktop-only" @click="toggleLeftPanelExpanded">
              {{ leftPanelExpanded ? "Exit full screen" : "Expand" }}
            </button>
            <button type="button" class="ghost-btn small-btn mobile-only" @click="closePanels">
              Close
            </button>
          </div>
        </div>

        <article class="block user-block">
          <div class="user-row">
            <div>
              <h3>{{ currentUser?.full_name || currentUser?.username }}</h3>
              <p>@{{ currentUser?.username }}</p>
            </div>
            <button class="ghost-btn small-btn" type="button" @click="runLogout">Logout</button>
          </div>
          <div class="chip-row">
            <span v-for="role in userRoles" :key="role" class="role-chip">{{ role }}</span>
          </div>
          <p class="muted">Teams: {{ currentUserTeamLabels }}</p>
        </article>

        <article class="block utility-block">
          <div class="rail-switch">
            <button
              type="button"
              :class="['rail-tab', { active: leftRailTab === 'list' }]"
              @click="setLeftRailTab('list')"
            >
              Browse
            </button>
            <button
              type="button"
              :class="['rail-tab', { active: leftRailTab === 'create' }]"
              @click="setLeftRailTab('create')"
            >
              Create
            </button>
            <button
              type="button"
              :class="['rail-tab', { active: leftRailTab === 'filters' }]"
              @click="setLeftRailTab('filters')"
            >
              Filter
            </button>
            <button
              v-if="isAdminUser"
              type="button"
              :class="['rail-tab', { active: leftRailTab === 'admin' }]"
              @click="setLeftRailTab('admin')"
            >
              Admin
            </button>
          </div>

          <div class="mini-stats">
            <div v-for="stat in leftRailStats" :key="stat.key" class="mini-stat">
              <span>{{ stat.label }}</span>
              <strong>{{ stat.value }}</strong>
            </div>
          </div>

          <details class="status-breakdown">
            <summary>Status breakdown</summary>
            <div class="summary-grid compact-summary">
              <div v-for="status in statusBreakdown" :key="status.key" class="summary-item">
                <span>{{ status.label }}</span>
                <strong>{{ status.value }}</strong>
              </div>
            </div>
          </details>
        </article>

        <article v-if="leftRailTab === 'create'" class="block">
          <div class="section-head">
            <div>
              <h3>Create inspection</h3>
              <p class="muted section-copy">Place the inspection on the map first, then save the record.</p>
            </div>
          </div>
          <div class="create-map-pick">
            <div>
              <strong>{{ hasCreateGeometry ? `${createGeometryTypeLabel} selected` : "No map geometry selected" }}</strong>
              <p class="muted">
                {{
                  createPlacementActive
                    ? createPlacementKind === "area"
                      ? "Map is waiting for area vertices. Finish the shape from the map banner."
                      : "Map is waiting for one click to set the inspection point."
                    : "Use the map tools instead of typing coordinates manually."
                }}
              </p>
            </div>
            <div class="action-row">
              <button
                type="button"
                :class="[createPlacementActive && createPlacementKind === 'point' ? 'ghost-btn' : 'primary-btn']"
                @click="createPlacementActive && createPlacementKind === 'point' ? cancelCreatePlacement() : beginCreatePlacement('point')"
              >
                {{ createPlacementActive && createPlacementKind === "point" ? "Cancel point" : "Pick point" }}
              </button>
              <button
                type="button"
                :class="[createPlacementActive && createPlacementKind === 'area' ? 'ghost-btn' : 'primary-btn']"
                @click="createPlacementActive && createPlacementKind === 'area' ? cancelCreatePlacement() : beginCreatePlacement('area')"
              >
                {{ createPlacementActive && createPlacementKind === "area" ? "Cancel area" : "Draw area" }}
              </button>
              <button
                type="button"
                class="ghost-btn"
                :disabled="!hasCreateGeometry"
                @click="clearCreateLocation"
              >
                Clear selection
              </button>
            </div>
          </div>
          <div class="form-grid compact-grid">
            <label>
              Site name
              <input v-model="newInspectionForm.site_name" placeholder="Warehouse C" />
            </label>
            <label>
              Team
              <select v-model="newInspectionForm.team_id" :disabled="directoryBusy || teamDirectory.length === 0">
                <option value="">{{ directoryBusy ? "Loading teams..." : "Select team" }}</option>
                <option v-for="team in teamDirectory" :key="team.id" :value="String(team.id)">
                  {{ team.label }} ({{ team.member_count }})
                </option>
              </select>
            </label>
            <label>
              Assigned inspector
              <select
                v-model="newInspectionForm.assigned_to"
                :disabled="directoryBusy || createAssignableUsers.length === 0"
              >
                <option value="">
                  {{
                    directoryBusy
                      ? "Loading users..."
                      : createAssignableUsers.length === 0
                        ? "Select team first"
                        : "Select inspector"
                  }}
                </option>
                <option v-for="user in createAssignableUsers" :key="user.id" :value="String(user.id)">
                  {{ user.full_name }} (@{{ user.username }}) · {{ user.role }}
                </option>
              </select>
            </label>
            <label>
              Geometry
              <input :value="createGeometryTypeLabel" readonly placeholder="Pick from map" />
            </label>
            <label>
              Area vertices
              <input :value="createAreaVertexCount || '-'" readonly placeholder="Draw area on map" />
            </label>
            <label>
              Reference latitude
              <input v-model="newInspectionForm.latitude" readonly placeholder="Pick from map" />
            </label>
            <label>
              Reference longitude
              <input v-model="newInspectionForm.longitude" readonly placeholder="Pick from map" />
            </label>
            <label class="span-2">
              Notes
              <textarea v-model="newInspectionForm.notes" rows="2" placeholder="Site context..." />
            </label>
          </div>
          <button class="primary-btn" type="button" :disabled="!hasCreateGeometry" @click="createInspection">
            Create inspection
          </button>
        </article>

        <article v-else-if="leftRailTab === 'filters'" class="block">
          <div class="section-head">
            <div>
              <h3>Filters</h3>
              <p class="muted section-copy">Narrow the map and inspection list without keeping extra widgets open.</p>
            </div>
            <button class="ghost-btn small-btn" type="button" @click="clearListFilters">Reset</button>
          </div>
          <div class="form-grid compact-grid">
            <label class="span-2">
              Search
              <input
                v-model="listFilters.search"
                placeholder="Site, notes, inspection no..."
                @keydown.enter.prevent="applyListFilters"
              />
            </label>
            <label>
              Status
              <select v-model="listFilters.status">
                <option value="">All</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="in_review">In Review</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="reopened">Reopened</option>
                <option value="closed">Closed</option>
              </select>
            </label>
            <label>
              Team
              <select v-model="listFilters.team_id" :disabled="directoryBusy">
                <option value="">All teams</option>
                <option v-for="team in teamDirectory" :key="team.id" :value="String(team.id)">
                  {{ team.label }}
                </option>
              </select>
            </label>
            <label class="span-2">
              Sort
              <select v-model="listFilters.sort">
                <option value="-updated_at">Updated (newest)</option>
                <option value="-created_at">Created (newest)</option>
                <option value="site_name">Site name (A-Z)</option>
                <option value="-site_name">Site name (Z-A)</option>
                <option value="status">Status (A-Z)</option>
              </select>
            </label>
          </div>
          <button class="primary-btn" type="button" @click="applyListFilters">Apply filters</button>
        </article>

        <article v-else-if="leftRailTab === 'admin' && isAdminUser" class="block">
          <div class="section-head">
            <div>
              <h3>Admin Controls</h3>
              <p class="muted section-copy">Manage local teams, user access, roles, and account status.</p>
            </div>
            <button class="ghost-btn small-btn" type="button" :disabled="directoryBusy" @click="loadDirectory">
              Refresh
            </button>
          </div>
          <div class="admin-section">
            <article class="admin-team-card">
              <div class="section-head compact-head">
                <div>
                  <h4>Backup and restore</h4>
                  <p class="muted">Export all local data and media, or restore from a previous backup.</p>
                </div>
              </div>
              <div class="admin-backup-grid">
                <section class="admin-backup-pane">
                  <p class="muted">Create a full backup file for safe storage.</p>
                  <div class="action-row">
                    <button
                      class="primary-btn"
                      type="button"
                      :disabled="backupExportBusy || backupImportBusy"
                      @click="exportBackup"
                    >
                      {{ backupExportBusy ? "Exporting..." : "Export backup" }}
                    </button>
                  </div>
                </section>
                <section class="admin-backup-pane">
                  <label>
                    Backup file (.json)
                    <input
                      ref="backupImportInputRef"
                      type="file"
                      accept=".json,application/json"
                      :disabled="backupImportBusy || backupExportBusy"
                      @change="onBackupFileChange"
                    />
                  </label>
                  <div class="action-row">
                    <button
                      class="danger-btn small-btn"
                      type="button"
                      :disabled="backupImportBusy || backupExportBusy || !backupImportFile"
                      @click="importBackup"
                    >
                      {{ backupImportBusy ? "Restoring..." : "Import and restore" }}
                    </button>
                  </div>
                  <p class="muted admin-backup-warning">
                    Restore replaces all current records and media files, then signs out this session.
                  </p>
                </section>
              </div>
            </article>

            <article class="admin-team-card">
              <div class="section-head compact-head">
                <div>
                  <h4>Inspection checklist templates</h4>
                  <p class="muted">Define checklist keys once and auto-seed them into new inspections.</p>
                </div>
                <button
                  class="ghost-btn small-btn"
                  type="button"
                  :disabled="checklistTemplateBusy"
                  @click="loadChecklistTemplates"
                >
                  {{ checklistTemplateBusy ? "Refreshing..." : "Refresh" }}
                </button>
              </div>

              <div class="form-grid compact-grid">
                <label>
                  Item key
                  <input
                    v-model="newChecklistTemplateForm.item_key"
                    :disabled="checklistTemplateBusy"
                    placeholder="fire_extinguisher"
                    @keydown.enter.prevent="createChecklistTemplate"
                  />
                </label>
                <label>
                  Label
                  <input
                    v-model="newChecklistTemplateForm.item_label"
                    :disabled="checklistTemplateBusy"
                    placeholder="Fire extinguisher"
                    @keydown.enter.prevent="createChecklistTemplate"
                  />
                </label>
                <label>
                  Sort order
                  <input
                    v-model="newChecklistTemplateForm.sort_order"
                    :disabled="checklistTemplateBusy"
                    type="number"
                    min="0"
                    placeholder="10"
                    @keydown.enter.prevent="createChecklistTemplate"
                  />
                </label>
              </div>
              <div class="action-row">
                <button
                  class="primary-btn small-btn"
                  type="button"
                  :disabled="
                    checklistTemplateBusy ||
                    !String(newChecklistTemplateForm.item_key || '').trim() ||
                    !String(newChecklistTemplateForm.item_label || '').trim()
                  "
                  @click="createChecklistTemplate"
                >
                  {{ checklistTemplateBusy ? "Saving..." : "Add checklist item" }}
                </button>
              </div>

              <div v-if="checklistTemplateBusy && checklistTemplateDirectory.length === 0" class="empty">
                Loading checklist templates...
              </div>
              <div v-else-if="checklistTemplateDirectory.length === 0" class="empty">
                No checklist templates configured yet.
              </div>
              <div v-else class="admin-checklist-list">
                <article
                  v-for="item in checklistTemplateDirectory"
                  :key="item.id"
                  class="admin-team-card nested-card admin-checklist-row"
                >
                  <div class="form-grid compact-grid admin-checklist-fields">
                    <label>
                      Item key
                      <input
                        v-model="checklistTemplateKeyDrafts[item.id]"
                        :disabled="
                          checklistTemplateSaveBusyId === item.id || checklistTemplateDeleteBusyId === item.id
                        "
                        placeholder="item_key"
                      />
                    </label>
                    <label>
                      Label
                      <input
                        v-model="checklistTemplateLabelDrafts[item.id]"
                        :disabled="
                          checklistTemplateSaveBusyId === item.id || checklistTemplateDeleteBusyId === item.id
                        "
                        placeholder="Item label"
                      />
                    </label>
                    <label>
                      Sort order
                      <input
                        v-model="checklistTemplateOrderDrafts[item.id]"
                        :disabled="
                          checklistTemplateSaveBusyId === item.id || checklistTemplateDeleteBusyId === item.id
                        "
                        type="number"
                        min="0"
                        placeholder="0"
                      />
                    </label>
                  </div>
                  <div class="action-row">
                    <button
                      class="primary-btn small-btn"
                      type="button"
                      :disabled="checklistTemplateSaveBusyId === item.id || !hasChecklistTemplateChanged(item)"
                      @click="saveChecklistTemplate(item.id)"
                    >
                      {{ checklistTemplateSaveBusyId === item.id ? "Saving..." : "Save" }}
                    </button>
                    <button
                      class="danger-btn small-btn"
                      type="button"
                      :disabled="checklistTemplateDeleteBusyId === item.id || checklistTemplateSaveBusyId === item.id"
                      @click="deleteChecklistTemplate(item)"
                    >
                      {{ checklistTemplateDeleteBusyId === item.id ? "Deleting..." : "Delete" }}
                    </button>
                  </div>
                </article>
              </div>
            </article>

            <article class="admin-team-card">
              <div class="section-head compact-head">
                <div>
                  <h4>Create team</h4>
                  <p class="muted">Add a new local team for assignment, filtering, and map labels.</p>
                </div>
              </div>
              <label>
                Team name
                <input
                  v-model="newTeamForm.name"
                  :disabled="teamCreateBusy"
                  placeholder="Northern Survey Team"
                  @keydown.enter.prevent="createTeam"
                />
              </label>
              <div class="action-row">
                <button
                  class="primary-btn"
                  type="button"
                  :disabled="teamCreateBusy || String(newTeamForm.name || '').trim().length < 2"
                  @click="createTeam"
                >
                  {{ teamCreateBusy ? "Creating..." : "Create team" }}
                </button>
              </div>
            </article>

            <article class="admin-team-card">
              <div class="section-head compact-head">
                <div>
                  <h4>Create user</h4>
                  <p class="muted">Create a local account with team, role, and a temporary password.</p>
                </div>
              </div>
              <div class="form-grid compact-grid">
                <label>
                  Username
                  <input
                    v-model="newUserForm.username"
                    :disabled="userCreateBusy"
                    placeholder="inspector3"
                  />
                </label>
                <label>
                  Full name
                  <input
                    v-model="newUserForm.full_name"
                    :disabled="userCreateBusy"
                    placeholder="Inspector Three"
                  />
                </label>
                <label>
                  Role
                  <select v-model="newUserForm.role" :disabled="userCreateBusy">
                    <option v-for="role in userRoleOptions" :key="role.value" :value="role.value">
                      {{ role.label }}
                    </option>
                  </select>
                </label>
                <label>
                  Team
                  <select v-model="newUserForm.team_id" :disabled="userCreateBusy || teamDirectory.length === 0">
                    <option value="">Select team</option>
                    <option v-for="team in teamDirectory" :key="team.id" :value="String(team.id)">
                      {{ team.label }}
                    </option>
                  </select>
                </label>
                <label class="span-2">
                  Temporary password
                  <input
                    v-model="newUserForm.password"
                    :disabled="userCreateBusy"
                    type="password"
                    placeholder="Temporary password"
                    @keydown.enter.prevent="createUser"
                  />
                </label>
              </div>
              <div class="action-row">
                <button
                  class="primary-btn"
                  type="button"
                  :disabled="
                    userCreateBusy ||
                    !String(newUserForm.username || '').trim() ||
                    !String(newUserForm.full_name || '').trim() ||
                    !String(newUserForm.password || '')
                  "
                  @click="createUser"
                >
                  {{ userCreateBusy ? "Creating..." : "Create user" }}
                </button>
              </div>
            </article>

            <article class="admin-team-card">
              <div class="section-head compact-head">
                <div>
                  <h4>Rename teams</h4>
                  <p class="muted">Keep labels clear across selectors, filters, cards, and map popups.</p>
                </div>
              </div>
              <div v-if="teamDirectory.length === 0" class="empty">No teams available.</div>
              <div v-else class="admin-team-list">
                <article v-for="team in teamDirectory" :key="team.id" class="admin-team-card nested-card">
                  <div class="section-head compact-head">
                    <div>
                      <h4>{{ team.label }}</h4>
                      <p class="muted">ID {{ team.id }} | {{ team.member_count }} member(s)</p>
                    </div>
                  </div>
                  <label>
                    Team name
                    <input
                      v-model="teamNameDrafts[team.id]"
                      :disabled="teamAdminBusyId === team.id"
                      placeholder="Enter team name"
                    />
                  </label>
                  <div class="action-row">
                    <button
                      class="primary-btn"
                      type="button"
                      :disabled="teamAdminBusyId === team.id || !hasTeamNameChanged(team)"
                      @click="renameTeam(team.id)"
                    >
                      {{ teamAdminBusyId === team.id ? "Saving..." : "Save name" }}
                    </button>
                  </div>
                </article>
              </div>
            </article>

            <article class="admin-team-card">
              <div class="section-head compact-head">
                <div>
                  <h4>User access</h4>
                  <p class="muted">Move users between teams, change roles, reset passwords, and activate or deactivate local accounts.</p>
                </div>
              </div>
              <div v-if="userDirectory.length === 0" class="empty">No users available.</div>
              <div v-else class="admin-user-list">
                <article v-for="user in userDirectory" :key="user.id" :class="['admin-user-row', { inactive: !user.is_active }]">
                  <div class="admin-user-meta">
                    <strong>{{ user.full_name || user.username }}</strong>
                    <p class="muted">
                      @{{ user.username }} | {{ teamLabel(user.team_id) }} | {{ user.is_active ? "Active" : "Inactive" }}
                      <span v-if="user.must_change_password">| Password reset pending</span>
                      <span v-if="currentUser?.id === user.id">| Current session</span>
                    </p>
                  </div>
                  <div class="admin-user-controls">
                    <div class="admin-user-fields">
                      <label class="inline-field">
                        Team
                        <select
                          v-model="userTeamDrafts[user.id]"
                          :disabled="userTeamBusyId === user.id || teamDirectory.length === 0"
                        >
                          <option value="">Select team</option>
                          <option v-for="team in teamDirectory" :key="team.id" :value="String(team.id)">
                            {{ team.label }} ({{ team.member_count }})
                          </option>
                        </select>
                      </label>
                      <label class="inline-field">
                        Role
                        <select
                          v-model="userRoleDrafts[user.id]"
                          :disabled="userRoleBusyId === user.id"
                        >
                          <option v-for="role in userRoleOptions" :key="role.value" :value="role.value">
                            {{ role.label }}
                          </option>
                        </select>
                      </label>
                      <label class="inline-field admin-user-password">
                        Temporary password
                        <input
                          v-model="userPasswordDrafts[user.id]"
                          :disabled="userPasswordBusyId === user.id || currentUser?.id === user.id"
                          type="password"
                          placeholder="Set temporary password"
                          @keydown.enter.prevent="resetUserPassword(user)"
                        />
                      </label>
                    </div>
                    <div class="action-row admin-user-actions">
                      <button
                        class="primary-btn small-btn"
                        type="button"
                        :disabled="userTeamBusyId === user.id || !hasUserTeamChanged(user)"
                        @click="reassignUserTeam(user.id)"
                      >
                        {{ userTeamBusyId === user.id ? "Saving..." : "Save team" }}
                      </button>
                      <button
                        class="primary-btn small-btn"
                        type="button"
                        :disabled="userRoleBusyId === user.id || currentUser?.id === user.id || !hasUserRoleChanged(user)"
                        @click="changeUserRole(user.id)"
                      >
                        {{ userRoleBusyId === user.id ? "Saving..." : "Save role" }}
                      </button>
                      <button
                        :class="[user.is_active ? 'danger-btn' : 'ghost-btn', 'small-btn']"
                        type="button"
                        :disabled="userStatusBusyId === user.id || (currentUser?.id === user.id && user.is_active)"
                        @click="setUserActiveState(user, !user.is_active)"
                      >
                        {{
                          userStatusBusyId === user.id
                            ? "Saving..."
                            : user.is_active
                              ? "Deactivate"
                              : "Activate"
                        }}
                      </button>
                      <button
                        class="ghost-btn small-btn"
                        type="button"
                        :disabled="
                          userPasswordBusyId === user.id ||
                          currentUser?.id === user.id ||
                          !hasUserPasswordDraft(user.id)
                        "
                        @click="resetUserPassword(user)"
                      >
                        {{ userPasswordBusyId === user.id ? "Saving..." : "Reset password" }}
                      </button>
                    </div>
                  </div>
                </article>
              </div>
            </article>
          </div>
        </article>

        <article v-else class="block list-block">
          <div class="section-head">
            <div>
              <h3>Inspection list</h3>
              <p class="muted section-copy">Browse inspections and open details without leaving the map context.</p>
            </div>
            <span class="muted">{{ listPagination.total_items }} total</span>
          </div>
          <div v-if="activeFilterSummary.length > 0" class="filter-pill-row">
            <span v-for="token in activeFilterSummary" :key="token" class="filter-pill">{{ token }}</span>
          </div>
          <div v-if="appBusy" class="empty">Loading inspections...</div>
          <div v-else-if="inspections.length === 0" class="empty">No inspections match current filters.</div>
          <ul v-else class="inspection-list">
            <li
              v-for="inspection in inspections"
              :key="inspection.id"
              :class="['inspection-item', { active: inspection.id === selectedInspectionId }]"
            >
              <button type="button" @click="openInspectionFromList(inspection.id)">
                <div class="row-title">
                  <strong>{{ inspection.site_name }}</strong>
                  <span :class="statusChipClass(inspection.status)">{{ inspection.status }}</span>
                </div>
                <p>{{ inspection.inspection_no }}</p>
                <p class="muted">{{ teamLabel(inspection.team_id) }}</p>
                <p class="muted">Updated {{ formatDate(inspection.updated_at) }}</p>
              </button>
            </li>
          </ul>
          <div class="pager">
            <button class="ghost-btn" type="button" :disabled="!listPagination.has_prev" @click="changeListPage(-1)">
              Prev
            </button>
            <span>Page {{ listPagination.page }} / {{ listPagination.total_pages || 1 }}</span>
            <button class="ghost-btn" type="button" :disabled="!listPagination.has_next" @click="changeListPage(1)">
              Next
            </button>
          </div>
        </article>
      </aside>

      <button
        v-if="showPanelResizers"
        type="button"
        :class="['panel-resizer', 'left-resizer', { active: panelResizeState.side === 'left' }]"
        aria-label="Resize left panel"
        @mousedown="startPanelResize('left', $event)"
      />

      <main :class="['map-stage', { expanded: mapExpanded }]">
        <InspectionMap
          :inspections="mapInspections"
          :overlays="masterMapOverlays"
          :teams="teamDirectory"
          :selected-inspection-id="selectedInspectionId"
          :map-only-active="mapExpanded"
          :busy="appBusy || inspectionBusy || mapBusy"
          :create-placement-active="createPlacementActive"
          :create-placement-kind="createPlacementKind"
          :create-inspection-draft="{
            latitude: newInspectionForm.latitude,
            longitude: newInspectionForm.longitude,
            geometry: createGeometryDraft,
          }"
          @select-inspection="selectInspection"
          @save-inspection-geometry="saveInspectionGeometry"
          @create-overlay="createMasterOverlay"
          @delete-overlay="deleteMasterOverlay"
          @pick-create-location="setCreateLocation"
          @pick-create-area="setCreateArea"
          @cancel-create-location="cancelCreatePlacement"
          @toggle-map-only="toggleMapExpanded"
        />
      </main>

      <button
        v-if="showPanelResizers"
        type="button"
        :class="['panel-resizer', 'right-resizer', { active: panelResizeState.side === 'right' }]"
        aria-label="Resize right panel"
        @mousedown="startPanelResize('right', $event)"
      />

      <aside
        v-show="!mapExpanded"
        :class="['panel', 'right-panel', { open: rightPanelOpen, expanded: rightPanelExpanded && selectedInspectionId }]"
      >
        <div class="panel-head">
          <div>
            <p class="eyebrow">Inspection Detail</p>
            <h2 v-if="selectedInspectionId">{{ selectedInspection?.site_name || "Inspection" }}</h2>
            <h2 v-else>Select inspection</h2>
          </div>
          <div class="panel-head-actions">
            <button
              v-if="selectedInspectionId"
              type="button"
              class="ghost-btn small-btn desktop-only"
              @click="toggleRightPanelExpanded"
            >
              {{ rightPanelExpanded ? "Exit full screen" : "Expand" }}
            </button>
            <button type="button" class="ghost-btn small-btn mobile-only" @click="closePanels">
              Close
            </button>
          </div>
        </div>

        <template v-if="!selectedInspectionId">
          <div class="empty detail-empty">
            Select an inspection from the list or map to open checklist, media, timeline, and review actions.
          </div>
        </template>

        <template v-else>
          <article class="block detail-head-block">
            <p class="muted">Inspection {{ selectedInspection?.inspection_no }}</p>
            <div class="chip-row">
              <span :class="statusChipClass(selectedInspection?.status)">{{ selectedInspection?.status }}</span>
              <span :class="resultChipClass(selectedInspection?.overall_result)">
                Result: {{ selectedInspection?.overall_result || "na" }}
              </span>
              <span class="meta-chip">{{ teamLabel(selectedInspection?.team_id) }}</span>
            </div>
            <div class="action-row">
              <button
                class="primary-btn"
                type="button"
                :disabled="!canSubmitFromCurrentStatus || inspectionBusy || inspectionDeleteBusy"
                @click="submitInspection"
              >
                Submit
              </button>
              <button
                class="ghost-btn"
                type="button"
                :disabled="inspectionBusy || inspectionDeleteBusy"
                @click="loadInspectionWorkspace(selectedInspectionId)"
              >
                Refresh
              </button>
              <button
                v-if="isAdminUser"
                class="danger-btn"
                type="button"
                :disabled="inspectionBusy || inspectionDeleteBusy"
                @click="deleteInspectionAsAdmin"
              >
                {{ inspectionDeleteBusy ? "Deleting..." : "Delete inspection" }}
              </button>
            </div>
          </article>

          <nav class="tab-strip">
            <button :class="{ 'tab-btn': true, active: activeTab === 'overview' }" type="button" @click="activeTab = 'overview'">
              Overview
            </button>
            <button :class="{ 'tab-btn': true, active: activeTab === 'checklist' }" type="button" @click="activeTab = 'checklist'">
              Checklist
            </button>
            <button :class="{ 'tab-btn': true, active: activeTab === 'media' }" type="button" @click="activeTab = 'media'">
              Media
            </button>
            <button :class="{ 'tab-btn': true, active: activeTab === 'timeline' }" type="button" @click="activeTab = 'timeline'">
              Timeline
            </button>
            <button :class="{ 'tab-btn': true, active: activeTab === 'reviews' }" type="button" @click="activeTab = 'reviews'">
              Reviews
            </button>
          </nav>

          <article v-if="activeTab === 'overview'" class="block">
            <div class="section-head">
              <h3>Notes and location</h3>
              <p class="muted">Updated {{ formatDate(selectedInspection?.updated_at) }}</p>
            </div>
            <div class="form-grid compact-grid">
              <label>
                Latitude
                <input
                  v-model="locationDraft.latitude"
                  :disabled="!canPatchInspection || notesBusy"
                  inputmode="decimal"
                  placeholder="25.2048"
                />
              </label>
              <label>
                Longitude
                <input
                  v-model="locationDraft.longitude"
                  :disabled="!canPatchInspection || notesBusy"
                  inputmode="decimal"
                  placeholder="55.2708"
                />
              </label>
              <label class="span-2">
                Notes
                <textarea
                  v-model="notesDraft"
                  rows="6"
                  :disabled="!canPatchInspection || notesBusy"
                  placeholder="Inspector notes and site context..."
                />
              </label>
            </div>
            <button
              class="primary-btn"
              type="button"
              :disabled="!canPatchInspection || notesBusy"
              @click="saveInspectionNotes"
            >
              {{ notesBusy ? "Saving..." : "Save details" }}
            </button>
          </article>

          <article v-else-if="activeTab === 'checklist'" class="block">
            <div class="section-head">
              <h3>Checklist</h3>
              <div class="checklist-head-actions">
                <span :class="resultChipClass(checklistOverallResult)">Overall: {{ checklistOverallResult }}</span>
                <button
                  class="ghost-btn small-btn"
                  type="button"
                  :disabled="!canUpdateChecklist || checklistTemplateApplyBusy || checklistBusy"
                  @click="applyChecklistTemplatesToInspection"
                >
                  {{ checklistTemplateApplyBusy ? "Applying..." : "Add template items" }}
                </button>
              </div>
            </div>

            <form class="form-grid compact-grid" @submit.prevent="upsertChecklistItem">
              <label class="span-2">
                Template item
                <select
                  v-model="checklistTemplateSelection"
                  :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateDirectory.length === 0"
                  @change="applyChecklistTemplateSelection"
                >
                  <option value="">Select checklist template</option>
                  <option v-for="template in checklistTemplateDirectory" :key="template.id" :value="template.item_key">
                    {{ template.item_label }} ({{ template.item_key }})
                  </option>
                </select>
              </label>
              <label>
                Item key
                <input
                  v-model="checklistForm.item_key"
                  :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateApplyBusy"
                  placeholder="fire_extinguisher"
                  required
                />
              </label>
              <label>
                Label
                <input
                  v-model="checklistForm.item_label"
                  :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateApplyBusy"
                  placeholder="Fire extinguisher"
                />
              </label>
              <label>
                Response value
                <input
                  v-model="checklistForm.response_value"
                  :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateApplyBusy"
                  placeholder="Optional value"
                />
              </label>
              <label>
                Result
                <select
                  v-model="checklistForm.result"
                  :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateApplyBusy"
                >
                  <option value="pass">Pass</option>
                  <option value="fail">Fail</option>
                  <option value="na">N/A</option>
                </select>
              </label>
              <label class="span-2">
                Comment
                <input
                  v-model="checklistForm.comment"
                  :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateApplyBusy"
                  placeholder="Issue details or remediation"
                />
              </label>
              <button
                class="primary-btn"
                type="submit"
                :disabled="!canUpdateChecklist || checklistBusy || checklistTemplateApplyBusy"
              >
                {{ checklistBusy ? "Saving..." : "Save item" }}
              </button>
            </form>

            <div v-if="checklistBusy && checklistData.length === 0" class="empty">Loading items...</div>
            <div v-else-if="checklistData.length === 0" class="empty">No checklist items yet.</div>
            <div v-else class="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Key</th>
                    <th>Label</th>
                    <th>Result</th>
                    <th>Comment</th>
                    <th>Answered</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in checklistData" :key="item.id">
                    <td>{{ item.item_key }}</td>
                    <td>{{ item.item_label || "-" }}</td>
                    <td><span :class="resultChipClass(item.result)">{{ item.result || "na" }}</span></td>
                    <td>{{ item.comment || "-" }}</td>
                    <td>{{ formatDate(item.answered_at || item.updated_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </article>

          <article v-else-if="activeTab === 'media'" class="block">
            <div class="section-head">
              <h3>Media</h3>
              <span class="muted">{{ mediaData.length }} file(s)</span>
            </div>

            <form class="form-grid compact-grid" @submit.prevent="uploadMedia">
              <label>
                Item key (optional)
                <input
                  v-model="mediaForm.item_key"
                  :disabled="!canUploadMedia || mediaBusy"
                  placeholder="fire_extinguisher"
                />
              </label>
              <label>
                Item response ID (optional)
                <input
                  v-model="mediaForm.item_response_id"
                  :disabled="!canUploadMedia || mediaBusy"
                  placeholder="12"
                />
              </label>
              <label class="span-2">
                File
                <input type="file" :disabled="!canUploadMedia || mediaBusy" @change="onMediaFileChange" />
              </label>
              <button class="primary-btn" type="submit" :disabled="!canUploadMedia || mediaBusy">
                {{ mediaBusy ? "Uploading..." : "Upload file" }}
              </button>
            </form>

            <div v-if="mediaBusy && mediaData.length === 0" class="empty">Loading media...</div>
            <div v-else-if="mediaData.length === 0" class="empty">No media attached.</div>
            <ul v-else class="stack-list">
              <li v-for="media in mediaData" :key="media.id" class="stack-item">
                <div>
                  <h4>{{ media.original_file_name || media.stored_file_name }}</h4>
                  <p class="muted">
                    {{ media.media_type }} | {{ formatBytes(media.file_size_bytes) }} | Uploaded
                    {{ formatDate(media.created_at) }}
                  </p>
                </div>
                <div class="action-row">
                  <button class="ghost-btn" type="button" @click="openMedia(media, false)">Open</button>
                  <button class="ghost-btn" type="button" @click="openMedia(media, true)">Download</button>
                  <button class="danger-btn" type="button" :disabled="mediaBusy" @click="deleteMedia(media.id)">
                    Delete
                  </button>
                </div>
              </li>
            </ul>
          </article>

          <article v-else-if="activeTab === 'timeline'" class="block">
            <div class="section-head">
              <h3>Timeline</h3>
              <div class="action-row">
                <label class="toggle">
                  <input v-model="timelineFilters.includeReads" type="checkbox" @change="refreshTimeline" />
                  Include read events
                </label>
                <button class="ghost-btn" type="button" @click="refreshTimeline">Refresh</button>
              </div>
            </div>

            <div v-if="timelineBusy && timelineData.length === 0" class="empty">Loading timeline...</div>
            <ul v-else-if="timelineData.length > 0" class="stack-list">
              <li v-for="event in timelineData" :key="event.id" class="stack-item">
                <h4>{{ event.action }}</h4>
                <p class="muted">
                  {{ event.actor?.full_name || event.actor?.username || "System" }} | {{ event.category }} |
                  {{ formatDate(event.created_at) }}
                </p>
                <details>
                  <summary>Details</summary>
                  <pre>{{ JSON.stringify(event.details || {}, null, 2) }}</pre>
                </details>
              </li>
            </ul>
            <div v-else class="empty">No timeline events.</div>

            <div class="pager">
              <button class="ghost-btn" type="button" :disabled="!timelinePagination.has_prev" @click="changeTimelinePage(-1)">
                Prev
              </button>
              <span>Page {{ timelinePagination.page }} / {{ timelinePagination.total_pages || 1 }}</span>
              <button class="ghost-btn" type="button" :disabled="!timelinePagination.has_next" @click="changeTimelinePage(1)">
                Next
              </button>
            </div>
          </article>

          <article v-else class="block">
            <div class="section-head">
              <h3>Reviews</h3>
              <span class="muted">{{ reviewData.length }} review(s)</span>
            </div>

            <form v-if="hasSupervisorPrivileges" class="form-grid compact-grid" @submit.prevent="createReviewDecision">
              <label>
                Decision
                <select v-model="reviewForm.decision" :disabled="reviewBusy">
                  <option value="review">Move to in_review</option>
                  <option value="approve">Approve</option>
                  <option value="reject">Reject</option>
                  <option value="reopen">Reopen</option>
                </select>
              </label>
              <label class="span-2">
                Comment
                <input v-model="reviewForm.comment" :disabled="reviewBusy" placeholder="Optional comment" />
              </label>
              <button class="primary-btn" type="submit" :disabled="reviewBusy">
                {{ reviewBusy ? "Saving..." : "Apply decision" }}
              </button>
            </form>

            <div v-if="reviewBusy && reviewData.length === 0" class="empty">Loading reviews...</div>
            <ul v-else-if="reviewData.length > 0" class="stack-list">
              <li v-for="review in reviewData" :key="review.id" class="stack-item">
                <h4>{{ review.decision }}</h4>
                <p class="muted">
                  {{ review.reviewer_name }} | {{ review.from_status }} -> {{ review.to_status }} |
                  {{ formatDate(review.created_at) }}
                </p>
                <p>{{ review.comment || "No comment" }}</p>
              </li>
            </ul>
            <div v-else class="empty">No reviews yet.</div>
          </article>
        </template>
      </aside>
    </section>
  </div>
</template>

<style>
@import url("https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Space+Grotesk:wght@500;700&display=swap");

:root {
  --bg-page: #07131d;
  --bg-shell: #0c1d2b;
  --bg-panel: #11293b;
  --bg-panel-soft: #16354c;
  --bg-panel-muted: #0f2434;
  --ink-main: #e8f2fb;
  --ink-soft: #9cb6ca;
  --line-soft: #29445c;
  --brand: #1f8ea1;
  --brand-strong: #0f788a;
  --accent: #f29f4b;
  --ok: #2aa56f;
  --warn: #f0a43f;
  --danger: #d86d6d;
  --radius-md: 12px;
  --radius-lg: 18px;
}

* {
  box-sizing: border-box;
}

html,
body,
#app {
  margin: 0;
  width: 100%;
  height: 100%;
  min-height: 100%;
}

body {
  font-family: "Manrope", "Segoe UI", sans-serif;
  color: var(--ink-main);
  background:
    radial-gradient(1100px 520px at 94% -12%, #154969 0%, transparent 60%),
    radial-gradient(820px 440px at -12% 112%, #8a4d1f 0%, transparent 58%),
    var(--bg-page);
  overflow: hidden;
}

.gis-app {
  width: 100%;
  max-width: none;
  margin: 0;
  padding: 14px;
  height: 100vh;
  height: 100dvh;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 12px;
}

h1,
h2,
h3,
h4 {
  margin: 0;
  font-family: "Space Grotesk", "Trebuchet MS", sans-serif;
  letter-spacing: -0.02em;
}

p {
  margin: 0;
}

code {
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 0.82em;
  padding: 0.15rem 0.34rem;
  border-radius: 6px;
  background: #143247;
  color: #d9eeff;
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.11em;
  font-size: 0.7rem;
  color: var(--ink-soft);
  font-weight: 800;
}

.topbar h1 {
  font-size: clamp(1.3rem, 1rem + 1.6vw, 2.2rem);
}

.topbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.backend-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  border: 1px solid var(--line-soft);
  background: rgba(16, 39, 57, 0.86);
  padding: 0.35rem 0.7rem;
  font-size: 0.85rem;
}

.banner {
  padding: 0.62rem 0.86rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  margin-bottom: 8px;
}

.banner.success {
  background: rgba(42, 165, 111, 0.14);
  border-color: rgba(72, 203, 142, 0.35);
  color: #9fe9c7;
}

.banner.error {
  background: rgba(216, 109, 109, 0.16);
  border-color: rgba(236, 129, 129, 0.35);
  color: #ffcece;
}

.auth-shell {
  display: grid;
  grid-template-columns: 1.2fr minmax(300px, 460px);
  gap: 12px;
  flex: 1;
  height: 100%;
  min-height: 0;
}

.auth-story,
.auth-card {
  border-radius: var(--radius-lg);
  border: 1px solid var(--line-soft);
  background: linear-gradient(154deg, rgba(20, 48, 69, 0.92), rgba(11, 28, 41, 0.96));
  padding: 16px;
  overflow: auto;
}

.auth-story h2 {
  margin-top: 10px;
  margin-bottom: 8px;
}

.auth-story p {
  color: var(--ink-soft);
  line-height: 1.45;
}

.seeded-accounts {
  margin-top: 16px;
}

.seeded-accounts p {
  font-size: 0.86rem;
  margin-bottom: 8px;
}

.seed-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.auth-card h2 {
  margin-bottom: 12px;
}

.password-card {
  max-width: 650px;
  flex: 1;
  min-height: 0;
}

.workspace {
  --workspace-left: 340px;
  --workspace-right: 420px;
  --workspace-resizer: 10px;
  display: grid;
  grid-template-columns:
    minmax(260px, var(--workspace-left))
    var(--workspace-resizer)
    minmax(0, 1fr)
    var(--workspace-resizer)
    minmax(300px, var(--workspace-right));
  gap: 12px;
  flex: 1;
  height: 100%;
  min-height: 0;
}

.workspace.map-only {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
}

.panel-resizer {
  width: 100%;
  height: 100%;
  margin: 0;
  border: 0;
  border-radius: 999px;
  background: transparent;
  cursor: col-resize;
  padding: 0;
  position: relative;
  z-index: 6;
  touch-action: none;
}

.panel-resizer::before {
  content: "";
  position: absolute;
  top: 12px;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  width: 2px;
  border-radius: 999px;
  background: rgba(71, 113, 142, 0.72);
}

.panel-resizer:hover::before,
.panel-resizer.active::before {
  width: 3px;
  background: rgba(102, 188, 219, 0.95);
}

.mobile-dock {
  display: none;
}

.mobile-dock .ghost-btn.active {
  border-color: #3cb6c9;
  background: #1a4762;
  color: #f2fbff;
}

.popup-backdrop {
  position: fixed;
  inset: 0;
  z-index: 880;
  border: 0;
  background: rgba(5, 14, 22, 0.42);
  cursor: pointer;
}

.panel {
  background: linear-gradient(172deg, rgba(17, 41, 59, 0.95), rgba(9, 23, 34, 0.95));
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-lg);
  overflow: auto;
  padding: 12px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}

.panel-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mobile-only {
  display: none;
}

.desktop-only {
  display: inline-flex;
}

.block {
  border: 1px solid var(--line-soft);
  background: rgba(15, 36, 52, 0.78);
  border-radius: var(--radius-md);
  padding: 10px;
}

.left-panel,
.right-panel {
  display: grid;
  gap: 10px;
  align-content: start;
}

.left-panel.expanded,
.right-panel.expanded {
  position: fixed;
  top: max(10px, env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  width: min(1460px, calc(100vw - max(14px, env(safe-area-inset-left)) - max(14px, env(safe-area-inset-right))));
  height: min(72vh, 860px);
  max-height: min(72vh, 860px);
  z-index: 900;
  box-shadow: 0 28px 72px rgba(0, 0, 0, 0.46);
}

.left-panel.expanded,
.right-panel.expanded {
  overflow: auto;
}

.map-stage {
  position: relative;
  z-index: 1;
  border: 1px solid #1f3b52;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: #0d2232;
  min-height: 0;
}

.workspace.map-only .map-stage {
  grid-column: 1 / -1;
  height: 100%;
}

.map-stage.expanded {
  z-index: 2;
}

.user-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}

.user-row p,
.muted {
  color: var(--ink-soft);
  font-size: 0.83rem;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.role-chip,
.meta-chip {
  border: 1px solid #355977;
  background: #19364c;
  border-radius: 999px;
  padding: 0.2rem 0.55rem;
  font-size: 0.76rem;
}

.form-grid {
  display: grid;
  gap: 8px;
}

.compact-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

label {
  display: grid;
  gap: 4px;
  font-size: 0.84rem;
  color: #a8bfd2;
}

.span-2 {
  grid-column: 1 / -1;
}

input,
select,
textarea,
button {
  font: inherit;
}

input,
select,
textarea {
  width: 100%;
  border: 1px solid #34546d;
  border-radius: 10px;
  background: #102a3c;
  color: #edf5fc;
  padding: 0.56rem 0.65rem;
}

input::placeholder,
textarea::placeholder {
  color: #8099ad;
}

input[readonly] {
  background: #0e2332;
  color: #cfe1f0;
}

input:focus,
select:focus,
textarea:focus {
  outline: 2px solid rgba(31, 142, 161, 0.45);
  border-color: #238ca0;
}

button {
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 0.52rem 0.72rem;
  transition: transform 130ms ease, border-color 130ms ease, background-color 130ms ease;
}

button:hover:not(:disabled) {
  transform: translateY(-1px);
}

button:disabled {
  opacity: 0.58;
  cursor: not-allowed;
}

.primary-btn {
  background: linear-gradient(120deg, var(--brand), var(--brand-strong));
  color: #f5fdff;
}

.ghost-btn {
  border-color: #31526d;
  background: #17344a;
  color: #dbe8f5;
}

.danger-btn {
  border-color: #7f4646;
  background: #522828;
  color: #ffc9c9;
}

.small-btn {
  font-size: 0.8rem;
  padding: 0.36rem 0.6rem;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.section-copy {
  margin-top: 4px;
}

.utility-block {
  display: grid;
  gap: 10px;
}

.create-map-pick {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
  border: 1px solid #35546d;
  border-radius: 12px;
  background: #102739;
  padding: 10px;
}

.rail-switch {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
  gap: 6px;
}

.rail-tab {
  border-color: #31526d;
  background: #122d41;
  color: #cfe0ef;
}

.rail-tab.active {
  border-color: #3cb6c9;
  background: #1a4762;
  color: #f2fbff;
}

.mini-stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.mini-stat {
  border: 1px solid #35546d;
  border-radius: 10px;
  background: #142d41;
  padding: 7px;
}

.mini-stat span {
  display: block;
  color: var(--ink-soft);
  font-size: 0.74rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mini-stat strong {
  display: block;
  margin-top: 2px;
  font-size: 1rem;
}

.status-breakdown {
  border: 1px solid #35546d;
  border-radius: 10px;
  background: #102739;
  padding: 8px;
}

.status-breakdown summary {
  cursor: pointer;
  color: #d7e5f1;
  font-size: 0.84rem;
}

.compact-summary {
  margin-top: 8px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
}

.summary-item {
  border: 1px solid #35546d;
  border-radius: 10px;
  background: #142d41;
  padding: 7px;
}

.summary-item span {
  display: block;
  color: var(--ink-soft);
  font-size: 0.76rem;
}

.summary-item strong {
  font-size: 1rem;
}

.admin-section {
  display: grid;
  gap: 10px;
}

.admin-team-list {
  display: grid;
  gap: 8px;
}

.admin-team-card {
  border: 1px solid #35546d;
  border-radius: 12px;
  background: #102739;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.admin-backup-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.admin-backup-pane {
  border: 1px solid #35546d;
  border-radius: 10px;
  background: #0f2434;
  padding: 8px;
  display: grid;
  gap: 8px;
}

.admin-backup-pane p {
  margin: 0;
}

.admin-backup-warning {
  font-size: 0.76rem;
}

.admin-checklist-list {
  display: grid;
  gap: 8px;
}

.admin-checklist-row {
  gap: 8px;
}

.admin-checklist-fields {
  align-items: end;
}

.nested-card {
  background: #0f2434;
}

.compact-head {
  margin-bottom: 0;
}

.admin-user-list {
  display: grid;
  gap: 8px;
}

.admin-user-row {
  border: 1px solid #35546d;
  border-radius: 12px;
  background: #0f2434;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.admin-user-row.inactive {
  border-style: dashed;
  opacity: 0.82;
}

.admin-user-meta {
  display: grid;
  gap: 4px;
}

.admin-user-meta strong,
.admin-user-meta p {
  margin: 0;
}

.admin-user-controls {
  display: grid;
  gap: 8px;
}

.admin-user-fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.admin-user-password {
  grid-column: 1 / -1;
}

.admin-user-actions {
  justify-content: flex-start;
}

.inline-field {
  margin: 0;
}

.list-block {
  min-height: 280px;
}

.filter-pill-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.filter-pill {
  border: 1px solid #375975;
  background: #163246;
  color: #dcedfa;
  border-radius: 999px;
  padding: 0.22rem 0.55rem;
  font-size: 0.75rem;
}

.inspection-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 7px;
  max-height: min(58vh, 620px);
  overflow: auto;
}

.inspection-item {
  border: 1px solid #315169;
  border-radius: 10px;
  background: #122a3b;
}

.inspection-item.active {
  border-color: #33a5b7;
  background: #17384f;
}

.inspection-item button {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  padding: 8px;
  color: inherit;
}

.row-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.status-chip,
.result-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid transparent;
  border-radius: 999px;
  padding: 0.18rem 0.5rem;
  font-size: 0.72rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  font-weight: 700;
}

.status-draft {
  background: #304150;
  border-color: #4f687d;
}

.status-submitted {
  background: #543b20;
  border-color: #8f6b3c;
}

.status-in_review {
  background: #234755;
  border-color: #2f6b82;
}

.status-approved {
  background: #214b35;
  border-color: #2f7f56;
}

.status-rejected {
  background: #552d2d;
  border-color: #8f4949;
}

.status-reopened {
  background: #27435b;
  border-color: #3a749f;
}

.status-closed {
  background: #363f4a;
  border-color: #616f7f;
}

.result-pass {
  background: #244f38;
  border-color: #318a5d;
}

.result-fail {
  background: #553131;
  border-color: #a95a5a;
}

.result-na {
  background: #354758;
  border-color: #5d7388;
}

.detail-head-block {
  display: grid;
  gap: 8px;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.checklist-head-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
}

.tab-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 6px;
}

.tab-btn {
  border: 1px solid #31526d;
  background: #122f43;
  color: #cfe1f0;
}

.tab-btn.active {
  border-color: #3cb6c9;
  background: #1a4762;
  color: #f2fbff;
}

.empty {
  border: 1px dashed #395a73;
  border-radius: 11px;
  padding: 10px;
  background: #102a3d;
  color: #9cb6ca;
}

.detail-empty {
  margin-top: 4px;
}

.table-wrap {
  overflow: auto;
}

table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}

th,
td {
  padding: 0.5rem;
  border-bottom: 1px solid #2f506b;
  text-align: left;
}

th {
  font-size: 0.76rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #a1bfd4;
}

.stack-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 7px;
}

.stack-item {
  border: 1px solid #33546f;
  border-radius: 10px;
  background: #122b3d;
  padding: 8px;
  display: grid;
  gap: 6px;
}

.stack-item pre {
  margin: 0;
  max-height: 180px;
  overflow: auto;
  border: 1px solid #33546f;
  border-radius: 8px;
  background: #0e2433;
  padding: 8px;
  font-size: 0.75rem;
}

.pager {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  font-size: 0.84rem;
  color: #9cb6ca;
}

.toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.82rem;
}

.toggle input {
  width: auto;
}

@media (max-width: 1300px) {
  .workspace {
    grid-template-columns:
      minmax(240px, var(--workspace-left))
      var(--workspace-resizer)
      minmax(0, 1fr)
      var(--workspace-resizer)
      minmax(280px, var(--workspace-right));
  }

  .tab-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 980px) {
  .auth-shell {
    grid-template-columns: 1fr;
  }

  .workspace {
    grid-template-columns: 1fr;
    min-height: 0;
    height: 100%;
    position: relative;
    padding-bottom: calc(78px + env(safe-area-inset-bottom));
  }

  .panel-resizer {
    display: none;
  }

  .mobile-dock {
    position: fixed;
    z-index: 180;
    left: max(8px, env(safe-area-inset-left));
    right: max(8px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 6px;
    padding: 8px;
    border: 1px solid rgba(41, 68, 92, 0.92);
    border-radius: 18px;
    background: rgba(7, 20, 31, 0.9);
    backdrop-filter: blur(10px);
    box-shadow: 0 18px 45px rgba(0, 0, 0, 0.35);
  }

  .popup-backdrop {
    display: none;
  }

  .mobile-only {
    display: inline-flex;
  }

  .desktop-only {
    display: none;
  }

  .left-panel,
  .right-panel {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    bottom: calc(78px + env(safe-area-inset-bottom));
    z-index: 190;
    width: auto;
    max-width: none;
    opacity: 0;
    pointer-events: none;
    transition: transform 180ms ease, opacity 180ms ease;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    transform: translateY(18px);
  }

  .left-panel.expanded,
  .right-panel.expanded {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    bottom: calc(78px + env(safe-area-inset-bottom));
    z-index: 190;
    width: auto;
    height: auto;
    max-height: none;
    transform: translateY(18px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
  }

  .left-panel.open,
  .right-panel.open {
    transform: translateY(0);
    opacity: 1;
    pointer-events: auto;
  }

  .map-stage {
    min-height: 100%;
  }

  .tab-strip {
    display: flex;
    overflow-x: auto;
    scrollbar-width: thin;
    white-space: nowrap;
  }

  .tab-btn {
    flex: 0 0 auto;
    min-width: max-content;
    white-space: nowrap;
  }
}

@media (max-width: 640px) {
  .gis-app {
    padding: 9px;
  }

  .topbar {
    flex-direction: column;
    align-items: flex-start;
  }

  .compact-grid {
    grid-template-columns: 1fr;
  }

  .mini-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .span-2 {
    grid-column: auto;
  }

  .create-map-pick {
    flex-direction: column;
    align-items: stretch;
  }

  .admin-user-fields {
    grid-template-columns: 1fr;
  }

  .admin-backup-grid {
    grid-template-columns: 1fr;
  }

  .mobile-dock {
    left: 8px;
    right: 8px;
  }
}
</style>

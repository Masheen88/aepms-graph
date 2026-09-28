<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  ClipboardList,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Grid2X2,
  Hand,
  HelpCircle,
  House,
  Layers,
  LoaderCircle,
  MapPinned,
  Maximize,
  Moon,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  ScanLine,
  Settings2,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-vue-next";
import GraphEditor from "./components/GraphEditor.vue";
import ModalShell from "./components/ModalShell.vue";
import StatementForm from "./components/StatementForm.vue";
import PaperPreview from "./components/PaperPreview.vue";
import {
  blankReport,
  clone,
  CONSTRUCTION,
  DEFAULT_GRAPH_STYLE,
  GRID,
  localDate,
  reportSchema,
  sampleReport,
  statementErrors,
  SYMBOLS,
  uid,
} from "./lib/model.js";
import { bounds, clamp, snapStepForScale, translatePoints } from "./lib/geometry.js";
import {
  canUseNativeAndroidFileSave,
  savePdfToAndroidDownloads,
  savePdfWithNativeAndroidPicker,
  saveTextToAndroidDownloads,
  saveTextWithNativeAndroidPicker,
} from "./lib/nativeFileSave.js";

const report = ref(blankReport()),
  revision = ref(0),
  savedSnapshot = ref(JSON.stringify(report.value));
const dirty = computed(
  () => JSON.stringify(report.value) !== savedSnapshot.value,
);
const tab = ref("graph"),
  tool = ref("outline"),
  selectedId = ref(null),
  selectedIds = ref([]),
  snap = ref(true),
  panelOpen = ref(false),
  railCollapsed = ref(false),
  inspectorCollapsed = ref(false),
  topUiCollapsed = ref(false),
  lineAutoConnect = ref(true),
  multiSelectMode = ref(false);
const graph = ref(null),
  fileInput = ref(null),
  labelInput = ref(null),
  position = ref({ x: 0, y: 0 });
const currentSymbol = ref(SYMBOLS[0]),
  modal = ref(null),
  busy = ref(false),
  busyPdf = ref(false),
  toast = ref(""),
  error = ref("");
const records = ref([]),
  loadingRecords = ref(false),
  recovery = ref(null),
  pages = ref([]);
const paper = ref("letter"),
  monochrome = ref(true),
  darkMode = ref(false),
  custom = ref({ title: "", text: "" }),
  preparedPdf = ref(null),
  mobileFileFlow = ref(false),
  deviceSavedAt = ref(""),
  credentialProfiles = ref([]),
  noteTemplates = ref([]),
  presetDraft = ref({ title: "", role: "inspector" });
const selectedItems = computed(() => {
  const ids = new Set(selectedIds.value);
  return report.value.items.filter((item) => ids.has(item.id));
});
const selectedCount = computed(() => selectedItems.value.length);
const selected = computed(() =>
  selectedCount.value === 1 ? selectedItems.value[0] : null,
);
const selectedTitle = computed(() => {
  if (selectedCount.value > 1) return `${selectedCount.value} objects selected`;
  const names = {
    rect: "Area / rectangle",
    ellipse: "Oval / circular area",
    outline: "Structure outline",
    line: "Line",
    curve: "Curved path",
    freehand: "Freehand drawing",
    label: "Text label",
    symbol: "Inspection mark",
  };
  return selected.value ? names[selected.value.type] || "Selected object" : "Selected object";
});
const selectedTypeSummary = computed(() => {
  const names = {
    rect: "areas",
    ellipse: "ovals",
    outline: "outlines",
    line: "lines",
    curve: "curves",
    freehand: "drawings",
    label: "labels",
    symbol: "marks",
  };
  const counts = {};
  for (const item of selectedItems.value) counts[item.type] = (counts[item.type] || 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${names[type] || 'items'}`)
    .join(' · ');
});
const selectedHasOptionalLabel = computed(() =>
  ["rect", "ellipse", "outline", "line", "curve", "freehand"].includes(selected.value?.type),
);
const selectedSupportsPattern = computed(() =>
  ["rect", "ellipse"].includes(selected.value?.type) ||
  (selected.value?.closed && ["outline", "curve", "freehand"].includes(selected.value?.type)),
);
const selectedSupportsMeasurement = computed(() =>
  ["rect", "ellipse", "outline", "line", "curve"].includes(selected.value?.type),
);
const selectedHiddenMeasurementCount = computed(() =>
  selected.value?.hiddenMeasurements?.length || 0,
);
const selectedSupportsClosedShape = computed(() =>
  ["outline", "curve", "freehand"].includes(selected.value?.type),
);
const selectedSupportsRotation = computed(() =>
  selected.value?.points?.length === 1 && ["label", "symbol"].includes(selected.value?.type),
);
const selectedSupportsCornerTreatment = computed(() =>
  ["rect", "outline", "line"].includes(selected.value?.type),
);
const selectedSupportsPointEditing = computed(() =>
  ["outline", "line"].includes(selected.value?.type),
);
const selectedHasLinkedPoints = computed(() =>
  selectedItems.value.some((item) => (item.pointLinks || []).some(Boolean)),
);
const selectedHasGroup = computed(() =>
  selectedItems.value.some((item) => Boolean(item.groupId)),
);
const selectedStraightLines = computed(() =>
  selectedItems.value.filter((item) => item.type === "line" && item.points?.length === 2),
);
const canCombineSelectedLines = computed(() => selectedStraightLines.value.length >= 2);
const canSplitSelectedLine = computed(() =>
  selectedCount.value === 1 && selected.value?.type === "line" && selected.value.points?.length === 2,
);
const selectedCornerStyle = computed(() => {
  if (!selected.value) return "square";
  if (selected.value.cornerStyle) return selected.value.cornerStyle;
  // v1.3 rounded rectangles did not persist a cornerStyle field.
  return selected.value.type === "rect" && Number(selected.value.cornerRadius || 0) > 0
    ? "round"
    : "square";
});
const cornerSnapStep = computed(() => snapStepForScale(report.value.feetPerSquare));
const snapDistance = computed(() => {
  const scale = Number(report.value.feetPerSquare) || 1;
  return Math.min(1, Math.max(0.1, scale));
});
const snapLabel = computed(() => `${Number(snapDistance.value.toFixed(2))} ${report.value.gridUnit}`);
const formatDistance = (worldValue) => {
  const scaled = (worldValue / GRID.step) * (Number(report.value.feetPerSquare) || 1);
  return Number(scaled.toFixed(2));
};
const symbols = computed(() => [...SYMBOLS, ...report.value.customSymbols]);
const exportErrors = computed(() => statementErrors(report.value));
const history = ref([JSON.stringify(report.value)]),
  historyIndex = ref(0);
const canUndo = computed(() => historyIndex.value > 0),
  canRedo = computed(() => historyIndex.value < history.value.length - 1);
const tools = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V" },
  { id: "outline", label: "Outline", icon: ScanLine, key: "O" },
  { id: "rect", label: "Area", icon: Square, key: "R" },
  { id: "rounded", label: "Rounded", icon: Square, key: "U" },
  { id: "beveled", label: "Bevel", icon: Square, key: "J" },
  { id: "ellipse", label: "Oval", icon: Circle, key: "E" },
  { id: "hatch", label: "Hatch area", icon: Grid2X2, key: "A" },
  { id: "hatchpoly", label: "Hatch polygon", icon: Grid2X2, key: "G" },
  { id: "line", label: "Line", icon: MoveUpRight, key: "L" },
  { id: "curve", label: "Curve", icon: Pencil, key: "C" },
  { id: "curvearea", label: "Curved area", icon: Pencil, key: "K" },
  { id: "freehand", label: "Draw", icon: Pencil, key: "B" },
  { id: "label", label: "Label", icon: Type, key: "T" },
  { id: "point", label: "Point", icon: Circle, key: "P" },
  { id: "pan", label: "Pan", icon: Hand, key: "H" },
];
// Keep the always-visible rail focused on the tools used most during a top-down field sketch.
// Advanced geometry stays one tap away in the inspector instead of filling the whole screen.
const QUICK_TOOL_IDS = new Set(["select", "outline", "line", "rect", "hatch", "label", "pan"]);
const quickTools = tools.filter((item) => QUICK_TOOL_IDS.has(item.id));
const LOCAL_REPORT_PREFIX = "tf-native-report:";

let draftTimer,
  previewTimer,
  toastTimer,
  assetsPromise,
  previewRun = 0,
  pendingAction = null;

function notify(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 4200);
}
function recordHistory() {
  const value = JSON.stringify(report.value);
  if (value === history.value[historyIndex.value]) return;
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(value);
  if (history.value.length > 70) history.value.shift();
  historyIndex.value = history.value.length - 1;
}
function setSelection(ids = [], primaryId = null) {
  const valid = report.value.items
    .map((item) => item.id)
    .filter((id) => ids.includes(id));
  selectedIds.value = [...new Set(valid)];
  selectedId.value =
    primaryId && selectedIds.value.includes(primaryId)
      ? primaryId
      : selectedIds.value.at(-1) || null;
}
function clearSelection() {
  setSelection([]);
}
function undo() {
  recordHistory();
  if (canUndo.value) {
    historyIndex.value--;
    report.value = JSON.parse(history.value[historyIndex.value]);
    clearSelection();
  }
}
function redo() {
  if (canRedo.value) {
    historyIndex.value++;
    report.value = JSON.parse(history.value[historyIndex.value]);
    clearSelection();
  }
}
function changeItems(items) {
  report.value.items = items;
  recordHistory();
}
function setTool(value) {
  tool.value = value;
  error.value = "";
  if (value !== "select") multiSelectMode.value = false;
}
function toggleMultiSelectMode() {
  multiSelectMode.value = !multiSelectMode.value;
}
function toggleInspector() {
  if (globalThis.matchMedia?.("(max-width: 959px)").matches) {
    panelOpen.value = !panelOpen.value;
    return;
  }
  inspectorCollapsed.value = !inspectorCollapsed.value;
}
function toggleCanvasFocus() {
  const enteringFocus = !railCollapsed.value || !inspectorCollapsed.value;
  railCollapsed.value = enteringFocus;
  inspectorCollapsed.value = enteringFocus;
  panelOpen.value = false;
}
function toggleTopUi() {
  topUiCollapsed.value = !topUiCollapsed.value;
  panelOpen.value = false;
}
function toggleTheme() {
  darkMode.value = !darkMode.value;
  try {
    localStorage.setItem("tf-theme", darkMode.value ? "dark" : "light");
  } catch {
    /* Theme persistence is optional when browser storage is restricted. */
  }
}
function resetGraphStyle() {
  report.value.graphStyle = { ...DEFAULT_GRAPH_STYLE };
  recordHistory();
}
function setMasterMeasurements(value) {
  // The toolbar switch is a persistent global display preference. Do not rewrite
  // each object's own visibility flag here: inspectors can keep deliberate per-shape
  // exceptions, and new geometry inherits the current global preference.
  report.value.graphStyle.showMeasurements = value;
  recordHistory();
}
function setAllMeasurements(value) {
  report.value.graphStyle.showMeasurements = value;
  report.value.items = report.value.items.map((item) =>
    ["rect", "ellipse", "outline", "line", "curve"].includes(item.type)
      ? { ...item, showMeasurements: value }
      : item,
  );
  recordHistory();
  notify(value ? "Measurements enabled for all measurable objects." : "Measurements hidden for all objects.");
}
function resetAllMeasurementLayout() {
  // Reflow means one predictable, readable layout. Earlier builds only cleared stored
  // offsets, while the collision solver itself could still move a value several feet
  // from its wall. Restore constrained Smart + Clean mode as part of the recovery.
  report.value.graphStyle.measurementPlacement = "smart";
  report.value.graphStyle.measurementCrowding = "clean";
  report.value.graphStyle.measurementDetail = "simplified";
  report.value.items = report.value.items.map((item) =>
    ["rect", "ellipse", "outline", "line", "curve"].includes(item.type)
      ? {
          ...item,
          measurementOffsets: [],
          hiddenMeasurements: [],
          measurementSideOverrides: [],
          measurementDistance: 0,
          measurementSide: "normal",
        }
      : item,
  );
  recordHistory();
  notify("Dimensions reflowed close to their walls. Crowded values are hidden instead of moved far away.");
}

function setSelectedMeasurements(value) {
  if (!selectedCount.value) return;
  const ids = new Set(selectedIds.value);
  report.value.items = report.value.items.map((item) =>
    ids.has(item.id) && ["rect", "ellipse", "outline", "line", "curve"].includes(item.type)
      ? { ...item, showMeasurements: value }
      : item,
  );
  if (value) report.value.graphStyle.showMeasurements = true;
  recordHistory();
}
function setAllLabels(value) {
  report.value.items = report.value.items.map((item) =>
    ["rect", "ellipse", "outline", "line", "curve", "freehand"].includes(item.type)
      ? { ...item, showLabel: value }
      : item,
  );
  recordHistory();
  notify(value ? "Drawing labels shown." : "Drawing labels hidden.");
}
function selectItemFromPanel(id) {
  setTool("select");
  setSelection([id], id);
}
function itemDisplayName(item) {
  const names = { rect: "Area", ellipse: "Oval", outline: "Outline", line: "Line", curve: "Curve", freehand: "Drawing", label: "Label", symbol: "Mark" };
  return item.text?.trim() || `${names[item.type] || "Object"} ${report.value.items.indexOf(item) + 1}`;
}
function setLineAutoConnect(value) {
  lineAutoConnect.value = value;
  try {
    localStorage.setItem("tf-line-auto-connect", value ? "1" : "0");
  } catch {
    /* Browser storage may be disabled; the drawing session still works. */
  }
}
function breakLineChain() {
  graph.value?.clearLineAnchor();
  notify("Next line starts fresh.");
}
function rotateSelected(delta) {
  if (!selected.value) return;
  const base = Number(selected.value.rotation || 0);
  let next = base + delta;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  selected.value.rotation = next;
  recordHistory();
}
function patchSelectedRotation(value) {
  if (!selected.value) return;
  let next = Number(value);
  if (!Number.isFinite(next)) return;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  selected.value.rotation = next;
  recordHistory();
}
function selectSymbol(symbol) {
  currentSymbol.value = symbol;
  tool.value = "symbol";
  panelOpen.value = false;
}
function patchSelected(field, value) {
  if (selected.value) selected.value[field] = value;
}
function patchSelectedPoint(axis, value) {
  // Position inputs use the selected report's real-world unit so a 2 ft/square graph
  // can still be corrected to exact 1 ft locations instead of square coordinates.
  if (!selected.value || selected.value.points.length !== 1) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const scale = Number(report.value.feetPerSquare) || 1;
  const limit = axis === "x" ? GRID.width : GRID.height;
  const point = { ...selected.value.points[0] };
  point[axis] = Math.max(0, Math.min(limit, (numeric / scale) * GRID.step));
  selected.value.points = [point];
  recordHistory();
}
function pointCoordinateFromDistance(axis, value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const scale = Number(report.value.feetPerSquare) || 1;
  const limit = axis === "x" ? GRID.width : GRID.height;
  let world = (numeric / scale) * GRID.step;
  if (snap.value) {
    const step = snapStepForScale(scale);
    world = Math.round(world / step) * step;
  }
  return clamp(world, 0, limit);
}
function patchSelectedVertex(index, axis, value) {
  if (!selectedSupportsPointEditing.value || !selected.value?.points[index]) return;
  const coordinate = pointCoordinateFromDistance(axis, value);
  if (coordinate === null) return;
  const points = clone(selected.value.points);
  points[index] = { ...points[index], [axis]: coordinate };
  selected.value.points = points;
  recordHistory();
}
function minimumSelectedPointCount() {
  if (!selected.value) return 0;
  return selected.value.type === "outline" && selected.value.closed ? 3 : 2;
}
function canDeleteSelectedVertex() {
  return Boolean(selected.value && selected.value.points.length > minimumSelectedPointCount());
}
function deleteSelectedVertex(index) {
  if (!selectedSupportsPointEditing.value || !canDeleteSelectedVertex()) {
    notify("This object needs its remaining points to stay valid.");
    return;
  }
  const points = clone(selected.value.points);
  const pointLinks = clone(selected.value.pointLinks || []);
  points.splice(index, 1);
  pointLinks.splice(index, 1);
  selected.value.points = points;
  selected.value.pointLinks = pointLinks;
  selected.value.measurementOffsets = [];
  selected.value.hiddenMeasurements = [];
  selected.value.measurementSideOverrides = [];
  recordHistory();
}
function insertSelectedVertexAfter(index) {
  if (!selectedSupportsPointEditing.value || selected.value.points.length >= 6000) return;
  const points = clone(selected.value.points);
  const nextIndex = index + 1;
  const next = points[nextIndex] || (selected.value.closed ? points[0] : null);
  const current = points[index];
  if (!current || !next) return;
  const raw = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
  const step = cornerSnapStep.value;
  const midpoint = snap.value
    ? {
        x: clamp(Math.round(raw.x / step) * step, 0, GRID.width),
        y: clamp(Math.round(raw.y / step) * step, 0, GRID.height),
      }
    : raw;
  if (
    snap.value &&
    [current, next].some((endpoint) => Math.hypot(endpoint.x - midpoint.x, endpoint.y - midpoint.y) < 0.01)
  ) {
    notify("No additional snap point fits on that segment. Lengthen it or turn Snap off first.");
    return;
  }
  points.splice(nextIndex, 0, midpoint);
  const pointLinks = clone(selected.value.pointLinks || []);
  pointLinks.splice(nextIndex, 0, "");
  selected.value.points = points;
  selected.value.pointLinks = pointLinks;
  selected.value.measurementOffsets = [];
  selected.value.hiddenMeasurements = [];
  selected.value.measurementSideOverrides = [];
  recordHistory();
}
function patchSelectedCornerStyle(value) {
  if (!selectedSupportsCornerTreatment.value || !selected.value) return;
  selected.value.cornerStyle = value;
  if (value !== "square" && Number(selected.value.cornerRadius || 0) < 0.5) {
    selected.value.cornerRadius = Math.min(120, cornerSnapStep.value * 2);
  }
  recordHistory();
}
function patchSelectedCornerRadius(value) {
  if (!selectedSupportsCornerTreatment.value || !selected.value) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const step = cornerSnapStep.value;
  selected.value.cornerRadius = clamp(Math.round(numeric / step) * step, 0, 120);
}
function convertSelectedRectToOutline() {
  if (!selected.value || selected.value.type !== "rect") return;
  const box = bounds(selected.value);
  const style = selectedCornerStyle.value;
  selected.value.type = "outline";
  selected.value.points = [
    { x: box.x, y: box.y },
    { x: box.right, y: box.y },
    { x: box.right, y: box.bottom },
    { x: box.x, y: box.bottom },
  ];
  selected.value.closed = true;
  selected.value.cornerStyle = style;
  selected.value.pointLinks = ["", "", "", ""];
  selected.value.measurementOffsets = [];
  selected.value.hiddenMeasurements = [];
  selected.value.measurementSideOverrides = [];
  recordHistory();
  notify("Rectangle converted to an editable 4-point outline.");
}
function resetSelectedLabelPosition() {
  if (!selected.value) return;
  selected.value.labelOffset = { x: 0, y: 0 };
  recordHistory();
  notify("Label returned to its automatic position.");
}
function resetSelectedMeasurementLayout() {
  if (!selected.value) return;
  selected.value.measurementOffsets = [];
  selected.value.hiddenMeasurements = [];
  selected.value.measurementSideOverrides = [];
  selected.value.measurementDistance = 0;
  selected.value.measurementSide = "normal";
  recordHistory();
  notify("Measurement labels returned to automatic positions.");
}
function groupSelected() {
  if (selectedCount.value < 2) return;
  const ids = new Set(selectedIds.value);
  const groupId = uid();
  report.value.items = report.value.items.map((item) =>
    ids.has(item.id) ? { ...item, groupId } : item,
  );
  recordHistory();
  notify(`${selectedCount.value} shapes grouped. Selecting one now selects the group.`);
}
function ungroupSelected() {
  if (!selectedCount.value) return;
  const groupIds = new Set(selectedItems.value.map((item) => item.groupId).filter(Boolean));
  const ids = new Set(selectedIds.value);
  report.value.items = report.value.items.map((item) =>
    ids.has(item.id) || (item.groupId && groupIds.has(item.groupId))
      ? { ...item, groupId: "" }
      : item,
  );
  recordHistory();
  notify("Selected shapes ungrouped.");
}
function mergeSelectedPoints() {
  if (selectedCount.value < 2) {
    notify("Select at least two shapes to join nearby corners.");
    return;
  }
  const ids = new Set(selectedIds.value);
  const entries = selectedItems.value.flatMap((item) =>
    item.points.map((point, pointIndex) => ({
      itemId: item.id,
      pointIndex,
      point,
      currentLink: item.pointLinks?.[pointIndex] || "",
    })),
  );
  const threshold = Math.max(2, cornerSnapStep.value * 1.35);
  const parent = entries.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  for (let a = 0; a < entries.length; a++) {
    for (let b = a + 1; b < entries.length; b++) {
      if (entries[a].itemId === entries[b].itemId) continue;
      if (Math.hypot(entries[a].point.x - entries[b].point.x, entries[a].point.y - entries[b].point.y) <= threshold)
        union(a, b);
    }
  }
  const clusters = new Map();
  entries.forEach((entry, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(entry);
  });
  const welds = [...clusters.values()].filter((cluster) => cluster.length > 1);
  if (!welds.length) {
    notify(`No selected corners were close enough to join.`);
    return;
  }
  const updates = new Map();
  for (const item of selectedItems.value) {
    updates.set(item.id, {
      points: clone(item.points),
      pointLinks: Array.from({ length: item.points.length }, (_, index) => item.pointLinks?.[index] || ""),
    });
  }
  const relink = new Map();
  const linkPositions = new Map();
  for (const cluster of welds) {
    const existingIds = [...new Set(cluster.map((entry) => entry.currentLink).filter(Boolean))];
    const linkId = existingIds[0] || uid();
    // If two already-welded networks are brought together, unify their ids as well
    // as their coordinates so no invisible stale connection remains behind.
    existingIds.forEach((existingId) => relink.set(existingId, linkId));
    let x = cluster.reduce((sum, entry) => sum + entry.point.x, 0) / cluster.length;
    let y = cluster.reduce((sum, entry) => sum + entry.point.y, 0) / cluster.length;
    if (snap.value) {
      const step = cornerSnapStep.value;
      x = Math.round(x / step) * step;
      y = Math.round(y / step) * step;
    }
    const mergedPoint = { x: clamp(x, 0, GRID.width), y: clamp(y, 0, GRID.height) };
    linkPositions.set(linkId, mergedPoint);
    cluster.forEach((entry) => {
      const update = updates.get(entry.itemId);
      update.points[entry.pointIndex] = mergedPoint;
      update.pointLinks[entry.pointIndex] = linkId;
    });
  }
  report.value.items = report.value.items.map((item) => {
    const update = ids.has(item.id) ? updates.get(item.id) : null;
    const points = clone(update?.points || item.points);
    const pointLinks = Array.from(
      { length: points.length },
      (_, index) => update?.pointLinks?.[index] || item.pointLinks?.[index] || "",
    );
    let changed = Boolean(update);
    pointLinks.forEach((currentId, index) => {
      const normalizedId = relink.get(currentId) || currentId;
      if (normalizedId !== currentId) {
        pointLinks[index] = normalizedId;
        changed = true;
      }
      const position = linkPositions.get(normalizedId);
      if (position) {
        points[index] = clone(position);
        changed = true;
      }
    });
    return changed ? { ...item, points, pointLinks } : item;
  });
  recordHistory();
  notify(`${welds.length} nearby corner ${welds.length === 1 ? "join" : "joins"} created.`);
}
function combineOverlappingLines() {
  const lines = selectedStraightLines.value;
  if (lines.length < 2) {
    notify("Select at least two straight lines that overlap or touch.");
    return;
  }

  const tolerance = Math.max(1.5, cornerSnapStep.value * 0.35);
  const parent = lines.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const compatibleStyle = (a, b) =>
    a.color === b.color && Math.abs(Number(a.width || 0) - Number(b.width || 0)) < 0.01;
  const overlapsOnSameLine = (a, b) => {
    if (!compatibleStyle(a, b)) return false;
    const [a0, a1] = a.points;
    const dx = a1.x - a0.x;
    const dy = a1.y - a0.y;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return false;
    const ux = dx / length;
    const uy = dy / length;
    const distanceToLine = (point) => Math.abs((point.x - a0.x) * uy - (point.y - a0.y) * ux);
    if (b.points.some((point) => distanceToLine(point) > tolerance)) return false;
    const projection = (point) => (point.x - a0.x) * ux + (point.y - a0.y) * uy;
    const values = b.points.map(projection);
    const bMin = Math.min(...values);
    const bMax = Math.max(...values);
    return bMax >= -tolerance && bMin <= length + tolerance;
  };

  for (let a = 0; a < lines.length; a++) {
    for (let b = a + 1; b < lines.length; b++) {
      if (overlapsOnSameLine(lines[a], lines[b])) union(a, b);
    }
  }

  const clusters = new Map();
  lines.forEach((line, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(line);
  });
  const mergeable = [...clusters.values()].filter((cluster) => cluster.length > 1);
  if (!mergeable.length) {
    notify("No selected lines overlap on the same path. Lines with different thickness or color stay separate.");
    return;
  }

  const replacements = new Map();
  const removals = new Set();
  const keepSelected = [];
  for (const cluster of mergeable) {
    const base = cluster[0];
    const [origin, end] = base.points;
    const dx = end.x - origin.x;
    const dy = end.y - origin.y;
    const length = Math.max(0.01, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const candidates = cluster.flatMap((line) =>
      line.points.map((point, pointIndex) => ({
        point,
        pointIndex,
        line,
        t: (point.x - origin.x) * ux + (point.y - origin.y) * uy,
      })),
    );
    const low = candidates.reduce((best, entry) => (entry.t < best.t ? entry : best));
    const high = candidates.reduce((best, entry) => (entry.t > best.t ? entry : best));
    const snapPoint = (point) => {
      if (!snap.value) return { x: clamp(point.x, 0, GRID.width), y: clamp(point.y, 0, GRID.height) };
      const step = cornerSnapStep.value;
      return {
        x: clamp(Math.round(point.x / step) * step, 0, GRID.width),
        y: clamp(Math.round(point.y / step) * step, 0, GRID.height),
      };
    };
    const start = snapPoint({ x: origin.x + ux * low.t, y: origin.y + uy * low.t });
    const finish = snapPoint({ x: origin.x + ux * high.t, y: origin.y + uy * high.t });
    const firstLabel = cluster.find((line) => line.text?.trim())?.text || base.text || "";
    replacements.set(base.id, {
      ...clone(base),
      points: [start, finish],
      pointLinks: [
        low.line.pointLinks?.[low.pointIndex] || "",
        high.line.pointLinks?.[high.pointIndex] || "",
      ],
      text: firstLabel,
      measurementOffsets: [],
      hiddenMeasurements: [],
      measurementSideOverrides: [],
    });
    cluster.slice(1).forEach((line) => removals.add(line.id));
    keepSelected.push(base.id);
  }

  report.value.items = report.value.items
    .filter((item) => !removals.has(item.id))
    .map((item) => replacements.get(item.id) || item);
  setSelection(keepSelected, keepSelected.at(-1) || null);
  recordHistory();
  notify(`${mergeable.length} overlapping wall ${mergeable.length === 1 ? "run" : "runs"} combined. Undo restores the original lines.`);
}
function splitSelectedLength() {
  if (!canSplitSelectedLine.value) {
    notify("Select one straight line to split its length into two measurements.");
    return;
  }
  insertSelectedVertexAfter(0);
  notify("Length split into two measurable sections. Drag the new center point to adjust the split.");
}
function unmergeSelectedPoints() {
  if (!selectedCount.value) return;
  const linkIds = new Set(
    selectedItems.value.flatMap((item) => (item.pointLinks || []).filter(Boolean)),
  );
  if (!linkIds.size) {
    notify("The selected shapes do not contain joined corners.");
    return;
  }
  report.value.items = report.value.items.map((item) => ({
    ...item,
    pointLinks: (item.pointLinks || []).map((id) => (linkIds.has(id) ? "" : id)),
  }));
  recordHistory();
  notify("Joined corners released.");
}
function handleGraphQuickAction(action) {
  if (action === "delete") deleteSelected();
  else if (action === "duplicate") duplicateSelected();
  else if (action === "combine-lines") combineOverlappingLines();
  else if (action === "split-line") splitSelectedLength();
  else if (action === "reset-measurements") resetAllMeasurementLayout();
}
function deleteSelected() {
  if (!selectedCount.value) return;
  const ids = new Set(selectedIds.value);
  report.value.items = report.value.items.filter((item) => !ids.has(item.id));
  clearSelection();
  recordHistory();
}
function duplicateSelected() {
  if (!selectedCount.value) return;

  // A duplicated group must be independent from the source group. The same is
  // true for welded point ids: keeping the old ids would make editing the copy
  // unexpectedly move vertices in the original geometry. Preserve relationships
  // *within* the copied selection by remapping each relationship to a fresh id.
  const groupIds = new Map();
  const pointLinkIds = new Map();
  const duplicates = selectedItems.value.map((item) => {
    const copy = clone(item);
    copy.id = uid();
    copy.points = translatePoints(copy.points, 20, 20);

    if (copy.groupId) {
      if (!groupIds.has(copy.groupId)) groupIds.set(copy.groupId, uid());
      copy.groupId = groupIds.get(copy.groupId);
    }

    copy.pointLinks = (copy.pointLinks || []).map((linkId) => {
      if (!linkId) return "";
      if (!pointLinkIds.has(linkId)) pointLinkIds.set(linkId, uid());
      return pointLinkIds.get(linkId);
    });

    return copy;
  });
  report.value.items.push(...duplicates);
  setSelection(duplicates.map((item) => item.id), duplicates.at(-1)?.id || null);
  recordHistory();
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
async function exportPortableText(text, name, contentType = "application/json") {
  error.value = "";

  // Installed Android builds bypass WebView downloads entirely. MediaStore gives us
  // a positive success/failure result and makes the backup visible in Files > Downloads.
  if (canUseNativeAndroidFileSave()) {
    try {
      const result = await saveTextToAndroidDownloads(text, name, contentType);
      if (result?.saved) {
        notify(`Backup saved to Downloads/Termite Fieldbook/${name}`);
        return true;
      }
      if (result?.cancelled) return false;
      throw new Error("Android did not confirm the backup write.");
    } catch (nativeError) {
      console.error("Direct Android backup save failed:", nativeError);
      try {
        const fallback = await saveTextWithNativeAndroidPicker(text, name, contentType);
        if (fallback?.cancelled) return false;
        if (fallback?.saved) {
          notify("Backup saved to the location you selected.");
          return true;
        }
      } catch (pickerError) {
        console.error("Android backup picker fallback failed:", pickerError);
      }
      error.value =
        "Android could not write the backup. Run ./scripts/run-android.sh once so the current native file saver is installed, then try again.";
      return false;
    }
  }

  const blob = new Blob([text], { type: contentType });

  // Desktop Chromium can give a true save confirmation without a server.
  if (typeof globalThis.showSaveFilePicker === "function") {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: "Termite Fieldbook backup",
            accept: { [contentType]: [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      notify(`Backup saved as ${name}`);
      return true;
    } catch (pickerError) {
      if (pickerError?.name === "AbortError") return false;
      // Continue to the share/download paths when this browser exposes the API but
      // does not allow it in the current context.
    }
  }

  // iPhone/iPad Safari and Home Screen web apps can hand a real JSON File to the
  // system share sheet. Choosing Save to Files gives the technician an explicit,
  // inspectable backup location with no report server involved.
  try {
    const file = new File([blob], name, { type: contentType });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: "Termite Fieldbook backup" });
      notify("Backup opened in the system share sheet. Choose Save to Files to keep a copy.");
      return true;
    }
  } catch (shareError) {
    if (shareError?.name === "AbortError") return false;
  }

  // Standard browser fallback. Browsers control the final Downloads directory, so
  // say that the download started rather than falsely claiming a path was written.
  download(text, name, contentType);
  notify(`Backup download started: ${name}`);
  return true;
}
async function savePreparedPdf(destination = "downloads") {
  if (!preparedPdf.value) return false;
  const name = `${filename()}.pdf`;
  const blob = new Blob([preparedPdf.value.bytes], { type: "application/pdf" });

  // Export is intentionally independent from report Save. The current in-memory
  // inspection is rendered first, then Android writes that exact PDF to Downloads.
  if (canUseNativeAndroidFileSave()) {
    try {
      const result = destination === "picker"
        ? await savePdfWithNativeAndroidPicker(preparedPdf.value.bytes, name)
        : await savePdfToAndroidDownloads(preparedPdf.value.bytes, name);

      if (result?.cancelled) {
        notify("PDF save cancelled.");
        return false;
      }
      if (result?.saved) {
        error.value = "";
        notify(
          destination === "picker"
            ? "PDF saved to the selected location."
            : "PDF saved in Downloads/Termite Fieldbook.",
        );
        return true;
      }
      throw new Error("Android did not confirm that the PDF was saved.");
    } catch (nativeError) {
      console.error("Native Android PDF save failed:", nativeError);

      // Older native projects may have the picker method but not the new direct
      // Downloads method yet. Fall back once so exporting still works before the
      // user reruns the Android sync script.
      if (destination !== "picker") {
        try {
          const fallback = await savePdfWithNativeAndroidPicker(preparedPdf.value.bytes, name);
          if (fallback?.cancelled) {
            notify("PDF save cancelled.");
            return false;
          }
          if (fallback?.saved) {
            error.value = "";
            notify("Direct Downloads save was unavailable, so Android used the file picker instead.");
            return true;
          }
        } catch (pickerError) {
          console.error("Android PDF picker fallback failed:", pickerError);
        }
      }

      error.value =
        "Android could not save the PDF. Run ./scripts/run-android.sh once so the updated native file saver is installed, then export again.";
      return false;
    }
  }

  // Prefer a real save picker in desktop browsers that expose the File System
  // Access API. This branch is normally skipped inside the Android application.
  if (typeof globalThis.showSaveFilePicker === "function") {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: name,
        types: [
          {
            description: "PDF document",
            accept: { "application/pdf": [".pdf"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      error.value = "";
      notify("PDF saved to your device.");
      return true;
    } catch (e) {
      if (e?.name === "AbortError") return false;
      // Some browsers expose the API but reject it for their current context.
      // Continue into the share/download fallbacks rather than losing the PDF.
    }
  }

  try {
    const file = new File([blob], name, { type: "application/pdf" });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: report.value.title });
      error.value = "";
      notify("PDF sent to your device's save/share sheet.");
      return true;
    }
  } catch (e) {
    if (e?.name === "AbortError") return false;
  }

  download(preparedPdf.value.bytes, name, "application/pdf");
  notify("PDF download started.");
  return true;
}

function filename() {
  return (
    report.value.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") ||
    "termite-inspection"
  );
}
async function backup() {
  const normalized = reportSchema.safeParse(report.value);
  const backupReport = normalized.success ? normalized.data : report.value;
  const name = `${filename()}.termite.json`;
  const text = JSON.stringify(
    { application: "Termite Fieldbook", report: backupReport },
    null,
    2,
  );
  return exportPortableText(text, name, "application/json");
}
async function backupAllSaves() {
  const reports = localReportRecords()
    .map((record) => readLocalReport(record.id))
    .filter(Boolean);
  const current = reportSchema.safeParse(report.value);
  if (current.success) {
    // Always place the live in-memory report into the bundle, even if an older device
    // save with the same id already exists. Export All is also an emergency offload
    // path for unsaved field edits when the optional report server is unavailable.
    const currentIndex = reports.findIndex((entry) => entry.report.id === current.data.id);
    if (currentIndex >= 0) reports.splice(currentIndex, 1);
    reports.unshift({
      report: current.data,
      revision: revision.value,
      updatedAt: new Date().toISOString(),
    });
  }
  const name = `termite-fieldbook-saves-${localDate()}.json`;
  const text = JSON.stringify(
    {
      application: "Termite Fieldbook",
      format: "termite-fieldbook-backup-bundle",
      bundleVersion: 1,
      exportedAt: new Date().toISOString(),
      reports,
      credentialProfiles: credentialProfiles.value,
      noteTemplates: noteTemplates.value,
    },
    null,
    2,
  );
  const exported = await exportPortableText(text, name, "application/json");
  if (exported && !canUseNativeAndroidFileSave()) {
    // The platform-specific helper already gives the important location/action.
    console.info(`Exported ${reports.length} Fieldbook inspection backup(s).`);
  }
  return exported;
}
async function request(path, options = {}) {
  // Allow field-save calls to fail over to the already-written local copy quickly
  // without making every report-service request use the shorter timeout.
  const { timeoutMs = 20000, ...fetchOptions } = options;
  const response = await fetch(path, {
    ...fetchOptions,
    signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The report service did not respond. Your work is still here.",
    );
  }
  if (!response.ok) {
    const requestError = new Error(data.error || "The request failed. Please try again.");
    requestError.status = response.status;
    throw requestError;
  }
  return data;
}
function persistFieldPresets() {
  try {
    localStorage.setItem("tf-credential-profiles", JSON.stringify(credentialProfiles.value));
    localStorage.setItem("tf-note-templates", JSON.stringify(noteTemplates.value));
  } catch {
    notify("This browser could not save field presets locally.");
  }
}
function beginCredentialSave(role) {
  const statement = report.value[role];
  if (!statement.name.trim() && !statement.certificate.trim() && !statement.signature.length) {
    notify("Add a name, certification number, or signature before saving credentials.");
    return;
  }
  presetDraft.value = { title: statement.name.trim() || "Technician", role };
  modal.value = "save-credential";
}
function saveCredentialPreset() {
  const role = presetDraft.value.role;
  const statement = report.value[role];
  const title = presetDraft.value.title.trim();
  if (!title) return;
  credentialProfiles.value.push({
    id: uid(),
    title,
    name: statement.name,
    certificate: statement.certificate,
    signature: clone(statement.signature),
  });
  persistFieldPresets();
  modal.value = null;
  notify(`Saved ${title} for future inspections on this device.`);
}
function applyCredentialPreset({ role, id }) {
  const profile = credentialProfiles.value.find((entry) => entry.id === id);
  if (!profile || !report.value[role]) return;
  report.value[role] = {
    ...report.value[role],
    name: profile.name,
    certificate: profile.certificate,
    signature: clone(profile.signature),
    date: report.value[role].date || localDate(),
  };
  recordHistory();
  notify(`Applied ${profile.title}.`);
}
function beginNoteTemplateSave(role) {
  if (!report.value[role].notes.trim()) return;
  presetDraft.value = { title: "", role };
  modal.value = "save-note-template";
}
function saveNoteTemplatePreset() {
  const role = presetDraft.value.role;
  const title = presetDraft.value.title.trim();
  if (!title) return;
  noteTemplates.value.push({
    id: uid(),
    title,
    role,
    text: report.value[role].notes.trim(),
  });
  persistFieldPresets();
  modal.value = null;
  notify(`Saved note template “${title}”.`);
}
function deleteCredentialPreset(id) {
  credentialProfiles.value = credentialProfiles.value.filter((entry) => entry.id !== id);
  persistFieldPresets();
}
function deleteNoteTemplate(id) {
  noteTemplates.value = noteTemplates.value.filter((entry) => entry.id !== id);
  persistFieldPresets();
}

function localReportKey(id) {
  return `${LOCAL_REPORT_PREFIX}${id}`;
}
function normalizeLocalReportEnvelope(value, fallbackId = "") {
  if (!value || typeof value !== "object") return null;
  const candidate = value.report || value;
  const parsed = reportSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const reportValue = parsed.data;
  if (fallbackId && reportValue.id !== fallbackId) return null;
  return {
    report: reportValue,
    revision: Number.isInteger(value.revision) && value.revision >= 0 ? value.revision : 0,
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : typeof value.updated_at === "string"
          ? value.updated_at
          : `${reportValue.date || localDate()}T12:00:00.000Z`,
  };
}
function readLocalReport(id) {
  try {
    const raw = localStorage.getItem(localReportKey(id));
    if (!raw) return null;
    return normalizeLocalReportEnvelope(JSON.parse(raw), id);
  } catch {
    return null;
  }
}
function localReportRecords() {
  const entries = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(LOCAL_REPORT_PREFIX)) continue;
      const id = key.slice(LOCAL_REPORT_PREFIX.length);
      const envelope = readLocalReport(id);
      if (!envelope) continue;
      entries.push({
        id: envelope.report.id,
        title: envelope.report.title,
        address: envelope.report.street,
        revision: envelope.revision,
        updated_at: envelope.updatedAt,
        source: "device",
      });
    }
  } catch {
    return [];
  }
  return entries.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}
function persistLocalReportEnvelope(snapshot, serverRevision = revision.value, updatedAt = new Date().toISOString()) {
  try {
    localStorage.setItem(
      localReportKey(snapshot.id),
      JSON.stringify({
        application: "Termite Fieldbook",
        storage: "device",
        report: snapshot,
        revision: serverRevision,
        updatedAt,
      }),
    );
    return updatedAt;
  } catch {
    return null;
  }
}
function persistLocalReport(snapshot, serverRevision = revision.value) {
  const savedAt = persistLocalReportEnvelope(snapshot, serverRevision);
  if (savedAt) deviceSavedAt.value = savedAt;
  return savedAt;
}
function clearSavedDraft(id) {
  clearTimeout(draftTimer);
  try {
    localStorage.removeItem(`tf-draft:${id}`);
  } catch {
    /* Device-local report saving does not depend on draft cleanup. */
  }
}
function mergeReportRecords(serverRecords, deviceRecords) {
  const merged = new Map();
  for (const record of serverRecords || []) merged.set(record.id, { ...record, source: "server" });
  for (const record of deviceRecords || []) {
    const current = merged.get(record.id);
    if (!current || new Date(record.updated_at) > new Date(current.updated_at)) merged.set(record.id, record);
  }
  return [...merged.values()].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
}

function stashDraft() {
  if (!dirty.value) return;
  try {
    localStorage.setItem(
      `tf-draft:${report.value.id}`,
      JSON.stringify({
        report: report.value,
        revision: revision.value,
        savedSnapshot: savedSnapshot.value,
        time: Date.now(),
      }),
    );
  } catch {
    error.value =
      "Automatic draft recovery is unavailable. Save your report or export an editable backup.";
  }
}
async function save() {
  if (busy.value) return false;
  error.value = "";
  graph.value?.finishOutline();
  const result = reportSchema.safeParse(report.value);
  if (!result.success) {
    error.value = result.error.issues[0].message;
    return false;
  }
  busy.value = true;
  const snapshot = clone(result.data);
  // Keep the live editor on the same normalized object that gets persisted. This
  // repairs any null/sparse legacy annotation arrays immediately instead of leaving
  // the report marked dirty again right after a successful Save.
  report.value = clone(snapshot);
  const localSavedAt = persistLocalReport(snapshot, revision.value);
  try {
    const data = await request(`/api/reports/${snapshot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report: snapshot,
        expectedRevision: revision.value,
      }),
      // The device copy was already written above. Do not leave technicians
      // staring at a spinner for 20 seconds when the optional API is offline.
      timeoutMs: 6000,
    });
    revision.value = data.revision;
    persistLocalReport(snapshot, revision.value);
    savedSnapshot.value = JSON.stringify(snapshot);
    clearSavedDraft(snapshot.id);
    notify("Inspection saved on this device and synced.");
    return true;
  } catch (e) {
    if (localSavedAt && e?.status === 409) {
      savedSnapshot.value = JSON.stringify(snapshot);
      clearSavedDraft(snapshot.id);
      error.value = `${e.message} Your current version is safely saved on this device.`;
      return false;
    }
    if (localSavedAt) {
      // A field device must still have a real Save operation when the optional report
      // service is offline. Keep the server revision unchanged so a later sync can use
      // optimistic concurrency safely instead of pretending the server accepted it.
      savedSnapshot.value = JSON.stringify(snapshot);
      clearSavedDraft(snapshot.id);
      error.value = "";
      notify("Inspection saved on this device. Server sync is currently unavailable.");
      return true;
    }
    error.value = `${e.message} Device storage was also unavailable; export an editable backup before leaving this page.`;
    stashDraft();
    return false;
  } finally {
    busy.value = false;
  }
}
function replaceReport(value, newRevision = 0, snapshot = null) {
  clearTimeout(draftTimer);
  graph.value?.cancel();
  // Parsing here also upgrades older v1 backups with new default drawing settings.
  const normalized = reportSchema.parse(value);
  report.value = clone(normalized);
  revision.value = newRevision;
  deviceSavedAt.value = snapshot ? new Date().toISOString() : "";
  savedSnapshot.value = snapshot || JSON.stringify(normalized);
  history.value = [JSON.stringify(normalized)];
  historyIndex.value = 0;
  clearSelection();
  // Reopened/imported drawings start in Select so existing marks are immediately editable.
  // A genuinely blank report still starts in Outline for the normal drawing workflow.
  tool.value = normalized.items.length ? "select" : "outline";
  error.value = "";
  tab.value = "graph";
  modal.value = null;
  nextTick(() => graph.value?.fit());
}
function guard(action) {
  graph.value?.finishOutline();
  if (busy.value) {
    notify("Wait for the current save to finish.");
    return;
  }
  if (dirty.value) {
    stashDraft();
    pendingAction = action;
    modal.value = "confirm";
  } else action();
}
async function continueAction(saveFirst) {
  if (saveFirst && !(await save())) return;
  const action = pendingAction;
  pendingAction = null;
  modal.value = null;
  action?.();
}
function newReport(sample = false) {
  guard(() => {
    replaceReport(sample ? sampleReport() : blankReport());
    if (sample) {
      savedSnapshot.value = "";
      notify(
        "Example loaded. Replace the example before recording an inspection.",
      );
    }
  });
}
async function openRecords() {
  modal.value = "reports";
  loadingRecords.value = true;
  error.value = "";
  const deviceRecords = localReportRecords();
  try {
    const serverRecords = (await request("/api/reports")).reports;
    records.value = mergeReportRecords(serverRecords, deviceRecords);
  } catch {
    records.value = deviceRecords;
    if (deviceRecords.length) notify("Report service unavailable; showing inspections saved on this device.");
    else error.value = "No device-saved inspections were found, and the report service is unavailable.";
  } finally {
    loadingRecords.value = false;
  }
}
async function loadRecord(record) {
  const id = typeof record === "string" ? record : record.id;
  const local = readLocalReport(id);
  if (record?.source === "device" && local) {
    // readLocalReport() parses through the latest schema. Write that normalized
    // copy back immediately so opening an older save upgrades it in place while
    // preserving its report id, revision, and original saved timestamp.
    persistLocalReportEnvelope(local.report, local.revision, local.updatedAt);
    guard(() => replaceReport(local.report, local.revision));
    return;
  }
  try {
    const data = await request(`/api/reports/${id}`);
    const parsed = reportSchema.parse(data.report);
    // Keep a device mirror whenever a server record is opened successfully.
    persistLocalReport(parsed, data.revision);
    guard(() => replaceReport(parsed, data.revision));
  } catch (e) {
    if (local) {
      notify("Report service unavailable; opened the device-saved copy instead.");
      guard(() => replaceReport(local.report, local.revision));
      return;
    }
    error.value = e.message;
  }
}
async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 25_000_000) {
    error.value = "Choose a Fieldbook backup smaller than 25 MB.";
    return;
  }
  try {
    const value = JSON.parse(await file.text());
    if (value?.format === "termite-fieldbook-backup-bundle" && Array.isArray(value.reports)) {
      let importedCount = 0;
      for (const envelopeValue of value.reports) {
        const envelope = normalizeLocalReportEnvelope(envelopeValue);
        if (!envelope) continue;
        if (
          persistLocalReportEnvelope(
            envelope.report,
            envelope.revision,
            envelope.updatedAt || new Date().toISOString(),
          )
        ) importedCount++;
      }
      if (Array.isArray(value.credentialProfiles)) credentialProfiles.value = clone(value.credentialProfiles);
      if (Array.isArray(value.noteTemplates)) noteTemplates.value = clone(value.noteTemplates);
      persistFieldPresets();
      if (!importedCount) throw new Error("This backup bundle did not contain any valid Fieldbook inspections.");
      records.value = mergeReportRecords(records.value.filter((record) => record.source !== "device"), localReportRecords());
      notify(`${importedCount} inspection ${importedCount === 1 ? "backup" : "backups"} imported to this device.`);
      return;
    }
    const result = reportSchema.safeParse(value.report || value);
    if (!result.success) throw new Error("This is not a valid Fieldbook report backup.");
    const imported = { ...result.data, id: uid() };
    guard(() => {
      replaceReport(imported);
      savedSnapshot.value = "";
      notify("Backup imported as a new report. Save to keep it across devices.");
    });
  } catch (e) {
    error.value = e.message;
  }
}

function restoreDraft() {
  if (!recovery.value) return;
  const draft = recovery.value;
  replaceReport(draft.report, draft.revision, draft.savedSnapshot);
  recovery.value = null;
  notify("Unsaved draft restored.");
}
function dismissRecovery() {
  try {
    localStorage.removeItem(`tf-draft:${recovery.value.report.id}`);
  } catch {}
  recovery.value = null;
}
async function buildPreview() {
  const run = ++previewRun;
  busyPdf.value = true;
  error.value = "";
  try {
    const pdf = await import("./lib/pdf.js");
    assetsPromise ??= pdf.loadPrintAssets().catch((e) => {
      assetsPromise = null;
      throw e;
    });
    const assets = await assetsPromise;
    const result = await pdf.createFormPdf(
      clone(report.value),
      assets,
      { paper: paper.value, monochrome: monochrome.value },
    );
    if (run === previewRun) pages.value = result.overlays;
    return result;
  } catch (e) {
    if (run === previewRun) {
      pages.value = [];
      error.value = e.message;
    }
    return null;
  } finally {
    if (run === previewRun) busyPdf.value = false;
  }
}
async function exportPdf() {
  if (exportErrors.value.length) return;
  const result = await buildPreview();
  if (!result) return;
  preparedPdf.value = result;

  // Mobile export is one action: generate the current unsaved view and immediately
  // hand it to the native Downloads/share flow. Saving the inspection is not required.
  if (mobileFileFlow.value) {
    await savePreparedPdf("downloads");
    return;
  }

  download(result.bytes, `${filename()}.pdf`, "application/pdf");
  modal.value = null;
  notify(`${result.pageCount}-page PDF downloaded.`);
}
function openExport() {
  graph.value?.finishOutline();
  preparedPdf.value = null;
  modal.value = "export";
}
function addCustom() {
  const text = custom.value.text.trim(),
    title = custom.value.title.trim();
  if (!text || !title) return;
  if (report.value.customSymbols.length >= 30) {
    error.value = "This report already has 30 custom symbols.";
    return;
  }
  const symbol = {
    key: `custom-${uid().slice(0, 8)}`,
    text,
    title,
    color: "#183b42",
  };
  report.value.customSymbols.push(symbol);
  recordHistory();
  custom.value = { title: "", text: "" };
  modal.value = null;
  selectSymbol(symbol);
}
function keyboard(event) {
  const input = event.target.closest("input,textarea,select,[contenteditable]");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
    return;
  }
  if (modal.value || input) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (["Delete", "Backspace"].includes(event.key) && selectedCount.value) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (!event.ctrlKey && !event.metaKey) {
    const match = tools.find(
      (t) => t.key.toLowerCase() === event.key.toLowerCase(),
    );
    if (match && tab.value === "graph") setTool(match.id);
  }
}
function leave(event) {
  graph.value?.finishOutline();
  stashDraft();
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function visibility() {
  if (document.visibilityState === "hidden") stashDraft();
}
watch(
  report,
  () => {
    preparedPdf.value = null;
    clearTimeout(draftTimer);
    draftTimer = setTimeout(stashDraft, 450);
  },
  { deep: true },
);
watch(
  tab,
  (value) => {
    if (value !== "graph") {
      graph.value?.finishOutline();
      topUiCollapsed.value = false;
    }
  },
  { flush: "sync" },
);
watch([() => JSON.stringify(report.value), paper, monochrome, tab], () => {
  if (tab.value === "preview") {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(buildPreview, 300);
  }
});
watch([selectedId, selectedCount], async () => {
  if (selectedCount.value === 1 && selected.value?.type === "label") {
    panelOpen.value = true;
    inspectorCollapsed.value = false;
    await nextTick();
    labelInput.value?.focus();
    labelInput.value?.select();
  }
});
onMounted(() => {
  try {
    const savedTheme = localStorage.getItem("tf-theme");
    darkMode.value = savedTheme
      ? savedTheme === "dark"
      : globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
    lineAutoConnect.value = localStorage.getItem("tf-line-auto-connect") !== "0";
    credentialProfiles.value = JSON.parse(localStorage.getItem("tf-credential-profiles") || "[]");
    noteTemplates.value = JSON.parse(localStorage.getItem("tf-note-templates") || "[]");
    const drafts = Object.keys(localStorage)
      .filter((k) => k.startsWith("tf-draft:"))
      .flatMap((k) => {
        try {
          const draft = JSON.parse(localStorage.getItem(k));
          return reportSchema.safeParse(draft.report).success ? [draft] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.time - a.time);
    recovery.value = drafts[0] || null;
  } catch {
    /* Restricted browsers may disable draft recovery; server saving still works. */
  }
  mobileFileFlow.value = navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  window.addEventListener("keydown", keyboard);
  window.addEventListener("beforeunload", leave);
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  clearTimeout(draftTimer);
  clearTimeout(previewTimer);
  clearTimeout(toastTimer);
  window.removeEventListener("keydown", keyboard);
  window.removeEventListener("beforeunload", leave);
  document.removeEventListener("visibilitychange", visibility);
});
</script>

<template>
  <div class="app-shell" :class="{ 'theme-dark': darkMode, 'top-ui-collapsed': topUiCollapsed && tab === 'graph' }">
    <header class="app-header">
      <a href="/" class="brand" @click.prevent="tab = 'graph'"
        ><span class="brand-icon company-brand-icon"><img src="/company-logo.png" alt="Apple's Environmental Pest Management Solutions" /></span
        ><span>Fieldbook<small>TERMITE INSPECTIONS</small></span></a
      >
      <div class="document-title">
        <input
          v-model="report.title"
          aria-label="Report title"
          maxlength="80"
          @change="recordHistory"
        /><span
          class="save-status"
          :class="{ 'is-saved': revision && !dirty }"
          >{{
            busy
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : revision
                  ? "Saved + synced"
                  : deviceSavedAt
                    ? "Saved on device"
                    : "New inspection"
          }}</span
        >
      </div>
      <div class="header-actions">
        <button
          class="icon-button"
          title="Saved inspections"
          aria-label="Open saved inspections"
          @click="openRecords"
        >
          <FolderOpen :size="20" /></button
        ><button class="btn btn-secondary" :disabled="busy" @click="save">
          <LoaderCircle v-if="busy" :size="17" class="spin" /><Save
            v-else
            :size="17"
          /><span>Save</span></button
        ><button class="btn btn-primary" @click="openExport">
          <ArrowDownToLine :size="18" /><span>Export PDF</span>
        </button>
      </div>
    </header>

    <div v-if="recovery" class="recovery-bar">
      <span
        >Unsaved draft found: <strong>{{ recovery.report.title }}</strong></span
      >
      <div>
        <button @click="restoreDraft">Restore draft</button
        ><button aria-label="Dismiss recovered draft" @click="dismissRecovery">
          <X :size="16" />
        </button>
      </div>
    </div>
    <div v-if="error" class="error-bar" role="alert">
      <span>{{ error }}</span
      ><button
        class="icon-button"
        aria-label="Dismiss error"
        @click="error = ''"
      >
        <X :size="18" />
      </button>
    </div>

    <div class="workspace-nav">
      <nav class="view-tabs" aria-label="Inspection views">
        <button
          :class="{ active: tab === 'graph' }"
          :aria-current="tab === 'graph' ? 'page' : undefined"
          @click="tab = 'graph'"
        >
          <Grid2X2 :size="17" /> Graph</button
        ><button
          :class="{ active: tab === 'notes' }"
          :aria-current="tab === 'notes' ? 'page' : undefined"
          @click="tab = 'notes'"
        >
          <ClipboardList :size="17" /> Details & notes<span class="tab-count"
            >2</span
          ></button
        ><button
          :class="{ active: tab === 'preview' }"
          :aria-current="tab === 'preview' ? 'page' : undefined"
          @click="tab = 'preview'"
        >
          <FileText :size="17" /> Print preview
        </button>
      </nav>
      <div class="nav-utilities">
        <button
          class="icon-button"
          :title="darkMode ? 'Use light mode' : 'Use dark mode'"
          :aria-label="darkMode ? 'Use light mode' : 'Use dark mode'"
          @click="toggleTheme"
        >
          <Sun v-if="darkMode" :size="19" />
          <Moon v-else :size="19" />
        </button>
        <button class="text-button" @click="modal = 'new'">
          <Plus :size="16" /> New inspection</button
        ><button
          class="icon-button"
          aria-label="Drawing help"
          @click="modal = 'help'"
        >
          <HelpCircle :size="19" />
        </button>
      </div>
    </div>

    <main
      v-if="tab === 'graph'"
      class="drawing-workspace"
      :class="{ 'rail-collapsed': railCollapsed, 'inspector-collapsed': inspectorCollapsed }"
    >
      <aside class="tool-rail" aria-label="Drawing tools">
        <button
          class="rail-collapse-control"
          :title="railCollapsed ? 'Show drawing tools' : 'Collapse drawing tools'"
          :aria-label="railCollapsed ? 'Show drawing tools' : 'Collapse drawing tools'"
          @click="railCollapsed = !railCollapsed"
        >
          <ArrowRight v-if="railCollapsed" :size="19" />
          <ArrowLeft v-else :size="19" />
          <span>{{ railCollapsed ? 'Tools' : 'Hide' }}</span>
        </button>
        <button
          v-for="item in quickTools"
          v-show="!railCollapsed"
          :key="item.id"
          :class="{ active: tool === item.id }"
          :aria-pressed="tool === item.id"
          :title="`${item.label} (${item.key})`"
          @click="setTool(item.id)"
        >
          <component :is="item.icon" :size="21" /><span>{{ item.label }}</span>
        </button>
        <div v-show="!railCollapsed" class="rail-divider"></div>
        <button
          v-show="!railCollapsed"
          :disabled="!canUndo"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          @click="undo"
        >
          <Undo2 :size="20" /><span>Undo</span></button
        ><button
          v-show="!railCollapsed"
          :disabled="!canRedo"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          @click="redo"
        >
          <Redo2 :size="20" /><span>Redo</span>
        </button>
      </aside>
      <section class="canvas-column">
        <div class="canvas-toolbar">
          <div class="flex items-center gap-2">
            <span class="eyebrow">DRAWING</span
            ><span class="tool-name">{{
              tool === "symbol"
                ? currentSymbol.title
                : tool === "garage"
                  ? "Garage"
                  : tool === "crawlspace"
                    ? "Crawlspace"
                    : tools.find((t) => t.id === tool)?.label
            }}</span>
            <span v-if="tool === 'line'" class="repeat-tool-badge">REPEAT · ESC TO FINISH</span>
            <span v-if="tool === 'curve'" class="repeat-tool-badge">DRAW CURVES · EDIT TO CLOSE / HATCH</span>
          </div>
          <button
            class="toolbar-pill top-collapse-action"
            title="Hide the app header and graph controls"
            @click="toggleTopUi"
          >
            <ChevronDown :size="15" class="collapse-chevron collapse-chevron-up" /> Hide top controls
          </button>
          <div v-if="tool === 'line'" class="line-tool-controls">
            <label class="snap-toggle compact-toggle">
              <input
                :checked="lineAutoConnect"
                type="checkbox"
                @change="setLineAutoConnect($event.target.checked)"
              /><span>Auto-connect</span>
            </label>
            <button class="text-button compact" @click="breakLineChain">Break chain</button>
          </div>
          <button
            v-if="tool === 'select'"
            class="toolbar-pill"
            :class="{ active: multiSelectMode }"
            :aria-pressed="multiSelectMode"
            @click="toggleMultiSelectMode"
          >
            <Layers :size="15" /> {{ multiSelectMode ? 'Multi-select on' : 'Multi-select' }}
          </button>
          <button
            class="toolbar-pill measurement-pill"
            :class="{ active: report.graphStyle.showMeasurements }"
            :aria-pressed="report.graphStyle.showMeasurements"
            @click="setMasterMeasurements(!report.graphStyle.showMeasurements)"
          >
            <ScanLine :size="15" /> {{ report.graphStyle.showMeasurements ? 'Dims on' : 'Dims off' }}
          </button>
          <button
            class="toolbar-pill"
            title="Reset every measurement to automatic placement"
            @click="resetAllMeasurementLayout"
          >
            <RotateCcw :size="15" /> Reflow dims
          </button>
          <label class="snap-toggle"
            ><input v-model="snap" type="checkbox" /><span
              >Snap every {{ snapLabel }}</span
            ></label
          ><button
            class="toolbar-pill canvas-focus-toggle"
            :class="{ active: railCollapsed && inspectorCollapsed }"
            @click="toggleCanvasFocus"
          >
            <Maximize :size="15" /> {{ railCollapsed && inspectorCollapsed ? 'Show panels' : 'Focus canvas' }}
          </button>
          <button
            class="toolbar-pill desktop-panel-toggle"
            @click="toggleInspector"
          >
            <Settings2 :size="15" /> {{ inspectorCollapsed ? 'Show tools' : 'Hide tools' }}
          </button>
          <button
            class="icon-button mobile-panel-toggle"
            :aria-expanded="panelOpen"
            aria-label="Show marks and selected object settings"
            @click="toggleInspector"
          >
            <Settings2 :size="19" />
          </button>
        </div>
        <button
          v-if="topUiCollapsed"
          class="top-ui-restore"
          title="Show header and graph controls"
          @click="toggleTopUi"
        >
          <ChevronDown :size="17" /> Show controls
        </button>
        <GraphEditor
          ref="graph"
          v-model:items="report.items"
          v-model:selected-id="selectedId"
          v-model:selected-ids="selectedIds"
          :tool="tool"
          :symbol="currentSymbol"
          :snap="snap"
          :scale-label="`1 square = ${report.feetPerSquare} ${report.gridUnit}`"
          :feet-per-square="report.feetPerSquare"
          :grid-unit="report.gridUnit"
          :graph-style="report.graphStyle"
          :line-auto-connect="lineAutoConnect"
          :multi-select-mode="multiSelectMode"
          @change="changeItems"
          @select-tool="setTool"
          @quick-action="handleGraphQuickAction"
          @position="position = $event"
        />
        <div v-if="selectedCount" class="mobile-selection-actions" aria-label="Selected object actions">
          <span>{{ selectedCount }} selected</span>
          <button class="btn btn-secondary" @click="panelOpen = true"><Settings2 :size="16" /> Edit</button>
          <button class="btn btn-secondary" @click="duplicateSelected"><Layers :size="16" /> Copy</button>
          <button class="btn btn-danger" @click="deleteSelected"><Trash2 :size="16" /> Delete</button>
        </div>
        <footer class="canvas-footer">
          <span
            ><Layers :size="14" /> {{ report.items.length }}
            {{ report.items.length === 1 ? "mark" : "marks" }}</span
          ><span v-if="selectedCount" class="coordinate-readout"
            >Selected {{ selectedCount }}</span
          ><span class="coordinate-readout"
            >X {{ formatDistance(position.x) }} {{ report.gridUnit }} · Y
            {{ formatDistance(position.y) }} {{ report.gridUnit }}</span
          ><button class="text-button" @click="newReport(true)">
            Try an example <ArrowRight :size="14" />
          </button>
        </footer>
      </section>
      <aside class="inspector-panel" :class="{ 'panel-open': panelOpen }">
        <div class="panel-mobile-header">
          <div><strong>Graph tools & settings</strong><small>Edit selected marks or add new ones.</small></div>
          <button class="icon-button" aria-label="Close graph settings" @click="panelOpen = false"><X :size="20" /></button>
        </div>
        <div class="panel-section mobile-quick-controls">
          <div class="section-heading">
            <h3>Quick display controls</h3>
            <span>ALL OBJECTS</span>
          </div>
          <div class="bulk-action-grid">
            <button class="btn btn-secondary" @click="setAllMeasurements(true)"><ScanLine :size="15" /> Dims on</button>
            <button class="btn btn-secondary" @click="setAllMeasurements(false)"><ScanLine :size="15" /> Dims off</button>
            <button class="btn btn-secondary" @click="setAllLabels(true)"><Type :size="15" /> Labels on</button>
            <button class="btn btn-secondary" @click="setAllLabels(false)"><Type :size="15" /> Labels off</button>
            <button class="btn btn-secondary" @click="resetAllMeasurementLayout"><RotateCcw :size="15" /> Reflow dims</button>
          </div>
        </div>
        <template v-if="selectedCount">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">{{ selectedCount > 1 ? 'SELECTED OBJECTS' : 'SELECTED OBJECT' }}</span>
              <h2>{{ selectedTitle }}</h2>
            </div>
            <button
              class="icon-button"
              :aria-label="selectedCount > 1 ? 'Clear selection' : 'Deselect object'"
              @click="clearSelection"
            >
              <X :size="18" />
            </button>
          </div>
          <div v-if="selected" class="panel-section">
            <div class="field">
              <span class="field-label-row">
                <span>Label / title</span>
                <button
                  v-if="selectedHasOptionalLabel && selected.text"
                  type="button"
                  class="inline-clear"
                  @click="
                    patchSelected('text', '');
                    recordHistory();
                  "
                >
                  Clear text
                </button>
              </span>
              <input
                ref="labelInput"
                :value="selected.text"
                maxlength="60"
                aria-label="Selected object label or title"
                :placeholder="selectedHasOptionalLabel ? 'Optional label' : 'Label text'"
                @input="patchSelected('text', $event.target.value)"
                @change="recordHistory"
              />
            </div>
            <label v-if="selectedHasOptionalLabel" class="setting-toggle object-label-toggle">
              <span>
                <strong>Show label on graph</strong>
                <small>Hide the title without deleting it from the object.</small>
              </span>
              <input
                type="checkbox"
                :checked="selected.showLabel !== false"
                @change="
                  patchSelected('showLabel', $event.target.checked);
                  recordHistory();
                "
              />
            </label>
            <div v-if="selectedHasOptionalLabel && selected.text" class="annotation-controls">
              <span>Label placement</span>
              <p>In Select mode, drag the label text directly on the graph to place it anywhere inside or outside the shape.</p>
              <button class="btn btn-secondary btn-mini" @click="resetSelectedLabelPosition">Reset label position</button>
            </div>
            <div class="field-pair">
              <label class="field"
                ><span>Text size</span
                ><select
                  :value="selected.fontSize"
                  @change="
                    patchSelected('fontSize', Number($event.target.value));
                    recordHistory();
                  "
                >
                  <option
                    v-for="size in [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 60, 72]"
                    :key="size"
                    :value="size"
                  >
                    {{ size }}
                  </option>
                </select></label
              ><label class="field"
                ><span>Line weight</span
                ><select
                  :value="selected.width"
                  @change="
                    patchSelected('width', Number($event.target.value));
                    recordHistory();
                  "
                >
                  <option
                    v-for="size in [0.5, 0.75, 1, 1.5, 2, 3, 4, 6]"
                    :key="size"
                    :value="size"
                  >
                    {{ size }} px
                  </option>
                </select></label
              >
            </div>
            <div v-if="selectedSupportsCornerTreatment" class="corner-editor">
              <div class="field-pair">
                <label class="field">
                  <span>Corner style</span>
                  <select :value="selectedCornerStyle" @change="patchSelectedCornerStyle($event.target.value)">
                    <option value="square">Square</option>
                    <option value="round">Rounded / radius</option>
                    <option value="bevel">Bevel / chamfer</option>
                  </select>
                </label>
                <label v-if="selectedCornerStyle !== 'square'" class="field">
                  <span>Corner size</span>
                  <div class="range-field">
                    <input
                      type="range"
                      min="0"
                      max="120"
                      :step="cornerSnapStep"
                      :value="selected.cornerRadius || 0"
                      @input="patchSelectedCornerRadius($event.target.value)"
                      @change="recordHistory"
                    />
                    <strong>{{ formatDistance(selected.cornerRadius || 0) }} {{ report.gridUnit }}</strong>
                  </div>
                </label>
              </div>
              <button
                v-if="selected.type === 'rect'"
                class="btn btn-secondary w-full"
                @click="convertSelectedRectToOutline"
              >
                <Pencil :size="16" /> Convert to editable 4-point outline
              </button>
              <p class="small-help">
                Rounded and beveled setbacks snap to the current grid increment. Lines and outlines apply the treatment at editable vertices; convert a rectangle when you need to move its corners independently.
              </p>
            </div>
            <label class="field"
              ><span>Ink color</span>
              <div class="color-options">
                <button
                  v-for="color in ['#183b42', '#b43b37', '#225daa', '#8a5928']"
                  :key="color"
                  :style="{ background: color }"
                  :aria-label="`Use ${color} ink`"
                  :aria-pressed="selected.color === color"
                  @click="
                    patchSelected('color', color);
                    recordHistory();
                  "
                >
                  <Check v-if="selected.color === color" :size="17" />
                </button></div
            ></label>
            <label v-if="selectedSupportsClosedShape" class="setting-toggle object-label-toggle">
              <span>
                <strong>Closed shape</strong>
                <small>Close the path so curved walkways or outlines can be hatched and measured around the full boundary.</small>
              </span>
              <input
                type="checkbox"
                :checked="selected.closed"
                :disabled="selected.points.length < 3"
                @change="
                  patchSelected('closed', $event.target.checked);
                  if (!$event.target.checked) patchSelected('pattern', 'none');
                  recordHistory();
                "
              />
            </label>
            <label v-if="selectedSupportsMeasurement" class="setting-toggle object-label-toggle">
              <span>
                <strong>Show measurements for this object</strong>
                <small>Turn lengths on or off without affecting other shapes.</small>
              </span>
              <input
                type="checkbox"
                :checked="selected.showMeasurements !== false"
                @change="
                  patchSelected('showMeasurements', $event.target.checked);
                  recordHistory();
                "
              />
            </label>
            <div v-if="selectedSupportsMeasurement && selected.showMeasurements !== false" class="annotation-controls measurement-layout-controls">
              <span>Measurement placement</span>
              <p>Measurements stay attached to the wall they describe. Press and hold a value on the graph to hide it, return it to Auto, or flip it to the other side. Labels can still be moved freely.</p>
              <div class="field-pair">
                <label class="field">
                  <span>Measurement side</span>
                  <select
                    :value="selected.measurementSide || 'normal'"
                    @change="patchSelected('measurementSide', $event.target.value); recordHistory()"
                  >
                    <option value="normal">Side 1</option>
                    <option value="opposite">Opposite side</option>
                  </select>
                </label>
                <label class="field">
                  <span>Distance from wall</span>
                  <select
                    :value="selected.measurementDistance || 0"
                    @change="patchSelected('measurementDistance', Number($event.target.value)); recordHistory()"
                  >
                    <option :value="-4">Tighter</option>
                    <option :value="0">Normal</option>
                    <option :value="8">A little farther</option>
                    <option :value="18">Farther</option>
                    <option :value="30">Wide</option>
                  </select>
                </label>
              </div>
              <div class="mini-actions measurement-reset-actions">
                <button v-if="canSplitSelectedLine" class="btn btn-secondary btn-mini" @click="splitSelectedLength">Split length</button>
                <button class="btn btn-secondary btn-mini" @click="resetSelectedMeasurementLayout">Reset / show all dimensions</button>
                <span v-if="selectedHiddenMeasurementCount" class="selection-chip">{{ selectedHiddenMeasurementCount }} hidden</span>
              </div>
            </div>
            <div v-if="selectedSupportsRotation" class="field-pair">
              <label class="field"
                ><span>Rotation</span
                ><input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  :value="selected.rotation || 0"
                  @change="patchSelectedRotation($event.target.value)"
              /></label>
              <div class="field quick-rotate-field">
                <span>Quick rotate</span>
                <div class="mini-actions">
                  <button class="btn btn-secondary btn-mini" @click="rotateSelected(-15)">-15°</button>
                  <button class="btn btn-secondary btn-mini" @click="rotateSelected(15)">+15°</button>
                </div>
              </div>
            </div>
            <div v-if="selectedSupportsPattern" class="field-pair">
              <label class="field"
                ><span>Area pattern</span
                ><select
                  :value="selected.pattern"
                  @change="
                    patchSelected('pattern', $event.target.value);
                    recordHistory();
                  "
                >
                  <option value="none">None</option>
                  <option value="diagonal">Diagonal marks</option>
                  <option value="crosshatch">Crosshatch</option>
                  <option value="horizontal">Horizontal marks</option>
                  <option value="vertical">Vertical marks</option>
                </select></label
              ><label class="field"
                ><span>Pattern spacing</span
                ><select
                  :value="selected.patternSpacing"
                  @change="
                    patchSelected('patternSpacing', Number($event.target.value));
                    recordHistory();
                  "
                >
                  <option v-for="spacing in [10, 12, 16, 20, 24, 32, 40]" :key="spacing" :value="spacing">
                    {{ spacing }}
                  </option>
                </select></label
              >
            </div>
            <div v-if="selected.points.length === 1" class="field-pair">
              <label class="field"
                ><span>X position ({{ report.gridUnit }})</span
                ><input
                  type="number"
                  min="0"
                  :max="(GRID.width / GRID.step) * report.feetPerSquare"
                  :step="snapDistance"
                  :value="formatDistance(selected.points[0].x)"
                  @change="patchSelectedPoint('x', $event.target.value)"
              /></label>
              <label class="field"
                ><span>Y position ({{ report.gridUnit }})</span
                ><input
                  type="number"
                  min="0"
                  :max="(GRID.height / GRID.step) * report.feetPerSquare"
                  :step="snapDistance"
                  :value="formatDistance(selected.points[0].y)"
                  @change="patchSelectedPoint('y', $event.target.value)"
              /></label>
            </div>
            <div v-if="selectedSupportsPointEditing" class="vertex-editor">
              <div class="vertex-editor-heading">
                <span>
                  <strong>Object points</strong>
                  <small>{{ selected.points.length }} editable {{ selected.points.length === 1 ? 'point' : 'points' }}</small>
                </span>
                <small>White handles move points · green + handles add points</small>
              </div>
              <div class="vertex-list">
                <div v-for="(point, index) in selected.points" :key="`vertex-${index}`" class="vertex-row">
                  <span class="vertex-number">{{ index + 1 }}</span>
                  <label class="field vertex-coordinate">
                    <span>X</span>
                    <input
                      type="number"
                      min="0"
                      :max="(GRID.width / GRID.step) * report.feetPerSquare"
                      :step="snapDistance"
                      :value="formatDistance(point.x)"
                      @change="patchSelectedVertex(index, 'x', $event.target.value)"
                    />
                  </label>
                  <label class="field vertex-coordinate">
                    <span>Y</span>
                    <input
                      type="number"
                      min="0"
                      :max="(GRID.height / GRID.step) * report.feetPerSquare"
                      :step="snapDistance"
                      :value="formatDistance(point.y)"
                      @change="patchSelectedVertex(index, 'y', $event.target.value)"
                    />
                  </label>
                  <button
                    v-if="index < selected.points.length - 1 || selected.closed"
                    class="icon-button vertex-action"
                    :aria-label="`Add point after point ${index + 1}`"
                    title="Add midpoint after this point"
                    @click="insertSelectedVertexAfter(index)"
                  >
                    <Plus :size="16" />
                  </button>
                  <button
                    class="icon-button vertex-action vertex-delete"
                    :disabled="!canDeleteSelectedVertex()"
                    :aria-label="`Delete point ${index + 1}`"
                    title="Delete this point"
                    @click="deleteSelectedVertex(index)"
                  >
                    <Trash2 :size="16" />
                  </button>
                </div>
              </div>
              <p class="small-help">
                Coordinates use {{ report.gridUnit }} and follow the current snap setting. Add a midpoint, drag it into place, or delete any extra point while keeping the object valid.
              </p>
            </div>
            <div v-if="tool !== 'select'" class="edit-object-callout">
              <span>Keep drawing with <strong>{{ tool === 'line' ? 'Line' : tools.find((t) => t.id === tool)?.label || 'the active tool' }}</strong>, or switch to Select to move/resize this object.</span>
              <button class="btn btn-secondary" @click="setTool('select')">
                <MousePointer2 :size="15" /> Edit on graph
              </button>
            </div>
            <p class="small-help">
              In Select mode, drag the object to move it. White round handles edit individual points; tap a line/outline point to expose its red delete control, or hold it for point actions. Hold an object or dimension for the radial quick menu. Green + handles insert midpoints; square handles resize the object. Arrow keys nudge by 1 px; hold Shift to nudge by 10 px.
            </p>
            <div class="flex gap-2">
              <button
                class="btn btn-secondary flex-1"
                @click="duplicateSelected"
              >
                <Layers :size="16" /> Duplicate</button
              ><button
                class="btn btn-danger"
                aria-label="Delete selected object"
                @click="deleteSelected"
              >
                <Trash2 :size="16" /> Delete
              </button>
            </div>
          </div>
          <div v-else class="panel-section multi-select-panel">
            <p class="multi-select-summary">
              <strong>{{ selectedCount }} objects selected.</strong>
              <span>{{ selectedTypeSummary || 'Mixed selection' }}</span>
            </p>
            <label class="setting-toggle object-label-toggle">
              <span>
                <strong>Multi-select mode</strong>
                <small>Tap this on mobile, or use Shift-click on desktop, to add or remove items from the selection.</small>
              </span>
              <input type="checkbox" :checked="multiSelectMode" @change="toggleMultiSelectMode" />
            </label>
            <div class="bulk-action-grid">
              <button class="btn btn-secondary" @click="setSelectedMeasurements(true)">Measurements on</button>
              <button class="btn btn-secondary" @click="setSelectedMeasurements(false)">Measurements off</button>
              <button class="btn btn-secondary" @click="groupSelected"><Layers :size="15" /> Group shapes</button>
              <button class="btn btn-secondary" :disabled="!selectedHasGroup" @click="ungroupSelected">Ungroup shapes</button>
              <button class="btn btn-secondary" :disabled="!canCombineSelectedLines" @click="combineOverlappingLines">Combine overlapping walls</button>
              <button class="btn btn-secondary" @click="mergeSelectedPoints">Join nearby corners</button>
              <button class="btn btn-secondary" :disabled="!selectedHasLinkedPoints" @click="unmergeSelectedPoints">Release joined corners</button>
            </div>
            <p class="small-help">
              Combine overlapping walls turns duplicate straight runs into one clean line and one combined measurement. Join nearby corners keeps separate shapes connected at a shared point. Grouping only makes objects move together. Undo reverses a wall combine.
            </p>
            <div class="multi-select-list">
              <span v-for="item in selectedItems" :key="item.id" class="selection-chip">{{ item.type }}</span>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-secondary flex-1" @click="duplicateSelected">
                <Layers :size="16" /> Duplicate group
              </button>
              <button class="btn btn-danger" @click="deleteSelected">
                <Trash2 :size="16" /> Delete group
              </button>
            </div>
          </div>
        </template>
        <div class="panel-heading">
          <div>
            <span class="eyebrow">ADD TO YOUR GRAPH</span>
            <h2>Top-down objects & marks</h2>
          </div>
          <MapPinned :size="21" class="muted" />
        </div>
        <div class="panel-section">
          <h3>Structure</h3>
          <div class="structure-buttons">
            <button
              :class="{ active: tool === 'garage' }"
              @click="
                setTool('garage');
                panelOpen = false;
              "
            >
              <House :size="18" /> Garage</button
            ><button
              :class="{ active: tool === 'crawlspace' }"
              @click="
                setTool('crawlspace');
                panelOpen = false;
              "
            >
              <Square :size="18" /> Crawlspace</button
            ><button
              :class="{ active: tool === 'hatch' }"
              @click="
                setTool('hatch');
                panelOpen = false;
              "
            >
              <Grid2X2 :size="18" /> Diagonal area</button
            ><button
              :class="{ active: tool === 'hatchpoly' }"
              @click="
                setTool('hatchpoly');
                panelOpen = false;
              "
            >
              <Grid2X2 :size="18" /> Hatch polygon</button
            ><button
              :class="{ active: tool === 'rounded' }"
              @click="
                setTool('rounded');
                panelOpen = false;
              "
            >
              <Square :size="18" /> Rounded area</button
            ><button
              :class="{ active: tool === 'beveled' }"
              @click="
                setTool('beveled');
                panelOpen = false;
              "
            >
              <Square :size="18" /> Beveled area</button
            ><button
              :class="{ active: tool === 'ellipse' }"
              @click="
                setTool('ellipse');
                panelOpen = false;
              "
            >
              <Circle :size="18" /> Oval / circle</button
            ><button
              :class="{ active: tool === 'curvearea' }"
              @click="
                setTool('curvearea');
                panelOpen = false;
              "
            >
              <Pencil :size="18" /> Curved hatch area</button
            ><button
              @click="selectSymbol(SYMBOLS.find((s) => s.key === 'door'))"
            >
              <span class="door-symbol">Z</span> Crawlspace door</button
            ><button
              @click="
                setTool('label');
                panelOpen = false;
              "
            >
              <Type :size="18" /> Custom label
            </button>
          </div>
        </div>
        <div class="panel-section">
          <div class="section-heading">
            <h3>Inspection key</h3>
            <span>FROM YOUR FORM</span>
          </div>
          <div class="symbol-list">
            <button
              v-for="symbol in symbols.filter(
                (s) => !['door', 'north', 'steps'].includes(s.key),
              )"
              :key="symbol.key"
              :class="{
                active: tool === 'symbol' && currentSymbol.key === symbol.key,
              }"
              @click="selectSymbol(symbol)"
            >
              <span class="symbol-token" :style="{ color: symbol.color }">{{
                symbol.text
              }}</span
              ><span>{{ symbol.title }}</span
              ><Plus :size="14" />
            </button>
          </div>
          <button class="add-symbol" @click="modal = 'symbol'">
            <Plus :size="16" /> Add your own symbol
          </button>
        </div>
        <div class="panel-section graph-appearance compact-appearance">
          <div class="section-heading">
            <h3>Display</h3>
            <div class="section-heading-actions">
              <button class="icon-button compact-help" title="Measurement help" aria-label="Measurement help" @click="modal = 'measurement-help'"><HelpCircle :size="17" /></button>
              <button class="text-button compact" @click="resetGraphStyle">Reset</button>
            </div>
          </div>
          <div class="measurement-primary-actions">
            <button
              class="btn btn-secondary"
              :class="{ active: report.graphStyle.showMeasurements }"
              @click="setMasterMeasurements(!report.graphStyle.showMeasurements)"
            ><ScanLine :size="15" /> {{ report.graphStyle.showMeasurements ? 'Dims on' : 'Dims off' }}</button>
            <button class="btn btn-secondary" @click="resetAllMeasurementLayout"><RotateCcw :size="15" /> Reflow dims</button>
          </div>
          <details class="compact-settings">
            <summary>Measurement options</summary>
            <div class="measurement-display-grid">
              <label class="field">
                <span>Placement</span>
                <select v-model="report.graphStyle.measurementPlacement" @change="recordHistory">
                  <option value="smart">Smart · close to wall</option>
                  <option value="close">Tight</option>
                  <option value="outside">Outside</option>
                  <option value="inline">On wall</option>
                </select>
              </label>
              <label class="field">
                <span>Crowding</span>
                <select v-model="report.graphStyle.measurementCrowding" @change="recordHistory">
                  <option value="clean">Clean · hide crowded values</option>
                  <option value="all">Show every value</option>
                </select>
              </label>
              <label class="field">
                <span>Direction</span>
                <select v-model="report.graphStyle.measurementOrientation" @change="recordHistory">
                  <option value="horizontal">Horizontal text</option>
                  <option value="along">Follow wall</option>
                </select>
              </label>
              <label class="field">
                <span>Boxes</span>
                <select v-model="report.graphStyle.measurementDetail" @change="recordHistory">
                  <option value="simplified">Width + height</option>
                  <option value="all">Every side</option>
                </select>
              </label>
              <label class="field">
                <span>Text size</span>
                <select v-model.number="report.graphStyle.measurementFontSize" @change="recordHistory">
                  <option v-for="size in [5, 6, 7, 8, 9, 10, 11, 12]" :key="size" :value="size">{{ size }}</option>
                </select>
              </label>
            </div>
          </details>
          <details class="compact-settings">
            <summary>Colors & bulk visibility</summary>
            <div class="graph-color-grid">
              <label class="field"><span>Paper</span><input v-model="report.graphStyle.background" type="color" @change="recordHistory" /></label>
              <label class="field"><span>Small grid</span><input v-model="report.graphStyle.minor" type="color" @change="recordHistory" /></label>
              <label class="field"><span>Major grid</span><input v-model="report.graphStyle.major" type="color" @change="recordHistory" /></label>
              <label class="field"><span>Dimensions</span><input v-model="report.graphStyle.dimensions" type="color" @change="recordHistory" /></label>
            </div>
            <div class="bulk-action-grid compact-bulk-grid">
              <button class="btn btn-secondary" @click="setAllMeasurements(true)">All dims on</button>
              <button class="btn btn-secondary" @click="setAllMeasurements(false)">All dims off</button>
              <button class="btn btn-secondary" @click="setAllLabels(true)">All labels on</button>
              <button class="btn btn-secondary" @click="setAllLabels(false)">All labels off</button>
            </div>
          </details>
        </div>
        <details v-if="report.items.length" class="panel-section object-browser compact-settings">
          <summary>Objects on graph <span>{{ report.items.length }}</span></summary>
          <div class="object-browser-list">
            <button
              v-for="item in report.items"
              :key="item.id"
              :class="{ active: selectedIds.includes(item.id) }"
              @click="selectItemFromPanel(item.id)"
            >
              <span><strong>{{ itemDisplayName(item) }}</strong><small>{{ item.type }}</small></span>
              <ArrowRight :size="15" />
            </button>
          </div>
        </details>
        <div class="panel-section panel-bottom">
          <button
            class="text-button"
            @click="selectSymbol(SYMBOLS.find((s) => s.key === 'north'))"
          >
            <MoveUpRight :size="17" /> Place north arrow
          </button>
          <button class="text-button compact" @click="modal = 'help'"><HelpCircle :size="15" /> Drawing help</button>
        </div>
      </aside>
    </main>

    <main v-else-if="tab === 'notes'" class="notes-workspace">
      <div class="page-heading">
        <div>
          <span class="eyebrow">INSPECTION RECORD</span>
          <h1>Details & notes</h1>
          <p>Property, findings, and sign-off.</p>
        </div>
        <div class="page-heading-actions">
          <button class="icon-button" title="Details & notes help" aria-label="Details & notes help" @click="modal = 'notes-help'"><HelpCircle :size="19" /></button>
          <button class="btn btn-secondary" @click="modal = 'presets'">Presets</button>
          <button class="btn btn-secondary" @click="tab = 'graph'">
            <ArrowLeft :size="17" /> Back to graph
          </button>
        </div>
      </div>
      <div class="notes-summary-strip compact-summary" aria-label="Inspection details summary">
        <span><Check v-if="report.customer" :size="14" /><strong>{{ report.customer || 'Add property' }}</strong></span>
        <span><Check v-if="report.inspector.notes.trim()" :size="14" /><strong>{{ report.inspector.notes.trim() ? 'Inspector notes added' : 'Inspector notes optional' }}</strong></span>
        <span><Check v-if="report.control.notes.trim()" :size="14" /><strong>{{ report.control.notes.trim() ? 'Treatment notes added' : 'Treatment notes optional' }}</strong></span>
      </div>
      <section class="property-card">
        <div class="section-heading">
          <h2>Property details</h2>
          <House :size="22" />
        </div>
        <div class="property-grid">
          <label class="field"
            ><span>Customer / property name</span
            ><input
              v-model="report.customer"
              maxlength="120"
              autocomplete="name"
              placeholder="Name on the inspection form"
              @change="recordHistory" /></label
          ><label class="field"
            ><span>Phone</span
            ><input
              v-model="report.phone"
              type="tel"
              maxlength="50"
              autocomplete="tel"
              placeholder="(615) 555-0100"
              @change="recordHistory" /></label
          ><label class="field"
            ><span>Inspection date</span
            ><input
              v-model="report.date"
              type="date"
              @change="recordHistory" /></label
          ><label class="field property-street"
            ><span>Street address</span
            ><input
              v-model="report.street"
              maxlength="160"
              autocomplete="street-address"
              placeholder="Street address"
              @change="recordHistory" /></label
          ><label class="field property-city"
            ><span>City, state & ZIP</span
            ><input
              v-model="report.city"
              maxlength="160"
              placeholder="City, state, ZIP code"
              @change="recordHistory"
          /></label>
        </div>
        <div class="construction-row">
          <fieldset>
            <legend>Type of construction</legend>
            <div class="construction-options">
              <label v-for="type in CONSTRUCTION" :key="type"
                ><input
                  v-model="report.construction"
                  type="checkbox"
                  :value="type"
                  @change="recordHistory"
                />{{ type }}</label
              >
            </div>
          </fieldset>
          <div class="scale-field">
            <span>One grid square equals</span>
            <div>
              <input
                v-model.number="report.feetPerSquare"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                aria-label="Distance per grid square"
                @change="recordHistory"
              /><select
                v-model="report.gridUnit"
                aria-label="Grid scale unit"
                @change="recordHistory"
              >
                <option value="ft">feet</option>
                <option value="m">meters</option>
              </select>
            </div>
            <details class="inline-help-details"><summary>Scale help</summary><small class="scale-help">Snap stays accurate to {{ snapLabel }} increments. If one square represents 2 ft, snapping can still land halfway through the square for 1 ft increments.</small></details>
          </div>
        </div>
      </section>
      <div class="statement-grid">
        <StatementForm
          v-model="report.inspector"
          role="inspector"
          :credential-profiles="credentialProfiles"
          :note-templates="noteTemplates"
          @save-credentials="beginCredentialSave"
          @save-note-template="beginNoteTemplateSave"
          @apply-credential="applyCredentialPreset"
        /><StatementForm
          v-model="report.control"
          role="control"
          :credential-profiles="credentialProfiles"
          :note-templates="noteTemplates"
          @save-credentials="beginCredentialSave"
          @save-note-template="beginNoteTemplateSave"
          @apply-credential="applyCredentialPreset"
        />
      </div>
      <div class="notes-footer">
        <span
          ><FileText :size="18" /> Notes, names, certifications, and dates
          appear on the back of the form.</span
        ><button class="btn btn-primary" @click="tab = 'preview'">
          Preview report <ArrowRight :size="17" />
        </button>
      </div>
    </main>

    <main v-else class="preview-workspace">
      <div class="page-heading">
        <div>
          <span class="eyebrow">READY FOR PAPER</span>
          <h1>Print preview</h1>
          <p>A clean printed-form recreation using the exact same graph geometry.</p>
        </div>
        <button class="btn btn-primary" @click="openExport">
          <Download :size="17" /> Export PDF
        </button>
      </div>
      <div class="preview-options">
        <label
          >Paper size
          <select v-model="paper">
            <option value="letter">US Letter · 8.5 × 11 in</option>
            <option value="original">Original document size</option>
          </select></label
        ><label
          ><input v-model="monochrome" type="checkbox" /> Black ink for
          printing</label
        ><span v-if="pages.length">{{ pages.length }} pages</span>
      </div>
      <div v-if="busyPdf" class="loading-state" role="status">
        <LoaderCircle :size="24" class="spin" /> Preparing the paper preview…
      </div>
      <PaperPreview v-else-if="pages.length" :pages="pages" />
      <div v-else class="loading-state">
        <p>Preview could not be prepared.</p>
        <button class="btn btn-secondary" @click="buildPreview">
          Try again
        </button>
      </div>
    </main>

    <div v-if="toast" class="toast" role="status">
      <Check :size="18" />{{ toast }}
    </div>
    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept=".json,.termite.json,application/json"
      aria-label="Import Fieldbook backup"
      @change="importFile"
    />

    <ModalShell
      v-if="modal === 'reports'"
      title="Saved inspections"
      wide
      @close="modal = null"
      ><div class="modal-intro">
        <p>Reopen a saved graph, import a backup, or offload every device save in one portable bundle.</p>
        <button class="btn btn-secondary" @click="modal = 'new'">
          <Plus :size="16" /> New</button
        ><button class="btn btn-secondary" @click="fileInput.click()">
          <Upload :size="16" /> Import backup(s)
        </button>
        <button class="btn btn-secondary" @click="backupAllSaves">
          <Download :size="16" /> Export all saves
        </button>
      </div>
      <div v-if="loadingRecords" class="loading-state">
        <LoaderCircle :size="22" class="spin" /> Loading inspections…
      </div>
      <div v-else-if="!records.length" class="empty-records">
        <FolderOpen :size="32" />
        <h3>No saved inspections yet</h3>
        <p>Use Save to keep this graph and its notes on this device.</p>
        <button class="btn btn-primary" @click="modal = null">
          Return to inspection
        </button>
      </div>
      <div v-else class="report-list">
        <button
          v-for="record in records"
          :key="record.id"
          @click="loadRecord(record)"
        >
          <span class="report-icon"><FileText :size="22" /></span
          ><span
            ><strong>{{ record.title }}</strong
            ><small
              >{{ record.address || "No address added" }} ·
              {{ new Date(record.updated_at).toLocaleDateString() }}{{ record.source === "device" ? " · On this device" : "" }}</small
            ></span
          ><ArrowRight :size="17" />
        </button>
      </div>
      <div class="saved-backup-actions mt-4">
        <button class="text-button" @click="backup">
          <Download :size="16" /> Export current backup
        </button>
        <button class="text-button" @click="backupAllSaves">
          <Download :size="16" /> Export all device saves
        </button>
      </div>
      <p v-if="error" class="inline-error" role="alert">
        {{ error }}
      </p></ModalShell
    >
    <ModalShell
      v-if="modal === 'new'"
      title="New inspection"
      @close="modal = null"
      ><p class="modal-description">
        Start a fresh inspection or explore the drawing tools with an example
        structure.
      </p>
      <button class="new-option" @click="newReport(false)">
        <FilePlus2 :size="24" /><span
          ><strong>Blank inspection</strong
          ><small>A clear grid and empty statements</small></span
        ><ArrowRight :size="18" /></button
      ><button class="new-option" @click="newReport(true)">
        <House :size="24" /><span
          ><strong>Example structure</strong
          ><small>See a residence, garage, and crawlspace</small></span
        ><ArrowRight :size="18" /></button
    ></ModalShell>
    <ModalShell
      v-if="modal === 'confirm'"
      title="Keep your current changes?"
      @close="modal = null"
      ><p class="modal-description">
        This inspection has unsaved changes. You can save it before continuing,
        or export an editable backup.
      </p>
      <button class="text-button mb-5" @click="backup">
        <Download :size="17" /> Export backup
      </button>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="continueAction(false)">
          Continue without saving</button
        ><button
          class="btn btn-primary"
          :disabled="busy"
          @click="continueAction(true)"
        >
          Save & continue
        </button>
      </div>
      <p v-if="error" class="inline-error" role="alert">
        {{ error }}
      </p></ModalShell
    >
    <ModalShell
      v-if="modal === 'symbol'"
      title="Add a custom symbol"
      @close="modal = null"
      ><form @submit.prevent="addCustom">
        <p class="modal-description">
          The symbol and its description are included in the additional graph
          key on the back of your PDF.
        </p>
        <label class="field"
          ><span>Symbol / abbreviation</span
          ><input
            v-model="custom.text"
            required
            maxlength="8"
            placeholder="e.g. VENT" /></label
        ><label class="field"
          ><span>Description</span
          ><input
            v-model="custom.title"
            required
            maxlength="45"
            placeholder="e.g. Foundation vent"
        /></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" @click="modal = null">
            Cancel</button
          ><button type="submit" class="btn btn-primary">
            Add & place <Plus :size="17" />
          </button>
        </div>
        <p v-if="error" class="inline-error">{{ error }}</p>
      </form></ModalShell
    >
    <ModalShell
      v-if="modal === 'export'"
      title="Export inspection PDF"
      @close="modal = null"
      ><div class="export-form-icon">
        <FileText :size="34" /><span
          >Clean two-sided printed form<small
            >Straight vector graph on the front. Statements on the back.</small
          ></span
        >
      </div>
      <label class="field"
        ><span>Paper size</span
        ><select v-model="paper">
          <option value="letter">US Letter · 8.5 × 11 in</option>
          <option value="original">Original document size</option>
        </select></label
      ><label class="checkbox-field"
        ><input v-model="monochrome" type="checkbox" /> Export markings in black
        ink</label
      >
      <p class="export-ready">
        <Check :size="18" /> Ready to export — technician statements are optional
      </p>
      <p class="small-help">
        The preview and PDF share the same vector grid, supplied company logo, and drawing coordinates.
        Export uses the current inspection exactly as shown; saving the inspection first is not required. On Android, the PDF is written to Downloads/Termite Fieldbook.
        Long statements continue on additional sheets; for two-sided printing, flip on the long edge.
      </p>
      <div class="modal-actions export-actions">
        <button class="btn btn-secondary" @click="backup">Export backup</button>
        <button
          class="btn btn-primary"
          :disabled="busyPdf"
          @click="exportPdf"
        >
          <LoaderCircle v-if="busyPdf" :size="17" class="spin" /><Download v-else :size="17" />
          {{ busyPdf ? "Preparing…" : mobileFileFlow ? "Export current PDF" : "Download PDF" }}
        </button>
        <button
          v-if="preparedPdf && canUseNativeAndroidFileSave()"
          class="btn btn-secondary"
          @click="savePreparedPdf('picker')"
        >
          Choose another location…
        </button>
      </div>
      <p v-if="error" class="inline-error" role="alert">
        {{ error }}
      </p></ModalShell
    >
    <ModalShell v-if="modal === 'save-credential'" title="Save technician credentials" @close="modal = null">
      <form @submit.prevent="saveCredentialPreset">
        <p class="modal-description">Save the current signed name, certification number, and drawn signature on this device for future inspections.</p>
        <label class="field"><span>Preset name</span><input v-model="presetDraft.title" maxlength="80" required placeholder="e.g. Matthew — Inspector" /></label>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" @click="modal = null">Cancel</button><button class="btn btn-primary" type="submit">Save credentials</button></div>
      </form>
    </ModalShell>
    <ModalShell v-if="modal === 'save-note-template'" title="Save note template" @close="modal = null">
      <form @submit.prevent="saveNoteTemplatePreset">
        <p class="modal-description">Save the current notes as a reusable {{ presetDraft.role === 'inspector' ? 'inspection' : 'control' }} template on this device.</p>
        <label class="field"><span>Template name</span><input v-model="presetDraft.title" maxlength="80" required placeholder="e.g. Standard crawlspace inspection" /></label>
        <div class="modal-actions"><button type="button" class="btn btn-secondary" @click="modal = null">Cancel</button><button class="btn btn-primary" type="submit">Save template</button></div>
      </form>
    </ModalShell>
    <ModalShell v-if="modal === 'presets'" title="Saved field presets" wide @close="modal = null">
      <p class="modal-description">These presets stay in this browser/device and can be reused on future inspection reports.</p>
      <div class="preset-manager-grid">
        <section>
          <h3>Technician credentials</h3>
          <p v-if="!credentialProfiles.length" class="small-help">No saved technicians yet.</p>
          <div v-for="profile in credentialProfiles" :key="profile.id" class="preset-row">
            <span><strong>{{ profile.title }}</strong><small>{{ profile.name || 'No typed name' }} · {{ profile.certificate || 'No certification #' }}</small></span>
            <button class="icon-button danger" aria-label="Delete credential preset" @click="deleteCredentialPreset(profile.id)"><Trash2 :size="17" /></button>
          </div>
        </section>
        <section>
          <h3>Note templates</h3>
          <p v-if="!noteTemplates.length" class="small-help">No saved note templates yet.</p>
          <div v-for="template in noteTemplates" :key="template.id" class="preset-row">
            <span><strong>{{ template.title }}</strong><small>{{ template.role === 'inspector' ? 'Inspection' : 'Control' }} · {{ template.text.slice(0, 70) }}{{ template.text.length > 70 ? '…' : '' }}</small></span>
            <button class="icon-button danger" aria-label="Delete note template" @click="deleteNoteTemplate(template.id)"><Trash2 :size="17" /></button>
          </div>
        </section>
      </div>
    </ModalShell>

    <ModalShell v-if="modal === 'measurement-help'" title="Measurement display" @close="modal = null">
      <div class="concise-help">
        <p><strong>Reflow dims</strong> returns every dimension to the recommended Smart + Clean layout and clears per-wall flips or hidden values.</p>
        <p><strong>Clean</strong> keeps dimensions close to their wall. If a value still cannot fit clearly, it is temporarily omitted instead of being moved somewhere confusing.</p>
        <p><strong>Show every value</strong> forces crowded dimensions to remain visible. Use it only when you need to inspect every segment.</p>
        <p>Labels can still be moved freely because their ownership is obvious. Measurements intentionally cannot be free-dragged.</p>
      </div>
      <button class="btn btn-primary w-full mt-5" @click="modal = null">Done</button>
    </ModalShell>
    <ModalShell v-if="modal === 'notes-help'" title="Details & notes" @close="modal = null">
      <div class="concise-help">
        <p><strong>Property details</strong> print at the top of the inspection graph.</p>
        <p><strong>Field/Treatment notes</strong> print on the statement page. Long notes continue automatically.</p>
        <p><strong>Sign-off</strong> is optional and stays collapsed until you need the technician name, certification, date, or signature.</p>
        <p>Presets are device-local shortcuts. They are also included when you export the complete device backup bundle.</p>
      </div>
      <button class="btn btn-primary w-full mt-5" @click="modal = null">Done</button>
    </ModalShell>

    <ModalShell
      v-if="modal === 'help'"
      title="Working with your graph"
      @close="modal = null"
      ><div class="help-list">
        <p>
          <strong>Outline a structure</strong>Choose Outline and tap each
          corner. Tap the first corner, press Enter, or choose Finish to close
          the outline.
        </p>
        <p>
          <strong>Rounded, beveled, curved, and hatched areas</strong>Use Rounded for radius corners, Bevel for chamfered corners, Oval for circles/ellipses, Hatch polygon for irregular slabs, or Curved area for gardens and curved sidewalks. Any closed area can use diagonal, crosshatch, horizontal, or vertical marks.
        </p>
        <p>
          <strong>Move, reshape, labels, and dimensions</strong>Choose Select. Drag a shape to move it, white handles to move vertices, optional geometry labels to reposition their text. Dimensions stay constrained to their wall; use Reflow, Hide, or Flip side when a dense area needs cleanup. Tap a line/outline point for its direct delete control. Press and hold a point, dimension, object, or empty canvas for context-specific radial actions and quick tools.
        </p>
        <p>
          <strong>Combine, group, or join geometry</strong>Use Multi-select to select several objects. Combine overlapping walls removes duplicate straight runs and combines their measurements. Group makes shapes move together. Join nearby corners keeps separate shapes attached at one point; Release joined corners separates them again.
        </p>
        <p>
          <strong>Repeated lines</strong>Line stays active so you can trace wall
          runs quickly. Auto-connect continues from the previous endpoint, and
          Break chain starts the next segment fresh.
        </p>
        <p>
          <strong>Zoom and pan</strong>Scroll or pinch with two fingers to zoom.
          Choose Pan, hold Space and drag, or on touch simply drag empty graph
          space while Select is active. Fit restores the full grid.
        </p>
        <p>
          <strong>Keep and print your work</strong>Save keeps the complete editable inspection. Export all saves creates one portable bundle for offloading or moving inspections between devices. Old v1 backups are upgraded as they are opened. Export PDF uses the same stored graph coordinates as the editor and preview.
        </p>
      </div>
      <div class="shortcut-grid">
        <span>Undo <kbd>Ctrl / ⌘ Z</kbd></span>
        <span>Save <kbd>Ctrl / ⌘ S</kbd></span>
        <span>Finish outline <kbd>Enter</kbd></span>
        <span>Cancel / stop line <kbd>Esc</kbd></span>
        <span>Select tool <kbd>V</kbd></span>
        <span>Curve tool <kbd>C</kbd></span>
      </div>
      <button class="btn btn-primary w-full mt-5" @click="modal = null">
        Back to the graph
      </button></ModalShell
    >
  </div>
</template>

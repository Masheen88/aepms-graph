<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Plus,
  Minus,
  Maximize,
  Check,
  X,
  Crosshair,
  Hand,
  MousePointer2,
  Trash2,
  Copy,
  EyeOff,
  RotateCcw,
  FlipHorizontal2,
  Unlink,
  CircleEllipsis,
  Ruler,
  ScanLine,
  Square,
  Type,
  MoveUpRight,
  Grid2X2,
} from "lucide-vue-next";
import ShapeItem from "./ShapeItem.vue";
import { GRID, clone, newItem } from "../lib/model.js";
import {
  constrained,
  translatePoints,
  resizePoints,
  clamp,
  bounds,
  rotatePoint,
  snapStepForScale,
  primitivesForItems,
} from "../lib/geometry.js";

const props = defineProps({
  items: Array,
  tool: String,
  symbol: Object,
  selectedId: String,
  selectedIds: { type: Array, default: () => [] },
  snap: Boolean,
  scaleLabel: String,
  feetPerSquare: { type: Number, default: 1 },
  gridUnit: { type: String, default: "ft" },
  graphStyle: { type: Object, default: () => ({}) },
  lineAutoConnect: { type: Boolean, default: true },
  multiSelectMode: { type: Boolean, default: false },
});
const emit = defineEmits([
  "update:items",
  "update:selectedId",
  "update:selectedIds",
  "change",
  "select-tool",
  "position",
  "quick-action",
]);
const wrap = ref(null),
  svg = ref(null),
  view = ref({ x: -35, y: -35, w: 870, h: 890 }),
  drawing = ref(null),
  pending = ref([]),
  pendingTool = ref(null),
  lineAnchor = ref(null),
  quickPan = ref(false),
  marquee = ref(null),
  coarsePointer = ref(false),
  activeVertexIndex = ref(null),
  radialMenu = ref(null);
const selectedSet = computed(() => new Set(props.selectedIds || []));
const selectedItems = computed(() =>
  props.items.filter((item) => selectedSet.value.has(item.id)),
);
const singleSelected = computed(() =>
  selectedItems.value.length === 1 ? selectedItems.value[0] : null,
);
const zoom = computed(() => Math.round((870 / view.value.w) * 100));
const snapStep = computed(() => snapStepForScale(props.feetPerSquare));
const showSnapSubdivision = computed(() => snapStep.value < GRID.step - 0.001);
const laidOutMarks = computed(() => {
  const entries = primitivesForItems(props.items, {
    feetPerSquare: props.feetPerSquare,
    gridUnit: props.gridUnit,
    graphStyle: props.graphStyle,
  });
  return new Map(entries.map((entry) => [entry.id, entry.marks]));
});
const pointers = new Map();
let action = null,
  gesture = null,
  before = null,
  space = false,
  longPressTimer = null,
  pressState = null,
  longPressPointerId = null;
// Keep the visible edit handles compact while giving touch users a larger invisible grab target.
const radius = computed(() => ((coarsePointer.value ? 9 : 6) * view.value.w) / 870);
const handleHitRadius = computed(() => ((coarsePointer.value ? 54 : 18) * view.value.w) / 870);
const selectedBounds = computed(() =>
  singleSelected.value ? bounds(singleSelected.value) : null,
);
function mergeBounds(items) {
  if (!items.length) return null;
  const list = items.map((item) => bounds(item));
  return {
    x: Math.min(...list.map((box) => box.x)),
    y: Math.min(...list.map((box) => box.y)),
    right: Math.max(...list.map((box) => box.right)),
    bottom: Math.max(...list.map((box) => box.bottom)),
  };
}
const groupBounds = computed(() => mergeBounds(selectedItems.value));
const selectedBoxes = computed(() =>
  selectedItems.value.map((item) => ({ id: item.id, ...bounds(item) })),
);
function denseArrayValue(source, index, value, filler) {
  // Never create sparse arrays. JSON serializes sparse slots as null, which caused
  // older drafts to fail schema validation during Save and unsaved PDF export.
  const next = Array.isArray(source) ? [...source] : [];
  while (next.length <= index) next.push(typeof filler === "function" ? filler() : filler);
  next[index] = value;
  return next;
}
const resizeHandles = computed(() => {
  if (!selectedBounds.value || singleSelected.value?.points.length < 2) return [];
  const b = selectedBounds.value;
  return [
    { key: "nw", x: b.x, y: b.y },
    { key: "ne", x: b.right, y: b.y },
    { key: "se", x: b.right, y: b.bottom },
    { key: "sw", x: b.x, y: b.bottom },
  ];
});
function paddedFrame(box) {
  if (!box) return null;
  const pad = handleHitRadius.value;
  const width = Math.max(box.right - box.x, pad * 2);
  const height = Math.max(box.bottom - box.y, pad * 2);
  const centerX = (box.x + box.right) / 2;
  const centerY = (box.y + box.bottom) / 2;
  return {
    x: centerX - width / 2 - pad,
    y: centerY - height / 2 - pad,
    width: width + pad * 2,
    height: height + pad * 2,
  };
}
const selectionFrame = computed(() => paddedFrame(selectedBounds.value));
const groupFrame = computed(() => paddedFrame(groupBounds.value));
const rotateHandle = computed(() => {
  if (
    !singleSelected.value ||
    props.tool !== "select" ||
    singleSelected.value.points.length !== 1 ||
    !["symbol", "label"].includes(singleSelected.value.type)
  )
    return null;
  const center = singleSelected.value.points[0];
  const handle = rotatePoint(
    { x: center.x, y: center.y - handleHitRadius.value * 2.6 },
    center,
    singleSelected.value.rotation || 0,
  );
  return { ...handle, center };
});

const editablePointHandles = computed(() => {
  const item = singleSelected.value;
  if (!item || item.type === "freehand") return [];
  // Curves can contain hundreds of sampled points. Expose a useful subset of control
  // handles so phone users can reshape them without covering the whole path in dots.
  if (item.type === "curve" && item.points.length > 14) {
    const step = Math.ceil((item.points.length - 1) / 12);
    const indexes = new Set([0, item.points.length - 1]);
    for (let index = step; index < item.points.length - 1; index += step) indexes.add(index);
    return [...indexes].sort((a, b) => a - b).map((index) => ({ index, point: item.points[index] }));
  }
  return item.points.map((point, index) => ({ index, point }));
});

function insertionPoint(start, end) {
  if (!start || !end) return null;
  const raw = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const point = constrained(raw, props.snap ? snapStep.value : false);
  // If a snapped midpoint lands directly on an existing endpoint, there is no
  // additional grid location available on this short segment. Hide/skip the + control.
  if (
    props.snap &&
    ([start, end].some((endpoint) => Math.hypot(endpoint.x - point.x, endpoint.y - point.y) < 0.01))
  )
    return null;
  return point;
}

const insertPointHandles = computed(() => {
  const item = singleSelected.value;
  if (!item || !["outline", "line"].includes(item.type) || item.points.length < 2) return [];
  const segmentCount = item.points.length - 1 + (item.closed ? 1 : 0);
  return Array.from({ length: segmentCount }, (_, index) => {
    const start = item.points[index];
    const end = item.points[(index + 1) % item.points.length];
    return { index, point: insertionPoint(start, end) };
  }).filter((handle) => handle.point);
});

function insertPointAtSegment(segmentIndex) {
  const item = singleSelected.value;
  if (!item || !["outline", "line"].includes(item.type) || item.points.length >= 6000) return;
  const start = item.points[segmentIndex];
  const end = item.points[(segmentIndex + 1) % item.points.length];
  const midpoint = insertionPoint(start, end);
  if (!midpoint) return;
  const points = clone(item.points);
  const pointLinks = clone(item.pointLinks || []);
  points.splice(segmentIndex + 1, 0, midpoint);
  pointLinks.splice(segmentIndex + 1, 0, "");
  const items = props.items.map((entry) =>
    entry.id === item.id
      ? {
          ...entry,
          points,
          pointLinks,
          measurementOffsets: [],
          hiddenMeasurements: [],
          measurementSideOverrides: [],
          measurementDistance: 0,
          measurementSide: "normal",
        }
      : entry,
  );
  activeVertexIndex.value = segmentIndex + 1;
  updateItems(items);
  commit(items);
}

function minimumPointCount(item) {
  if (!item) return 0;
  return item.type === "outline" && item.closed ? 3 : 2;
}
function canDeletePoint(item, index) {
  return Boolean(
    item &&
      ["outline", "line"].includes(item.type) &&
      item.points[index] &&
      item.points.length > minimumPointCount(item),
  );
}
function deletePoint(itemId, index) {
  const item = props.items.find((entry) => entry.id === itemId);
  if (!canDeletePoint(item, index)) return;
  const points = clone(item.points);
  const pointLinks = clone(item.pointLinks || []);
  points.splice(index, 1);
  pointLinks.splice(index, 1);
  const items = props.items.map((entry) =>
    entry.id === itemId
      ? {
          ...entry,
          points,
          pointLinks,
          // Segment indexes change when a vertex disappears, so clear only annotation
          // layout metadata rather than risking stale offsets on the wrong wall.
          measurementOffsets: [],
          hiddenMeasurements: [],
          measurementSideOverrides: [],
        }
      : entry,
  );
  activeVertexIndex.value = null;
  updateItems(items);
  commit(items);
}
function releasePointWeld(itemId, index) {
  const item = props.items.find((entry) => entry.id === itemId);
  if (!item?.pointLinks?.[index]) return;
  const pointLinks = clone(item.pointLinks || []);
  pointLinks[index] = "";
  const items = props.items.map((entry) =>
    entry.id === itemId ? { ...entry, pointLinks } : entry,
  );
  updateItems(items);
  commit(items);
}
function hideMeasurement(itemId, index) {
  const items = props.items.map((entry) => {
    if (entry.id !== itemId) return entry;
    const hiddenMeasurements = [...new Set([...(entry.hiddenMeasurements || []), index])];
    return { ...entry, hiddenMeasurements };
  });
  updateItems(items);
  commit(items);
}
function resetMeasurement(itemId, index) {
  const items = props.items.map((entry) => {
    if (entry.id !== itemId) return entry;
    const measurementOffsets = denseArrayValue(
      entry.measurementOffsets,
      index,
      { x: 0, y: 0 },
      () => ({ x: 0, y: 0 }),
    );
    const measurementSideOverrides = denseArrayValue(
      entry.measurementSideOverrides,
      index,
      "inherit",
      "inherit",
    );
    return {
      ...entry,
      measurementOffsets,
      measurementSideOverrides,
      hiddenMeasurements: (entry.hiddenMeasurements || []).filter((value) => value !== index),
    };
  });
  updateItems(items);
  commit(items);
}
function flipMeasurement(itemId, index) {
  const items = props.items.map((entry) => {
    if (entry.id !== itemId) return entry;
    const current = entry.measurementSideOverrides?.[index] === "inherit" || !entry.measurementSideOverrides?.[index]
      ? entry.measurementSide || "normal"
      : entry.measurementSideOverrides[index];
    const overrides = denseArrayValue(
      entry.measurementSideOverrides,
      index,
      current === "opposite" ? "normal" : "opposite",
      "inherit",
    );
    return {
      ...entry,
      measurementSideOverrides: overrides,
      hiddenMeasurements: (entry.hiddenMeasurements || []).filter((value) => value !== index),
    };
  });
  updateItems(items);
  commit(items);
}
function toggleSelectionMeasurements() {
  if (!selectedItems.value.length) return;
  const measurable = selectedItems.value.filter((item) =>
    ["rect", "ellipse", "outline", "line", "curve"].includes(item.type),
  );
  if (!measurable.length) return;
  const next = measurable.some((item) => item.showMeasurements === false);
  const ids = new Set(measurable.map((item) => item.id));
  const items = props.items.map((item) =>
    ids.has(item.id) ? { ...item, showMeasurements: next } : item,
  );
  updateItems(items);
  commit(items);
}
function resetSelectionAnnotations() {
  if (!selectedItems.value.length) return;
  const ids = new Set(selectedItems.value.map((item) => item.id));
  const items = props.items.map((item) =>
    ids.has(item.id)
      ? {
          ...item,
          labelOffset: { x: 0, y: 0 },
          measurementOffsets: [],
          hiddenMeasurements: [],
          measurementSideOverrides: [],
        }
      : item,
  );
  updateItems(items);
  commit(items);
}

const activeVertexHandle = computed(() => {
  const item = singleSelected.value;
  const index = activeVertexIndex.value;
  if (!item || index === null || !canDeletePoint(item, index)) return null;
  return { itemId: item.id, index, point: item.points[index] };
});

const radialActions = computed(() => {
  const context = radialMenu.value?.context;
  if (!context) return [];
  if (context.kind === "point") {
    const item = props.items.find((entry) => entry.id === context.itemId);
    const actions = [];
    if (canDeletePoint(item, context.index))
      actions.push({ id: "delete-point", label: "Delete point", icon: Trash2, danger: true });
    const canInsert = item && ["outline", "line"].includes(item.type) &&
      (context.index < item.points.length - 1 || item.closed);
    if (canInsert) actions.push({ id: "insert-point", label: "Add after", icon: Plus });
    if (item?.pointLinks?.[context.index])
      actions.push({ id: "release-point", label: "Release corner", icon: Unlink });
    return actions;
  }
  if (context.kind === "measurement") {
    return [
      { id: "hide-measurement", label: "Hide", icon: EyeOff },
      { id: "reset-measurement", label: "Auto", icon: RotateCcw },
      { id: "flip-measurement", label: "Flip side", icon: FlipHorizontal2 },
    ];
  }
  if (context.kind === "item") {
    const measurable = selectedItems.value.some((item) =>
      ["rect", "ellipse", "outline", "line", "curve"].includes(item.type),
    );
    const actions = [
      { id: "duplicate-selection", label: "Copy", icon: Copy },
      { id: "delete-selection", label: "Delete", icon: Trash2, danger: true },
      { id: "reset-annotations", label: "Reset layout", icon: RotateCcw },
    ];
    if (measurable) {
      const measurableItems = selectedItems.value.filter((item) =>
        ["rect", "ellipse", "outline", "line", "curve"].includes(item.type),
      );
      const allShown = measurableItems.every((item) => item.showMeasurements !== false);
      actions.splice(2, 0, {
        id: "toggle-measurements",
        label: allShown ? "Dims off" : "Dims on",
        icon: Ruler,
      });
    }
    const straightLines = selectedItems.value.filter(
      (item) => item.type === "line" && item.points?.length === 2,
    );
    if (straightLines.length >= 2)
      actions.splice(actions.length - 1, 0, {
        id: "combine-lines",
        label: "Combine walls",
        icon: ScanLine,
      });
    if (straightLines.length === 1 && selectedItems.value.length === 1)
      actions.splice(actions.length - 1, 0, {
        id: "split-line",
        label: "Split length",
        icon: Plus,
      });
    return actions;
  }
  if (context.kind === "canvas") {
    return [
      { id: "tool:outline", label: "Outline", icon: ScanLine },
      { id: "tool:line", label: "Line", icon: MoveUpRight },
      { id: "tool:rect", label: "Area", icon: Square },
      { id: "tool:hatch", label: "Hatch", icon: Grid2X2 },
      { id: "tool:label", label: "Label", icon: Type },
      { id: "tool:pan", label: "Pan", icon: Hand },
      { id: "tool:select", label: "Select", icon: MousePointer2 },
      { id: "reset-all-measurements", label: "Reflow dims", icon: RotateCcw },
    ];
  }
  return [];
});

function radialButtonStyle(index, total) {
  const start = -Math.PI / 2;
  const angle = start + (Math.PI * 2 * index) / Math.max(1, total);
  const distance = total > 5 ? 88 : 80;
  const dx = Math.cos(angle) * distance;
  const dy = Math.sin(angle) * distance;
  return { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))` };
}
function clearLongPress() {
  if (longPressTimer) clearTimeout(longPressTimer);
  longPressTimer = null;
  pressState = null;
}
function closeRadial() {
  radialMenu.value = null;
}
function openRadial(clientX, clientY, context) {
  const rect = wrap.value?.getBoundingClientRect();
  if (!rect) return;
  // Keep the whole ring inside the canvas on phones so edge vertices are still usable.
  radialMenu.value = {
    left: clamp(clientX - rect.left, 102, Math.max(102, rect.width - 102)),
    top: clamp(clientY - rect.top, 112, Math.max(112, rect.height - 112)),
    context,
  };
}
function scheduleLongPress(event, context) {
  if (!["touch", "pen"].includes(event.pointerType)) return;
  clearLongPress();
  pressState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
    context,
  };
  longPressTimer = setTimeout(() => {
    if (!pressState || pressState.pointerId !== event.pointerId) return;
    longPressPointerId = event.pointerId;
    // A hold is a command gesture, not the beginning of a drag. Any provisional
    // move/handle action is discarded before the radial menu appears.
    action = null;
    before = null;
    drawing.value = null;
    marquee.value = null;
    openRadial(pressState.clientX, pressState.clientY, pressState.context);
    clearLongPress();
  }, 460);
}
function openQuickToolRadial() {
  const rect = wrap.value?.getBoundingClientRect();
  if (!rect) return;
  openRadial(rect.left + Math.min(rect.width * 0.7, rect.width - 112), rect.top + Math.min(190, rect.height * 0.38), { kind: "canvas" });
}
function runRadialAction(actionId) {
  const context = radialMenu.value?.context;
  if (!context) return;
  if (actionId.startsWith("tool:")) {
    emit("select-tool", actionId.slice(5));
  } else if (actionId === "delete-point") {
    deletePoint(context.itemId, context.index);
  } else if (actionId === "insert-point") {
    insertPointAtSegment(context.index);
  } else if (actionId === "release-point") {
    releasePointWeld(context.itemId, context.index);
  } else if (actionId === "hide-measurement") {
    hideMeasurement(context.itemId, context.index);
  } else if (actionId === "reset-measurement") {
    resetMeasurement(context.itemId, context.index);
  } else if (actionId === "flip-measurement") {
    flipMeasurement(context.itemId, context.index);
  } else if (actionId === "toggle-measurements") {
    toggleSelectionMeasurements();
  } else if (actionId === "reset-annotations") {
    resetSelectionAnnotations();
  } else if (actionId === "combine-lines") {
    emit("quick-action", "combine-lines");
  } else if (actionId === "split-line") {
    emit("quick-action", "split-line");
  } else if (actionId === "duplicate-selection") {
    emit("quick-action", "duplicate");
  } else if (actionId === "delete-selection") {
    emit("quick-action", "delete");
  } else if (actionId === "reset-all-measurements") {
    emit("quick-action", "reset-measurements");
  }
  closeRadial();
}

const lineChainMarker = computed(() =>
  props.tool === "line" && props.lineAutoConnect && lineAnchor.value
    ? lineAnchor.value
    : null,
);
const hint = computed(
  () =>
    ({
      select:
        "Tap an object to select it. Tap a white line/outline point to expose its delete control. Hold a point, measurement, object, or empty canvas for quick radial actions. Measurements stay attached to their walls; hold one to hide, reset, or flip it. Reflow dims restores Smart + Clean placement when a dense area becomes confusing. Labels remain freely movable. Select overlapping straight walls to combine them, or split one length into two sections.",
      outline:
        "Tap to add corners. Tap the first corner or choose Finish to close.",
      rect: "Drag from one corner to the opposite corner.",
      rounded: "Drag a rounded area. Radius size snaps to the active drawing grid and can be changed in Edit.",
      beveled: "Drag a beveled area. Chamfer size snaps to the active drawing grid and can be changed in Edit.",
      ellipse: "Drag an oval or circular area. Add hatch marks from Edit if needed.",
      hatch: "Drag a rectangular hatch area, then edit its label or pattern.",
      hatchpoly: "Tap each corner of an irregular hatch area, then choose Finish.",
      garage: "Drag to place a garage.",
      crawlspace: "Drag to place a crawlspace.",
      line: "Drag to draw a line. Line stays active for the next segment; auto-connect can continue from the previous endpoint. Press V or Esc when finished.",
      curve:
        "Drag to draw a curved path. Turn on Closed shape and a hatch pattern afterwards for curved walkways or beds.",
      curvearea:
        "Draw a curved closed area for gardens or curved sidewalks; it starts with diagonal hatch marks.",
      freehand: "Draw with your finger, pen, or mouse.",
      label: "Tap the grid to place a label.",
      point: "Tap to add a point.",
      symbol: `Tap to place ${props.symbol?.title?.toLowerCase() || "a symbol"}.`,
      pan: "Drag to move the graph. Pinch or scroll to zoom.",
    })[props.tool],
);

function screenPoint(event) {
  const matrix = svg.value?.getScreenCTM();
  return matrix
    ? new DOMPoint(event.clientX, event.clientY).matrixTransform(
        matrix.inverse(),
      )
    : { x: 0, y: 0 };
}
function gridPoint(event) {
  const shouldSnap = props.snap && !["freehand", "curve", "curvearea"].includes(props.tool);
  return constrained(screenPoint(event), shouldSnap ? snapStep.value : false);
}
function rawGridPoint(event) {
  return constrained(screenPoint(event), false);
}
function setSelection(ids = [], primaryId = null) {
  const valid = props.items.map((item) => item.id).filter((id) => ids.includes(id));
  const unique = [...new Set(valid)];
  emit("update:selectedIds", unique);
  emit(
    "update:selectedId",
    primaryId && unique.includes(primaryId) ? primaryId : unique.at(-1) || null,
  );
}
function toggleSelection(id) {
  const ids = selectedSet.value.has(id)
    ? props.selectedIds.filter((value) => value !== id)
    : [...props.selectedIds, id];
  setSelection(ids, ids.at(-1) || null);
}
function clearSelection() {
  setSelection([]);
}
function updateItems(items) {
  emit("update:items", items);
}
function commit(items) {
  emit("change", clone(items));
}
function fit() {
  view.value = { x: -35, y: -35, w: 870, h: 890 };
}
function clearLineAnchor() {
  lineAnchor.value = null;
}
function zoomAt(
  factor,
  point = {
    x: view.value.x + view.value.w / 2,
    y: view.value.y + view.value.h / 2,
  },
) {
  const v = view.value,
    w = clamp(v.w / factor, 109, 1740),
    ratio = w / v.w;
  view.value = {
    x: point.x - (point.x - v.x) * ratio,
    y: point.y - (point.y - v.y) * ratio,
    w,
    h: v.h * ratio,
  };
}
function wheel(event) {
  zoomAt(Math.exp(-clamp(event.deltaY, -100, 100) * 0.008), screenPoint(event));
}
function resetInteraction(restore = false) {
  if (restore && before) updateItems(before);
  action = null;
  before = null;
  drawing.value = null;
  marquee.value = null;
}
function finishOutline(close = true) {
  const hatchPolygon = pendingTool.value === "hatchpoly";
  const minimumPoints = hatchPolygon ? 3 : 2;
  if (pending.value.length >= minimumPoints) {
    const shape = newItem("outline", clone(pending.value), {
      closed: hatchPolygon ? pending.value.length >= 3 : close && pending.value.length >= 3,
      text: hatchPolygon ? "Hatched area" : "",
      pattern: hatchPolygon ? "diagonal" : "none",
      showMeasurements: props.graphStyle.showMeasurements !== false,
    });
    commit([...props.items, shape]);
    setSelection([shape.id], shape.id);
    // Explicitly finishing a structure enters edit mode so mistakes can be corrected.
    if (close || hatchPolygon) emit("select-tool", "select");
  }
  pending.value = [];
  pendingTool.value = null;
}
function cancel() {
  pending.value = [];
  pendingTool.value = null;
  resetInteraction(true);
}
function movementForGroup(group, dx, dy) {
  const box = mergeBounds(group.map((entry) => ({ points: entry.points })));
  const allowedDx = clamp(dx, -box.x, GRID.width - box.right);
  const allowedDy = clamp(dy, -box.y, GRID.height - box.bottom);
  return { dx: allowedDx, dy: allowedDy };
}
// Keep welded vertices coincident when an entire object/group changes shape or position.
// The moved objects are authoritative for their shared link ids; linked points on
// unselected shapes follow without requiring a destructive geometry merge.
function propagateWeldedPoints(items, sourceIds) {
  const ids = new Set(sourceIds);
  const positions = new Map();
  for (const item of items) {
    if (!ids.has(item.id)) continue;
    (item.pointLinks || []).forEach((linkId, index) => {
      if (linkId && item.points[index]) positions.set(linkId, item.points[index]);
    });
  }
  if (!positions.size) return items;
  return items.map((item) => {
    if (ids.has(item.id)) return item;
    let changed = false;
    const points = clone(item.points);
    (item.pointLinks || []).forEach((linkId, index) => {
      const position = positions.get(linkId);
      if (!position || !points[index]) return;
      points[index] = clone(position);
      changed = true;
    });
    return changed ? { ...item, points } : item;
  });
}
function intersectsSelection(item, area) {
  const box = bounds(item);
  return !(
    box.right < area.x ||
    box.x > area.right ||
    box.bottom < area.y ||
    box.y > area.bottom
  );
}
function pointerDown(event) {
  if (event.button > 0 && event.button !== 1) return;
  if (radialMenu.value) closeRadial();
  const directPointDelete = event.target.closest?.("[data-delete-point]");
  if (directPointDelete && singleSelected.value) {
    deletePoint(singleSelected.value.id, Number(directPointDelete.dataset.deletePoint));
    return;
  }
  svg.value.focus({ preventScroll: true });
  svg.value.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
    clearLongPress();
    resetInteraction(true);
    const [a, b] = [...pointers.values()];
    const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
    gesture = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      view: { ...view.value },
      world: screenPoint(mid),
    };
    return;
  }
  if (pointers.size > 1) return;
  const p = gridPoint(event);
  const targetId = event.target.closest("[data-item-id]")?.dataset.itemId;
  const editControl = event.target.closest(
    "[data-insert-point], [data-rotate], [data-resize], [data-handle], [data-measurement-index], [data-geometry-label]",
  );
  if (props.tool === "select") {
    const holdHandle = event.target.closest("[data-handle]");
    const holdMeasurement = event.target.closest("[data-measurement-index]");
    if (holdHandle && singleSelected.value) {
      scheduleLongPress(event, {
        kind: "point",
        itemId: singleSelected.value.id,
        index: Number(holdHandle.dataset.handle),
      });
    } else if (holdMeasurement && targetId) {
      scheduleLongPress(event, {
        kind: "measurement",
        itemId: targetId,
        index: Number(holdMeasurement.dataset.measurementIndex),
      });
    } else if (targetId) {
      scheduleLongPress(event, { kind: "item", itemId: targetId });
    } else if (["touch", "pen"].includes(event.pointerType)) {
      scheduleLongPress(event, { kind: "canvas" });
    }
  }
  if (
    props.tool === "pan" ||
    quickPan.value ||
    event.button === 1 ||
    space ||
    (event.pointerType === "touch" && props.tool === "select" && !targetId && !editControl)
  ) {
    action = {
      kind: "pan",
      x: event.clientX,
      y: event.clientY,
      view: { ...view.value },
      screenScale: svg.value.getScreenCTM().a,
    };
    return;
  }
  if (props.tool === "select") {
    const insertPoint = event.target.closest("[data-insert-point]");
    if (insertPoint && singleSelected.value) {
      insertPointAtSegment(Number(insertPoint.dataset.insertPoint));
      return;
    }
    const measurement = event.target.closest("[data-measurement-index]");
    const geometryLabel = event.target.closest("[data-geometry-label]");
    if (measurement && targetId) {
      // Measurements stay attached to their wall. Free dragging made it too easy to
      // create a dimension that visually belonged to the wrong segment. Tap selects
      // the object; press/hold the value for Hide, Auto, or Flip side.
      setSelection([targetId], targetId);
      return;
    }
    if (geometryLabel && targetId) {
      // Labels are descriptive annotations, so they remain freely movable.
      const targetItem = props.items.find((item) => item.id === targetId);
      if (!targetItem) return;
      setSelection([targetId], targetId);
      before = clone(props.items);
      const original = clone(targetItem);
      action = {
        kind: "label-offset",
        id: original.id,
        index: null,
        start: rawGridPoint(event),
        original,
      };
      return;
    }
    const rotate = event.target.closest("[data-rotate]");
    const resize = event.target.closest("[data-resize]");
    const handle = event.target.closest("[data-handle]");
    if ((rotate || resize || handle) && singleSelected.value) {
      if (handle) activeVertexIndex.value = Number(handle.dataset.handle);
      before = clone(props.items);
      const original = clone(singleSelected.value);
      const box = bounds(original);
      action = {
        kind: rotate ? "rotate" : resize ? "resize" : "handle",
        id: original.id,
        index: handle ? Number(handle.dataset.handle) : null,
        corner: resize?.dataset.resize || null,
        start: p,
        original,
        center:
          original.points.length === 1
            ? original.points[0]
            : { x: (box.x + box.right) / 2, y: (box.y + box.bottom) / 2 },
      };
      return;
    }

    const additive = props.multiSelectMode || event.shiftKey || event.metaKey || event.ctrlKey;
    if (targetId) {
      activeVertexIndex.value = null;
      if (additive) {
        toggleSelection(targetId);
        return;
      }
      const targetItem = props.items.find((item) => item.id === targetId);
      const groupedIds = targetItem?.groupId
        ? props.items.filter((item) => item.groupId === targetItem.groupId).map((item) => item.id)
        : [];
      const moveIds = groupedIds.length > 1
        ? groupedIds
        : selectedSet.value.has(targetId) && selectedItems.value.length > 1
          ? [...props.selectedIds]
          : [targetId];
      setSelection(moveIds, targetId);
      before = clone(props.items);
      if (moveIds.length > 1) {
        action = {
          kind: "move-group",
          ids: moveIds,
          start: p,
          originals: props.items
            .filter((item) => moveIds.includes(item.id))
            .map((item) => ({ id: item.id, points: clone(item.points) })),
        };
      } else {
        const original = clone(props.items.find((item) => item.id === targetId));
        action = { kind: "move", id: targetId, start: p, original };
      }
      return;
    }

    // Desktop users can drag a selection box. Touch users pan empty space instead.
    if (event.pointerType !== "touch") {
      marquee.value = { start: rawGridPoint(event), current: rawGridPoint(event) };
      action = {
        kind: "marquee",
        start: rawGridPoint(event),
        current: rawGridPoint(event),
        additive,
      };
      return;
    }
    activeVertexIndex.value = null;
    clearSelection();
    return;
  }
  // Ignore drawing outside the paper instead of pinning stray taps to its edge.
  const raw = screenPoint(event);
  if (raw.x < 0 || raw.x > GRID.width || raw.y < 0 || raw.y > GRID.height)
    return;
  if (["outline", "hatchpoly"].includes(props.tool)) {
    // Place on release so a second finger can turn this tap into a pinch gesture.
    action = { kind: "corner", point: p, tool: props.tool };
    return;
  }
  if (["label", "symbol", "point"].includes(props.tool)) {
    action = {
      kind: "place",
      point: p,
      tool: props.tool,
      symbol: props.symbol,
    };
    return;
  }
  const type = ["garage", "crawlspace", "hatch", "rounded", "beveled"].includes(props.tool)
    ? "rect"
    : props.tool === "curvearea"
      ? "curve"
      : props.tool;
  const start =
    props.tool === "line" && props.lineAutoConnect && lineAnchor.value && !event.altKey
      ? clone(lineAnchor.value)
      : p;
  if (props.tool === "line" && event.altKey) clearLineAnchor();
  drawing.value = newItem(type, [start], {
    text:
      props.tool === "garage"
        ? "Garage"
        : props.tool === "crawlspace"
          ? "Crawlspace"
          : props.tool === "hatch"
            ? "Slab / paved area"
            : props.tool === "rounded"
              ? "Rounded area"
              : props.tool === "beveled"
                ? "Beveled area"
                : props.tool === "ellipse"
                ? "Oval area"
                : props.tool === "curvearea"
                  ? "Curved area"
                  : "",
    pattern: ["hatch", "curvearea"].includes(props.tool) ? "diagonal" : "none",
    closed: props.tool === "curvearea",
    cornerStyle:
      props.tool === "rounded" ? "round" : props.tool === "beveled" ? "bevel" : "square",
    cornerRadius: ["rounded", "beveled"].includes(props.tool) ? 20 : 0,
    showMeasurements: props.graphStyle.showMeasurements !== false,
  });
  if (["rect", "ellipse", "line", "garage", "crawlspace", "hatch", "rounded", "beveled"].includes(props.tool))
    drawing.value.points = [start, start];
  action = { kind: "create", start };
}
function pointerMove(event) {
  const p = gridPoint(event);
  emit("position", p);
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pressState?.pointerId === event.pointerId) {
    const moved = Math.hypot(event.clientX - pressState.startX, event.clientY - pressState.startY);
    // Keep a held finger stable until it clearly becomes a drag. This prevents tiny
    // touch jitter from nudging a vertex/object just before its radial menu opens.
    if (moved <= 12) return;
    clearLongPress();
  }
  if (longPressPointerId === event.pointerId) return;
  if (gesture && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const factor = Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance;
    const w = clamp(gesture.view.w / factor, 109, 1740),
      ratio = w / gesture.view.w;
    view.value = {
      x: gesture.world.x - (gesture.world.x - gesture.view.x) * ratio,
      y: gesture.world.y - (gesture.world.y - gesture.view.y) * ratio,
      w,
      h: gesture.view.h * ratio,
    };
    const current = screenPoint({
      clientX: (a.x + b.x) / 2,
      clientY: (a.y + b.y) / 2,
    });
    view.value.x += gesture.world.x - current.x;
    view.value.y += gesture.world.y - current.y;
    return;
  }
  if (!action) return;
  if (action.kind === "pan") {
    view.value = {
      ...action.view,
      x: action.view.x - (event.clientX - action.x) / action.screenScale,
      y: action.view.y - (event.clientY - action.y) / action.screenScale,
    };
    return;
  }
  if (action.kind === "marquee") {
    action.current = rawGridPoint(event);
    marquee.value = { start: action.start, current: action.current };
    return;
  }
  if (action.kind === "create") {
    if (["freehand", "curve"].includes(drawing.value.type)) {
      const points = drawing.value.points,
        prev = points.at(-1);
      if (Math.hypot(p.x - prev.x, p.y - prev.y) > 0.7 && points.length < 6000)
        points.push(p);
    } else drawing.value.points = [action.start, p];
    return;
  }
  if (action.kind === "label-offset") {
    const current = rawGridPoint(event);
    const originalOffset = action.original.labelOffset || { x: 0, y: 0 };
    const labelOffset = {
      x: clamp(originalOffset.x + current.x - action.start.x, -GRID.width, GRID.width),
      y: clamp(originalOffset.y + current.y - action.start.y, -GRID.height, GRID.height),
    };
    updateItems(
      props.items.map((item) => (item.id === action.id ? { ...item, labelOffset } : item)),
    );
    return;
  }
  if (action.kind === "rotate") {
    let degrees = (Math.atan2(p.y - action.center.y, p.x - action.center.x) * 180) / Math.PI + 90;
    if (!event.shiftKey) degrees = Math.round(degrees / 15) * 15;
    if (degrees > 180) degrees -= 360;
    if (degrees < -180) degrees += 360;
    updateItems(
      props.items.map((i) =>
        i.id === action.id ? { ...i, rotation: clamp(degrees, -180, 180) } : i,
      ),
    );
    return;
  }
  if (action.kind === "resize") {
    const points = resizePoints(action.original.points, action.corner, p);
    const resized = props.items.map((i) =>
      i.id === action.id ? { ...i, points } : i,
    );
    updateItems(propagateWeldedPoints(resized, [action.id]));
    return;
  }
  if (action.kind === "handle") {
    const linkId = action.original.pointLinks?.[action.index] || "";
    updateItems(
      props.items.map((item) => {
        const points = clone(
          item.id === action.id
            ? action.original.points
            : before?.find((entry) => entry.id === item.id)?.points || item.points,
        );
        let changed = false;
        if (item.id === action.id) {
          points[action.index] = p;
          changed = true;
        }
        if (linkId) {
          (item.pointLinks || []).forEach((value, index) => {
            if (value === linkId) {
              points[index] = p;
              changed = true;
            }
          });
        }
        return changed ? { ...item, points } : item;
      }),
    );
    return;
  }
  if (action.kind === "move") {
    const points = translatePoints(
      action.original.points,
      p.x - action.start.x,
      p.y - action.start.y,
    );
    const dx = points[0].x - action.original.points[0].x;
    const dy = points[0].y - action.original.points[0].y;
    const linkedIds = new Set((action.original.pointLinks || []).filter(Boolean));
    updateItems(
      props.items.map((item) => {
        if (item.id === action.id) return { ...item, points };
        if (!linkedIds.size || !(item.pointLinks || []).some((id) => linkedIds.has(id))) return item;
        const original = before?.find((entry) => entry.id === item.id) || item;
        const linkedPoints = clone(original.points);
        (original.pointLinks || []).forEach((id, index) => {
          if (linkedIds.has(id)) {
            linkedPoints[index] = constrained(
              { x: linkedPoints[index].x + dx, y: linkedPoints[index].y + dy },
              false,
            );
          }
        });
        return { ...item, points: linkedPoints };
      }),
    );
    return;
  }
  if (action.kind === "move-group") {
    const { dx, dy } = movementForGroup(
      action.originals,
      p.x - action.start.x,
      p.y - action.start.y,
    );
    const moved = props.items.map((item) => {
      const original = action.originals.find((entry) => entry.id === item.id);
      return original
        ? { ...item, points: translatePoints(original.points, dx, dy) }
        : item;
    });
    updateItems(propagateWeldedPoints(moved, action.ids));
  }
}
function pointerUp(event) {
  clearLongPress();
  pointers.delete(event.pointerId);
  if (longPressPointerId === event.pointerId) {
    longPressPointerId = null;
    resetInteraction();
    return;
  }
  if (gesture) {
    if (pointers.size === 0) gesture = null;
    return;
  }
  if (action?.kind === "corner") {
    pendingTool.value ||= action.tool;
    const p = action.point,
      first = pending.value[0],
      last = pending.value.at(-1);
    if (
      first &&
      pending.value.length >= 3 &&
      Math.hypot(first.x - p.x, first.y - p.y) < radius.value * 2
    )
      finishOutline();
    else if (!last || last.x !== p.x || last.y !== p.y) pending.value.push(p);
  } else if (action?.kind === "place") {
    const { point, tool, symbol } = action;
    const shape = newItem(tool === "label" ? "label" : "symbol", [point], {
      text:
        tool === "label"
          ? "Custom label"
          : tool === "point"
            ? "●"
            : symbol.text,
      symbol: tool === "symbol" ? symbol.key : "",
      color: tool === "symbol" ? symbol.color : "#183b42",
      showMeasurements: props.graphStyle.showMeasurements !== false,
    });
    commit([...props.items, shape]);
    setSelection([shape.id], shape.id);
    emit("select-tool", "select");
  } else if (action?.kind === "marquee") {
    const dx = action.current.x - action.start.x;
    const dy = action.current.y - action.start.y;
    if (Math.hypot(dx, dy) < 5) {
      if (!action.additive) clearSelection();
    } else {
      const area = {
        x: Math.min(action.start.x, action.current.x),
        y: Math.min(action.start.y, action.current.y),
        right: Math.max(action.start.x, action.current.x),
        bottom: Math.max(action.start.y, action.current.y),
      };
      const hitIds = props.items.filter((item) => intersectsSelection(item, area)).map((item) => item.id);
      const ids = action.additive
        ? [...new Set([...props.selectedIds, ...hitIds])]
        : hitIds;
      setSelection(ids, ids.at(-1) || null);
    }
  } else if (action?.kind === "create" && drawing.value) {
    const b = bounds(drawing.value),
      validSize = Math.hypot(b.right - b.x, b.bottom - b.y) > 2,
      minimumPoints = drawing.value.closed && ["curve", "freehand"].includes(drawing.value.type) ? 3 : 2,
      validStroke = drawing.value.points.length >= minimumPoints && validSize;
    if (validStroke) {
      const created = clone(drawing.value);
      commit([...props.items, created]);
      setSelection([created.id], created.id);
      if (created.type === "line") {
        if (props.lineAutoConnect) lineAnchor.value = clone(created.points.at(-1));
        else clearLineAnchor();
      }
      // Line is intentionally a repeat tool for quickly tracing walls, slabs, walkways, etc.
      // Other drag tools still enter Select so the new object can be resized or corrected immediately.
      if (created.type !== "line") emit("select-tool", "select");
    }
  } else if (before) commit(props.items);
  resetInteraction();
}
function pointerCancel(event) {
  clearLongPress();
  if (longPressPointerId === event.pointerId) longPressPointerId = null;
  pointers.delete(event.pointerId);
  if (!pointers.size) gesture = null;
  resetInteraction(true);
}
function keydown(event) {
  if (event.code === "Space") {
    event.preventDefault();
    space = true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    finishOutline();
  }
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
    clearSelection();
    // Repeat-line mode needs an obvious keyboard exit that does not require clicking the toolbar.
    if (props.tool === "line") {
      clearLineAnchor();
      emit("select-tool", "select");
    }
  }
  if (event.key === "Backspace" && pending.value.length) {
    event.preventDefault();
    event.stopPropagation();
    pending.value.pop();
  }
  if (
    props.tool === "select" &&
    selectedItems.value.length &&
    ["Delete", "Backspace"].includes(event.key) &&
    !pending.value.length
  ) {
    event.preventDefault();
    event.stopPropagation();
    emit("quick-action", "delete");
  }
  if (
    selectedItems.value.length &&
    ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
  ) {
    event.preventDefault();
    const amount = event.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: [-amount, 0],
      ArrowRight: [amount, 0],
      ArrowUp: [0, -amount],
      ArrowDown: [0, amount],
    }[event.key];
    const ids = new Set(props.selectedIds);
    const originals = props.items
      .filter((item) => ids.has(item.id))
      .map((item) => ({ id: item.id, points: clone(item.points) }));
    const { dx, dy } = movementForGroup(originals, ...delta);
    const moved = props.items.map((item) =>
      ids.has(item.id)
        ? {
            ...item,
            points: translatePoints(
              originals.find((entry) => entry.id === item.id).points,
              dx,
              dy,
            ),
          }
        : item,
    );
    commit(propagateWeldedPoints(moved, ids));
  }
}
function releaseSpace() {
  space = false;
}
function toggleQuickPan() {
  quickPan.value = !quickPan.value;
}
function switchToSelect() {
  quickPan.value = false;
  emit("select-tool", "select");
}
watch(
  () => props.tool,
  (value) => {
    finishOutline(false);
    resetInteraction(true);
    if (value !== "line") clearLineAnchor();
    if (value !== "select") quickPan.value = false;
  },
);
watch(
  () => props.lineAutoConnect,
  (value) => {
    if (!value) clearLineAnchor();
  },
);
watch(
  () => props.selectedId,
  () => {
    activeVertexIndex.value = null;
    closeRadial();
  },
);
onMounted(() => {
  coarsePointer.value = globalThis.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
  window.addEventListener("keyup", releaseSpace);
});
onBeforeUnmount(() => {
  clearLongPress();
  window.removeEventListener("keyup", releaseSpace);
});
defineExpose({ fit, cancel, finishOutline, clearLineAnchor });
</script>

<template>
  <div ref="wrap" class="graph-wrap">
    <div class="canvas-topline">
      <span><Crosshair :size="15" /> STRUCTURE GRAPH</span
      ><span>{{ scaleLabel }}</span>
    </div>
    <svg
      ref="svg"
      class="graph-svg"
      :class="`cursor-${tool}`"
      :viewBox="`${view.x} ${view.y} ${view.w} ${view.h}`"
      tabindex="0"
      role="application"
      aria-label="Structure drawing grid. Choose a drawing tool, then tap or drag. Use arrow keys to move a selected object."
      @pointerdown.prevent="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="pointerCancel"
      @wheel.prevent="wheel"
      @keydown="keydown"
    >
      <defs>
        <pattern
          id="snap-grid"
          :width="snapStep"
          :height="snapStep"
          patternUnits="userSpaceOnUse"
        >
          <path
            :d="`M ${snapStep} 0 L 0 0 0 ${snapStep}`"
            fill="none"
            :stroke="graphStyle.minor || '#dce4e7'"
            stroke-width="0.35"
            stroke-opacity="0.45"
          />
        </pattern>
        <pattern
          id="minor-grid"
          width="10"
          height="10"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 10 0 L 0 0 0 10"
            fill="none"
            :stroke="graphStyle.minor || '#dce4e7'"
            stroke-width="0.6"
          />
        </pattern>
        <pattern
          id="major-grid"
          width="100"
          height="100"
          patternUnits="userSpaceOnUse"
        >
          <rect width="100" height="100" fill="url(#minor-grid)" />
          <path
            d="M 100 0 L 0 0 0 100"
            fill="none"
            :stroke="graphStyle.major || '#b9cbd0'"
            stroke-width="1"
          />
        </pattern>
        <clipPath id="paper-clip">
          <rect :width="GRID.width" :height="GRID.height" />
        </clipPath>
      </defs>
      <rect
        x="-3"
        y="-3"
        :width="GRID.width + 6"
        :height="GRID.height + 6"
        :fill="graphStyle.background || '#fffef8'"
        :stroke="graphStyle.major || '#ccd7db'"
        stroke-width="1"
      />
      <rect
        v-if="showSnapSubdivision"
        :width="GRID.width"
        :height="GRID.height"
        fill="url(#snap-grid)"
        pointer-events="none"
      />
      <rect :width="GRID.width" :height="GRID.height" fill="url(#major-grid)" />
      <g class="ruler-numbers" aria-hidden="true">
        <text
          v-for="n in 9"
          :key="`x${n}`"
          :x="(n - 1) * 100"
          y="-14"
          text-anchor="middle"
        >
          {{ Number(((n - 1) * 10 * feetPerSquare).toFixed(1)) }}
        </text>
        <text
          v-for="n in 9"
          :key="`y${n}`"
          x="-15"
          :y="(n - 1) * 100 + 4"
          text-anchor="end"
        >
          {{ Number(((n - 1) * 10 * feetPerSquare).toFixed(1)) }}
        </text>
      </g>
      <g clip-path="url(#paper-clip)">
        <g v-for="item in items" :key="item.id" :data-item-id="item.id">
          <ShapeItem
            :item="item"
            :feet-per-square="feetPerSquare"
            :grid-unit="gridUnit"
            :graph-style="graphStyle"
            :marks="laidOutMarks.get(item.id)"
          />
        </g>
        <ShapeItem
          v-if="drawing"
          :item="drawing"
          :feet-per-square="feetPerSquare"
          :grid-unit="gridUnit"
          :graph-style="graphStyle"
        />
        <polyline
          v-if="pending.length"
          :points="pending.map((p) => `${p.x},${p.y}`).join(' ')"
          fill="none"
          stroke="#157b79"
          stroke-width="2"
          stroke-dasharray="5 4"
        />
        <g v-if="lineChainMarker" class="line-chain-marker" pointer-events="none">
          <circle
            :cx="lineChainMarker.x"
            :cy="lineChainMarker.y"
            :r="handleHitRadius * 0.7"
            fill="#157b79"
            fill-opacity="0.12"
            stroke="#157b79"
            :stroke-width="Math.max(1, radius / 4)"
            stroke-dasharray="4 3"
          />
          <circle
            :cx="lineChainMarker.x"
            :cy="lineChainMarker.y"
            :r="radius * 0.65"
            fill="#157b79"
          />
        </g>
        <g v-if="marquee" class="selection-marquee" pointer-events="none">
          <rect
            :x="Math.min(marquee.start.x, marquee.current.x)"
            :y="Math.min(marquee.start.y, marquee.current.y)"
            :width="Math.abs(marquee.current.x - marquee.start.x)"
            :height="Math.abs(marquee.current.y - marquee.start.y)"
            fill="#157b7918"
            stroke="#157b79"
            :stroke-width="Math.max(1, radius / 4)"
            stroke-dasharray="6 4"
          />
        </g>
        <g v-if="props.selectedIds.length && tool === 'select'" class="selection-items" pointer-events="none">
          <rect
            v-for="box in selectedBoxes"
            :key="`box-${box.id}`"
            :x="box.x - 5"
            :y="box.y - 5"
            :width="Math.max(box.right - box.x + 10, 10)"
            :height="Math.max(box.bottom - box.y + 10, 10)"
            rx="6"
            fill="#157b790f"
            stroke="#157b7990"
            :stroke-width="Math.max(0.8, radius / 5)"
            stroke-dasharray="4 4"
          />
        </g>
      </g>
      <g v-if="singleSelected && tool === 'select'" class="selection-handles">
        <rect
          v-if="selectionFrame"
          class="selection-outline"
          :x="selectionFrame.x"
          :y="selectionFrame.y"
          :width="selectionFrame.width"
          :height="selectionFrame.height"
          :rx="handleHitRadius / 2"
          fill="none"
          stroke="#157b79"
          :stroke-width="Math.max(1, radius / 4)"
          stroke-dasharray="5 4"
          pointer-events="none"
        />
        <g v-if="rotateHandle" class="selection-rotate-control">
          <line
            :x1="rotateHandle.center.x"
            :y1="rotateHandle.center.y"
            :x2="rotateHandle.x"
            :y2="rotateHandle.y"
            stroke="#157b79"
            :stroke-width="Math.max(1, radius / 4)"
            stroke-dasharray="4 3"
            pointer-events="none"
          />
          <circle
            data-rotate="1"
            :cx="rotateHandle.x"
            :cy="rotateHandle.y"
            :r="handleHitRadius"
            fill="transparent"
            pointer-events="all"
          />
          <circle
            :cx="rotateHandle.x"
            :cy="rotateHandle.y"
            :r="radius"
            fill="#157b79"
            stroke="white"
            :stroke-width="radius / 3"
            pointer-events="none"
          />
        </g>
        <template v-for="handle in resizeHandles" :key="`resize-${handle.key}`">
          <circle
            :data-resize="handle.key"
            :cx="handle.x"
            :cy="handle.y"
            :r="handleHitRadius"
            fill="transparent"
            pointer-events="all"
            class="selection-resize-hit"
          />
          <rect
            :x="handle.x - radius * 0.8"
            :y="handle.y - radius * 0.8"
            :width="radius * 1.6"
            :height="radius * 1.6"
            rx="1"
            :fill="graphStyle.background || '#fffef8'"
            stroke="#157b79"
            :stroke-width="radius / 3"
            pointer-events="none"
          />
        </template>
        <template v-for="handle in insertPointHandles" :key="`insert-${handle.index}`">
          <circle
            :data-insert-point="handle.index"
            :cx="handle.point.x"
            :cy="handle.point.y"
            :r="handleHitRadius * 0.86"
            fill="transparent"
            pointer-events="all"
            class="selection-insert-hit"
          />
          <circle
            :cx="handle.point.x"
            :cy="handle.point.y"
            :r="radius * 0.82"
            fill="#157b79"
            stroke="white"
            :stroke-width="radius / 3"
            pointer-events="none"
          />
          <path
            :d="`M ${handle.point.x - radius * 0.42} ${handle.point.y} H ${handle.point.x + radius * 0.42} M ${handle.point.x} ${handle.point.y - radius * 0.42} V ${handle.point.y + radius * 0.42}`"
            stroke="white"
            :stroke-width="Math.max(1, radius / 4)"
            stroke-linecap="round"
            pointer-events="none"
          />
        </template>
        <template
          v-for="handle in editablePointHandles"
          :key="handle.index"
        >
          <circle
            :data-handle="handle.index"
            :cx="handle.point.x"
            :cy="handle.point.y"
            :r="handleHitRadius"
            fill="transparent"
            pointer-events="all"
            class="selection-handle-hit"
          />
          <circle
            :cx="handle.point.x"
            :cy="handle.point.y"
            :r="radius"
            fill="white"
            stroke="#157b79"
            :stroke-width="radius / 3"
            pointer-events="none"
          />
        </template>
        <g v-if="activeVertexHandle" class="vertex-delete-control">
          <circle
            :data-delete-point="activeVertexHandle.index"
            :cx="activeVertexHandle.point.x + radius * 2.45"
            :cy="activeVertexHandle.point.y - radius * 2.45"
            :r="handleHitRadius * 0.78"
            fill="transparent"
            pointer-events="all"
          />
          <circle
            :cx="activeVertexHandle.point.x + radius * 2.45"
            :cy="activeVertexHandle.point.y - radius * 2.45"
            :r="radius * 1.08"
            fill="#b9473f"
            stroke="white"
            :stroke-width="Math.max(1, radius / 3)"
            pointer-events="none"
          />
          <path
            :d="`M ${activeVertexHandle.point.x + radius * 1.98} ${activeVertexHandle.point.y - radius * 2.92} L ${activeVertexHandle.point.x + radius * 2.92} ${activeVertexHandle.point.y - radius * 1.98} M ${activeVertexHandle.point.x + radius * 2.92} ${activeVertexHandle.point.y - radius * 2.92} L ${activeVertexHandle.point.x + radius * 1.98} ${activeVertexHandle.point.y - radius * 1.98}`"
            stroke="white"
            :stroke-width="Math.max(1.2, radius / 3)"
            stroke-linecap="round"
            pointer-events="none"
          />
        </g>
      </g>
      <g v-else-if="props.selectedIds.length > 1 && tool === 'select' && groupFrame" class="selection-group-frame">
        <rect
          :x="groupFrame.x"
          :y="groupFrame.y"
          :width="groupFrame.width"
          :height="groupFrame.height"
          :rx="handleHitRadius / 2"
          fill="none"
          stroke="#157b79"
          :stroke-width="Math.max(1, radius / 4)"
          stroke-dasharray="8 5"
          pointer-events="none"
        />
      </g>
      <circle
        v-for="(point, index) in pending"
        :key="`p${index}`"
        :cx="point.x"
        :cy="point.y"
        :r="radius"
        :fill="index === 0 ? '#157b79' : 'white'"
        stroke="#157b79"
        stroke-width="1.5"
      />
    </svg>
    <div
      v-if="radialMenu && radialActions.length"
      class="radial-menu"
      :style="{ left: `${radialMenu.left}px`, top: `${radialMenu.top}px` }"
      role="menu"
      aria-label="Quick graph actions"
      @pointerdown.stop
    >
      <span class="radial-menu-ring" aria-hidden="true"></span>
      <button
        v-for="(radialAction, index) in radialActions"
        :key="radialAction.id"
        type="button"
        class="radial-action"
        :class="{ danger: radialAction.danger }"
        :style="radialButtonStyle(index, radialActions.length)"
        :aria-label="radialAction.label"
        role="menuitem"
        @pointerdown.stop.prevent="runRadialAction(radialAction.id)"
      >
        <component :is="radialAction.icon" :size="19" />
        <small>{{ radialAction.label }}</small>
      </button>
      <button
        type="button"
        class="radial-center"
        aria-label="Close quick actions"
        @pointerdown.stop.prevent="closeRadial"
      >
        <X :size="20" />
      </button>
    </div>
    <div
      v-if="items.length === 0 && !drawing && !pending.length"
      class="canvas-empty"
      aria-hidden="true"
    >
      <span class="empty-cross">+</span
      ><strong>Start with the structure.</strong>
      <p>Choose Outline, then tap the corners on the grid.</p>
    </div>
    <div v-if="pending.length" class="drawing-actions">
      <span>{{ pending.length }} points</span
      ><button class="btn btn-primary" @click="finishOutline()">
        <Check :size="16" /> Finish</button
      ><button class="icon-button" aria-label="Cancel outline" @click="cancel">
        <X :size="18" />
      </button>
    </div>
    <div class="zoom-controls">
      <button aria-label="Zoom out" @click="zoomAt(1 / 1.25)">
        <Minus :size="18" /></button
      ><span>{{ zoom }}%</span
      ><button aria-label="Zoom in" @click="zoomAt(1.25)">
        <Plus :size="18" /></button
      ><i></i
      ><button aria-label="Fit graph" title="Fit graph" @click="fit">
        <Maximize :size="17" />
      </button>
    </div>
    <div class="mobile-graph-dock">
      <button
        class="mobile-dock-button"
        :class="{ active: quickPan || tool === 'pan' }"
        :aria-pressed="quickPan || tool === 'pan'"
        :title="quickPan || tool === 'pan' ? 'Return to drawing' : 'Temporarily pan the graph'"
        @click="tool === 'pan' ? emit('select-tool', 'select') : toggleQuickPan()"
      >
        <Hand :size="18" />
        <span>{{ quickPan || tool === 'pan' ? 'Pan on' : 'Pan' }}</span>
      </button>
      <button class="mobile-dock-button" :class="{ active: tool === 'select' && !quickPan }" @click="switchToSelect">
        <MousePointer2 :size="18" />
        <span>Select</span>
      </button>
      <button class="mobile-dock-button" @click="openQuickToolRadial">
        <CircleEllipsis :size="18" />
        <span>Quick</span>
      </button>
      <button class="mobile-dock-button" @click="fit">
        <Maximize :size="18" />
        <span>Fit</span>
      </button>
    </div>
    <p class="canvas-hint">{{ hint }}</p>
  </div>
</template>

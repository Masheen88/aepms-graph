<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Plus, Minus, Maximize, Check, X, Crosshair, Hand, MousePointer2 } from "lucide-vue-next";
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
]);
const svg = ref(null),
  view = ref({ x: -35, y: -35, w: 870, h: 890 }),
  drawing = ref(null),
  pending = ref([]),
  lineAnchor = ref(null),
  quickPan = ref(false),
  marquee = ref(null);
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
const pointers = new Map();
let action = null,
  gesture = null,
  before = null,
  space = false;
// Keep the visible edit handles compact while giving touch users a larger invisible grab target.
const radius = computed(() => (6 * view.value.w) / 870);
const handleHitRadius = computed(() => (15 * view.value.w) / 870);
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
const lineChainMarker = computed(() =>
  props.tool === "line" && props.lineAutoConnect && lineAnchor.value
    ? lineAnchor.value
    : null,
);
const hint = computed(
  () =>
    ({
      select:
        "Tap an object to select it. On desktop, Shift-click or drag a selection box to select multiple objects. On touch, drag empty space to pan and use Multi-select to add items.",
      outline:
        "Tap to add corners. Tap the first corner or choose Finish to close.",
      rect: "Drag from one corner to the opposite corner.",
      hatch: "Drag an area, then edit the label or pattern from the object panel.",
      garage: "Drag to place a garage.",
      crawlspace: "Drag to place a crawlspace.",
      line: "Drag to draw a line. Line stays active for the next segment; auto-connect can continue from the previous endpoint. Press V or Esc when finished.",
      curve:
        "Drag to draw a curved path. Turn on Closed shape and Diagonal marks afterwards for curved walkways or beds.",
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
  const shouldSnap = props.snap && !["freehand", "curve"].includes(props.tool);
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
  if (pending.value.length >= 2) {
    const shape = newItem("outline", clone(pending.value), {
      closed: close && pending.value.length >= 3,
    });
    commit([...props.items, shape]);
    setSelection([shape.id], shape.id);
    // Explicitly finishing a structure enters edit mode so mistakes can be corrected.
    if (close) emit("select-tool", "select");
  }
  pending.value = [];
}
function cancel() {
  pending.value = [];
  resetInteraction(true);
}
function movementForGroup(group, dx, dy) {
  const box = mergeBounds(group.map((entry) => ({ points: entry.points })));
  const allowedDx = clamp(dx, -box.x, GRID.width - box.right);
  const allowedDy = clamp(dy, -box.y, GRID.height - box.bottom);
  return { dx: allowedDx, dy: allowedDy };
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
  svg.value.focus({ preventScroll: true });
  svg.value.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2) {
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
  if (
    props.tool === "pan" ||
    quickPan.value ||
    event.button === 1 ||
    space ||
    (event.pointerType === "touch" && props.tool === "select" && !targetId)
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
    const rotate = event.target.closest("[data-rotate]");
    const resize = event.target.closest("[data-resize]");
    const handle = event.target.closest("[data-handle]");
    if ((rotate || resize || handle) && singleSelected.value) {
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
      if (additive) {
        toggleSelection(targetId);
        return;
      }
      const moveIds = selectedSet.value.has(targetId) && selectedItems.value.length > 1
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
    clearSelection();
    return;
  }
  // Ignore drawing outside the paper instead of pinning stray taps to its edge.
  const raw = screenPoint(event);
  if (raw.x < 0 || raw.x > GRID.width || raw.y < 0 || raw.y > GRID.height)
    return;
  if (props.tool === "outline") {
    // Place on release so a second finger can turn this tap into a pinch gesture.
    action = { kind: "corner", point: p };
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
  const type = ["garage", "crawlspace", "hatch"].includes(props.tool)
    ? "rect"
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
            : "",
    pattern: props.tool === "hatch" ? "diagonal" : "none",
  });
  if (["rect", "line", "garage", "crawlspace", "hatch"].includes(props.tool))
    drawing.value.points = [start, start];
  action = { kind: "create", start };
}
function pointerMove(event) {
  const p = gridPoint(event);
  emit("position", p);
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
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
    updateItems(
      props.items.map((i) => (i.id === action.id ? { ...i, points } : i)),
    );
    return;
  }
  if (action.kind === "handle") {
    const points = clone(action.original.points);
    points[action.index] = p;
    updateItems(
      props.items.map((i) => (i.id === action.id ? { ...i, points } : i)),
    );
    return;
  }
  if (action.kind === "move") {
    const points = translatePoints(
      action.original.points,
      p.x - action.start.x,
      p.y - action.start.y,
    );
    updateItems(
      props.items.map((i) => (i.id === action.id ? { ...i, points } : i)),
    );
    return;
  }
  if (action.kind === "move-group") {
    const { dx, dy } = movementForGroup(
      action.originals,
      p.x - action.start.x,
      p.y - action.start.y,
    );
    updateItems(
      props.items.map((item) => {
        const original = action.originals.find((entry) => entry.id === item.id);
        return original
          ? { ...item, points: translatePoints(original.points, dx, dy) }
          : item;
      }),
    );
  }
}
function pointerUp(event) {
  pointers.delete(event.pointerId);
  if (gesture) {
    if (pointers.size === 0) gesture = null;
    return;
  }
  if (action?.kind === "corner") {
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
      validStroke = drawing.value.points.length >= 2 && validSize;
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
    commit(
      props.items.map((item) =>
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
      ),
    );
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
onMounted(() => window.addEventListener("keyup", releaseSpace));
onBeforeUnmount(() => window.removeEventListener("keyup", releaseSpace));
defineExpose({ fit, cancel, finishOutline, clearLineAnchor });
</script>

<template>
  <div class="graph-wrap">
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
        <template
          v-for="(point, index) in ['freehand', 'curve'].includes(singleSelected.type)
            ? []
            : singleSelected.points"
          :key="index"
        >
          <circle
            :data-handle="index"
            :cx="point.x"
            :cy="point.y"
            :r="handleHitRadius"
            fill="transparent"
            pointer-events="all"
            class="selection-handle-hit"
          />
          <circle
            :cx="point.x"
            :cy="point.y"
            :r="radius"
            fill="white"
            stroke="#157b79"
            :stroke-width="radius / 3"
            pointer-events="none"
          />
        </template>
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
      <button class="mobile-dock-button" @click="fit">
        <Maximize :size="18" />
        <span>Fit</span>
      </button>
    </div>
    <p class="canvas-hint">{{ hint }}</p>
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import { Hand, Maximize, Minus, Plus, RotateCcw } from "lucide-vue-next";
import { GRAPH_CORNERS, clamp, svgPath } from "../lib/geometry.js";

const props = defineProps({ pages: Array });
const viewport = ref(null);
const stage = ref(null);
const zoom = ref(1);
const pan = ref({ x: 0, y: 0 });
const pointers = new Map();
let dragStart = null;
let pinchStart = null;

const zoomPercent = computed(() => Math.round(zoom.value * 100));
const stageStyle = computed(() => ({
  transform: `translate(${pan.value.x}px, ${pan.value.y}px) scale(${zoom.value})`,
}));

function applyZoom(next) {
  zoom.value = clamp(next, 0.25, 2.75);
}
function zoomIn() {
  applyZoom(zoom.value * 1.15);
}
function zoomOut() {
  applyZoom(zoom.value / 1.15);
}
function resetView() {
  zoom.value = 1;
  pan.value = { x: 0, y: 0 };
}
function fitView() {
  const available = viewport.value?.clientWidth || 0;
  const natural = stage.value?.scrollWidth || 0;
  if (!available || !natural) {
    resetView();
    return;
  }
  applyZoom((available - 28) / natural);
  pan.value = { x: 0, y: 0 };
}
function pointerDown(event) {
  if (event.button > 0) return;
  viewport.value?.setPointerCapture?.(event.pointerId);
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 1) {
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      pan: { ...pan.value },
    };
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchStart = {
      distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      zoom: zoom.value,
      pan: { ...pan.value },
      center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
    dragStart = null;
  }
}
function pointerMove(event) {
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (pointers.size === 2 && pinchStart) {
    const [a, b] = [...pointers.values()];
    const distance = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    applyZoom(pinchStart.zoom * (distance / pinchStart.distance));
    pan.value = {
      x: pinchStart.pan.x + center.x - pinchStart.center.x,
      y: pinchStart.pan.y + center.y - pinchStart.center.y,
    };
    return;
  }
  if (pointers.size === 1 && dragStart) {
    pan.value = {
      x: dragStart.pan.x + event.clientX - dragStart.x,
      y: dragStart.pan.y + event.clientY - dragStart.y,
    };
  }
}
function pointerUp(event) {
  pointers.delete(event.pointerId);
  if (pointers.size === 1) {
    const remaining = [...pointers.values()][0];
    dragStart = { x: remaining.x, y: remaining.y, pan: { ...pan.value } };
  } else {
    dragStart = null;
  }
  if (pointers.size < 2) pinchStart = null;
}
function wheel(event) {
  if (event.ctrlKey || event.metaKey) {
    applyZoom(zoom.value * (event.deltaY > 0 ? 0.9 : 1.1));
    return;
  }
  pan.value = {
    x: pan.value.x - event.deltaX,
    y: pan.value.y - event.deltaY,
  };
}
</script>

<template>
  <section class="paper-preview-shell" aria-label="Interactive print preview">
    <div class="preview-review-toolbar">
      <span class="preview-review-label"><Hand :size="15" /> Drag to pan · pinch or Ctrl/⌘ + wheel to zoom</span>
      <div class="preview-zoom-controls" aria-label="Preview zoom controls">
        <button type="button" class="icon-button" aria-label="Zoom out" @click="zoomOut"><Minus :size="17" /></button>
        <span class="zoom-readout">{{ zoomPercent }}%</span>
        <button type="button" class="icon-button" aria-label="Zoom in" @click="zoomIn"><Plus :size="17" /></button>
        <button type="button" class="btn btn-secondary btn-mini" @click="fitView"><Maximize :size="15" /> Fit width</button>
        <button type="button" class="icon-button" aria-label="Reset preview position" @click="resetView"><RotateCcw :size="16" /></button>
      </div>
    </div>

    <div
      ref="viewport"
      class="paper-preview-viewport"
      tabindex="0"
      @pointerdown="pointerDown"
      @pointermove="pointerMove"
      @pointerup="pointerUp"
      @pointercancel="pointerUp"
      @wheel.prevent="wheel"
    >
      <div ref="stage" class="paper-preview" :style="stageStyle">
        <figure v-for="(page, index) in props.pages" :key="index" class="paper-sheet">
          <figcaption>
            <span>{{
              index === 0
                ? "01 / INSPECTION GRAPH"
                : index === 1
                  ? "02 / TECHNICIAN STATEMENTS"
                  : `${String(index + 1).padStart(2, "0")} / CONTINUATION`
            }}</span>
          </figcaption>
          <svg
            :viewBox="`0 0 ${page.width} ${page.height}`"
            role="img"
            :aria-label="`Printed report page ${index + 1}`"
          >
            <defs>
              <clipPath :id="`preview-grid-${index}`">
                <polygon
                  :points="GRAPH_CORNERS.map((p) => `${p.x},${p.y}`).join(' ')"
                />
              </clipPath>
            </defs>
            <!-- Preview and PDF share the same vector primitives and stored coordinates. -->
            <rect :width="page.width" :height="page.height" fill="white" />
            <template v-for="(mark, n) in page.marks" :key="n">
              <g :clip-path="mark.graph ? `url(#preview-grid-${index})` : undefined">
                <image
                  v-if="mark.kind === 'image'"
                  :x="mark.x"
                  :y="mark.y"
                  :width="mark.width"
                  :height="mark.height"
                  href="/company-logo.png"
                  preserveAspectRatio="xMidYMid meet"
                />
                <rect
                  v-else-if="mark.kind === 'rect'"
                  :x="mark.x"
                  :y="mark.y"
                  :width="mark.width"
                  :height="mark.height"
                  :fill="mark.fill || 'none'"
                  :stroke="mark.color || 'none'"
                  :stroke-width="mark.borderWidth || 0"
                />
                <path
                  v-else-if="mark.kind === 'path'"
                  :d="svgPath(mark)"
                  :stroke="mark.color"
                  :stroke-width="mark.width"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
                <text
                  v-else
                  :x="mark.x"
                  :y="mark.y"
                  :font-size="mark.size"
                  :font-weight="mark.bold ? 700 : 400"
                  :text-anchor="mark.anchor"
                  :dominant-baseline="mark.anchor === 'middle' ? 'central' : 'auto'"
                  :transform="mark.rotate ? `rotate(${mark.rotate} ${mark.x} ${mark.y})` : undefined"
                  :fill="mark.color"
                  :stroke="mark.halo ? mark.haloColor || 'white' : 'none'"
                  :stroke-width="mark.halo ? mark.haloWidth || (mark.measurement ? 2 : 8) : 0"
                  paint-order="stroke"
                  font-family="'DejaVu Sans', sans-serif"
                >
                  {{ mark.text }}
                </text>
              </g>
            </template>
          </svg>
        </figure>
      </div>
    </div>
  </section>
</template>

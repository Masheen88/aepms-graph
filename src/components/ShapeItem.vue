<script setup>
import { computed } from "vue";
import { primitives, svgPath } from "../lib/geometry.js";

const props = defineProps({
  item: Object,
  feetPerSquare: { type: Number, default: 1 },
  gridUnit: { type: String, default: "ft" },
  graphStyle: { type: Object, default: () => ({}) },
  // GraphEditor can supply globally laid-out marks so dimensions avoid labels/one another.
  // Standalone callers still fall back to per-item primitive generation.
  marks: { type: Array, default: null },
});
const marks = computed(() =>
  Array.isArray(props.marks)
    ? props.marks
    : primitives(props.item, {
        feetPerSquare: props.feetPerSquare,
        gridUnit: props.gridUnit,
        graphStyle: props.graphStyle,
      }),
);
</script>

<template>
  <!-- The same primitives feed the graph, paper preview, and vector PDF export. -->
  <g :data-item-id="item.id" class="graph-item">
    <!-- Single-point marks are intentionally given a larger transparent hit target.
         This makes an existing point/label practical to select and move on tablets/phones. -->
    <circle
      v-if="item.points.length === 1"
      :cx="item.points[0].x"
      :cy="item.points[0].y"
      :r="Math.max(42, item.fontSize * 1.4)"
      fill="transparent"
      pointer-events="all"
    />
    <template v-for="(p, index) in marks" :key="index">
      <template v-if="p.kind === 'path'">
        <path
          :d="svgPath(p)"
          :fill="p.closed ? 'transparent' : 'none'"
          stroke="transparent"
          :stroke-width="Math.max(p.width, 36)"
          vector-effect="non-scaling-stroke"
          :pointer-events="p.closed ? 'all' : 'stroke'"
        />
        <path
          :d="svgPath(p)"
          fill="none"
          :stroke="p.color"
          :stroke-width="p.width"
          stroke-linecap="round"
          stroke-linejoin="round"
          pointer-events="none"
        />
      </template>
      <text
        v-else
        :x="p.x"
        :y="p.y"
        :data-measurement-index="p.measurement ? p.measurementIndex : undefined"
        :data-geometry-label="p.geometryLabel ? '1' : undefined"
        :class="{ 'movable-annotation': p.geometryLabel, 'measurement-annotation': p.measurement }"
        :font-size="p.size"
        :fill="p.color"
        text-anchor="middle"
        dominant-baseline="central"
        :transform="p.rotate ? `rotate(${p.rotate} ${p.x} ${p.y})` : undefined"
        :stroke="p.halo ? graphStyle.background || '#fffef8' : 'none'"
        :stroke-width="p.halo ? p.haloWidth || 5 : 0"
        stroke-linejoin="round"
        paint-order="stroke"
        :pointer-events="p.measurement || p.geometryLabel ? 'all' : 'auto'"
        font-family="'DejaVu Sans', sans-serif"
        >{{ p.text }}</text
      >
    </template>
  </g>
</template>

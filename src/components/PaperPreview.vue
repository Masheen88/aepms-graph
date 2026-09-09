<script setup>
import { GRAPH_CORNERS, svgPath } from "../lib/geometry.js";
defineProps({ pages: Array });
</script>

<template>
  <div class="paper-preview">
    <figure v-for="(page, index) in pages" :key="index" class="paper-sheet">
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
        <!-- Preview and PDF now share the same clean vector form primitives. -->
        <rect :width="page.width" :height="page.height" fill="white" />
        <template v-for="(mark, n) in page.marks" :key="n">
          <g
            :clip-path="mark.graph ? `url(#preview-grid-${index})` : undefined"
          >
            <rect
              v-if="mark.kind === 'rect'"
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
              :fill="mark.color"
              :stroke="mark.halo ? mark.haloColor || 'white' : 'none'"
              :stroke-width="mark.halo ? 8 : 0"
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
</template>

import { DEFAULT_GRAPH_STYLE, GRID } from "./model.js";

export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// Keep snapping accurate in real-world units instead of forcing every point to a full grid square.
// Example: at 2 ft per square, one foot is half a square, so the snap step is 5 drawing units.
export function snapStepForScale(unitsPerSquare = 1) {
  const scale = Number(unitsPerSquare);
  if (!Number.isFinite(scale) || scale <= 0) return GRID.step;
  return GRID.step / Math.max(1, scale);
}

export function constrained(point, snap = false) {
  // A numeric snap value is treated as an explicit drawing-unit increment. Boolean true
  // keeps the legacy full-square behavior for callers that do not provide a scale.
  const step = typeof snap === "number" ? Math.max(0.1, snap) : snap ? GRID.step : 0.1;
  return {
    x: clamp(Math.round(point.x / step) * step, 0, GRID.width),
    y: clamp(Math.round(point.y / step) * step, 0, GRID.height),
  };
}
export function bounds(item) {
  const xs = item.points.map((p) => p.x),
    ys = item.points.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}
export function translatePoints(points, dx, dy) {
  // Clamp the whole object together so dragging against an edge never distorts it.
  const box = bounds({ points });
  dx = clamp(dx, -box.x, GRID.width - box.right);
  dy = clamp(dy, -box.y, GRID.height - box.bottom);
  return points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
}

export function resizePoints(points, corner, target, minimum = 5) {
  // Resize around the opposite corner. Freehand paths use this too, so hand-drawn
  // slabs, walkways and notes can be corrected without redrawing them.
  const box = bounds({ points });
  const corners = {
    nw: { moving: { x: box.x, y: box.y }, anchor: { x: box.right, y: box.bottom } },
    ne: { moving: { x: box.right, y: box.y }, anchor: { x: box.x, y: box.bottom } },
    se: { moving: { x: box.right, y: box.bottom }, anchor: { x: box.x, y: box.y } },
    sw: { moving: { x: box.x, y: box.bottom }, anchor: { x: box.right, y: box.y } },
  };
  const config = corners[corner];
  if (!config) return points;

  let x = clamp(target.x, 0, GRID.width),
    y = clamp(target.y, 0, GRID.height);
  if (corner.includes("w")) x = Math.min(x, config.anchor.x - minimum);
  else x = Math.max(x, config.anchor.x + minimum);
  if (corner.includes("n")) y = Math.min(y, config.anchor.y - minimum);
  else y = Math.max(y, config.anchor.y + minimum);

  const oldWidth = config.moving.x - config.anchor.x,
    oldHeight = config.moving.y - config.anchor.y;
  const sx = Math.abs(oldWidth) > 0.001 ? (x - config.anchor.x) / oldWidth : 1;
  const sy = Math.abs(oldHeight) > 0.001 ? (y - config.anchor.y) / oldHeight : 1;
  return points.map((p) => ({
    x: clamp(config.anchor.x + (p.x - config.anchor.x) * sx, 0, GRID.width),
    y: clamp(config.anchor.y + (p.y - config.anchor.y) * sy, 0, GRID.height),
  }));
}

export function rotatePoint(point, center, degrees) {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

function rotatedShape(center, points, degrees = 0) {
  return points.map((point) =>
    rotatePoint({ x: center.x + point.x, y: center.y + point.y }, center, degrees),
  );
}

function polygonFor(item) {
  if (item.type === "rect") {
    const b = bounds(item);
    return [
      { x: b.x, y: b.y },
      { x: b.right, y: b.y },
      { x: b.right, y: b.bottom },
      { x: b.x, y: b.bottom },
    ];
  }
  return item.closed && ["outline", "curve", "freehand"].includes(item.type) ? item.points : [];
}

function hatchSegments(polygon, a, b, spacing) {
  if (polygon.length < 3) return [];
  const values = polygon.map((p) => a * p.x + b * p.y),
    min = Math.min(...values),
    max = Math.max(...values),
    result = [];
  const start = Math.floor(min / spacing) * spacing;
  for (let c = start; c <= max + spacing; c += spacing) {
    const hits = [];
    for (let i = 0; i < polygon.length; i++) {
      const p1 = polygon[i],
        p2 = polygon[(i + 1) % polygon.length],
        v1 = a * p1.x + b * p1.y,
        v2 = a * p2.x + b * p2.y,
        denominator = v2 - v1;
      if (Math.abs(denominator) < 1e-8) continue;
      const t = (c - v1) / denominator;
      if (t < -1e-8 || t > 1 + 1e-8) continue;
      hits.push({
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t,
      });
    }
    const unique = hits
      .sort((p1, p2) => p1.x - p2.x || p1.y - p2.y)
      .filter(
        (p, i, list) =>
          i === 0 || Math.hypot(p.x - list[i - 1].x, p.y - list[i - 1].y) > 0.05,
      );
    for (let i = 0; i + 1 < unique.length; i += 2)
      result.push([unique[i], unique[i + 1]]);
  }
  return result;
}

function addPattern(result, item, polygon) {
  if (!polygon.length || item.pattern === "none") return;
  const spacing = item.patternSpacing || 16,
    width = Math.max(0.65, item.width * 0.45);
  const add = (segments) =>
    segments.forEach((points) =>
      result.push({ kind: "path", points, closed: false, color: item.color, width }),
    );
  // x + y = c produces one diagonal direction; crosshatch adds the opposite.
  add(hatchSegments(polygon, 1, 1, spacing));
  if (item.pattern === "crosshatch") add(hatchSegments(polygon, 1, -1, spacing));
}

function measurementText(result, item, points, closed, options) {
  const {
    feetPerSquare = 1,
    gridUnit = "ft",
    graphStyle = DEFAULT_GRAPH_STYLE,
  } = options;
  if (!graphStyle.showMeasurements || item.showMeasurements === false || points.length < 2) return;
  const segments = points.slice(0, -1).map((point, i) => [point, points[i + 1]]);
  if (closed) segments.push([points.at(-1), points[0]]);
  for (const [a, b] of segments) {
    const worldLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (worldLength < 2) continue;
    const scaled = (worldLength / GRID.step) * feetPerSquare,
      rounded = Math.abs(scaled - Math.round(scaled)) < 0.05 ? Math.round(scaled) : Number(scaled.toFixed(1));
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.max(1, Math.hypot(dx, dy)),
      offset = Math.max(8, graphStyle.measurementFontSize * 0.85),
      nx = -dy / length,
      ny = dx / length;
    result.push({
      kind: "text",
      text: `${rounded} ${gridUnit}`,
      x: clamp((a.x + b.x) / 2 + nx * offset, graphStyle.measurementFontSize * 2, GRID.width - graphStyle.measurementFontSize * 2),
      y: clamp((a.y + b.y) / 2 + ny * offset, graphStyle.measurementFontSize * 1.5, GRID.height - graphStyle.measurementFontSize * 1.5),
      size: graphStyle.measurementFontSize,
      color: graphStyle.dimensions,
      anchor: "middle",
      halo: true,
      measurement: true,
    });
  }
}

export function primitives(item, options = {}) {
  const { points: p, color, width, fontSize } = item;
  // showLabel only controls optional titles attached to drawn geometry. Symbols and standalone
  // text labels remain visible because their text is the mark itself.
  const showGeometryLabel = item.showLabel !== false;
  const result = [];
  const path = (points, closed = false, smooth = false) =>
    result.push({ kind: "path", points, closed, color, width, smooth });
  const text = (value, x, y, size = fontSize, rotate = 0) => {
    if (value)
      result.push({
        kind: "text",
        text: value,
        x,
        y,
        size,
        color,
        anchor: "middle",
        halo: true,
        rotate,
      });
  };
  if (item.type === "rect") {
    const polygon = polygonFor(item),
      b = bounds(item);
    addPattern(result, item, polygon);
    path(polygon, true);
    measurementText(result, item, polygon, true, options);
    if (showGeometryLabel)
      text(item.text, (b.x + b.right) / 2, (b.y + b.bottom) / 2);
  } else if (["outline", "line", "freehand", "curve"].includes(item.type)) {
    const polygon = polygonFor(item);
    addPattern(result, item, polygon);
    path(p, item.closed, item.type === "curve");
    if (["outline", "line", "curve"].includes(item.type))
      measurementText(result, item, p, item.closed, options);
    const b = bounds(item);
    if (showGeometryLabel)
      text(item.text, (b.x + b.right) / 2, (b.y + b.bottom) / 2);
  } else if (item.type === "symbol" && item.symbol === "door") {
    const { x, y } = p[0];
    // Crawlspace access is rendered as a simple, familiar Z-like field mark.
    path(
      rotatedShape(
        { x, y },
        [
          { x: -13, y: -11 },
          { x: 13, y: -11 },
          { x: -13, y: 11 },
          { x: 13, y: 11 },
        ],
        item.rotation || 0,
      ),
    );
  } else if (item.type === "symbol" && item.symbol === "steps") {
    const { x, y } = p[0];
    // A compact stair-step glyph provides a fast way to mark steps or stairs.
    path(
      rotatedShape(
        { x, y },
        [
          { x: -14, y: 12 },
          { x: -14, y: -12 },
          { x: -7, y: -12 },
          { x: -7, y: -4 },
          { x: 0, y: -4 },
          { x: 0, y: 4 },
          { x: 7, y: 4 },
          { x: 7, y: 12 },
          { x: 14, y: 12 },
        ],
        item.rotation || 0,
      ),
    );
  } else if (item.type === "symbol" && item.symbol === "north") {
    const { x, y } = p[0];
    path(
      rotatedShape(
        { x, y },
        [
          { x: 0, y: 24 },
          { x: 0, y: -10 },
        ],
        item.rotation || 0,
      ),
    );
    path(
      rotatedShape(
        { x, y },
        [
          { x: -7, y: -1 },
          { x: 0, y: -10 },
          { x: 7, y: -1 },
        ],
        item.rotation || 0,
      ),
    );
    const northLabel = rotatePoint({ x, y: y - 22 }, { x, y }, item.rotation || 0);
    text(item.text, northLabel.x, northLabel.y, 14, item.rotation || 0);
  } else text(item.text, p[0].x, p[0].y, fontSize, item.rotation || 0);
  return result;
}

function smoothPath(primitive) {
  const { points, closed } = primitive;
  if (!points?.length) return "";
  if (points.length < 3) {
    return points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") + (closed ? " Z" : "");
  }
  const get = (index) => {
    if (closed) return points[(index + points.length) % points.length];
    return points[clamp(index, 0, points.length - 1)];
  };
  let d = `M ${points[0].x} ${points[0].y}`;
  const end = closed ? points.length : points.length - 1;
  for (let i = 0; i < end; i++) {
    const p0 = get(i - 1),
      p1 = get(i),
      p2 = get(i + 1),
      p3 = get(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6,
      c1y = p1.y + (p2.y - p0.y) / 6,
      c2x = p2.x - (p3.x - p1.x) / 6,
      c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return closed ? `${d} Z` : d;
}

export const svgPath = (primitive) =>
  primitive.smooth
    ? smoothPath(primitive)
    : primitive.points.map((p, i) => `${i ? "L" : "M"} ${p.x} ${p.y}`).join(" ") +
      (primitive.closed ? " Z" : "");

// The clean printed form uses a true rectangular registration. Unlike the old scan,
// this mapping is uniform, so exported geometry has the same proportions as the editor.
export const PRINT_GRAPH = {
  x: 40,
  y: 410,
  scale: 1.7,
  width: GRID.width * 1.7,
  height: GRID.height * 1.7,
};
export const GRAPH_CORNERS = [
  { x: PRINT_GRAPH.x, y: PRINT_GRAPH.y },
  { x: PRINT_GRAPH.x + PRINT_GRAPH.width, y: PRINT_GRAPH.y },
  { x: PRINT_GRAPH.x + PRINT_GRAPH.width, y: PRINT_GRAPH.y + PRINT_GRAPH.height },
  { x: PRINT_GRAPH.x, y: PRINT_GRAPH.y + PRINT_GRAPH.height },
];
export function toForm(point) {
  return {
    x: PRINT_GRAPH.x + point.x * PRINT_GRAPH.scale,
    y: PRINT_GRAPH.y + point.y * PRINT_GRAPH.scale,
  };
}

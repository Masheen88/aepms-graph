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

export function resolvedCornerStyle(item) {
  // v1.3 stored rounded rectangles as cornerRadius only. Treat those older objects
  // as rounded until the user explicitly chooses a corner style in the new editor.
  if (item.cornerStyle) return item.cornerStyle;
  return item.type === "rect" && Number(item.cornerRadius || 0) > 0 ? "round" : "square";
}

function quadraticPoint(start, control, end, t) {
  const inverse = 1 - t;
  return {
    x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
    y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y,
  };
}

function treatedCorner(points, index, closed, style, size) {
  const current = points[index];
  if (style === "square" || size < 0.5) return [current];
  if (!closed && (index === 0 || index === points.length - 1)) return [current];

  const previous = points[(index - 1 + points.length) % points.length];
  const next = points[(index + 1) % points.length];
  const prevLength = Math.hypot(previous.x - current.x, previous.y - current.y);
  const nextLength = Math.hypot(next.x - current.x, next.y - current.y);
  if (prevLength < 0.01 || nextLength < 0.01) return [current];

  const prevX = (previous.x - current.x) / prevLength;
  const prevY = (previous.y - current.y) / prevLength;
  const nextX = (next.x - current.x) / nextLength;
  const nextY = (next.y - current.y) / nextLength;
  const cross = prevX * nextY - prevY * nextX;
  const dot = prevX * nextX + prevY * nextY;
  // A straight segment has no visible corner to round/bevel. Keeping the original
  // point also prevents dense collinear imported paths from gaining tiny notches.
  if (Math.abs(cross) < 0.0001 && dot < -0.999) return [current];

  // Never let one corner consume its neighboring segments. The user-entered size is
  // a tangent setback; it is snapped by the editor before being stored.
  const offset = Math.min(size, prevLength * 0.45, nextLength * 0.45);
  if (offset < 0.5) return [current];
  const incoming = {
    x: current.x + prevX * offset,
    y: current.y + prevY * offset,
  };
  const outgoing = {
    x: current.x + nextX * offset,
    y: current.y + nextY * offset,
  };
  if (style === "bevel") return [incoming, outgoing];

  // Sample a quadratic fillet. It stays vector-based in the editor/PDF and gives a
  // predictable radiused-looking corner for arbitrary wall angles without SVG-only arcs.
  const steps = clamp(Math.ceil(offset / 4), 3, 10);
  return Array.from({ length: steps + 1 }, (_, step) =>
    quadraticPoint(incoming, current, outgoing, step / steps),
  );
}

export function corneredPathPoints(item) {
  const points = item.points || [];
  if (points.length < 3 || !["rect", "outline", "line"].includes(item.type)) return points;
  const style = resolvedCornerStyle(item);
  const size = clamp(Number(item.cornerRadius || 0), 0, 120);
  if (style === "square" || size < 0.5) return points;
  const closed = item.type === "rect" || item.closed === true;
  return points.flatMap((_, index) => treatedCorner(points, index, closed, style, size));
}

function rectBasePolygon(item) {
  const b = bounds(item);
  return [
    { x: b.x, y: b.y },
    { x: b.right, y: b.y },
    { x: b.right, y: b.bottom },
    { x: b.x, y: b.bottom },
  ];
}

/**
 * Return the exact segment model used by dimension rendering.
 * Keeping this shared lets the inspector, radial controls, PDF, and live graph
 * all refer to the same "side 1 / side 2" indexes.
 */
export function measurementSegmentsForItem(item) {
  if (!item || !["rect", "ellipse", "outline", "line", "curve"].includes(item.type))
    return [];
  let points = item.points || [];
  let closed = item.closed === true;
  if (["rect", "ellipse"].includes(item.type)) {
    points = rectBasePolygon(item);
    closed = true;
  }
  if (points.length < 2) return [];
  const segments = points.slice(0, -1).map((point, index) => ({
    index,
    a: point,
    b: points[index + 1],
  }));
  if (closed) {
    segments.push({
      index: points.length - 1,
      a: points.at(-1),
      b: points[0],
    });
  }
  return segments.map((segment) => ({
    ...segment,
    length: Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y),
  }));
}

export function measurementSegmentForItem(item, index) {
  return measurementSegmentsForItem(item).find((segment) => segment.index === index) || null;
}

export function formatMeasurementLength(worldLength, feetPerSquare = 1, gridUnit = "ft") {
  const scaled = (worldLength / GRID.step) * feetPerSquare;
  const rounded =
    Math.abs(scaled - Math.round(scaled)) < 0.05
      ? Math.round(scaled)
      : Number(scaled.toFixed(1));
  return `${rounded} ${gridUnit}`;
}

/**
 * Resolve several sides into one straight touching/overlapping measurement span.
 * Geometry is not changed. This is intentionally strict enough that a dimension can
 * never jump across an actual gap or around a corner.
 */
export function combinedMeasurementSpan(segments, tolerance = 2.5) {
  const usable = (segments || []).filter(
    (segment) =>
      segment?.a &&
      segment?.b &&
      Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) > 0.01,
  );
  if (usable.length < 2) return null;

  const first = usable[0];
  const dx = first.b.x - first.a.x;
  const dy = first.b.y - first.a.y;
  const baseLength = Math.hypot(dx, dy);
  const ux = dx / baseLength;
  const uy = dy / baseLength;
  const origin = first.a;

  const intervals = [];
  for (const segment of usable) {
    const sx = segment.b.x - segment.a.x;
    const sy = segment.b.y - segment.a.y;
    const length = Math.hypot(sx, sy);
    const vx = sx / length;
    const vy = sy / length;
    // Parallel or reversed is valid. A noticeable angle means these are different walls.
    if (Math.abs(ux * vy - uy * vx) > 0.035) return null;

    const distanceToBase = (point) =>
      Math.abs((point.x - origin.x) * uy - (point.y - origin.y) * ux);
    if (distanceToBase(segment.a) > tolerance || distanceToBase(segment.b) > tolerance)
      return null;

    const project = (point) =>
      (point.x - origin.x) * ux + (point.y - origin.y) * uy;
    const a = project(segment.a);
    const b = project(segment.b);
    intervals.push({ min: Math.min(a, b), max: Math.max(a, b) });
  }

  intervals.sort((a, b) => a.min - b.min || a.max - b.max);
  let unionMin = intervals[0].min;
  let unionMax = intervals[0].max;
  for (const interval of intervals.slice(1)) {
    if (interval.min > unionMax + tolerance) return null;
    unionMax = Math.max(unionMax, interval.max);
  }

  const a = {
    x: origin.x + ux * unionMin,
    y: origin.y + uy * unionMin,
  };
  const b = {
    x: origin.x + ux * unionMax,
    y: origin.y + uy * unionMax,
  };
  return {
    a,
    b,
    length: Math.hypot(b.x - a.x, b.y - a.y),
    ux,
    uy,
  };
}

function rectanglePolygon(item) {
  // Rectangles store only opposite corners for fast resizing. Expand them to four
  // vertices before applying the same round/bevel logic used by editable outlines.
  const expanded = { ...item, points: rectBasePolygon(item), closed: true };
  return corneredPathPoints(expanded);
}

function ellipsePolygon(item, steps = 48) {
  const b = bounds(item);
  const cx = (b.x + b.right) / 2;
  const cy = (b.y + b.bottom) / 2;
  const rx = Math.max(0.5, (b.right - b.x) / 2);
  const ry = Math.max(0.5, (b.bottom - b.y) / 2);
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

function polygonFor(item) {
  if (item.type === "rect") return rectanglePolygon(item);
  if (item.type === "ellipse") return ellipsePolygon(item);
  if (item.closed && item.type === "outline") return corneredPathPoints(item);
  return item.closed && ["curve", "freehand"].includes(item.type) ? item.points : [];
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
  // x + y = c produces one diagonal direction; the other combinations add
  // crosshatch or simple horizontal/vertical field marks.
  if (["diagonal", "crosshatch"].includes(item.pattern))
    add(hatchSegments(polygon, 1, 1, spacing));
  if (item.pattern === "crosshatch") add(hatchSegments(polygon, 1, -1, spacing));
  if (item.pattern === "horizontal") add(hatchSegments(polygon, 0, 1, spacing));
  if (item.pattern === "vertical") add(hatchSegments(polygon, 1, 0, spacing));
}

function measurementText(result, item, points, closed, options, allowedIndexes = null) {
  const {
    feetPerSquare = 1,
    gridUnit = "ft",
    graphStyle = DEFAULT_GRAPH_STYLE,
  } = options;
  if (!graphStyle.showMeasurements || item.showMeasurements === false || points.length < 2) return;
  const segments = points.slice(0, -1).map((point, i) => [point, points[i + 1]]);
  if (closed) segments.push([points.at(-1), points[0]]);
  const hidden = new Set(item.hiddenMeasurements || []);
  const explicitlyShown = new Set(item.shownMeasurements || []);
  for (const [index, [a, b]] of segments.entries()) {
    if (
      hidden.has(index) ||
      (allowedIndexes && !allowedIndexes.has(index) && !explicitlyShown.has(index))
    )
      continue;
    const worldLength = Math.hypot(b.x - a.x, b.y - a.y);
    if (worldLength < 2) continue;
    const configuredSize = Number(graphStyle.measurementFontSize || 6),
      // Short details are common around porches, piers, and one-foot boxes. Keep
      // the value legible without letting the text/halo visually replace the wall.
      measurementSize = worldLength <= GRID.step * 1.25
        ? Math.min(configuredSize, 4.6)
        : worldLength <= GRID.step * 2.1
          ? Math.min(configuredSize, 5.1)
          : configuredSize;
    const dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.max(1, Math.hypot(dx, dy)),
      placement = graphStyle.measurementPlacement || "smart",
      baseOffset =
        placement === "inline"
          ? 0
          : placement === "close"
            ? Math.max(2.2, measurementSize * 0.3)
            : placement === "outside"
              ? Math.max(7, measurementSize * 1.05)
              : Math.max(3.2, measurementSize * 0.46),
      distance = baseOffset + Number(item.measurementDistance || 0),
      sidePreference = item.measurementSideOverrides?.[index] || "inherit",
      effectiveSide = sidePreference === "inherit" ? item.measurementSide || "normal" : sidePreference,
      side = effectiveSide === "opposite" ? -1 : 1,
      nx = (-dy / length) * side,
      ny = (dx / length) * side,
      tx = dx / length,
      ty = dy / length,
      midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      // Free x/y measurement offsets from older saves are deliberately ignored.
      // A dimension must remain visually attached to the segment it measures.
      manual = { x: 0, y: 0 },
      hasManualOffset = false;
    result.push({
      kind: "text",
      text: formatMeasurementLength(worldLength, feetPerSquare, gridUnit),
      x: clamp(
        midpoint.x + nx * distance + Number(manual.x || 0),
        measurementSize * 1.7,
        GRID.width - measurementSize * 1.7,
      ),
      y: clamp(
        midpoint.y + ny * distance + Number(manual.y || 0),
        measurementSize * 1.3,
        GRID.height - measurementSize * 1.3,
      ),
      size: measurementSize,
      color: graphStyle.dimensions,
      anchor: "middle",
      // Measurements intentionally use a thinner halo than ordinary labels so dense
      // drawings keep more of the wall/grid visible around the value.
      halo: true,
      haloWidth: 0.75,
      measurement: true,
      rotate: (() => {
        if ((graphStyle.measurementOrientation || "horizontal") !== "along") return 0;
        let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
        // Keep text upright when it follows a wall from right-to-left.
        if (angle > 90) angle -= 180;
        if (angle < -90) angle += 180;
        return angle;
      })(),
      measurementIndex: index,
      measurementRunId: item.measurementRunIds?.[index] || "",
      // Layout metadata is ignored by the SVG/PDF painters but lets the shared smart
      // measurement pass resolve collisions identically on screen and in exported PDFs.
      measurementManual: hasManualOffset,
      measurementLayout: { midpoint, nx, ny, tx, ty, distance },
      measurementSegment: { a, b },
    });
  }
}

function simplifiedMeasurementIndexes(item, points, graphStyle) {
  if ((graphStyle.measurementDetail || "simplified") === "all") return null;
  if (["rect", "ellipse"].includes(item.type)) return new Set([0, 1]);
  if (item.type !== "outline" || item.closed !== true || points.length !== 4) return null;

  // A simple four-corner orthogonal outline reads as a box. Width + height are
  // enough; repeating the same dimensions on all four sides hides small geometry.
  const vectors = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    return { x: next.x - point.x, y: next.y - point.y };
  });
  const orthogonal = vectors.every((vector, index) => {
    const next = vectors[(index + 1) % vectors.length];
    return Math.abs(vector.x * next.x + vector.y * next.y) < 0.01;
  });
  const oppositeMatch =
    Math.abs(Math.hypot(vectors[0].x, vectors[0].y) - Math.hypot(vectors[2].x, vectors[2].y)) < 0.05 &&
    Math.abs(Math.hypot(vectors[1].x, vectors[1].y) - Math.hypot(vectors[3].x, vectors[3].y)) < 0.05;
  return orthogonal && oppositeMatch ? new Set([0, 1]) : null;
}

export function defaultMeasurementIndexesForItem(item, graphStyle = DEFAULT_GRAPH_STYLE) {
  if (!item) return null;
  if (["rect", "ellipse"].includes(item.type)) {
    const points = rectBasePolygon(item);
    return simplifiedMeasurementIndexes(item, points, graphStyle);
  }
  return simplifiedMeasurementIndexes(item, item.points || [], graphStyle);
}

export function primitives(item, options = {}) {
  const { points: p, color, width, fontSize } = item;
  // showLabel only controls optional titles attached to drawn geometry. Symbols and standalone
  // text labels remain visible because their text is the mark itself.
  const showGeometryLabel = item.showLabel !== false;
  const result = [];
  const path = (points, closed = false, smooth = false) =>
    result.push({ kind: "path", points, closed, color, width, smooth });
  const text = (value, x, y, size = fontSize, rotate = 0, meta = {}) => {
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
        ...meta,
      });
  };
  if (["rect", "ellipse"].includes(item.type)) {
    const polygon = polygonFor(item),
      b = bounds(item);
    addPattern(result, item, polygon);
    path(polygon, true, item.type === "ellipse");
    // Keep dimension labels useful on rounded/elliptical areas by reporting the
    // bounding width and height instead of labeling every sampled curve segment.
    measurementText(
      result,
      item,
      [
        { x: b.x, y: b.y },
        { x: b.right, y: b.y },
        { x: b.right, y: b.bottom },
        { x: b.x, y: b.bottom },
      ],
      true,
      options,
      simplifiedMeasurementIndexes(item, [
        { x: b.x, y: b.y },
        { x: b.right, y: b.y },
        { x: b.right, y: b.bottom },
        { x: b.x, y: b.bottom },
      ], options.graphStyle || DEFAULT_GRAPH_STYLE),
    );
    if (showGeometryLabel) {
      const offset = item.labelOffset || { x: 0, y: 0 };
      text(
        item.text,
        (b.x + b.right) / 2 + Number(offset.x || 0),
        (b.y + b.bottom) / 2 + Number(offset.y || 0),
        fontSize,
        0,
        { geometryLabel: true },
      );
    }
  } else if (["outline", "line", "freehand", "curve"].includes(item.type)) {
    const polygon = polygonFor(item);
    const renderedPoints = ["outline", "line"].includes(item.type) ? corneredPathPoints(item) : p;
    addPattern(result, item, polygon);
    path(renderedPoints, item.closed, item.type === "curve");
    if (["outline", "line", "curve"].includes(item.type))
      measurementText(
        result,
        item,
        p,
        item.closed,
        options,
        simplifiedMeasurementIndexes(item, p, options.graphStyle || DEFAULT_GRAPH_STYLE),
      );
    const b = bounds(item);
    if (showGeometryLabel) {
      const offset = item.labelOffset || { x: 0, y: 0 };
      text(
        item.text,
        (b.x + b.right) / 2 + Number(offset.x || 0),
        (b.y + b.bottom) / 2 + Number(offset.y || 0),
        fontSize,
        0,
        { geometryLabel: true },
      );
    }
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


function annotationBox(mark, padding = 3) {
  const width = Math.max(mark.size * 1.8, String(mark.text || "").length * mark.size * 0.62 + padding * 2);
  const height = mark.size * 1.45 + padding * 2;
  return {
    x: mark.x - width / 2,
    y: mark.y - height / 2,
    right: mark.x + width / 2,
    bottom: mark.y + height / 2,
  };
}

function boxOverlapArea(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  return width * height;
}

/**
 * Lay out every item's primitives together so automatic dimension labels can avoid
 * one another and ordinary geometry labels. Manual dimension drags remain authoritative.
 * The return value preserves item grouping for GraphEditor while PDF export can flatten it.
 */
export function primitivesForItems(items, options = {}) {
  const graphStyle = options.graphStyle || DEFAULT_GRAPH_STYLE;
  const entries = items.map((item) => ({
    id: item.id,
    marks: primitives(item, options).map((mark) =>
      mark.measurement ? { ...mark, measurementItemId: item.id } : mark,
    ),
  }));
  const reserved = [];
  const seenMeasurementSegments = new Set();

  // Combined measurement runs are non-destructive. The source shapes keep every wall
  // and hatch boundary; only their dimension labels are replaced by one full-span value.
  // If later edits make the run non-collinear or introduce a real gap, the combined
  // dimension automatically falls back to the original individual measurements.
  const runMembers = new Map();
  for (const entry of entries) {
    for (const mark of entry.marks) {
      if (!mark.measurement || !mark.measurementRunId || !mark.measurementSegment) continue;
      if (!runMembers.has(mark.measurementRunId)) runMembers.set(mark.measurementRunId, []);
      runMembers.get(mark.measurementRunId).push({ entry, mark });
    }
  }

  for (const [runId, members] of runMembers) {
    if (members.length < 2) continue;
    const span = combinedMeasurementSpan(
      members.map(({ mark }) => mark.measurementSegment),
      Math.max(2, GRID.step * 0.22),
    );
    if (!span) continue;

    const primary = members[0];
    const source = primary.mark;
    const dx = span.b.x - span.a.x;
    const dy = span.b.y - span.a.y;
    const length = Math.max(1, span.length);
    const midpoint = {
      x: (span.a.x + span.b.x) / 2,
      y: (span.a.y + span.b.y) / 2,
    };
    const configuredSize = Number(graphStyle.measurementFontSize || 6);
    const size =
      length <= GRID.step * 1.25
        ? Math.min(configuredSize, 4.6)
        : length <= GRID.step * 2.1
          ? Math.min(configuredSize, 5.1)
          : configuredSize;
    const sourceLayout = source.measurementLayout || {};
    const sourceNormal = {
      x: Number(sourceLayout.nx ?? (-dy / length)),
      y: Number(sourceLayout.ny ?? (dx / length)),
    };
    const sourceDistance = Number(sourceLayout.distance ?? Math.max(3.2, size * 0.46));
    let angle = 0;
    if ((graphStyle.measurementOrientation || "horizontal") === "along") {
      angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (angle > 90) angle -= 180;
      if (angle < -90) angle += 180;
    }

    const combined = {
      ...source,
      text: formatMeasurementLength(span.length, options.feetPerSquare || 1, options.gridUnit || "ft"),
      x: clamp(
        midpoint.x + sourceNormal.x * sourceDistance,
        size * 1.7,
        GRID.width - size * 1.7,
      ),
      y: clamp(
        midpoint.y + sourceNormal.y * sourceDistance,
        size * 1.3,
        GRID.height - size * 1.3,
      ),
      size,
      rotate: angle,
      measurementCombined: true,
      measurementRunId: runId,
      measurementSegment: { a: span.a, b: span.b },
      measurementMembers: members.map(({ mark }) => ({
        itemId: mark.measurementItemId,
        index: mark.measurementIndex,
      })),
      measurementLayout: {
        midpoint,
        nx: sourceNormal.x,
        ny: sourceNormal.y,
        tx: dx / length,
        ty: dy / length,
        distance: sourceDistance,
      },
    };

    const memberMarks = new Set(members.map(({ mark }) => mark));
    for (const member of members) {
      member.entry.marks = member.entry.marks.filter((mark) => !memberMarks.has(mark));
    }
    primary.entry.marks.push(combined);
  }

  // Exact overlapping walls can exist in recovered/older drawings. Keep the wall
  // geometry intact, but render only one dimension for the same exact segment so
  // duplicate lines do not create an unreadable stack of identical values.
  for (const entry of entries) {
    entry.marks = entry.marks.filter((mark) => {
      if (!mark.measurement || !mark.measurementSegment) return true;
      const { a, b } = mark.measurementSegment;
      const first = `${Number(a.x.toFixed(3))},${Number(a.y.toFixed(3))}`;
      const second = `${Number(b.x.toFixed(3))},${Number(b.y.toFixed(3))}`;
      const key = first < second ? `${first}|${second}` : `${second}|${first}`;
      if (seenMeasurementSegments.has(key)) return false;
      seenMeasurementSegments.add(key);
      return true;
    });
  }

  // Reserve ordinary text and every manually positioned dimension first. Automatic
  // dimensions should move around room labels, symbols, notes, and pinned dimensions
  // regardless of item ordering in the report.
  for (const entry of entries) {
    for (const mark of entry.marks) {
      if (mark.kind !== "text") continue;
      if (!mark.measurement || mark.measurementManual) {
        if (mark.measurementManual) mark.measurementAutoOffset = { x: 0, y: 0 };
        reserved.push(annotationBox(mark, 2.5));
      }
    }
  }

  const fontSize = Number(graphStyle.measurementFontSize || 6);
  const placement = graphStyle.measurementPlacement || "smart";
  const crowding = graphStyle.measurementCrowding || "clean";
  // The old collision solver could move a 1 ft label two or more grid squares away
  // from its wall. Smart layout is now intentionally constrained: a measurement may
  // move slightly farther out or a tiny amount along the wall, but never enough to
  // make ownership ambiguous. Clean mode hides a value if that small safe zone is
  // still crowded; Show all keeps the best nearby candidate instead.
  const useSmartLayout = placement === "smart" || placement === "outside";
  const normalSteps = placement === "outside" ? [0, 3, 6, 9] : [0, 2, 4, 6];
  const tangentSteps = [0, 1.5, -1.5];
  const suppressOverlapThreshold = Math.max(7, fontSize * fontSize * 0.45);

  for (const entry of entries) {
    for (const mark of entry.marks) {
      if (mark.kind !== "text" || !mark.measurement) continue;
      if (mark.measurementManual || !mark.measurementLayout) {
        if (!mark.measurementAutoOffset) mark.measurementAutoOffset = { x: 0, y: 0 };
        continue;
      }
      if (!useSmartLayout) {
        mark.measurementAutoOffset = { x: 0, y: 0 };
        reserved.push(annotationBox(mark, 2));
        continue;
      }

      const originalPosition = { x: mark.x, y: mark.y };
      const { midpoint, nx, ny, tx, ty, distance } = mark.measurementLayout;
      const candidates = [];
      // Smart layout never changes the chosen side of a segment. It only moves farther
      // from the wall or along it, so Default side / Flip side remain predictable.
      for (const sideMultiplier of [1]) {
        for (const extraNormal of normalSteps) {
          for (const tangent of tangentSteps) {
            const normalDistance = sideMultiplier * (distance + extraNormal);
            candidates.push({
              x: midpoint.x + nx * normalDistance + tx * tangent,
              y: midpoint.y + ny * normalDistance + ty * tangent,
              sidePenalty: 0,
              travelPenalty: Math.abs(extraNormal) * 0.35 + Math.abs(tangent) * 0.18,
            });
          }
        }
      }

      let best = null;
      for (const candidate of candidates) {
        const placed = {
          ...mark,
          x: clamp(candidate.x, fontSize * 2, GRID.width - fontSize * 2),
          y: clamp(candidate.y, fontSize * 1.5, GRID.height - fontSize * 1.5),
        };
        const box = annotationBox(placed, 2.5);
        const overlap = reserved.reduce((sum, other) => sum + boxOverlapArea(box, other), 0);
        const edgePenalty =
          (placed.x !== candidate.x || placed.y !== candidate.y) ? fontSize * fontSize * 5 : 0;
        const score = overlap * 30 + candidate.sidePenalty + candidate.travelPenalty + edgePenalty;
        if (!best || score < best.score) best = { ...placed, score, box };
        if (overlap === 0 && candidate.sidePenalty === 0 && candidate.travelPenalty === 0 && !edgePenalty) break;
      }

      if (best) {
        const bestOverlap = reserved.reduce((sum, other) => sum + boxOverlapArea(best.box, other), 0);
        if (crowding === "clean" && bestOverlap > suppressOverlapThreshold) {
          mark.measurementAutoSuppressed = true;
          mark.measurementAutoOffset = { x: 0, y: 0 };
          continue;
        }
        mark.x = best.x;
        mark.y = best.y;
        mark.measurementAutoOffset = {
          x: best.x - originalPosition.x,
          y: best.y - originalPosition.y,
        };
        reserved.push(best.box);
      } else {
        mark.measurementAutoOffset = { x: 0, y: 0 };
        reserved.push(annotationBox(mark, 2));
      }
    }
  }

  for (const entry of entries) {
    entry.marks = entry.marks.filter((mark) => !mark.measurementAutoSuppressed);
  }

  return entries;
}

import { z } from "zod";

// Drawing coordinates never depend on screen size, zoom, or device pixel ratio.
export const GRID = { width: 800, height: 820, step: 10 };
export const INK = "#183b42";
export const DEFAULT_GRAPH_STYLE = Object.freeze({
  background: "#fffef8",
  minor: "#d7dfdc",
  major: "#8fa19f",
  dimensions: "#183b42",
  showMeasurements: true,
  measurementFontSize: 6,
  // Global measurement layout stays intentionally simple for field use.
  measurementPlacement: "smart",
  measurementOrientation: "horizontal",
  // Clean mode suppresses a crowded dimension instead of moving it far enough away
  // that the technician can no longer tell which wall it belongs to.
  measurementCrowding: "clean",
  // Simplify repeated dimensions on rectangular areas so small boxes stay readable.
  measurementDetail: "simplified",
});
export const CONSTRUCTION = [
  "Crawlspace",
  "Basement",
  "Floating slab",
  "Supported slab",
  "Monolithic slab",
];
export const SYMBOLS = [
  {
    key: "termites",
    text: "XXX",
    title: "Subterranean termites",
    color: "#b43b37",
  },
  {
    key: "powder",
    text: "PPB",
    title: "Powder post beetles",
    color: "#b43b37",
  },
  { key: "ants", text: "CA", title: "Carpenter ants", color: "#b43b37" },
  { key: "bees", text: "CB", title: "Carpenter bees", color: "#b43b37" },
  { key: "borers", text: "WB", title: "Wood borers", color: "#b43b37" },
  { key: "fungus", text: "F", title: "Fungus", color: "#b43b37" },
  { key: "damage", text: "D", title: "Existing damage", color: "#b43b37" },
  { key: "tubes", text: "T", title: "Termite tubes", color: "#b43b37" },
  // A compact Z-shaped mark reads more like the hand-drawn crawlspace access symbol.
  { key: "door", text: "Z", title: "Crawlspace door", color: INK },
  // Legacy only: older reports containing this mark still render, but new field
  // workflows no longer surface a stair-placement tool in the top-down palette.
  { key: "steps", text: "ST", title: "Steps / stair", color: INK },
  { key: "north", text: "N", title: "North arrow", color: INK },
];

export function uid() {
  // getRandomValues also works when a phone visits the local app over LAN HTTP.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const n = globalThis.crypto.getRandomValues(new Uint8Array(1))[0] & 15;
    return (c === "x" ? n : (n & 3) | 8).toString(16);
  });
}
export function localDate() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const point = z.object({
  x: z.number().min(0).max(GRID.width),
  y: z.number().min(0).max(GRID.height),
});
const offsetPoint = z.object({
  // Offsets are stored in graph coordinates so labels and dimensions render identically
  // in the editor, print preview, and generated PDF regardless of screen size.
  x: z.number().min(-GRID.width).max(GRID.width),
  y: z.number().min(-GRID.height).max(GRID.height),
});
const denseOffsetArray = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) => {
          const entry = value[index];
          return entry && typeof entry === "object" ? entry : { x: 0, y: 0 };
        })
      : value,
  z.array(offsetPoint).max(6000),
);
const denseMeasurementSideArray = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) => {
          const entry = value[index];
          return ["inherit", "normal", "opposite"].includes(entry) ? entry : "inherit";
        })
      : value,
  z.array(z.enum(["inherit", "normal", "opposite"])).max(6000),
);
const densePointLinkArray = z.preprocess(
  (value) =>
    Array.isArray(value)
      ? Array.from({ length: value.length }, (_, index) =>
          typeof value[index] === "string" ? value[index] : "",
        )
      : value,
  z.array(z.string().max(80)).max(6000),
);

function normalizeReportInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const sourceRevision = Number(value.schemaRevision || 1);
  const normalized = { ...value };

  if (value.graphStyle && typeof value.graphStyle === "object") {
    normalized.graphStyle = { ...value.graphStyle };
    // The original v1 fieldbook used 10px dimensions. On dense phone drawings this
    // can cover one-foot walls almost completely, so legacy v1 reports migrate to
    // the compact field default while newer reports preserve an explicit choice.
    if (sourceRevision === 1 && Number(normalized.graphStyle.measurementFontSize) === 10) {
      normalized.graphStyle.measurementFontSize = DEFAULT_GRAPH_STYLE.measurementFontSize;
    }
  }

  if (sourceRevision < 6 && Array.isArray(value.items)) {
    normalized.items = value.items.map((item) =>
      item && typeof item === "object"
        ? {
            ...item,
            // v1.5.4 fully retires free-floating dimension positions. Older
            // offsets/side-distance experiments can make a value look attached to the
            // wrong wall, so migration returns location controls to the constrained
            // automatic layout. Deliberately hidden dimensions are preserved.
            measurementOffsets: [],
            measurementSideOverrides: [],
            measurementDistance: 0,
            measurementSide: "normal",
          }
        : item,
    );
  }

  return normalized;
}

const short = z.string().max(120);
const calendarDate = z.union([
  z.literal(""),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((v) => {
      const d = new Date(`${v}T12:00:00Z`);
      return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
    }, "Enter a valid calendar date"),
]);
const signature = z
  .array(
    z
      .array(
        z.object({
          x: z.number().min(0).max(400),
          y: z.number().min(0).max(100),
        }),
      )
      .max(1500),
  )
  .max(40);
const statement = z.object({
  notes: z.string().max(4000),
  name: short,
  certificate: z.string().max(60),
  date: calendarDate,
  signature,
});
const graphStyleSchema = z
  .object({
    background: hexColor.default(DEFAULT_GRAPH_STYLE.background),
    minor: hexColor.default(DEFAULT_GRAPH_STYLE.minor),
    major: hexColor.default(DEFAULT_GRAPH_STYLE.major),
    dimensions: hexColor.default(DEFAULT_GRAPH_STYLE.dimensions),
    showMeasurements: z.boolean().default(DEFAULT_GRAPH_STYLE.showMeasurements),
    measurementFontSize: z.number().min(5).max(30).default(DEFAULT_GRAPH_STYLE.measurementFontSize),
    measurementPlacement: z.enum(["smart", "close", "outside", "inline"]).default(DEFAULT_GRAPH_STYLE.measurementPlacement),
    measurementOrientation: z.enum(["horizontal", "along"]).default(DEFAULT_GRAPH_STYLE.measurementOrientation),
    measurementCrowding: z.enum(["clean", "all"]).default(DEFAULT_GRAPH_STYLE.measurementCrowding),
    measurementDetail: z.enum(["simplified", "all"]).default(DEFAULT_GRAPH_STYLE.measurementDetail),
  })
  // Old v1 backups did not contain graphStyle. Defaults keep those files importable.
  .default(() => ({ ...DEFAULT_GRAPH_STYLE }));
export const itemSchema = z
  .object({
    id: z.string().uuid(),
    type: z.enum(["outline", "line", "curve", "freehand", "rect", "ellipse", "label", "symbol"]),
    points: z.array(point).min(1).max(6000),
    text: z.string().max(60),
    symbol: z.string().max(40).default(""),
    color: hexColor,
    width: z.number().min(0.5).max(8),
    // Larger labels are useful for room names and exterior area labels on tablets.
    fontSize: z.number().min(6).max(72),
    closed: z.boolean(),
    // Patterns are stored on the object so the editor, preview, backup and PDF agree.
    pattern: z.enum(["none", "diagonal", "crosshatch", "horizontal", "vertical"]).default("none"),
    patternSpacing: z.number().min(8).max(50).default(16),
    // Corner treatment works on rectangles and editable line/outline vertices.
    // cornerStyle stays optional so older v1.3 backups with only cornerRadius remain rounded.
    cornerStyle: z.enum(["square", "round", "bevel"]).optional(),
    cornerRadius: z.number().min(0).max(120).default(0),
    // Structural labels can be hidden without deleting their text, so they can be restored later.
    showLabel: z.boolean().default(true),
    // Measurements can be turned off for a single object while remaining on elsewhere.
    showMeasurements: z.boolean().default(true),
    // Geometry labels are independently movable. Older saves default to the geometric center.
    labelOffset: offsetPoint.default(() => ({ x: 0, y: 0 })),
    // Retained only for backwards-compatible imports from earlier builds. Current
    // rendering ignores free x/y dimension offsets so measurements cannot drift away
    // from the wall they describe.
    measurementOffsets: denseOffsetArray.default(() => []),
    // Individual dimension labels can be hidden without disabling measurements for the whole object.
    // This is especially useful around dense corners and hatch areas on phone/tablet drawings.
    hiddenMeasurements: z.array(z.number().int().min(0).max(5999)).max(6000).default(() => []),
    // Per-segment side overrides power the canvas radial menu while preserving the existing
    // whole-object side preference for older reports. Missing entries inherit measurementSide.
    measurementSideOverrides: denseMeasurementSideArray.default(() => []),
    measurementDistance: z.number().min(-40).max(120).default(0),
    measurementSide: z.enum(["normal", "opposite"]).default("normal"),
    // A lightweight group id keeps grouped shapes reversible instead of destructively merging them.
    groupId: z.string().max(80).default(""),
    // Point-link ids weld vertices across separate shapes while remaining reversible.
    pointLinks: densePointLinkArray.default(() => []),
    // Single-point symbols and labels can be rotated to match the graph.
    rotation: z.number().min(-180).max(180).default(0),
  })
  .superRefine((item, ctx) => {
    const min =
      item.type === "outline" && item.closed
        ? 3
        : ["outline", "line", "curve", "freehand", "rect", "ellipse"].includes(item.type)
          ? 2
          : 1;
    if (item.points.length < min)
      ctx.addIssue({ code: "custom", message: "Drawing has too few points" });
    if (["rect", "ellipse"].includes(item.type) && item.points.length !== 2)
      ctx.addIssue({
        code: "custom",
        message: "This area shape needs two corners",
      });
  });
export const reportSchema = z.preprocess(
  normalizeReportInput,
  z.object({
    schemaVersion: z.literal(1),
    // schemaRevision is additive within the v1 backup format. Parsing an older save upgrades
    // it to the latest additive revision while the new item fields below receive safe defaults.
    schemaRevision: z.number().int().min(1).max(6).default(6).transform(() => 6),
    id: z.string().uuid(),
    title: z.string().min(1).max(80),
    customer: short,
    phone: z.string().max(50),
    date: calendarDate,
    street: z.string().max(160),
    city: z.string().max(160),
    construction: z.array(z.enum(CONSTRUCTION)).max(5),
    feetPerSquare: z.number().min(0.1).max(100),
    gridUnit: z.enum(["ft", "m"]),
    graphStyle: graphStyleSchema,
    items: z.array(itemSchema).max(400),
    inspector: statement,
    control: statement,
    customSymbols: z
      .array(
        z.object({
          key: z.string().max(40),
          text: z.string().min(1).max(8),
          title: z.string().min(1).max(45),
          color: hexColor,
        }),
      )
      .max(30),
  }),
)
  .refine(
    (r) => r.items.reduce((n, i) => n + i.points.length, 0) <= 40000,
    "This drawing has too many points. Split it into separate reports.",
  );

export const clone = (value) => JSON.parse(JSON.stringify(value));
export function blankReport() {
  const date = localDate();
  const emptyStatement = () => ({
    notes: "",
    name: "",
    certificate: "",
    date: "",
    signature: [],
  });
  return {
    schemaVersion: 1,
    schemaRevision: 6,
    id: uid(),
    title: "Untitled inspection",
    customer: "",
    phone: "",
    date,
    street: "",
    city: "",
    construction: [],
    feetPerSquare: 1,
    gridUnit: "ft",
    graphStyle: { ...DEFAULT_GRAPH_STYLE },
    items: [],
    inspector: emptyStatement(),
    control: emptyStatement(),
    customSymbols: [],
  };
}
export function newItem(type, points, overrides = {}) {
  return {
    id: uid(),
    type,
    points,
    text: "",
    symbol: "",
    color: INK,
    width: 2,
    fontSize: 14,
    closed: false,
    pattern: "none",
    patternSpacing: 16,
    cornerStyle: "square",
    cornerRadius: 0,
    showLabel: true,
    showMeasurements: true,
    labelOffset: { x: 0, y: 0 },
    measurementOffsets: [],
    hiddenMeasurements: [],
    measurementSideOverrides: [],
    measurementDistance: 0,
    measurementSide: "normal",
    groupId: "",
    pointLinks: Array.from({ length: points.length }, () => ""),
    rotation: 0,
    ...overrides,
  };
}
export function statementErrors() {
  // Inspector and control statements are intentionally optional. Field users often need
  // to save or export the graph before either section is applicable or complete.
  return [];
}
export function readableDate(value) {
  if (!value) return "";
  const [y, m, d] = value.split("-");
  return `${m}/${d}/${y}`;
}
export function sampleReport() {
  // Samples are explicitly loaded and never mixed into an actual inspection.
  const report = blankReport();
  report.title = "Example structure";
  report.construction = ["Crawlspace"];
  report.items = [
    newItem(
      "outline",
      [
        { x: 190, y: 210 },
        { x: 590, y: 210 },
        { x: 590, y: 540 },
        { x: 430, y: 540 },
        { x: 430, y: 610 },
        { x: 190, y: 610 },
      ],
      { closed: true, text: "MAIN RESIDENCE" },
    ),
    newItem(
      "rect",
      [
        { x: 70, y: 360 },
        { x: 190, y: 550 },
      ],
      { text: "Garage" },
    ),
    newItem(
      "rect",
      [
        { x: 240, y: 280 },
        { x: 530, y: 460 },
      ],
      { text: "Crawlspace", width: 1, pattern: "diagonal" },
    ),
    newItem(
      "curve",
      [
        { x: 260, y: 640 },
        { x: 290, y: 620 },
        { x: 345, y: 615 },
        { x: 410, y: 635 },
        { x: 440, y: 665 },
        { x: 432, y: 700 },
        { x: 360, y: 712 },
        { x: 292, y: 692 },
      ],
      { text: "Curved walkway", width: 1, pattern: "diagonal", closed: true, showMeasurements: false },
    ),
    newItem("symbol", [{ x: 435, y: 540 }], { text: "Z", symbol: "door", rotation: 90 }),
    newItem("symbol", [{ x: 200, y: 260 }], {
      text: "XXX",
      symbol: "termites",
      color: "#b43b37",
    }),
    newItem("symbol", [{ x: 535, y: 340 }], {
      text: "T",
      symbol: "tubes",
      color: "#b43b37",
    }),
    newItem("symbol", [{ x: 680, y: 150 }], { text: "N", symbol: "north" }),
    newItem("label", [{ x: 385, y: 165 }], {
      text: "EXAMPLE · REPLACE BEFORE USE",
      fontSize: 16,
    }),
    newItem("label", [{ x: 340, y: 740 }], {
      text: "FRONT / STREET",
      fontSize: 12,
    }),
  ];
  return report;
}

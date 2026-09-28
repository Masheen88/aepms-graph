import assert from "node:assert/strict";
import { mkdtemp, cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import {
  sampleReport,
  reportSchema,
  statementErrors,
  clone,
  blankReport,
} from "../src/lib/model.js";
import {
  constrained,
  corneredPathPoints,
  primitives,
  primitivesForItems,
  resizePoints,
  resolvedCornerStyle,
  snapStepForScale,
  translatePoints,
} from "../src/lib/geometry.js";
import { createFormPdf } from "../src/lib/pdf.js";
import { handleApi } from "../server/api.js";
import { localDatabase } from "../server/local.js";

// Focused integration checks cover data loss and print correctness, without a UI test suite.
const report = sampleReport();
report.title = "Example inspection";
report.customer = "Example property";
report.street = "100 Example Lane";
report.city = "Lebanon, TN 37087";
report.phone = "615-555-0100";
report.date = "2026-09-08";
report.inspector = {
  notes:
    "SAMPLE ONLY. Example structure inspected for demonstration. Garage and crawlspace shown on graph. XXX marks an example observation at the west wall. Access door shown at rear. This is not a completed inspection.",
  name: "Alex Sample",
  certificate: "SAMPLE-123",
  date: "2026-09-08",
  signature: [],
};
report.control = {
  notes:
    "SAMPLE ONLY. No actual treatment was performed. This statement demonstrates the control technician section on the original form.",
  name: "Taylor Example",
  certificate: "SAMPLE-456",
  date: "2026-09-08",
  signature: [],
};
assert.equal(statementErrors(report).length, 0);
assert.equal(blankReport().feetPerSquare, 1, "New inspections must default to 1 unit per square");
assert.equal(snapStepForScale(1), 10, "1 ft/square snaps to full grid squares");
assert.equal(snapStepForScale(2), 5, "2 ft/square must expose the halfway 1 ft snap point");
assert.deepEqual(
  constrained({ x: 13, y: 17 }, snapStepForScale(2)),
  { x: 15, y: 15 },
  "2 ft/square snapping must round to 1 ft half-square increments",
);
const invalid = clone(report);
invalid.items[0].points[0].x = -1;
assert.equal(reportSchema.safeParse(invalid).success, false);
const incomplete = clone(report);
incomplete.control = { notes: "", name: "", certificate: "", date: "", signature: [] };
incomplete.inspector = { notes: "", name: "", certificate: "", date: "", signature: [] };
assert.equal(
  statementErrors(incomplete).length,
  0,
  "Inspector and control statements must remain optional for save/export",
);
assert.deepEqual(
  translatePoints(
    [
      { x: 780, y: 100 },
      { x: 800, y: 100 },
    ],
    30,
    10,
  ),
  [
    { x: 780, y: 110 },
    { x: 800, y: 110 },
  ],
);
const resized = resizePoints(
  [
    { x: 100, y: 100 },
    { x: 200, y: 200 },
  ],
  "se",
  { x: 300, y: 250 },
);
assert.deepEqual(resized[1], { x: 300, y: 250 });
const patterned = clone(report.items.find((item) => item.type === "rect"));
patterned.pattern = "diagonal";
const patternMarks = primitives(patterned, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.ok(patternMarks.filter((mark) => mark.kind === "path").length > 4);
assert.ok(patternMarks.some((mark) => mark.measurement));
const hiddenLabel = clone(patterned);
hiddenLabel.text = "Hidden area title";
hiddenLabel.showLabel = false;
const hiddenMarks = primitives(hiddenLabel, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.equal(
  hiddenMarks.some((mark) => mark.kind === "text" && mark.text === "Hidden area title"),
  false,
  "Hidden geometry labels must stay out of editor/preview/PDF primitives",
);
const hiddenMeasurements = clone(patterned);
hiddenMeasurements.showMeasurements = false;
const hiddenMeasurementMarks = primitives(hiddenMeasurements, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.equal(
  hiddenMeasurementMarks.some((mark) => mark.measurement),
  false,
  "Per-object measurement toggles must suppress length text",
);
const hiddenOne = clone(patterned);
hiddenOne.hiddenMeasurements = [0];
const hiddenOneMarks = primitives(hiddenOne, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.equal(
  hiddenOneMarks.some((mark) => mark.measurement && mark.measurementIndex === 0),
  false,
  "A single crowded dimension must be hideable without disabling the object",
);
const oldRevision = clone(report);
oldRevision.schemaRevision = 2;
delete oldRevision.items[0].hiddenMeasurements;
delete oldRevision.items[0].measurementSideOverrides;
const migrated = reportSchema.parse(oldRevision);
assert.equal(migrated.schemaRevision, 7, "Older saves must normalize to schema revision 7");
assert.deepEqual(migrated.items[0].hiddenMeasurements, []);
assert.deepEqual(migrated.items[0].measurementSideOverrides, []);
assert.deepEqual(migrated.items[0].shownMeasurements, [], "Older saves must default to no explicit side overrides");
assert.deepEqual(migrated.items[0].measurementRunIds, [], "Older saves must default to no combined measurement runs");
assert.deepEqual(migrated.items[0].measurementOffsets, [], "Older manual dimension drags must reset to automatic layout");
assert.equal(migrated.graphStyle.measurementPlacement, "smart");
assert.equal(migrated.graphStyle.measurementOrientation, "horizontal");
assert.equal(migrated.graphStyle.measurementDetail, "simplified");
assert.equal(migrated.graphStyle.measurementCrowding, "clean");

const sparseRevision = clone(report);
sparseRevision.schemaRevision = 6;
sparseRevision.items[0].measurementOffsets = [];
sparseRevision.items[0].measurementOffsets.length = 3;
sparseRevision.items[0].measurementOffsets[2] = { x: 4, y: 5 };
sparseRevision.items[0].measurementSideOverrides = [null, null, "opposite"];
sparseRevision.items[0].pointLinks = [null, "corner-link"];
const repairedSparse = reportSchema.parse(sparseRevision);
assert.deepEqual(
  repairedSparse.items[0].measurementOffsets.slice(0, 2),
  [{ x: 0, y: 0 }, { x: 0, y: 0 }],
  "Sparse/null measurement offsets must be repaired before Save/PDF export",
);
assert.deepEqual(repairedSparse.items[0].measurementSideOverrides.slice(0, 2), ["inherit", "inherit"]);
assert.deepEqual(repairedSparse.items[0].pointLinks.slice(0, 2), ["", "corner-link"]);

const compactBox = clone(patterned);
compactBox.points = [{ x: 100, y: 100 }, { x: 110, y: 110 }];
const compactBoxMarks = primitives(compactBox, {
  feetPerSquare: 1,
  gridUnit: "ft",
  graphStyle: { ...report.graphStyle, measurementFontSize: 6, measurementDetail: "simplified" },
});
const compactBoxDimensions = compactBoxMarks.filter((mark) => mark.measurement);
assert.equal(compactBoxDimensions.length, 2, "A rectangular box should default to width + height only");
assert.ok(
  compactBoxDimensions.every((mark) => mark.size <= 4.6),
  "One-foot box dimensions should use the compact short-wall text size",
);

const overlapA = clone(patterned);
overlapA.id = crypto.randomUUID();
overlapA.text = "";
const overlapB = clone(patterned);
overlapB.id = crypto.randomUUID();
overlapB.text = "";
const smartEntries = primitivesForItems([overlapA, overlapB], {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
const smartA = smartEntries[0].marks.filter((mark) => mark.measurement);
const smartB = smartEntries[1].marks.filter((mark) => mark.measurement);
assert.ok(smartA.length > 0, "The first overlapping object must retain dimensions");
assert.equal(
  smartB.length,
  0,
  "Exact duplicate geometry must not stack duplicate dimension text",
);

const nearbyLineA = clone(report.items.find((item) => item.type === "line"));
nearbyLineA.id = crypto.randomUUID();
nearbyLineA.points = [{ x: 100, y: 100 }, { x: 120, y: 100 }];
nearbyLineA.text = "";
const nearbyLineB = clone(nearbyLineA);
nearbyLineB.id = crypto.randomUUID();
nearbyLineB.points = [{ x: 100, y: 106 }, { x: 120, y: 106 }];
const nearbyEntries = primitivesForItems([nearbyLineA, nearbyLineB], {
  feetPerSquare: 1,
  gridUnit: "ft",
  graphStyle: { ...report.graphStyle, measurementCrowding: "all", measurementPlacement: "smart" },
});
for (const mark of nearbyEntries.flatMap((entry) => entry.marks).filter((mark) => mark.measurement)) {
  const offset = mark.measurementAutoOffset || { x: 0, y: 0 };
  assert.ok(
    Math.hypot(offset.x, offset.y) <= 7,
    "Smart measurement layout must stay close enough to the wall that ownership is obvious",
  );
}

// v1.5.5 combined measurement runs must render one full-span value without changing geometry.
const runA = clone(report.items.find((item) => item.type === "line"));
runA.id = crypto.randomUUID();
runA.points = [{ x: 100, y: 100 }, { x: 200, y: 100 }];
runA.showMeasurements = true;
runA.hiddenMeasurements = [];
runA.shownMeasurements = [0];
runA.measurementRunIds = ["test-run"];
const runB = clone(runA);
runB.id = crypto.randomUUID();
runB.points = [{ x: 200, y: 100 }, { x: 230, y: 100 }];
const combinedEntries = primitivesForItems([runA, runB], {
  feetPerSquare: 1,
  gridUnit: "ft",
  graphStyle: { ...report.graphStyle, showMeasurements: true, measurementCrowding: "all" },
});
const combinedMarks = combinedEntries
  .flatMap((entry) => entry.marks)
  .filter((mark) => mark.measurement);
assert.equal(combinedMarks.length, 1, "A combined run must render one dimension value");
assert.equal(combinedMarks[0].text, "13 ft", "Touching 10 ft + 3 ft segments must show their full 13 ft span");
assert.equal(combinedMarks[0].measurementCombined, true);
assert.deepEqual(runA.points, [{ x: 100, y: 100 }, { x: 200, y: 100 }], "Combining dimensions must not mutate wall geometry");

const rotatedDoor = primitives(
  clone(report.items.find((item) => item.symbol === "door")),
  { feetPerSquare: report.feetPerSquare, gridUnit: report.gridUnit, graphStyle: report.graphStyle },
);
assert.ok(
  rotatedDoor.some((mark) => mark.kind === "path"),
  "Rotated door symbols must still render as vector paths",
);
const curved = clone(report.items.find((item) => item.type === "curve"));
const curvedMarks = primitives(curved, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.ok(
  curvedMarks.some((mark) => mark.kind === "path" && mark.smooth),
  "Curve objects must render as smooth paths",
);
const rounded = clone(patterned);
// Simulate a v1.3 backup: cornerRadius existed before cornerStyle was introduced.
delete rounded.cornerStyle;
rounded.cornerRadius = 28;
assert.equal(resolvedCornerStyle(rounded), "round");
const roundedMarks = primitives(rounded, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.ok(
  roundedMarks.some((mark) => mark.kind === "path" && mark.closed && mark.points.length > 8),
  "Rounded rectangles must render with curved-corner geometry",
);
const bevelOutline = clone(report.items.find((item) => item.type === "outline"));
bevelOutline.cornerStyle = "bevel";
bevelOutline.cornerRadius = 20;
const bevelPoints = corneredPathPoints(bevelOutline);
assert.ok(
  bevelPoints.length > bevelOutline.points.length,
  "Beveled outlines must replace each treated vertex with chamfer endpoints",
);
const roundLine = {
  ...clone(bevelOutline),
  id: crypto.randomUUID(),
  type: "line",
  closed: false,
  cornerStyle: "round",
  points: [
    { x: 100, y: 100 },
    { x: 200, y: 100 },
    { x: 200, y: 200 },
  ],
};
assert.ok(
  corneredPathPoints(roundLine).length > roundLine.points.length,
  "Multi-point lines must support rounded internal corners",
);
const ellipse = { ...clone(patterned), id: crypto.randomUUID(), type: "ellipse", cornerRadius: 0 };
const ellipseMarks = primitives(ellipse, {
  feetPerSquare: report.feetPerSquare,
  gridUnit: report.gridUnit,
  graphStyle: report.graphStyle,
});
assert.ok(
  ellipseMarks.some((mark) => mark.kind === "path" && mark.closed && mark.points.length >= 40),
  "Oval areas must render as closed scalable geometry",
);

const root = await mkdtemp(join(tmpdir(), "fieldbook-verify-"));
let db;
try {
  await cp("drizzle", join(root, "drizzle"), { recursive: true });
  db = localDatabase(root);
  const put = (payload, revision = 0, origin = "http://fieldbook.test") =>
    new Request(`http://fieldbook.test/api/reports/${payload.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ report: payload, expectedRevision: revision }),
    });
  assert.equal((await handleApi(put(report), db)).status, 200);
  assert.equal(
    (await handleApi(put(report), db)).status,
    409,
    "Duplicate creation must not overwrite",
  );
  report.customer = "Updated sample property";
  assert.equal((await handleApi(put(report, 1), db)).status, 200);
  assert.equal(
    (await handleApi(put(report, 1), db)).status,
    409,
    "Stale revisions must not overwrite",
  );
  assert.equal(
    (await handleApi(put(report, 2, "http://other.test"), db)).status,
    403,
  );
  assert.equal((await handleApi(put(invalid), db)).status, 400);
  db.close();
  db = localDatabase(root);
  const loaded = await (
    await handleApi(
      new Request(`http://fieldbook.test/api/reports/${report.id}`),
      db,
    )
  ).json();
  assert.equal(loaded.report.customer, "Updated sample property");
  assert.equal(loaded.revision, 2);
  const list = await (
    await handleApi(new Request("http://fieldbook.test/api/reports"), db)
  ).json();
  assert.equal(list.reports.length, 1);
} finally {
  db?.close();
  await rm(root, { recursive: true, force: true });
}

const fontBytes = await readFile("public/DejaVuSans.ttf");
const logoBytes = await readFile("public/company-logo.png");
const printAssets = { fontBytes, logoBytes };
await mkdir("examples", { recursive: true });
const pdf = await createFormPdf(report, printAssets);
assert.equal(pdf.pageCount, 2);
assert.ok(pdf.overlays[0].marks.some((mark) => mark.kind === "image" && mark.source === "company-logo"));
const document = await PDFDocument.load(pdf.bytes);
assert.equal(document.getPageCount(), 2);
assert.equal(document.getPage(0).getWidth(), 612);
assert.equal(document.getPage(0).getHeight(), 792);
await writeFile("examples/inspection-example.pdf", pdf.bytes);
await writeFile(
  "examples/inspection-example.termite.json",
  JSON.stringify({ application: "Termite Fieldbook", report }, null, 2),
);
const long = clone(report);
long.inspector.notes = Array.from(
  { length: 80 },
  (_, i) => `Observation ${i + 1}: example note.`,
).join("\n");
const overflow = await createFormPdf(long, printAssets);
assert.ok(overflow.pageCount > 2);
assert.equal(
  (await PDFDocument.load(overflow.bytes)).getPageCount(),
  overflow.pageCount,
);
const text = overflow.overlays
  .flatMap((p) => p.marks.filter((m) => m.kind === "text").map((m) => m.text))
  .join("\n");
assert.ok(
  text.includes("Observation 80: example note."),
  "Last note must survive continuation pagination",
);
const unicode = clone(report);
unicode.inspector.name = "José Núñez";
assert.ok((await createFormPdf(unicode, printAssets)).bytes.length > 0);
const sourceSize = await createFormPdf(report, printAssets, {
  paper: "original",
});
assert.equal(
  (await PDFDocument.load(sourceSize.bytes)).getPage(0).getHeight(),
  1950,
);
console.log(
  "PASS: validation, optional technician statements, company logo output, 1-unit default scale, scale-aware snapping, resizing, rounded/beveled/oval areas, hidden labels, per-object/per-side measurements, combined dimension runs, schema migration, smart dimension layout, smooth curves, rotated symbols, hatch/dimensions, edge movement, durable saves, stale revision conflicts, request origin, clean two-page Letter export, original size, Unicode, and complete note overflow.",
);

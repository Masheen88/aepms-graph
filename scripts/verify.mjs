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
} from "../src/lib/model.js";
import { primitives, resizePoints, translatePoints } from "../src/lib/geometry.js";
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
const invalid = clone(report);
invalid.items[0].points[0].x = -1;
assert.equal(reportSchema.safeParse(invalid).success, false);
const incomplete = clone(report);
incomplete.control.name = "";
assert.ok(statementErrors(incomplete).some((v) => v.includes("signed name")));
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
await mkdir("examples", { recursive: true });
const pdf = await createFormPdf(report, fontBytes);
assert.equal(pdf.pageCount, 2);
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
const overflow = await createFormPdf(long, fontBytes);
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
assert.ok((await createFormPdf(unicode, fontBytes)).bytes.length > 0);
const sourceSize = await createFormPdf(report, fontBytes, {
  paper: "original",
});
assert.equal(
  (await PDFDocument.load(sourceSize.bytes)).getPage(0).getHeight(),
  1950,
);
console.log(
  "PASS: validation, resizing, hidden labels, hatch/dimensions, edge movement, durable saves, stale revision conflicts, request origin, clean two-page Letter export, original size, Unicode, and complete note overflow.",
);

import {
  PDFDocument,
  rgb,
  pushGraphicsState,
  popGraphicsState,
  moveTo,
  lineTo,
  closePath,
  clip,
  endPath,
  degrees,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import {
  CONSTRUCTION,
  GRID,
  readableDate,
  reportSchema,
  SYMBOLS,
} from "./model.js";
import {
  GRAPH_CORNERS,
  PRINT_GRAPH,
  primitives,
  svgPath,
  toForm,
} from "./geometry.js";

const BLACK = "#172027";
const PAGE = { width: 1440, height: 1950 };
const color = (hex) =>
  rgb(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  );

export function wrapText(text, font, size, width) {
  // Preserve paragraphs and split long words so notes never disappear off the page.
  const lines = [];
  for (const paragraph of text.replace(/\r/g, "").split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.trim().split(/\s+/)) {
      if (
        font.widthOfTextAtSize(line ? `${line} ${word}` : word, size) <= width
      ) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const char of word) {
        if (font.widthOfTextAtSize(line + char, size) > width) {
          lines.push(line);
          line = "";
        }
        line += char;
      }
    }
    lines.push(line);
  }
  return lines;
}
function addText(
  list,
  font,
  text,
  x,
  y,
  size = 23,
  maxWidth = 1000,
  options = {},
) {
  if (!text) return;
  let fitted = size;
  while (fitted > 12 && font.widthOfTextAtSize(text, fitted) > maxWidth)
    fitted -= 0.5;
  if (font.widthOfTextAtSize(text, fitted) > maxWidth)
    throw new Error(
      `“${text.slice(0, 35)}…” is too long for its printed field. Shorten that field or put the detail in notes.`,
    );
  list.push({
    kind: "text",
    text,
    x,
    y,
    size: fitted,
    color: BLACK,
    anchor: "start",
    ...options,
  });
}
function line(list, x1, y1, x2, y2, width = 1.5, ink = BLACK, options = {}) {
  list.push({
    kind: "path",
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ],
    closed: false,
    color: ink,
    width,
    ...options,
  });
}
function rectangle(list, x, y, width, height, options = {}) {
  list.push({
    kind: "rect",
    x,
    y,
    width,
    height,
    fill: options.fill || null,
    color: options.color || BLACK,
    borderWidth: options.borderWidth ?? 1.5,
    ...options,
  });
}
function checkbox(list, x, y, checked = false, size = 14) {
  rectangle(list, x, y, size, size, { fill: "#ffffff", borderWidth: 1.5 });
  if (checked) {
    line(list, x + 2, y + 2, x + size - 2, y + size - 2, 2.1);
    line(list, x + size - 2, y + 2, x + 2, y + size - 2, 2.1);
  }
}
function labelledCheckbox(list, font, text, x, y, checked, width) {
  checkbox(list, x, y - 12, checked, 15);
  addText(list, font, text, x + 23, y, 17, width - 23);
}
function fieldBox(list, font, label, value, x, y, width, height) {
  rectangle(list, x, y, width, height, { fill: "#ffffff", borderWidth: 1.3 });
  addText(list, font, label, x + 9, y + 20, 14, width - 18);
  addText(list, font, value, x + 9, y + 49, 22, width - 18);
}

function graphGrid(list, report) {
  const style = report.graphStyle;
  rectangle(list, PRINT_GRAPH.x, PRINT_GRAPH.y, PRINT_GRAPH.width, PRINT_GRAPH.height, {
    fill: style.background,
    color: style.major,
    borderWidth: 2.2,
  });
  for (let x = 0; x <= GRID.width; x += GRID.step) {
    const p1 = toForm({ x, y: 0 }),
      p2 = toForm({ x, y: GRID.height }),
      major = x % 100 === 0;
    line(list, p1.x, p1.y, p2.x, p2.y, major ? 1.55 : 0.65, major ? style.major : style.minor);
  }
  for (let y = 0; y <= GRID.height; y += GRID.step) {
    const p1 = toForm({ x: 0, y }),
      p2 = toForm({ x: GRID.width, y }),
      major = y % 100 === 0;
    line(list, p1.x, p1.y, p2.x, p2.y, major ? 1.55 : 0.65, major ? style.major : style.minor);
  }
}

function frontTemplate(report, font) {
  const marks = [];
  // Company artwork is a real print primitive so it appears in both preview and PDF.
  marks.push({
    kind: "image",
    source: "company-logo",
    x: 42,
    y: 42,
    width: 125,
    height: 103,
  });
  // This is a clean vector recreation of the printed form, not the skewed photographed scan.
  addText(
    marks,
    font,
    "APPLE'S ENVIRONMENTAL PEST MANAGEMENT SOLUTIONS, INC.",
    PAGE.width / 2,
    72,
    34,
    1260,
    { anchor: "middle" },
  );
  addText(marks, font, "203 Gordon Dr. · Lebanon, TN 37087", PAGE.width / 2, 111, 24, 1100, {
    anchor: "middle",
  });
  addText(
    marks,
    font,
    "(615) 444-5884 · Fax: (615) 444-1359 · Toll Free: 877-358-4646",
    PAGE.width / 2,
    145,
    23,
    1200,
    { anchor: "middle" },
  );
  addText(marks, font, "TN CHARTER #188", PAGE.width / 2, 180, 24, 800, { anchor: "middle" });
  addText(marks, font, "INSPECTION GRAPH", PAGE.width / 2, 238, 38, 800, { anchor: "middle" });

  fieldBox(marks, font, "NAME", report.customer, 40, 270, 680, 62);
  fieldBox(marks, font, "PHONE", report.phone, 720, 270, 390, 62);
  fieldBox(marks, font, "DATE", readableDate(report.date), 1110, 270, 290, 62);
  fieldBox(marks, font, "STREET", report.street, 40, 332, 680, 62);
  fieldBox(marks, font, "CITY, STATE AND ZIP CODE", report.city, 720, 332, 680, 62);

  graphGrid(marks, report);

  const constructionY = 1830,
    construction = [
      ["Crawlspace", 188],
      ["Basement", 390],
      ["Floating slab", 565],
      ["Supported slab", 785],
      ["Monolithic slab", 1045],
    ];
  addText(marks, font, "TYPE OF CONSTRUCTION:", 40, constructionY, 17, 165);
  for (const [label, x] of construction)
    labelledCheckbox(marks, font, label.toUpperCase(), x, constructionY, report.construction.includes(label), 230);

  const firstKeyY = 1864,
    secondKeyY = 1897;
  addText(marks, font, "KEY:", 40, firstKeyY, 17, 60);
  const keyRows = [
    [
      ["termites", "SUBTERRANEAN TERMITES — XXX", 98, 300],
      ["powder", "POWDER POST BEETLES — PPB", 410, 292],
      ["ants", "CARPENTER ANTS — CA", 716, 250],
      ["damage", "EXISTING DAMAGE — D", 980, 250],
    ],
    [
      ["bees", "CARPENTER BEES — CB", 98, 260],
      ["borers", "WOOD BORERS — WB", 372, 250],
      ["fungus", "FUNGUS — F", 638, 190],
      ["tubes", "TERMITE TUBES — T", 840, 220],
      ["door", "CRAWLSPACE DOOR — Z", 1075, 300],
    ],
  ];
  const used = new Set(report.items.filter((i) => i.type === "symbol").map((i) => i.symbol));
  keyRows[0].forEach(([key, label, x, width]) =>
    labelledCheckbox(marks, font, label, x, firstKeyY, used.has(key), width),
  );
  addText(marks, font, "KEY:", 40, secondKeyY, 17, 60);
  keyRows[1].forEach(([key, label, x, width]) =>
    labelledCheckbox(marks, font, label, x, secondKeyY, used.has(key), width),
  );
  addText(
    marks,
    font,
    `GRID SCALE: 1 SQUARE = ${report.feetPerSquare} ${report.gridUnit}`,
    40,
    1930,
    16,
    600,
  );
  addText(marks, font, report.title, 1400, 1930, 16, 620, { anchor: "end" });
  return marks;
}

function graphOverlay(report, mono) {
  const options = {
    feetPerSquare: report.feetPerSquare,
    gridUnit: report.gridUnit,
    graphStyle: report.graphStyle,
  };
  return report.items
    .flatMap((item) => primitives(item, options))
    .map((primitive) => {
      if (primitive.kind === "path")
        return {
          ...primitive,
          graph: true,
          points: primitive.points.map(toForm),
          width: primitive.width * PRINT_GRAPH.scale,
          color: mono ? BLACK : primitive.color,
        };
      return {
        ...primitive,
        graph: true,
        ...toForm(primitive),
        size: primitive.size * PRINT_GRAPH.scale,
        color: mono ? BLACK : primitive.color,
        haloColor: report.graphStyle.background,
      };
    });
}

function backTemplate(font, continuation = false) {
  const marks = [];
  addText(
    marks,
    font,
    continuation ? "INSPECTOR'S STATEMENT — CONTINUED" : "INSPECTOR'S STATEMENT:",
    44,
    72,
    19,
    620,
  );
  addText(
    marks,
    font,
    continuation
      ? "CONTROL TECHNICIAN'S STATEMENT — CONTINUED"
      : "CONTROL TECHNICIAN'S STATEMENT:",
    754,
    72,
    19,
    640,
  );
  for (let i = 0; i < 12; i++) {
    const y = 128 + i * 58;
    line(marks, 42, y, 678, y, 1.2);
    line(marks, 752, y, 1398, y, 1.2);
  }
  line(marks, 720, 55, 720, 1080, 0.8, "#a8adaf");

  addText(marks, font, "INSPECTED BY:", 42, 850, 17, 150);
  line(marks, 166, 855, 455, 855, 1.2);
  addText(marks, font, "DATE:", 470, 850, 17, 70);
  line(marks, 530, 855, 678, 855, 1.2);
  addText(marks, font, "TECH CERT #:", 42, 912, 17, 150);
  line(marks, 166, 917, 678, 917, 1.2);

  addText(marks, font, "TREATED BY:", 752, 850, 17, 150);
  line(marks, 875, 855, 1170, 855, 1.2);
  addText(marks, font, "DATE:", 1185, 850, 17, 70);
  line(marks, 1244, 855, 1398, 855, 1.2);
  addText(marks, font, "TECH CERT #:", 752, 912, 17, 150);
  line(marks, 875, 917, 1398, 917, 1.2);

  addText(marks, font, "SIGNATURE:", 42, 985, 15, 120);
  rectangle(marks, 150, 946, 528, 105, { fill: "#ffffff", color: "#c7cbcd", borderWidth: 1 });
  addText(marks, font, "SIGNATURE:", 752, 985, 15, 120);
  rectangle(marks, 860, 946, 538, 105, { fill: "#ffffff", color: "#c7cbcd", borderWidth: 1 });
  return marks;
}

function statementOverlay(list, font, statement, key, lines, pageNumber, more) {
  const left = key === "inspector",
    x = left ? 44 : 754,
    top = 116;
  lines.forEach((text, index) => addText(list, font, text, x, top + index * 58, 21, left ? 628 : 638));
  if (more)
    addText(
      list,
      font,
      `Continued on page ${pageNumber + 1}.`,
      x,
      top + 11 * 58,
      18,
      620,
    );

  addText(list, font, statement.name, left ? 170 : 879, 845, 21, left ? 280 : 285);
  addText(list, font, readableDate(statement.date), left ? 534 : 1248, 845, 20, 140);
  addText(list, font, statement.certificate, left ? 170 : 879, 907, 21, left ? 500 : 510);
  if (statement.signature.length) {
    const sx = left ? 165 : 875,
      sy = 958;
    for (const stroke of statement.signature)
      list.push({
        kind: "path",
        points: stroke.map((p) => ({ x: sx + p.x, y: sy + p.y })),
        width: 2,
        color: BLACK,
        closed: false,
      });
  }
}

export async function createFormPdf(
  raw,
  assets,
  { paper = "letter", monochrome = true } = {},
) {
  const report = reportSchema.parse(raw);
  // Accept the old font-only argument too so older integrations fail gracefully while
  // the app moves to the combined font + company-logo print asset bundle.
  const fontBytes = assets?.fontBytes || assets;
  const logoBytes = assets?.logoBytes || null;
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  const font = await document.embedFont(fontBytes, { subset: true });
  const companyLogo = logoBytes ? await document.embedPng(logoBytes) : null;

  // Reject missing glyphs explicitly instead of exporting blank squares in names or notes.
  const printable = [
    report.title,
    report.customer,
    report.phone,
    report.street,
    report.city,
    ...report.items.map((i) => i.text),
    ...report.customSymbols.flatMap((s) => [s.title, s.text]),
    ...["inspector", "control"].flatMap((k) => [
      report[k].notes,
      report[k].name,
      report[k].certificate,
    ]),
  ].join("");
  const charset = new Set(font.getCharacterSet());
  for (const char of printable) {
    if (!/\s/.test(char) && !charset.has(char.codePointAt(0)))
      throw new Error(
        `The printed font does not support “${char}”. Replace this character before exporting.`,
      );
  }

  const overlays = [
    { width: PAGE.width, height: PAGE.height, background: "vector-front", marks: [] },
    { width: PAGE.width, height: PAGE.height, background: "vector-back", marks: [] },
  ];
  overlays[0].marks.push(...frontTemplate(report, font), ...graphOverlay(report, monochrome));

  const remaining = {
    inspector: wrapText(report.inspector.notes, font, 21, 620),
    control: wrapText(report.control.notes, font, 21, 630),
  };
  let pageIndex = 1;
  do {
    if (pageIndex > 1)
      overlays.push({ width: PAGE.width, height: PAGE.height, background: "vector-back", marks: [] });
    const marks = overlays[pageIndex].marks;
    marks.push(...backTemplate(font, pageIndex > 1));
    for (const key of ["inspector", "control"]) {
      const more = remaining[key].length > 12;
      const lines = remaining[key].splice(0, more ? 11 : 12);
      statementOverlay(marks, font, report[key], key, lines, pageIndex + 1, more);
    }
    addText(
      marks,
      font,
      `${pageIndex > 1 ? "STATEMENT CONTINUATION · " : ""}${report.title}`,
      44,
      1885,
      20,
      1100,
    );
    addText(
      marks,
      font,
      `Grid scale: 1 square = ${report.feetPerSquare} ${report.gridUnit} · Page ${pageIndex + 1}`,
      44,
      1920,
      17,
      900,
    );
    if (pageIndex === 1) {
      const extraKeys = [
        ...SYMBOLS.filter(
          (s) => ["north"].includes(s.key) && report.items.some((i) => i.symbol === s.key),
        ),
        ...report.customSymbols,
      ];
      if (extraKeys.length) {
        addText(marks, font, "ADDITIONAL GRAPH KEY", 754, 1125, 20, 620);
        extraKeys.slice(0, 12).forEach((symbol, index) =>
          addText(marks, font, `${symbol.text} — ${symbol.title}`, 754, 1165 + index * 35, 18, 620),
        );
      }
    }
    pageIndex++;
  } while (remaining.inspector.length || remaining.control.length);

  // Both the preview and PDF draw from overlays. No scanned background or skew correction
  // is involved, so straight/diagonal geometry stays identical to the editor.
  for (const overlay of overlays) {
    const page = document.addPage([PAGE.width, PAGE.height]),
      height = page.getHeight();
    for (const mark of overlay.marks) {
      if (mark.graph)
        page.pushOperators(
          pushGraphicsState(),
          moveTo(GRAPH_CORNERS[0].x, height - GRAPH_CORNERS[0].y),
          ...GRAPH_CORNERS.slice(1).map((p) => lineTo(p.x, height - p.y)),
          closePath(),
          clip(),
          endPath(),
        );
      if (mark.kind === "image") {
        if (companyLogo && mark.source === "company-logo")
          page.drawImage(companyLogo, {
            x: mark.x,
            y: height - mark.y - mark.height,
            width: mark.width,
            height: mark.height,
          });
      } else if (mark.kind === "rect") {
        page.drawRectangle({
          x: mark.x,
          y: height - mark.y - mark.height,
          width: mark.width,
          height: mark.height,
          color: mark.fill ? color(mark.fill) : undefined,
          borderColor: mark.color ? color(mark.color) : undefined,
          borderWidth: mark.borderWidth || 0,
        });
      } else if (mark.kind === "path") {
        const d = svgPath(mark);
        page.drawSvgPath(d, {
          x: 0,
          y: height,
          borderColor: color(mark.color),
          borderWidth: mark.width,
        });
      } else {
        const width = font.widthOfTextAtSize(mark.text, mark.size),
          x =
            mark.anchor === "middle"
              ? mark.x - width / 2
              : mark.anchor === "end"
                ? mark.x - width
                : mark.x,
          baseline = mark.anchor === "middle" ? mark.y + mark.size * 0.34 : mark.y;
        if (mark.halo)
          page.drawRectangle({
            x: x - 4,
            y: height - baseline - mark.size * 0.22,
            width: width + 8,
            height: mark.size * 1.2,
            color: color(mark.haloColor || "#ffffff"),
          });
        page.drawText(mark.text, {
          x,
          y: height - baseline,
          size: mark.size,
          font,
          color: color(mark.color),
          rotate: mark.rotate ? degrees(mark.rotate) : undefined,
        });
      }
      if (mark.graph) page.pushOperators(popGraphicsState());
    }
  }

  let output = document;
  if (paper === "letter") {
    // Uniform page scaling preserves the clean vector form on standard US Letter paper.
    const bytes = await document.save();
    output = await PDFDocument.create();
    const embedded = await output.embedPdf(bytes, document.getPageIndices());
    for (const page of embedded) {
      const sheet = output.addPage([612, 792]),
        scale = Math.min(588 / page.width, 768 / page.height);
      sheet.drawPage(page, {
        x: (612 - page.width * scale) / 2,
        y: (792 - page.height * scale) / 2,
        width: page.width * scale,
        height: page.height * scale,
      });
    }
  }
  output.setTitle(report.title);
  output.setAuthor("Termite Fieldbook");
  output.setSubject("Structure inspection graph and technician statements");
  return { bytes: await output.save(), overlays, pageCount: overlays.length };
}

export async function loadPrintAssets() {
  // The old captured PDF is intentionally no longer loaded. The clean vector form needs
  // the bundled font plus the supplied company logo so preview and PDF remain identical.
  const [fontResponse, logoResponse] = await Promise.all([
    fetch("/DejaVuSans.ttf"),
    fetch("/company-logo.png"),
  ]);
  if (!fontResponse.ok)
    throw new Error("The print font could not be loaded. Reconnect and try again.");
  if (!logoResponse.ok)
    throw new Error("The company logo could not be loaded. Reconnect and try again.");
  const [fontBytes, logoBytes] = await Promise.all([
    fontResponse.arrayBuffer(),
    logoResponse.arrayBuffer(),
  ]);
  return { fontBytes, logoBytes };
}

# Termite Fieldbook

A Vite + Vue 3 Composition API app with Tailwind CSS **4.3.3**, inspired by the supplied **Termite Graph.pdf**. The editor keeps the original fieldbook workflow while rebuilding the printable form as clean vector artwork so exported geometry is no longer warped by the photographed/scanned source. Source comments describe the coordinate system, printing, persistence, patterns, measurements, and gesture handling.

## Run on Windows 11

Install Node.js **22.13 or later** (Node 24 is supported), extract this project, and open its folder in VS Code. In a CMD terminal:

```cmd
npm ci
npm run dev
```

Open the Local URL shown by Vite. To use a tablet or phone, connect it to the same network and open the **Network** URL printed by Vite. If Windows asks, allow Node through the firewall for your private network. Keep the computer and development server running. Node may print an experimental SQLite notice on some versions; the local database still works.

For a production build and local preview:

```cmd
npm run build
npm run preview
```

The preview command serves the complete client and local report API. Opening `dist/client/index.html` directly cannot run the API.

## Use the editor

1. **Outline:** tap each corner, then tap the first corner, press Enter, or choose Finish. Choose Room and drag for a rectangle. Garage and Crawlspace create labeled rectangles.
2. **Select / edit:** drag any existing object to move it. Most newly placed marks automatically enter Select mode so they can be corrected immediately. The Line tool intentionally stays active for repeated wall/segment drawing; press Esc or V when you are done. Round handles move individual points; square corner handles resize the entire object, including freehand drawings. Single-point marks also expose exact X/Y grid positions in the object panel.
3. **Draw / patterned areas:** use a mouse, finger, or stylus to add freehand strokes. **Hatch area** creates a diagonal-marked area for slabs, driveways, and walkways. Any closed Outline or rectangle can be changed to None, Diagonal, or Crosshatch with adjustable spacing.
4. **Measurements:** structural segments display their calculated length from the current grid scale, including diagonal segments. Measurement visibility, color, and font size are configurable under Graph appearance.
5. **Graph appearance:** change graph paper, minor-grid, major-grid, and measurement colors. The UI itself has a persistent light/dark-mode toggle. Labels support font sizes from 6 through 72. Optional titles on rooms, outlines, lines, and freehand objects can be hidden without deleting their saved text, or cleared entirely.
6. **Zoom / pan:** scroll, use the + / - controls, or pinch with two fingers. Choose Pan, or hold Space while dragging. Fit resets the view. A pinch cancels the pending single-finger placement rather than leaving an accidental mark.
7. **Marks:** place any symbol from the printed key. The crawlspace door uses a compact Z-style field mark. Add a north arrow or your own abbreviation and description. Additional symbol definitions print on the back.
8. **Details & notes:** add the customer, address, construction type, grid scale, and inspector/control statements. Each statement has notes, signed name, certification number, date, and an optional hand-drawn signature.
9. **Save:** stores the editable report. Use the folder button to reopen it. **Editable backup** downloads a `.termite.json` file; Import backup opens it as a new inspection so an existing saved record is not overwritten.
10. **Export PDF:** generates a clean vector recreation of the printed graph front and statement back. The editor, preview, and PDF share the same drawing primitives and a uniform graph transform, so straight and diagonal geometry is not skewed by the old captured form.

On phones, **New inspection** is available inside the saved-inspections dialog. **Try an example** loads a clearly labeled demonstration. Example findings and certifications are fictional and must be replaced before actual use.

### Keyboard controls

| Action                         | Shortcut                               |
| ------------------------------ | -------------------------------------- |
| Select / Outline / Room / Line | V / O / R / L                          |
| Hatched area                   | A                                      |
| Draw / Label / Point / Pan     | B / T / P / H                          |
| Finish / cancel outline        | Enter / Escape                         |
| Exit repeating Line tool        | Escape or V                            |
| Remove last unfinished corner  | Backspace                              |
| Move selected object           | Arrow keys; Shift for larger steps     |
| Delete selected object         | Delete / Backspace                     |
| Undo / redo                    | Ctrl+Z / Ctrl+Shift+Z (Command on Mac) |
| Save                           | Ctrl+S (Command on Mac)                |

## Persistence and deployment

- **Hosted app:** records live in its D1 database and can be reopened on another device through the same private app. It relies on the host's access gate; this is a single shared inspection book for the people allowed into that app.
- **Local development / preview:** records live in `.data/reports.sqlite` on the computer running Vite. Devices visiting that same server use the same database. Hosted and local records are separate; transfer an editable backup when needed. Back up the `.data` directory as well as your source.
- **Temporary recovery:** unsaved work is buffered per report in browser storage when available. This is recovery support, not the authoritative save. Private browsing, cleared storage, unavailable storage, and browser eviction can remove recovery drafts. Use Save or an editable backup for work you need to retain.
- **Concurrent edits:** revision checks reject stale saves from another device. Download a backup of your changes, reopen the newer saved record, and reconcile the changes. There is no automatic merging.
- The local server has no built-in account system; it is for your trusted network. If deploying the source elsewhere, protect the entire app and `/api` with authentication before exposing inspection data. The included Worker is compatible with Cloudflare and expects `DB` and `ASSETS` bindings. The `.openai/hosting.json` identity belongs to the private hosted instance; remove its `project_id` when using the code to create a separate site.

## PDF fidelity

The supplied scan remains in `public/` as a visual reference, but it is **not used as the export background anymore**. The app recreates the front and back as straight vector artwork. The graph registration is a uniform scale from the editor coordinate system, so a square remains a square and a diagonal keeps the same angle/proportions in the editor, preview, and PDF.

- **US Letter** uniformly scales each complete vector page into 8.5 × 11 inches with a small margin. **Original document size** keeps the clean 1440 × 1950 vector canvas.
- Graph paper/minor/major colors are report settings. Black annotation ink is on by default for printing; turn it off to preserve annotation colors.
- Length labels, hatch patterns, structure outlines, freehand strokes, symbols, and labels all come from the same shared primitives used by the live editor.
- Statements wrap to ruled lines. Long statements continue on additional numbered sheets, preserving all notes. Custom symbol definitions and scale information use the blank space on the back.
- Long single-line property fields are fitted to their boxes. If they cannot fit legibly, export asks you to shorten that field and move details into notes. The bundled DejaVu Sans font supports accented names; unsupported characters produce a clear export error.
- Typed names and optional drawn signatures are report content. This app does not create a cryptographic PDF signature or independently validate a technician certification.
- For duplex printing choose **two-sided, flip on long edge**. Match the printer paper setting to the exported paper size.

## Project map

| File                               | Purpose                                                      |
| ---------------------------------- | ------------------------------------------------------------ |
| `src/App.vue`                      | Inspection workflow, save/open, history, and export controls |
| `src/components/GraphEditor.vue`   | Pointer input, gestures, zoom, and editable SVG graph        |
| `src/components/ShapeItem.vue`     | Graph objects from shared drawing primitives                 |
| `src/components/StatementForm.vue` | Notes, technician details, and signatures                    |
| `src/components/PaperPreview.vue`  | Clean vector print preview using shared PDF overlays          |
| `src/lib/model.js`                 | Shared report schema, symbols, and sample data               |
| `src/lib/geometry.js`              | Geometry, resize, hatch, dimensions, and print registration   |
| `src/lib/pdf.js`                   | Clean vector form, overlays, wrapping, and PDF output         |
| `server/api.js`                    | Validated report API with optimistic concurrency             |
| `server/local.js`                  | Vite middleware with file-backed SQLite                      |
| `server/worker.js`                 | Hosted Worker entrypoint                                     |
| `db/schema.ts`, `drizzle/`         | Database schema and generated migrations                     |
| `examples/`                        | Fictional editable backup; verify regenerates example PDF     |

For a schema change, edit `db/schema.ts` and run `npm run db:generate`; preserve previously applied migrations. `npm run build` packages the Worker, client assets, hosting manifest, and migrations into `dist/`.

## Verification

```cmd
npm run verify
```

The focused integration checks cover hidden geometry labels, persisted reports after a database reopen, stale-save rejection, origin checks, report validation, geometry bounds, mandatory technician fields, both PDF pages, Letter/native page sizes, accented names, and note continuation. It regenerates the fictional examples. The integration script also checks resizing, hatch output, measurements, PDF page sizes, Unicode, and note continuation. Browser interaction and physical touch-device testing should still be performed on the target devices.

Limits: 400 graph objects, 40,000 total drawing points, 30 custom symbols, 4,000 characters per statement, and 3 MB per editable report. The saved-inspection list shows the latest 500 records. This version does not include automatic cloud autosave, an offline service worker, team roles, image uploads, or live multi-user editing.

## Technical references

- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [PDF-LIB page drawing API](https://pdf-lib.js.org/docs/api/classes/pdfpage)
- [Pointer events for mouse, pen, and touch](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)

The form was supplied by the user. Font redistribution terms are included in `public/FONT-LICENSE.txt`; dependencies retain their respective licenses.

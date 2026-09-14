# Termite Fieldbook

**Current project version: 1.4.2 — precision geometry editing + native Android PDF saving.**

A Vite + Vue 3 Composition API app with Tailwind CSS **4.3.3**, inspired by the supplied **Termite Graph.pdf**. The editor keeps the original fieldbook workflow while rebuilding the printable form as clean vector artwork so exported geometry is no longer warped by the photographed/scanned source. Source comments describe the coordinate system, printing, persistence, patterns, measurements, and gesture handling.

## Run on Windows 11

Install Node.js **22.13 or later** (Node 24 is supported), extract this project, and open its folder in VS Code. In PowerShell or CMD:

```powershell
pnpm i
pnpm dev
```

Open the Local URL shown by Vite. To use a tablet or phone, connect it to the same network and open the **Network** URL printed by Vite. If Windows asks, allow Node through the firewall for your private network. Keep the computer and development server running. Node may print an experimental SQLite notice on some versions; the local database still works.

For a production build and local preview:

```powershell
pnpm build
pnpm preview
```

The preview command serves the complete client and local report API. Opening `dist/client/index.html` directly cannot run the API.

## Use the editor

1. **Outline / area shapes:** tap each corner, then tap the first corner, press Enter, or choose Finish. Room draws a rectangle; Rounded adds adjustable-radius corners; Oval adds circular/elliptical areas; Hatch polygon creates irregular filled areas. Garage and Crawlspace create labeled rectangles.
2. **Select / edit:** drag any existing object to move it. Lines and outlines expose editable white vertex handles plus green midpoint **+** controls for inserting points; the Edit panel also provides exact X/Y coordinates, insert-after controls, and safe per-point deletion. Rectangles can be converted into four-point editable outlines when individual corners need to move independently. Mobile uses large invisible hit targets around lines, resize handles, vertices, and midpoint controls.
3. **Draw / patterned areas:** use a mouse, finger, or stylus to add freehand strokes. **Hatch box**, **Hatch polygon**, **Rounded area**, **Beveled area**, **Oval**, and **Curved area** cover slabs, driveways, gardens, porches, and curved sidewalks. Rectangles, lines, and outlines can use **Square**, **Rounded / radius**, or **Bevel / chamfer** corner treatment with a grid-snapped corner size. Closed shapes can use None, Diagonal, Crosshatch, Horizontal, or Vertical patterns with adjustable spacing.
4. **Measurements:** structural segments display their calculated length from the current grid scale, including diagonal segments. The graph toolbar has a one-tap all-measurements switch. The mobile settings drawer exposes Measurements on/off and Labels on/off immediately, while each selected shape has its own measurement toggle.
5. **Graph appearance:** change graph paper, minor-grid, major-grid, and measurement colors. The UI itself has a persistent light/dark-mode toggle. Labels support font sizes from 6 through 72. Optional titles on rooms, outlines, lines, and freehand objects can be hidden without deleting their saved text, or cleared entirely.
6. **Zoom / pan:** scroll, use the + / - controls, or pinch with two fingers. Choose Pan, or hold Space while dragging. Fit resets the view. A pinch cancels the pending single-finger placement rather than leaving an accidental mark.
7. **Marks:** place any symbol from the printed key. The crawlspace door uses a compact Z-style field mark. Add a north arrow or your own abbreviation and description. Additional symbol definitions print on the back.
8. **Details & notes:** add the customer, address, construction type, grid scale, and optional inspector/control statements. Neither technician section is required to save or export. Technician name/certificate/signature combinations can be saved as reusable device presets, and common notes can be saved as insertable templates.
9. **Save:** always writes an editable device-local copy under `tf-native-report:<report-id>` and also syncs the report service when it is reachable. The folder button merges device-saved and server-saved inspections, so field work can still be reopened when `/api/reports` is offline. **Editable backup** downloads a `.termite.json` file; Import backup opens it as a new inspection so an existing saved record is not overwritten.
10. **Export PDF:** generates a clean vector recreation of the printed graph front and statement back with the supplied Apple’s company logo at the upper left. In the installed Android app, **Save PDF to device** now calls a local Capacitor `PdfSaver` plugin that launches Android’s native `ACTION_CREATE_DOCUMENT` picker. The inspector chooses the folder and filename, then the plugin writes the generated PDF to that selected URI. Browser save/share/download behavior remains only as a fallback for web contexts.

On phones, the drawing-tool rail scrolls horizontally and the settings button opens a full-screen, scrollable graph drawer so no controls are hidden below the canvas. **New inspection** is available inside the saved-inspections dialog. **Try an example** loads a clearly labeled demonstration. Example findings and certifications are fictional and must be replaced before actual use.

### Keyboard controls

| Action                         | Shortcut                               |
| ------------------------------ | -------------------------------------- |
| Select / Outline / Room / Line | V / O / R / L                          |
| Rounded / Bevel / Oval / Hatch box | U / J / E / A                         |
| Hatch polygon / curved area    | G / K                                  |
| Curve / Draw / Label / Point / Pan | C / B / T / P / H                  |
| Finish / cancel outline        | Enter / Escape                         |
| Exit repeating Line tool        | Escape or V                            |
| Remove last unfinished corner  | Backspace                              |
| Move selected object           | Arrow keys; Shift for larger steps     |
| Delete selected object         | Delete / Backspace                     |
| Undo / redo                    | Ctrl+Z / Ctrl+Shift+Z (Command on Mac) |
| Save                           | Ctrl+S (Command on Mac)                |

## Android

### Java 21 selection

`pnpm android` validates the actual Java runtime before Gradle starts. On Windows it prefers Android Studio's bundled `C:\Program Files\Android\Android Studio\jbr` when it is Java 21 or newer, even if `JAVA_HOME` still points at an older JDK. This prevents Gradle failures such as `invalid source release: 21`.
 development

The project keeps the Android command in `package.json`:

```powershell
pnpm android
```

That command runs `scripts/run-android.mjs`, builds Vite, syncs Capacitor, lets you select the connected Android device, installs the debug APK, and prints the APK path. It also runs `scripts/install-android-pdf-saver.mjs` before every build. That installer discovers the Java package from the existing `android/.../MainActivity.java`, writes `PdfSaverPlugin.java` beside it, and registers the plugin without hard-coding or changing your package identity.

**Keep your existing `capacitor.config.json` and `android/` project when applying this source update.** Those files contain the Android package identity used by the already-installed app and therefore by its existing WebView/local-storage data. The runner intentionally refuses to invent a replacement app ID when `capacitor.config.json` is missing.

On Android, tapping **Save PDF to device** should now open the system document picker (the same class of picker used by Android’s Storage Access Framework for “Save As”). Choose a location/name and tap Save. Cancelling the picker leaves the prepared PDF in the export modal so you can try again.

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
| `src/lib/nativeFileSave.js`        | Capacitor bridge for Android native PDF save picker           |
| `server/api.js`                    | Validated report API with optimistic concurrency             |
| `server/local.js`                  | Vite middleware with file-backed SQLite                      |
| `server/worker.js`                 | Hosted Worker entrypoint                                     |
| `db/schema.ts`, `drizzle/`         | Database schema and generated migrations                     |
| `scripts/run-android.mjs`          | Windows-friendly Android build/install runner                 |
| `scripts/install-android-pdf-saver.mjs` | Injects/registers the local Android PDF saver plugin       |
| `examples/`                        | Fictional editable backup; verify regenerates example PDF     |

For a schema change, edit `db/schema.ts` and run `pnpm db:generate`; preserve previously applied migrations. `pnpm build` packages the Worker, client assets, hosting manifest, and migrations into `dist/`.

## Verification

```powershell
pnpm verify
```

The focused integration checks cover hidden geometry labels, optional technician statements, the company-logo print primitive, persisted reports after a database reopen, stale-save rejection, origin checks, report validation, geometry bounds, rounded/beveled corner geometry, oval geometry, both PDF pages, Letter/native page sizes, accented names, resizing, hatch output, measurements, and note continuation. It regenerates the fictional examples. Browser interaction and physical touch-device testing should still be performed on the target devices.

Limits: 400 graph objects, 40,000 total drawing points, 30 custom symbols, 4,000 characters per statement, and 3 MB per editable report. The saved-inspection list shows the latest 500 records. This version does not include automatic cloud autosave, an offline service worker, team roles, image uploads, or live multi-user editing.

## Technical references

- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [PDF-LIB page drawing API](https://pdf-lib.js.org/docs/api/classes/pdfpage)
- [Pointer events for mouse, pen, and touch](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)

The form was supplied by the user. Font redistribution terms are included in `public/FONT-LICENSE.txt`; dependencies retain their respective licenses.

## Scale-aware snapping

New inspections default to **1 ft per grid square**. Snapping is based on real-world distance rather than forcing points to full squares. For example, if the graph scale is set to **2 ft per square**, Snap uses **1 ft** increments and exposes a lighter halfway subdivision inside each square. The editor ruler, coordinate readout, and single-point X/Y position fields also use the selected report unit/scale.

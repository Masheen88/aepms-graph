# Termite Fieldbook

**Current project version: 1.5.4 — confirmed offline backup export, constrained/clean dimension reflow, a quieter field UI, and installable browser/iOS web-app support.**

A Vite + Vue 3 Composition API app with Tailwind CSS **4.3.3**, inspired by the supplied **Termite Graph.pdf**. The editor keeps the original fieldbook workflow while rebuilding the printable form as clean vector artwork so exported geometry is no longer warped by the photographed/scanned source. Source comments describe the coordinate system, printing, persistence, patterns, measurements, and gesture handling.

## What changed in 1.5.4

- **Backups no longer depend on the report server.** Current-inspection and complete-device JSON backups are generated entirely from local in-memory/device data.
- **Android backup export is native and confirmed.** JSON backups now use the same MediaStore/Downloads bridge as PDF export. A success message is shown only after Android confirms the file write, including the exact filename under Downloads/Termite Fieldbook.
- **Browser/iPhone backup export is explicit.** Desktop browsers use a save picker when available. iPhone/iPad Safari/Home Screen web apps use the system share sheet when file sharing is available, where **Save to Files** keeps the JSON backup. Standard browser download remains the fallback.
- **Dimensions cannot wander away from their wall.** Smart placement is capped to a small local zone around the segment. If a dimension cannot fit there in **Clean** mode, it is temporarily omitted rather than moved several grid squares away.
- **Reflow dims is a true recovery action.** It restores Smart + Clean placement, simplified box measurements, default sides/distances, and clears legacy position overrides.
- **Small geometry is clearer.** One-foot/two-foot dimensions use a smaller size and thinner backing so a 1 × 1 ft box remains visible.
- **UI is quieter.** Graph display options, colors, object lists, note shortcuts, technician presets, and sign-off details are progressively disclosed instead of occupying the screen all at once. Help dialogs explain the less-common options.
- **Web/PWA support.** The production client includes a web-app manifest and service-worker shell cache. This provides an App-like Home Screen workflow on iPhone/iPad without shipping through the App Store.
- **Native iOS remains available for later.** `@capacitor/ios` and `scripts/run-ios.sh` are included for teams that later choose normal Apple code signing/distribution.

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

1. **Outline / area shapes:** tap each corner, then tap the first corner, press Enter, or choose Finish. Area draws a rectangle; Rounded adds adjustable-radius corners; Oval adds circular/elliptical areas; Hatch polygon creates irregular filled areas. Garage and Crawlspace create labeled rectangles. The quick rail now stays focused on top-down field-sketch tools; less common geometry remains in the collapsible inspector.
2. **Select / edit:** drag any existing object to move it. Lines and outlines expose editable white vertex handles plus green midpoint **+** controls. Tap a white line/outline vertex to expose a red direct-delete control beside it; press and hold that point for Delete / Add after / Release corner radial actions. Rectangles can still be converted into four-point editable outlines when individual corners need independent movement.
3. **Draw / patterned areas:** use a mouse, finger, or stylus to add freehand strokes. **Hatch area**, **Hatch polygon**, **Rounded area**, **Beveled area**, **Oval**, and **Curved area** cover slabs, driveways, gardens, porches, and curved sidewalks. Rectangles, lines, and outlines can use **Square**, **Rounded / radius**, or **Bevel / chamfer** corner treatment with a grid-snapped corner size. Closed shapes can use None, Diagonal, Crosshatch, Horizontal, or Vertical patterns with adjustable spacing.
4. **Measurements:** structural segments display their calculated length from the current grid scale, including diagonals. Smart placement stays close to the measured wall. In the recommended **Clean** crowding mode, a value that cannot fit clearly is omitted rather than moved far away. Hold a dimension for **Hide**, **Auto**, and **Flip side**. **Reflow dims** restores the whole drawing to Smart + Clean automatic layout. Rectangular areas default to width + height only, with an option to show every side.
5. **Graph appearance / labels:** change graph paper, minor-grid, major-grid, and measurement colors. The UI itself has a persistent light/dark-mode toggle. Labels support font sizes from 6 through 72. Shape labels can be dragged independently of their geometry (including hatch-area labels), hidden without deleting their text, or reset to their automatic position.
6. **Zoom / pan / quick tools:** scroll, use the + / - controls, or pinch with two fingers. Choose Pan, or hold Space while dragging. In Select mode, press and hold empty canvas to open the radial drawing-tool menu; on mobile the **Quick** dock button opens the same menu directly. Fit resets the view.
7. **Marks:** place any symbol from the printed key. The crawlspace door uses a compact Z-style field mark. Add a north arrow or your own abbreviation and description. Additional symbol definitions print on the back.
8. **Details & notes:** property fields and notes stay primary while note shortcuts, technician presets, scale help, and sign-off controls collapse until needed. Neither technician section is required to save or export. Technician name/certificate/signature combinations can be saved as reusable device presets, and common notes can be saved as insertable templates.
9. **Save / transfer:** always writes an editable device-local copy under `tf-native-report:<report-id>` and also syncs the report service when it is reachable. The server is optional for device work. **Export all saves** creates one portable JSON bundle containing all device inspections plus technician/note presets; on installed Android it is written directly to **Downloads/Termite Fieldbook**. **Import backup(s)** restores that bundle. Opening an older Fieldbook save runs it through the current schema and upgrades its stored device copy in place.
10. **Print review / Export PDF:** pan or drag around the preview, pinch or use the zoom controls to inspect small details, then export. PDF generation creates a clean vector recreation of the printed graph front and statement back with the supplied Apple’s company logo at the upper left. In the installed Android app, **Export current PDF** writes the current in-memory inspection directly to **Downloads** through MediaStore; saving the report first is not required. **Choose another location…** uses Android’s native document picker when you want a different folder/name. Browser save/share/download behavior remains as the web fallback.

The drawing rail and inspector can collapse independently, **Focus canvas** hides both on larger screens, and **Hide top controls** removes the entire header/navigation/graph-toolbar stack for maximum graph room. On phones, the drawing-tool rail scrolls horizontally and the settings button opens a full-screen, scrollable graph drawer so no controls are hidden below the canvas. **New inspection** is available inside the saved-inspections dialog. **Try an example** loads a clearly labeled demonstration. Example findings and certifications are fictional and must be replaced before actual use.

### Keyboard controls

| Action                         | Shortcut                               |
| ------------------------------ | -------------------------------------- |
| Select / Outline / Area / Line | V / O / R / L                          |
| Rounded / Bevel / Oval / Hatch area | U / J / E / A                         |
| Hatch polygon / curved area    | G / K                                  |
| Curve / Draw / Label / Point / Pan | C / B / T / P / H                  |
| Finish / cancel outline        | Enter / Escape                         |
| Exit repeating Line tool        | Escape or V                            |
| Remove last unfinished corner  | Backspace                              |
| Move selected object           | Arrow keys; Shift for larger steps     |
| Delete selected object         | Delete / Backspace                     |
| Undo / redo                    | Ctrl+Z / Ctrl+Shift+Z (Command on Mac) |
| Save                           | Ctrl+S (Command on Mac)                |

## Browser / iPhone / iPad

The client can run without the report API. Device saves use browser storage, and JSON backups can be exported/imported to move work between devices. For production web use, serve `dist/client` from an **HTTPS** origin. The included manifest/service worker lets the production site behave as an installable/offline-capable web app after its assets have been cached.

On iPhone or iPad, open the HTTPS site in Safari, use **Share → Add to Home Screen**, enable **Open as Web App**, and add it. This route does not require an App Store listing, Apple Developer Program membership, or Developer Mode. Backups use the system share sheet; choose **Save to Files** to keep the `.termite.json` / bundle file.

For a future native Capacitor iOS build on a Mac:

```bash
chmod +x scripts/run-ios.sh
./scripts/run-ios.sh
```

That native route opens Xcode and therefore follows Apple’s normal signing/distribution requirements.

## Android

### macOS first run

The project now includes its Capacitor identity and can create the native `android/` directory automatically when the source is copied to a Mac. With Android Studio installed, USB debugging enabled on the Android device, and Node.js 22+ available:

```bash
chmod +x scripts/run-android.sh
./scripts/run-android.sh
```

The wrapper installs dependencies when needed, prefers an existing `pnpm`, falls back to Corepack or the pinned pnpm through `npx`, and then uses the normal Android runner. You can also run `pnpm android` once dependencies are installed.

### Java 21 selection

`pnpm android` validates the actual Java runtime before Gradle starts. On Windows it prefers Android Studio's bundled `C:\Program Files\Android\Android Studio\jbr` when it is Java 21 or newer, even if `JAVA_HOME` still points at an older JDK. This prevents Gradle failures such as `invalid source release: 21`.

The project keeps the Android command in `package.json`:

```powershell
pnpm android
```

That command runs `scripts/run-android.mjs`, builds Vite, syncs Capacitor, lets you select the connected Android device, installs the debug APK, and prints the APK path. It also runs `scripts/install-android-pdf-saver.mjs` before every build. That installer discovers the Java package from the existing `android/.../MainActivity.java`, writes the local `PdfSaverPlugin.java` file-saver bridge beside it, and registers the plugin without hard-coding or changing your package identity. Despite the historical class name, the bridge now writes both PDFs and JSON backups.

`capacitor.config.json` is included with the project so a clean checkout/copy can safely create the Android project with the established package identity. If an `android/` directory already exists, the runner keeps it and syncs it rather than recreating it.

On Android, **Export current PDF**, **Export current backup**, and **Export all device saves** can write directly into the public **Downloads/Termite Fieldbook** folder through MediaStore. A report does not have to sync with the server before you can make a backup. The success toast is shown only after Android confirms the write.

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
| `src/lib/nativeFileSave.js`        | Capacitor bridge for Android PDF/JSON file saving             |
| `server/api.js`                    | Validated report API with optimistic concurrency             |
| `server/local.js`                  | Vite middleware with file-backed SQLite                      |
| `server/worker.js`                 | Hosted Worker entrypoint                                     |
| `db/schema.ts`, `drizzle/`         | Database schema and generated migrations                     |
| `scripts/run-android.mjs`          | Cross-platform Android build/install runner                   |
| `scripts/run-android.sh`           | macOS/Linux first-run wrapper with pnpm/Corepack fallback     |
| `scripts/install-android-pdf-saver.mjs` | Injects/registers the local Android PDF/JSON saver plugin  |
| `examples/`                        | Fictional editable backup; verify regenerates example PDF     |

For a schema change, edit `db/schema.ts` and run `pnpm db:generate`; preserve previously applied migrations. `pnpm build` packages the Worker, client assets, hosting manifest, and migrations into `dist/`.

## Verification

```powershell
pnpm verify
```

The focused integration checks cover hidden geometry labels, optional technician statements, the company-logo print primitive, persisted reports after a database reopen, stale-save rejection, origin checks, report validation, geometry bounds, rounded/beveled corner geometry, oval geometry, both PDF pages, Letter/native page sizes, accented names, resizing, hatch output, measurements, and note continuation. It regenerates the fictional examples. Browser interaction and physical touch-device testing should still be performed on the target devices.

Limits: 400 graph objects, 40,000 total drawing points, 30 custom symbols, 4,000 characters per statement, and 3 MB per editable report. The saved-inspection list shows the latest 500 records. This version does not include automatic cloud autosave, team roles, image uploads, or live multi-user editing. The browser build does include a production service-worker shell cache, but inspection data itself remains device-local unless the optional report API is deployed.

## Technical references

- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite)
- [PDF-LIB page drawing API](https://pdf-lib.js.org/docs/api/classes/pdfpage)
- [Pointer events for mouse, pen, and touch](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events)

The form was supplied by the user. Font redistribution terms are included in `public/FONT-LICENSE.txt`; dependencies retain their respective licenses.

## Scale-aware snapping

New inspections default to **1 ft per grid square**. Snapping is based on real-world distance rather than forcing points to full squares. For example, if the graph scale is set to **2 ft per square**, Snap uses **1 ft** increments and exposes a lighter halfway subdivision inside each square. The editor ruler, coordinate readout, and single-point X/Y position fields also use the selected report unit/scale.

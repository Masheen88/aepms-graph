<script setup>
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  ClipboardList,
  Download,
  FilePlus2,
  FileText,
  FolderOpen,
  Grid2X2,
  Hand,
  HelpCircle,
  House,
  Layers,
  LoaderCircle,
  MapPinned,
  Moon,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Plus,
  Redo2,
  Save,
  ScanLine,
  Settings2,
  Square,
  Sun,
  Trash2,
  Type,
  Undo2,
  Upload,
  X,
} from "lucide-vue-next";
import GraphEditor from "./components/GraphEditor.vue";
import ModalShell from "./components/ModalShell.vue";
import StatementForm from "./components/StatementForm.vue";
import PaperPreview from "./components/PaperPreview.vue";
import {
  blankReport,
  clone,
  CONSTRUCTION,
  DEFAULT_GRAPH_STYLE,
  GRID,
  localDate,
  reportSchema,
  sampleReport,
  statementErrors,
  SYMBOLS,
  uid,
} from "./lib/model.js";
import { translatePoints } from "./lib/geometry.js";

const report = ref(blankReport()),
  revision = ref(0),
  savedSnapshot = ref(JSON.stringify(report.value));
const dirty = computed(
  () => JSON.stringify(report.value) !== savedSnapshot.value,
);
const tab = ref("graph"),
  tool = ref("outline"),
  selectedId = ref(null),
  selectedIds = ref([]),
  snap = ref(true),
  panelOpen = ref(false),
  lineAutoConnect = ref(true),
  multiSelectMode = ref(false);
const graph = ref(null),
  fileInput = ref(null),
  labelInput = ref(null),
  position = ref({ x: 0, y: 0 });
const currentSymbol = ref(SYMBOLS[0]),
  modal = ref(null),
  busy = ref(false),
  busyPdf = ref(false),
  toast = ref(""),
  error = ref("");
const records = ref([]),
  loadingRecords = ref(false),
  recovery = ref(null),
  pages = ref([]);
const paper = ref("letter"),
  monochrome = ref(true),
  darkMode = ref(false),
  custom = ref({ title: "", text: "" });
const selectedItems = computed(() => {
  const ids = new Set(selectedIds.value);
  return report.value.items.filter((item) => ids.has(item.id));
});
const selectedCount = computed(() => selectedItems.value.length);
const selected = computed(() =>
  selectedCount.value === 1 ? selectedItems.value[0] : null,
);
const selectedTitle = computed(() => {
  if (selectedCount.value > 1) return `${selectedCount.value} objects selected`;
  const names = {
    rect: "Area / rectangle",
    outline: "Structure outline",
    line: "Line",
    curve: "Curved path",
    freehand: "Freehand drawing",
    label: "Text label",
    symbol: "Inspection mark",
  };
  return selected.value ? names[selected.value.type] || "Selected object" : "Selected object";
});
const selectedTypeSummary = computed(() => {
  const names = {
    rect: "areas",
    outline: "outlines",
    line: "lines",
    curve: "curves",
    freehand: "drawings",
    label: "labels",
    symbol: "marks",
  };
  const counts = {};
  for (const item of selectedItems.value) counts[item.type] = (counts[item.type] || 0) + 1;
  return Object.entries(counts)
    .map(([type, count]) => `${count} ${names[type] || 'items'}`)
    .join(' · ');
});
const selectedHasOptionalLabel = computed(() =>
  ["rect", "outline", "line", "curve", "freehand"].includes(selected.value?.type),
);
const selectedSupportsPattern = computed(() =>
  selected.value?.type === "rect" ||
  (selected.value?.closed && ["outline", "curve", "freehand"].includes(selected.value?.type)),
);
const selectedSupportsMeasurement = computed(() =>
  ["rect", "outline", "line", "curve"].includes(selected.value?.type),
);
const selectedSupportsClosedShape = computed(() =>
  ["outline", "curve", "freehand"].includes(selected.value?.type),
);
const selectedSupportsRotation = computed(() =>
  selected.value?.points?.length === 1 && ["label", "symbol"].includes(selected.value?.type),
);
const snapDistance = computed(() => {
  const scale = Number(report.value.feetPerSquare) || 1;
  return Math.min(1, Math.max(0.1, scale));
});
const snapLabel = computed(() => `${Number(snapDistance.value.toFixed(2))} ${report.value.gridUnit}`);
const formatDistance = (worldValue) => {
  const scaled = (worldValue / GRID.step) * (Number(report.value.feetPerSquare) || 1);
  return Number(scaled.toFixed(2));
};
const symbols = computed(() => [...SYMBOLS, ...report.value.customSymbols]);
const exportErrors = computed(() => statementErrors(report.value));
const history = ref([JSON.stringify(report.value)]),
  historyIndex = ref(0);
const canUndo = computed(() => historyIndex.value > 0),
  canRedo = computed(() => historyIndex.value < history.value.length - 1);
const tools = [
  { id: "select", label: "Select", icon: MousePointer2, key: "V" },
  { id: "outline", label: "Outline", icon: ScanLine, key: "O" },
  { id: "rect", label: "Room", icon: Square, key: "R" },
  { id: "hatch", label: "Hatch area", icon: Grid2X2, key: "A" },
  { id: "line", label: "Line", icon: MoveUpRight, key: "L" },
  { id: "curve", label: "Curve", icon: Pencil, key: "C" },
  { id: "freehand", label: "Draw", icon: Pencil, key: "B" },
  { id: "label", label: "Label", icon: Type, key: "T" },
  { id: "point", label: "Point", icon: Circle, key: "P" },
  { id: "pan", label: "Pan", icon: Hand, key: "H" },
];
let draftTimer,
  previewTimer,
  toastTimer,
  assetsPromise,
  previewRun = 0,
  pendingAction = null;

function notify(message) {
  toast.value = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = ""), 4200);
}
function recordHistory() {
  const value = JSON.stringify(report.value);
  if (value === history.value[historyIndex.value]) return;
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(value);
  if (history.value.length > 70) history.value.shift();
  historyIndex.value = history.value.length - 1;
}
function setSelection(ids = [], primaryId = null) {
  const valid = report.value.items
    .map((item) => item.id)
    .filter((id) => ids.includes(id));
  selectedIds.value = [...new Set(valid)];
  selectedId.value =
    primaryId && selectedIds.value.includes(primaryId)
      ? primaryId
      : selectedIds.value.at(-1) || null;
}
function clearSelection() {
  setSelection([]);
}
function undo() {
  recordHistory();
  if (canUndo.value) {
    historyIndex.value--;
    report.value = JSON.parse(history.value[historyIndex.value]);
    clearSelection();
  }
}
function redo() {
  if (canRedo.value) {
    historyIndex.value++;
    report.value = JSON.parse(history.value[historyIndex.value]);
    clearSelection();
  }
}
function changeItems(items) {
  report.value.items = items;
  recordHistory();
}
function setTool(value) {
  tool.value = value;
  error.value = "";
  if (value !== "select") multiSelectMode.value = false;
}
function toggleMultiSelectMode() {
  multiSelectMode.value = !multiSelectMode.value;
}
function toggleTheme() {
  darkMode.value = !darkMode.value;
  try {
    localStorage.setItem("tf-theme", darkMode.value ? "dark" : "light");
  } catch {
    /* Theme persistence is optional when browser storage is restricted. */
  }
}
function resetGraphStyle() {
  report.value.graphStyle = { ...DEFAULT_GRAPH_STYLE };
  recordHistory();
}
function setLineAutoConnect(value) {
  lineAutoConnect.value = value;
  try {
    localStorage.setItem("tf-line-auto-connect", value ? "1" : "0");
  } catch {
    /* Browser storage may be disabled; the drawing session still works. */
  }
}
function breakLineChain() {
  graph.value?.clearLineAnchor();
  notify("Next line starts fresh.");
}
function rotateSelected(delta) {
  if (!selected.value) return;
  const base = Number(selected.value.rotation || 0);
  let next = base + delta;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  selected.value.rotation = next;
  recordHistory();
}
function patchSelectedRotation(value) {
  if (!selected.value) return;
  let next = Number(value);
  if (!Number.isFinite(next)) return;
  while (next > 180) next -= 360;
  while (next < -180) next += 360;
  selected.value.rotation = next;
  recordHistory();
}
function selectSymbol(symbol) {
  currentSymbol.value = symbol;
  tool.value = "symbol";
  panelOpen.value = false;
}
function patchSelected(field, value) {
  if (selected.value) selected.value[field] = value;
}
function patchSelectedPoint(axis, value) {
  // Position inputs use the selected report's real-world unit so a 2 ft/square graph
  // can still be corrected to exact 1 ft locations instead of square coordinates.
  if (!selected.value || selected.value.points.length !== 1) return;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return;
  const scale = Number(report.value.feetPerSquare) || 1;
  const limit = axis === "x" ? GRID.width : GRID.height;
  const point = { ...selected.value.points[0] };
  point[axis] = Math.max(0, Math.min(limit, (numeric / scale) * GRID.step));
  selected.value.points = [point];
  recordHistory();
}
function deleteSelected() {
  if (!selectedCount.value) return;
  const ids = new Set(selectedIds.value);
  report.value.items = report.value.items.filter((item) => !ids.has(item.id));
  clearSelection();
  recordHistory();
}
function duplicateSelected() {
  if (!selectedCount.value) return;
  const duplicates = selectedItems.value.map((item) => {
    const copy = clone(item);
    copy.id = uid();
    copy.points = translatePoints(copy.points, 20, 20);
    return copy;
  });
  report.value.items.push(...duplicates);
  setSelection(duplicates.map((item) => item.id), duplicates.at(-1)?.id || null);
  recordHistory();
}
function download(bytes, name, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function filename() {
  return (
    report.value.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") ||
    "termite-inspection"
  );
}
function backup() {
  download(
    JSON.stringify(
      { application: "Termite Fieldbook", report: report.value },
      null,
      2,
    ),
    `${filename()}.termite.json`,
    "application/json",
  );
  notify("Editable backup downloaded.");
}
async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    signal: AbortSignal.timeout(20000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The report service did not respond. Your work is still here.",
    );
  }
  if (!response.ok)
    throw new Error(data.error || "The request failed. Please try again.");
  return data;
}
function stashDraft() {
  if (!dirty.value) return;
  try {
    localStorage.setItem(
      `tf-draft:${report.value.id}`,
      JSON.stringify({
        report: report.value,
        revision: revision.value,
        savedSnapshot: savedSnapshot.value,
        time: Date.now(),
      }),
    );
  } catch {
    error.value =
      "Automatic draft recovery is unavailable. Save your report or download an editable backup.";
  }
}
async function save() {
  if (busy.value) return false;
  error.value = "";
  graph.value?.finishOutline();
  const result = reportSchema.safeParse(report.value);
  if (!result.success) {
    error.value = result.error.issues[0].message;
    return false;
  }
  busy.value = true;
  const snapshot = clone(result.data);
  try {
    const data = await request(`/api/reports/${snapshot.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        report: snapshot,
        expectedRevision: revision.value,
      }),
    });
    revision.value = data.revision;
    savedSnapshot.value = JSON.stringify(snapshot);
    clearTimeout(draftTimer);
    if (dirty.value) stashDraft();
    else {
      try {
        localStorage.removeItem(`tf-draft:${snapshot.id}`);
      } catch {
        /* Saving the server record does not depend on local storage. */
      }
    }
    notify("Inspection saved.");
    return true;
  } catch (e) {
    error.value = e.message;
    stashDraft();
    return false;
  } finally {
    busy.value = false;
  }
}
function replaceReport(value, newRevision = 0, snapshot = null) {
  clearTimeout(draftTimer);
  graph.value?.cancel();
  // Parsing here also upgrades older v1 backups with new default drawing settings.
  const normalized = reportSchema.parse(value);
  report.value = clone(normalized);
  revision.value = newRevision;
  savedSnapshot.value = snapshot || JSON.stringify(normalized);
  history.value = [JSON.stringify(normalized)];
  historyIndex.value = 0;
  clearSelection();
  // Reopened/imported drawings start in Select so existing marks are immediately editable.
  // A genuinely blank report still starts in Outline for the normal drawing workflow.
  tool.value = normalized.items.length ? "select" : "outline";
  error.value = "";
  tab.value = "graph";
  modal.value = null;
  nextTick(() => graph.value?.fit());
}
function guard(action) {
  graph.value?.finishOutline();
  if (busy.value) {
    notify("Wait for the current save to finish.");
    return;
  }
  if (dirty.value) {
    stashDraft();
    pendingAction = action;
    modal.value = "confirm";
  } else action();
}
async function continueAction(saveFirst) {
  if (saveFirst && !(await save())) return;
  const action = pendingAction;
  pendingAction = null;
  modal.value = null;
  action?.();
}
function newReport(sample = false) {
  guard(() => {
    replaceReport(sample ? sampleReport() : blankReport());
    if (sample) {
      savedSnapshot.value = "";
      notify(
        "Example loaded. Replace the example before recording an inspection.",
      );
    }
  });
}
async function openRecords() {
  modal.value = "reports";
  loadingRecords.value = true;
  error.value = "";
  try {
    records.value = (await request("/api/reports")).reports;
  } catch (e) {
    error.value = e.message;
  } finally {
    loadingRecords.value = false;
  }
}
async function loadRecord(id) {
  try {
    const data = await request(`/api/reports/${id}`);
    const parsed = reportSchema.parse(data.report);
    guard(() => replaceReport(parsed, data.revision));
  } catch (e) {
    error.value = e.message;
  }
}
async function importFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (file.size > 3_000_000) {
    error.value = "Choose a Fieldbook backup smaller than 3 MB.";
    return;
  }
  try {
    const value = JSON.parse(await file.text()),
      result = reportSchema.safeParse(value.report || value);
    if (!result.success)
      throw new Error("This is not a valid Fieldbook report backup.");
    const imported = { ...result.data, id: uid() };
    guard(() => {
      replaceReport(imported);
      savedSnapshot.value = "";
      notify(
        "Backup imported as a new report. Save to keep it across devices.",
      );
    });
  } catch (e) {
    error.value = e.message;
  }
}
function restoreDraft() {
  if (!recovery.value) return;
  const draft = recovery.value;
  replaceReport(draft.report, draft.revision, draft.savedSnapshot);
  recovery.value = null;
  notify("Unsaved draft restored.");
}
function dismissRecovery() {
  try {
    localStorage.removeItem(`tf-draft:${recovery.value.report.id}`);
  } catch {}
  recovery.value = null;
}
async function buildPreview() {
  const run = ++previewRun;
  busyPdf.value = true;
  error.value = "";
  try {
    const pdf = await import("./lib/pdf.js");
    assetsPromise ??= pdf.loadPrintAssets().catch((e) => {
      assetsPromise = null;
      throw e;
    });
    const font = await assetsPromise;
    const result = await pdf.createFormPdf(
      clone(report.value),
      font,
      { paper: paper.value, monochrome: monochrome.value },
    );
    if (run === previewRun) pages.value = result.overlays;
    return result;
  } catch (e) {
    if (run === previewRun) {
      pages.value = [];
      error.value = e.message;
    }
    return null;
  } finally {
    if (run === previewRun) busyPdf.value = false;
  }
}
async function exportPdf() {
  if (exportErrors.value.length) return;
  const result = await buildPreview();
  if (!result) return;
  download(result.bytes, `${filename()}.pdf`, "application/pdf");
  modal.value = null;
  notify(`${result.pageCount}-page PDF downloaded.`);
}
function openExport() {
  graph.value?.finishOutline();
  modal.value = "export";
}
function addCustom() {
  const text = custom.value.text.trim(),
    title = custom.value.title.trim();
  if (!text || !title) return;
  if (report.value.customSymbols.length >= 30) {
    error.value = "This report already has 30 custom symbols.";
    return;
  }
  const symbol = {
    key: `custom-${uid().slice(0, 8)}`,
    text,
    title,
    color: "#183b42",
  };
  report.value.customSymbols.push(symbol);
  recordHistory();
  custom.value = { title: "", text: "" };
  modal.value = null;
  selectSymbol(symbol);
}
function keyboard(event) {
  const input = event.target.closest("input,textarea,select,[contenteditable]");
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    save();
    return;
  }
  if (modal.value || input) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
    event.preventDefault();
    event.shiftKey ? redo() : undo();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (["Delete", "Backspace"].includes(event.key) && selectedCount.value) {
    event.preventDefault();
    deleteSelected();
    return;
  }
  if (!event.ctrlKey && !event.metaKey) {
    const match = tools.find(
      (t) => t.key.toLowerCase() === event.key.toLowerCase(),
    );
    if (match && tab.value === "graph") setTool(match.id);
  }
}
function leave(event) {
  graph.value?.finishOutline();
  stashDraft();
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = "";
  }
}
function visibility() {
  if (document.visibilityState === "hidden") stashDraft();
}
watch(
  report,
  () => {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(stashDraft, 450);
  },
  { deep: true },
);
watch(
  tab,
  (value) => {
    if (value !== "graph") graph.value?.finishOutline();
  },
  { flush: "sync" },
);
watch([() => JSON.stringify(report.value), paper, monochrome, tab], () => {
  if (tab.value === "preview") {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(buildPreview, 300);
  }
});
watch([selectedId, selectedCount], async () => {
  if (selectedCount.value === 1 && selected.value?.type === "label") {
    panelOpen.value = true;
    await nextTick();
    labelInput.value?.focus();
    labelInput.value?.select();
  }
});
onMounted(() => {
  try {
    const savedTheme = localStorage.getItem("tf-theme");
    darkMode.value = savedTheme
      ? savedTheme === "dark"
      : globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches || false;
    lineAutoConnect.value = localStorage.getItem("tf-line-auto-connect") !== "0";
    const drafts = Object.keys(localStorage)
      .filter((k) => k.startsWith("tf-draft:"))
      .flatMap((k) => {
        try {
          const draft = JSON.parse(localStorage.getItem(k));
          return reportSchema.safeParse(draft.report).success ? [draft] : [];
        } catch {
          return [];
        }
      })
      .sort((a, b) => b.time - a.time);
    recovery.value = drafts[0] || null;
  } catch {
    /* Restricted browsers may disable draft recovery; server saving still works. */
  }
  window.addEventListener("keydown", keyboard);
  window.addEventListener("beforeunload", leave);
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  clearTimeout(draftTimer);
  clearTimeout(previewTimer);
  clearTimeout(toastTimer);
  window.removeEventListener("keydown", keyboard);
  window.removeEventListener("beforeunload", leave);
  document.removeEventListener("visibilitychange", visibility);
});
</script>

<template>
  <div class="app-shell" :class="{ 'theme-dark': darkMode }">
    <header class="app-header">
      <a href="/" class="brand" @click.prevent="tab = 'graph'"
        ><span class="brand-icon"><House :size="25" /></span
        ><span>Fieldbook<small>TERMITE INSPECTIONS</small></span></a
      >
      <div class="document-title">
        <input
          v-model="report.title"
          aria-label="Report title"
          maxlength="80"
          @change="recordHistory"
        /><span
          class="save-status"
          :class="{ 'is-saved': revision && !dirty }"
          >{{
            busy
              ? "Saving…"
              : dirty
                ? "Unsaved changes"
                : revision
                  ? "Saved inspection"
                  : "New inspection"
          }}</span
        >
      </div>
      <div class="header-actions">
        <button
          class="icon-button"
          title="Saved inspections"
          aria-label="Open saved inspections"
          @click="openRecords"
        >
          <FolderOpen :size="20" /></button
        ><button class="btn btn-secondary" :disabled="busy" @click="save">
          <LoaderCircle v-if="busy" :size="17" class="spin" /><Save
            v-else
            :size="17"
          /><span>Save</span></button
        ><button class="btn btn-primary" @click="openExport">
          <ArrowDownToLine :size="18" /><span>Export PDF</span>
        </button>
      </div>
    </header>

    <div v-if="recovery" class="recovery-bar">
      <span
        >Unsaved draft found: <strong>{{ recovery.report.title }}</strong></span
      >
      <div>
        <button @click="restoreDraft">Restore draft</button
        ><button aria-label="Dismiss recovered draft" @click="dismissRecovery">
          <X :size="16" />
        </button>
      </div>
    </div>
    <div v-if="error" class="error-bar" role="alert">
      <span>{{ error }}</span
      ><button
        class="icon-button"
        aria-label="Dismiss error"
        @click="error = ''"
      >
        <X :size="18" />
      </button>
    </div>

    <div class="workspace-nav">
      <nav class="view-tabs" aria-label="Inspection views">
        <button
          :class="{ active: tab === 'graph' }"
          :aria-current="tab === 'graph' ? 'page' : undefined"
          @click="tab = 'graph'"
        >
          <Grid2X2 :size="17" /> Graph</button
        ><button
          :class="{ active: tab === 'notes' }"
          :aria-current="tab === 'notes' ? 'page' : undefined"
          @click="tab = 'notes'"
        >
          <ClipboardList :size="17" /> Details & notes<span class="tab-count"
            >2</span
          ></button
        ><button
          :class="{ active: tab === 'preview' }"
          :aria-current="tab === 'preview' ? 'page' : undefined"
          @click="tab = 'preview'"
        >
          <FileText :size="17" /> Print preview
        </button>
      </nav>
      <div class="nav-utilities">
        <button
          class="icon-button"
          :title="darkMode ? 'Use light mode' : 'Use dark mode'"
          :aria-label="darkMode ? 'Use light mode' : 'Use dark mode'"
          @click="toggleTheme"
        >
          <Sun v-if="darkMode" :size="19" />
          <Moon v-else :size="19" />
        </button>
        <button class="text-button" @click="modal = 'new'">
          <Plus :size="16" /> New inspection</button
        ><button
          class="icon-button"
          aria-label="Drawing help"
          @click="modal = 'help'"
        >
          <HelpCircle :size="19" />
        </button>
      </div>
    </div>

    <main v-if="tab === 'graph'" class="drawing-workspace">
      <aside class="tool-rail" aria-label="Drawing tools">
        <button
          v-for="item in tools"
          :key="item.id"
          :class="{ active: tool === item.id }"
          :aria-pressed="tool === item.id"
          :title="`${item.label} (${item.key})`"
          @click="setTool(item.id)"
        >
          <component :is="item.icon" :size="21" /><span>{{ item.label }}</span>
        </button>
        <div class="rail-divider"></div>
        <button
          :disabled="!canUndo"
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
          @click="undo"
        >
          <Undo2 :size="20" /><span>Undo</span></button
        ><button
          :disabled="!canRedo"
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
          @click="redo"
        >
          <Redo2 :size="20" /><span>Redo</span>
        </button>
      </aside>
      <section class="canvas-column">
        <div class="canvas-toolbar">
          <div class="flex items-center gap-2">
            <span class="eyebrow">DRAWING</span
            ><span class="tool-name">{{
              tool === "symbol"
                ? currentSymbol.title
                : tool === "garage"
                  ? "Garage"
                  : tool === "crawlspace"
                    ? "Crawlspace"
                    : tools.find((t) => t.id === tool)?.label
            }}</span>
            <span v-if="tool === 'line'" class="repeat-tool-badge">REPEAT · ESC TO FINISH</span>
            <span v-if="tool === 'curve'" class="repeat-tool-badge">DRAW CURVES · EDIT TO CLOSE / HATCH</span>
          </div>
          <div v-if="tool === 'line'" class="line-tool-controls">
            <label class="snap-toggle compact-toggle">
              <input
                :checked="lineAutoConnect"
                type="checkbox"
                @change="setLineAutoConnect($event.target.checked)"
              /><span>Auto-connect</span>
            </label>
            <button class="text-button compact" @click="breakLineChain">Break chain</button>
          </div>
          <button
            v-if="tool === 'select'"
            class="toolbar-pill"
            :class="{ active: multiSelectMode }"
            :aria-pressed="multiSelectMode"
            @click="toggleMultiSelectMode"
          >
            <Layers :size="15" /> {{ multiSelectMode ? 'Multi-select on' : 'Multi-select' }}
          </button>
          <label class="snap-toggle"
            ><input v-model="snap" type="checkbox" /><span
              >Snap every {{ snapLabel }}</span
            ></label
          ><button
            class="icon-button mobile-panel-toggle"
            :aria-expanded="panelOpen"
            aria-label="Show marks and selected object settings"
            @click="panelOpen = !panelOpen"
          >
            <Settings2 :size="19" />
          </button>
        </div>
        <GraphEditor
          ref="graph"
          v-model:items="report.items"
          v-model:selected-id="selectedId"
          v-model:selected-ids="selectedIds"
          :tool="tool"
          :symbol="currentSymbol"
          :snap="snap"
          :scale-label="`1 square = ${report.feetPerSquare} ${report.gridUnit}`"
          :feet-per-square="report.feetPerSquare"
          :grid-unit="report.gridUnit"
          :graph-style="report.graphStyle"
          :line-auto-connect="lineAutoConnect"
          :multi-select-mode="multiSelectMode"
          @change="changeItems"
          @select-tool="setTool"
          @position="position = $event"
        />
        <footer class="canvas-footer">
          <span
            ><Layers :size="14" /> {{ report.items.length }}
            {{ report.items.length === 1 ? "mark" : "marks" }}</span
          ><span v-if="selectedCount" class="coordinate-readout"
            >Selected {{ selectedCount }}</span
          ><span class="coordinate-readout"
            >X {{ formatDistance(position.x) }} {{ report.gridUnit }} · Y
            {{ formatDistance(position.y) }} {{ report.gridUnit }}</span
          ><button class="text-button" @click="newReport(true)">
            Try an example <ArrowRight :size="14" />
          </button>
        </footer>
      </section>
      <aside class="inspector-panel" :class="{ 'panel-open': panelOpen }">
        <template v-if="selectedCount">
          <div class="panel-heading">
            <div>
              <span class="eyebrow">{{ selectedCount > 1 ? 'SELECTED OBJECTS' : 'SELECTED OBJECT' }}</span>
              <h2>{{ selectedTitle }}</h2>
            </div>
            <button
              class="icon-button"
              :aria-label="selectedCount > 1 ? 'Clear selection' : 'Deselect object'"
              @click="clearSelection"
            >
              <X :size="18" />
            </button>
          </div>
          <div v-if="selected" class="panel-section">
            <div class="field">
              <span class="field-label-row">
                <span>Label / title</span>
                <button
                  v-if="selectedHasOptionalLabel && selected.text"
                  type="button"
                  class="inline-clear"
                  @click="
                    patchSelected('text', '');
                    recordHistory();
                  "
                >
                  Clear text
                </button>
              </span>
              <input
                ref="labelInput"
                :value="selected.text"
                maxlength="60"
                aria-label="Selected object label or title"
                :placeholder="selectedHasOptionalLabel ? 'Optional label' : 'Label text'"
                @input="patchSelected('text', $event.target.value)"
                @change="recordHistory"
              />
            </div>
            <label v-if="selectedHasOptionalLabel" class="setting-toggle object-label-toggle">
              <span>
                <strong>Show label on graph</strong>
                <small>Hide the title without deleting it from the object.</small>
              </span>
              <input
                type="checkbox"
                :checked="selected.showLabel !== false"
                @change="
                  patchSelected('showLabel', $event.target.checked);
                  recordHistory();
                "
              />
            </label>
            <div class="field-pair">
              <label class="field"
                ><span>Text size</span
                ><select
                  :value="selected.fontSize"
                  @change="
                    patchSelected('fontSize', Number($event.target.value));
                    recordHistory();
                  "
                >
                  <option
                    v-for="size in [6, 8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 60, 72]"
                    :key="size"
                    :value="size"
                  >
                    {{ size }}
                  </option>
                </select></label
              ><label class="field"
                ><span>Line weight</span
                ><select
                  :value="selected.width"
                  @change="
                    patchSelected('width', Number($event.target.value));
                    recordHistory();
                  "
                >
                  <option
                    v-for="size in [1, 2, 3, 4, 6]"
                    :key="size"
                    :value="size"
                  >
                    {{ size }} px
                  </option>
                </select></label
              >
            </div>
            <label class="field"
              ><span>Ink color</span>
              <div class="color-options">
                <button
                  v-for="color in ['#183b42', '#b43b37', '#225daa', '#8a5928']"
                  :key="color"
                  :style="{ background: color }"
                  :aria-label="`Use ${color} ink`"
                  :aria-pressed="selected.color === color"
                  @click="
                    patchSelected('color', color);
                    recordHistory();
                  "
                >
                  <Check v-if="selected.color === color" :size="17" />
                </button></div
            ></label>
            <label v-if="selectedSupportsClosedShape" class="setting-toggle object-label-toggle">
              <span>
                <strong>Closed shape</strong>
                <small>Close the path so curved walkways or outlines can be hatched and measured around the full boundary.</small>
              </span>
              <input
                type="checkbox"
                :checked="selected.closed"
                :disabled="selected.points.length < 3"
                @change="
                  patchSelected('closed', $event.target.checked);
                  if (!$event.target.checked) patchSelected('pattern', 'none');
                  recordHistory();
                "
              />
            </label>
            <label v-if="selectedSupportsMeasurement" class="setting-toggle object-label-toggle">
              <span>
                <strong>Show measurements for this object</strong>
                <small>Turn lengths on or off without affecting other shapes.</small>
              </span>
              <input
                type="checkbox"
                :checked="selected.showMeasurements !== false"
                @change="
                  patchSelected('showMeasurements', $event.target.checked);
                  recordHistory();
                "
              />
            </label>
            <div v-if="selectedSupportsRotation" class="field-pair">
              <label class="field"
                ><span>Rotation</span
                ><input
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  :value="selected.rotation || 0"
                  @change="patchSelectedRotation($event.target.value)"
              /></label>
              <div class="field quick-rotate-field">
                <span>Quick rotate</span>
                <div class="mini-actions">
                  <button class="btn btn-secondary btn-mini" @click="rotateSelected(-15)">-15°</button>
                  <button class="btn btn-secondary btn-mini" @click="rotateSelected(15)">+15°</button>
                </div>
              </div>
            </div>
            <div v-if="selectedSupportsPattern" class="field-pair">
              <label class="field"
                ><span>Area pattern</span
                ><select
                  :value="selected.pattern"
                  @change="
                    patchSelected('pattern', $event.target.value);
                    recordHistory();
                  "
                >
                  <option value="none">None</option>
                  <option value="diagonal">Diagonal marks</option>
                  <option value="crosshatch">Crosshatch</option>
                </select></label
              ><label class="field"
                ><span>Pattern spacing</span
                ><select
                  :value="selected.patternSpacing"
                  @change="
                    patchSelected('patternSpacing', Number($event.target.value));
                    recordHistory();
                  "
                >
                  <option v-for="spacing in [10, 12, 16, 20, 24, 32, 40]" :key="spacing" :value="spacing">
                    {{ spacing }}
                  </option>
                </select></label
              >
            </div>
            <div v-if="selected.points.length === 1" class="field-pair">
              <label class="field"
                ><span>X position ({{ report.gridUnit }})</span
                ><input
                  type="number"
                  min="0"
                  :max="(GRID.width / GRID.step) * report.feetPerSquare"
                  :step="snapDistance"
                  :value="formatDistance(selected.points[0].x)"
                  @change="patchSelectedPoint('x', $event.target.value)"
              /></label>
              <label class="field"
                ><span>Y position ({{ report.gridUnit }})</span
                ><input
                  type="number"
                  min="0"
                  :max="(GRID.height / GRID.step) * report.feetPerSquare"
                  :step="snapDistance"
                  :value="formatDistance(selected.points[0].y)"
                  @change="patchSelectedPoint('y', $event.target.value)"
              /></label>
            </div>
            <div v-if="tool !== 'select'" class="edit-object-callout">
              <span>Keep drawing with <strong>{{ tool === 'line' ? 'Line' : tools.find((t) => t.id === tool)?.label || 'the active tool' }}</strong>, or switch to Select to move/resize this object.</span>
              <button class="btn btn-secondary" @click="setTool('select')">
                <MousePointer2 :size="15" /> Edit on graph
              </button>
            </div>
            <p class="small-help">
              In Select mode, drag the object to move it. Round handles edit
              individual points; square corner handles resize the whole object,
              including freehand drawings; the green rotate handle turns single-point
              symbols and labels. Arrow keys nudge by 1 px; hold Shift to nudge
              by 10 px. Hold Shift while rotating for free-angle rotation.
            </p>
            <div class="flex gap-2">
              <button
                class="btn btn-secondary flex-1"
                @click="duplicateSelected"
              >
                <Layers :size="16" /> Duplicate</button
              ><button
                class="btn btn-danger"
                aria-label="Delete selected object"
                @click="deleteSelected"
              >
                <Trash2 :size="16" /> Delete
              </button>
            </div>
          </div>
          <div v-else class="panel-section multi-select-panel">
            <p class="multi-select-summary">
              <strong>{{ selectedCount }} objects selected.</strong>
              <span>{{ selectedTypeSummary || 'Mixed selection' }}</span>
            </p>
            <label class="setting-toggle object-label-toggle">
              <span>
                <strong>Multi-select mode</strong>
                <small>Tap this on mobile, or use Shift-click on desktop, to add or remove items from the selection.</small>
              </span>
              <input type="checkbox" :checked="multiSelectMode" @change="toggleMultiSelectMode" />
            </label>
            <p class="small-help">
              Drag any selected item to move the whole selection together. Use Delete to remove all selected objects, or Duplicate to copy them as a group. For detailed edits such as labels, measurements, or patterns, reduce the selection to one object.
            </p>
            <div class="multi-select-list">
              <span v-for="item in selectedItems" :key="item.id" class="selection-chip">{{ item.type }}</span>
            </div>
            <div class="flex gap-2">
              <button class="btn btn-secondary flex-1" @click="duplicateSelected">
                <Layers :size="16" /> Duplicate group
              </button>
              <button class="btn btn-danger" @click="deleteSelected">
                <Trash2 :size="16" /> Delete group
              </button>
            </div>
          </div>
        </template>
        <div class="panel-heading">
          <div>
            <span class="eyebrow">ADD TO YOUR GRAPH</span>
            <h2>Marks & labels</h2>
          </div>
          <MapPinned :size="21" class="muted" />
        </div>
        <div class="panel-section">
          <h3>Structure</h3>
          <div class="structure-buttons">
            <button
              :class="{ active: tool === 'garage' }"
              @click="
                setTool('garage');
                panelOpen = false;
              "
            >
              <House :size="18" /> Garage</button
            ><button
              :class="{ active: tool === 'crawlspace' }"
              @click="
                setTool('crawlspace');
                panelOpen = false;
              "
            >
              <Square :size="18" /> Crawlspace</button
            ><button
              :class="{ active: tool === 'hatch' }"
              @click="
                setTool('hatch');
                panelOpen = false;
              "
            >
              <Grid2X2 :size="18" /> Diagonal area</button
            ><button
              @click="selectSymbol(SYMBOLS.find((s) => s.key === 'door'))"
            >
              <span class="door-symbol">Z</span> Crawlspace door</button
            ><button
              @click="selectSymbol(SYMBOLS.find((s) => s.key === 'steps'))"
            >
              ST Steps / stair</button
            ><button
              @click="
                setTool('label');
                panelOpen = false;
              "
            >
              <Type :size="18" /> Custom label
            </button>
          </div>
        </div>
        <div class="panel-section">
          <div class="section-heading">
            <h3>Inspection key</h3>
            <span>FROM YOUR FORM</span>
          </div>
          <div class="symbol-list">
            <button
              v-for="symbol in symbols.filter(
                (s) => !['door', 'north', 'steps'].includes(s.key),
              )"
              :key="symbol.key"
              :class="{
                active: tool === 'symbol' && currentSymbol.key === symbol.key,
              }"
              @click="selectSymbol(symbol)"
            >
              <span class="symbol-token" :style="{ color: symbol.color }">{{
                symbol.text
              }}</span
              ><span>{{ symbol.title }}</span
              ><Plus :size="14" />
            </button>
          </div>
          <button class="add-symbol" @click="modal = 'symbol'">
            <Plus :size="16" /> Add your own symbol
          </button>
        </div>
        <div class="panel-section graph-appearance">
          <div class="section-heading">
            <h3>Graph appearance</h3>
            <button class="text-button compact" @click="resetGraphStyle">Reset</button>
          </div>
          <div class="graph-color-grid">
            <label class="field"><span>Paper</span><input v-model="report.graphStyle.background" type="color" @change="recordHistory" /></label>
            <label class="field"><span>Small grid</span><input v-model="report.graphStyle.minor" type="color" @change="recordHistory" /></label>
            <label class="field"><span>Major grid</span><input v-model="report.graphStyle.major" type="color" @change="recordHistory" /></label>
            <label class="field"><span>Measurements</span><input v-model="report.graphStyle.dimensions" type="color" @change="recordHistory" /></label>
          </div>
          <label class="checkbox-field measurement-toggle">
            <input v-model="report.graphStyle.showMeasurements" type="checkbox" @change="recordHistory" />
            Show measurements by default
          </label>
          <label class="field">
            <span>Measurement font size</span>
            <select v-model.number="report.graphStyle.measurementFontSize" @change="recordHistory">
              <option v-for="size in [6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24]" :key="size" :value="size">{{ size }}</option>
            </select>
          </label>
        </div>
        <div class="panel-section panel-bottom">
          <button
            class="text-button"
            @click="selectSymbol(SYMBOLS.find((s) => s.key === 'north'))"
          >
            <MoveUpRight :size="17" /> Place north arrow
          </button>
          <p class="small-help">
            Your graph and notes export onto a clean, straight vector recreation of the printed form.
          </p>
        </div>
      </aside>
    </main>

    <main v-else-if="tab === 'notes'" class="notes-workspace">
      <div class="page-heading">
        <div>
          <span class="eyebrow">INSPECTION RECORD</span>
          <h1>Details & technician notes</h1>
          <p>
            Complete the inspector or control statement. Fill out both when
            applicable.
          </p>
        </div>
        <button class="btn btn-secondary" @click="tab = 'graph'">
          <ArrowLeft :size="17" /> Back to graph
        </button>
      </div>
      <section class="property-card">
        <div class="section-heading">
          <h2>Property details</h2>
          <House :size="22" />
        </div>
        <div class="property-grid">
          <label class="field"
            ><span>Customer / property name</span
            ><input
              v-model="report.customer"
              maxlength="120"
              autocomplete="name"
              placeholder="Name on the inspection form"
              @change="recordHistory" /></label
          ><label class="field"
            ><span>Phone</span
            ><input
              v-model="report.phone"
              type="tel"
              maxlength="50"
              autocomplete="tel"
              placeholder="(615) 555-0100"
              @change="recordHistory" /></label
          ><label class="field"
            ><span>Inspection date</span
            ><input
              v-model="report.date"
              type="date"
              @change="recordHistory" /></label
          ><label class="field property-street"
            ><span>Street address</span
            ><input
              v-model="report.street"
              maxlength="160"
              autocomplete="street-address"
              placeholder="Street address"
              @change="recordHistory" /></label
          ><label class="field property-city"
            ><span>City, state & ZIP</span
            ><input
              v-model="report.city"
              maxlength="160"
              placeholder="City, state, ZIP code"
              @change="recordHistory"
          /></label>
        </div>
        <div class="construction-row">
          <fieldset>
            <legend>Type of construction</legend>
            <div class="construction-options">
              <label v-for="type in CONSTRUCTION" :key="type"
                ><input
                  v-model="report.construction"
                  type="checkbox"
                  :value="type"
                  @change="recordHistory"
                />{{ type }}</label
              >
            </div>
          </fieldset>
          <div class="scale-field">
            <span>One grid square equals</span>
            <div>
              <input
                v-model.number="report.feetPerSquare"
                type="number"
                min="0.1"
                max="100"
                step="0.1"
                aria-label="Distance per grid square"
                @change="recordHistory"
              /><select
                v-model="report.gridUnit"
                aria-label="Grid scale unit"
                @change="recordHistory"
              >
                <option value="ft">feet</option>
                <option value="m">meters</option>
              </select>
            </div>
            <small class="scale-help">Snap stays accurate to {{ snapLabel }} increments. Example: 2 ft per square adds a snap point halfway through each square.</small>
          </div>
        </div>
      </section>
      <div class="statement-grid">
        <StatementForm
          v-model="report.inspector"
          role="inspector"
          @change="recordHistory"
        /><StatementForm
          v-model="report.control"
          role="control"
          @change="recordHistory"
        />
      </div>
      <div class="notes-footer">
        <span
          ><FileText :size="18" /> Notes, names, certifications, and dates
          appear on the back of the form.</span
        ><button class="btn btn-primary" @click="tab = 'preview'">
          Preview report <ArrowRight :size="17" />
        </button>
      </div>
    </main>

    <main v-else class="preview-workspace">
      <div class="page-heading">
        <div>
          <span class="eyebrow">READY FOR PAPER</span>
          <h1>Print preview</h1>
          <p>A clean printed-form recreation using the exact same graph geometry.</p>
        </div>
        <button class="btn btn-primary" @click="openExport">
          <Download :size="17" /> Export PDF
        </button>
      </div>
      <div class="preview-options">
        <label
          >Paper size
          <select v-model="paper">
            <option value="letter">US Letter · 8.5 × 11 in</option>
            <option value="original">Original document size</option>
          </select></label
        ><label
          ><input v-model="monochrome" type="checkbox" /> Black ink for
          printing</label
        ><span v-if="pages.length">{{ pages.length }} pages</span>
      </div>
      <div v-if="busyPdf" class="loading-state" role="status">
        <LoaderCircle :size="24" class="spin" /> Preparing the paper preview…
      </div>
      <PaperPreview v-else-if="pages.length" :pages="pages" />
      <div v-else class="loading-state">
        <p>Preview could not be prepared.</p>
        <button class="btn btn-secondary" @click="buildPreview">
          Try again
        </button>
      </div>
    </main>

    <div v-if="toast" class="toast" role="status">
      <Check :size="18" />{{ toast }}
    </div>
    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept=".json,.termite.json,application/json"
      aria-label="Import Fieldbook backup"
      @change="importFile"
    />

    <ModalShell
      v-if="modal === 'reports'"
      title="Saved inspections"
      wide
      @close="modal = null"
      ><div class="modal-intro">
        <p>Reopen a saved graph, or import an editable backup.</p>
        <button class="btn btn-secondary" @click="modal = 'new'">
          <Plus :size="16" /> New</button
        ><button class="btn btn-secondary" @click="fileInput.click()">
          <Upload :size="16" /> Import backup
        </button>
      </div>
      <div v-if="loadingRecords" class="loading-state">
        <LoaderCircle :size="22" class="spin" /> Loading inspections…
      </div>
      <div v-else-if="!records.length" class="empty-records">
        <FolderOpen :size="32" />
        <h3>No saved inspections yet</h3>
        <p>Use Save to keep this graph and its notes.</p>
        <button class="btn btn-primary" @click="modal = null">
          Return to inspection
        </button>
      </div>
      <div v-else class="report-list">
        <button
          v-for="record in records"
          :key="record.id"
          @click="loadRecord(record.id)"
        >
          <span class="report-icon"><FileText :size="22" /></span
          ><span
            ><strong>{{ record.title }}</strong
            ><small
              >{{ record.address || "No address added" }} ·
              {{ new Date(record.updated_at).toLocaleDateString() }}</small
            ></span
          ><ArrowRight :size="17" />
        </button>
      </div>
      <button class="text-button mt-4" @click="backup">
        <Download :size="16" /> Download current inspection as an editable
        backup
      </button>
      <p v-if="error" class="inline-error" role="alert">
        {{ error }}
      </p></ModalShell
    >
    <ModalShell
      v-if="modal === 'new'"
      title="New inspection"
      @close="modal = null"
      ><p class="modal-description">
        Start a fresh inspection or explore the drawing tools with an example
        structure.
      </p>
      <button class="new-option" @click="newReport(false)">
        <FilePlus2 :size="24" /><span
          ><strong>Blank inspection</strong
          ><small>A clear grid and empty statements</small></span
        ><ArrowRight :size="18" /></button
      ><button class="new-option" @click="newReport(true)">
        <House :size="24" /><span
          ><strong>Example structure</strong
          ><small>See a residence, garage, and crawlspace</small></span
        ><ArrowRight :size="18" /></button
    ></ModalShell>
    <ModalShell
      v-if="modal === 'confirm'"
      title="Keep your current changes?"
      @close="modal = null"
      ><p class="modal-description">
        This inspection has unsaved changes. You can save it before continuing,
        or download an editable backup.
      </p>
      <button class="text-button mb-5" @click="backup">
        <Download :size="17" /> Download backup
      </button>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="continueAction(false)">
          Continue without saving</button
        ><button
          class="btn btn-primary"
          :disabled="busy"
          @click="continueAction(true)"
        >
          Save & continue
        </button>
      </div>
      <p v-if="error" class="inline-error" role="alert">
        {{ error }}
      </p></ModalShell
    >
    <ModalShell
      v-if="modal === 'symbol'"
      title="Add a custom symbol"
      @close="modal = null"
      ><form @submit.prevent="addCustom">
        <p class="modal-description">
          The symbol and its description are included in the additional graph
          key on the back of your PDF.
        </p>
        <label class="field"
          ><span>Symbol / abbreviation</span
          ><input
            v-model="custom.text"
            required
            maxlength="8"
            placeholder="e.g. VENT" /></label
        ><label class="field"
          ><span>Description</span
          ><input
            v-model="custom.title"
            required
            maxlength="45"
            placeholder="e.g. Foundation vent"
        /></label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" @click="modal = null">
            Cancel</button
          ><button type="submit" class="btn btn-primary">
            Add & place <Plus :size="17" />
          </button>
        </div>
        <p v-if="error" class="inline-error">{{ error }}</p>
      </form></ModalShell
    >
    <ModalShell
      v-if="modal === 'export'"
      title="Export inspection PDF"
      @close="modal = null"
      ><div class="export-form-icon">
        <FileText :size="34" /><span
          >Clean two-sided printed form<small
            >Straight vector graph on the front. Statements on the back.</small
          ></span
        >
      </div>
      <label class="field"
        ><span>Paper size</span
        ><select v-model="paper">
          <option value="letter">US Letter · 8.5 × 11 in</option>
          <option value="original">Original document size</option>
        </select></label
      ><label class="checkbox-field"
        ><input v-model="monochrome" type="checkbox" /> Export markings in black
        ink</label
      >
      <div v-if="exportErrors.length" class="export-checklist">
        <strong>A few details are still needed</strong>
        <ul>
          <li v-for="message in exportErrors" :key="message">{{ message }}</li>
        </ul>
        <button
          class="text-button"
          @click="
            tab = 'notes';
            modal = null;
          "
        >
          Complete technician notes <ArrowRight :size="16" />
        </button>
      </div>
      <p v-else class="export-ready">
        <Check :size="18" /> Technician details complete
      </p>
      <p class="small-help">
        The export no longer uses the warped photographed form. The preview and
        PDF share the same vector grid and drawing coordinates. Long statements
        continue on additional sheets; for two-sided printing, flip on the long edge.
      </p>
      <div class="modal-actions">
        <button class="btn btn-secondary" @click="backup">
          Editable backup</button
        ><button
          class="btn btn-primary"
          :disabled="busyPdf || exportErrors.length > 0"
          @click="exportPdf"
        >
          <LoaderCircle v-if="busyPdf" :size="17" class="spin" /><Download
            v-else
            :size="17"
          />{{ busyPdf ? "Preparing…" : "Download PDF" }}
        </button>
      </div>
      <p v-if="error" class="inline-error" role="alert">
        {{ error }}
      </p></ModalShell
    >
    <ModalShell
      v-if="modal === 'help'"
      title="Working with your graph"
      @close="modal = null"
      ><div class="help-list">
        <p>
          <strong>Outline a structure</strong>Choose Outline and tap each
          corner. Tap the first corner, press Enter, or choose Finish to close
          the outline.
        </p>
        <p>
          <strong>Curved walkways and steps</strong>Use Curve to sketch a curved
          path, then turn on Closed shape and Diagonal marks if it should become
          a walkway or slab. Use the Steps / stair symbol for stair runs.
        </p>
        <p>
          <strong>Move, reshape, rotate, and group</strong>Choose Select. Drag a mark
          to move it, drag its round handles to reposition individual points,
          drag the square handles to resize, and drag the green rotate handle on
          single-point labels or symbols to turn them. Use Shift-click on desktop
          or Multi-select mode on touch devices to build a group selection.
        </p>
        <p>
          <strong>Repeated lines</strong>Line stays active so you can trace wall
          runs quickly. Auto-connect continues from the previous endpoint, and
          Break chain starts the next segment fresh.
        </p>
        <p>
          <strong>Zoom and pan</strong>Scroll or pinch with two fingers to zoom.
          Choose Pan, hold Space and drag, or on touch simply drag empty graph
          space while Select is active. Fit restores the full grid.
        </p>
        <p>
          <strong>Keep and print your work</strong>Save keeps the complete
          editable inspection. An editable backup transfers it as a file. Export
          PDF places the graph and notes on your original form.
        </p>
      </div>
      <div class="shortcut-grid">
        <span>Undo <kbd>Ctrl / ⌘ Z</kbd></span>
        <span>Save <kbd>Ctrl / ⌘ S</kbd></span>
        <span>Finish outline <kbd>Enter</kbd></span>
        <span>Cancel / stop line <kbd>Esc</kbd></span>
        <span>Select tool <kbd>V</kbd></span>
        <span>Curve tool <kbd>C</kbd></span>
      </div>
      <button class="btn btn-primary w-full mt-5" @click="modal = null">
        Back to the graph
      </button></ModalShell
    >
  </div>
</template>

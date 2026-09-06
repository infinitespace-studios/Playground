import { installIssue024RunStopControl } from "./issue24";
import { gateFirstRun } from "./issue37";
import { installIssue047Editor, defaultExampleSource } from "./issue047";
import { installIssue048ProblemsPanel } from "./issue048";
import { installIssue049OutputPanel } from "./issue049";
import installIssue050Tracker from "./issue050";
import { installIssue051ProjectManager } from "./issue051";
import { installIssue052PreviewPanel } from "./issue052";

// Workbench application controller wiring
// Run/Stop buttons are wired into the workbench toolbar (see index.html)
// This module is imported by main.ts at the bottom; DOM is already parsed
// by the time this module-level code executes.

// Issue 047: mount the real Monaco editor with the default HelloWorld example
// before wiring Run, so Run can read the live editor buffer.
const editor = installIssue047Editor();

// Issue 050: dirty-state tracking for the Monaco editor
// Initialize with the default example content
const tracker = installIssue050Tracker(editor.getValue);

// Issue 051: folder-based multi-file project manager. Coexists with the
// single-scratch-file tracker (issue 50): when a folder project is open, issue
// 51 owns the file list, per-file dirty state, Save All, and multi-file Run;
// otherwise the scratch flow (New/Open/Save of one Game1.cs) stays active.
const fileExplorer = document.getElementById("file-explorer");
const projectLabel = document.getElementById("project-label");
const saveAllButton = document.getElementById("save-all-button");

function showModalError(title: string, message: string): void {
  const dialog = document.createElement("dialog");
  dialog.className = "confirmation-dialog";
  const content = document.createElement("div");
  content.className = "dialog-content";
  const h3 = document.createElement("h3");
  h3.textContent = title;
  const p = document.createElement("p");
  p.textContent = message;
  const buttons = document.createElement("div");
  buttons.className = "dialog-buttons";
  const ok = document.createElement("button");
  ok.className = "btn-confirm";
  ok.textContent = "OK";
  ok.addEventListener("click", () => dialog.remove());
  buttons.append(ok);
  content.append(h3, p, buttons);
  dialog.append(content);
  document.body.appendChild(dialog);
  dialog.showModal();
}

const project = installIssue051ProjectManager({
  setEditorContent: content => editor.setValue(content),
  getEditorContent: () => editor.getValue(),
  renderExplorer: entries => {
    if (!fileExplorer) return;
    fileExplorer.replaceChildren();
    for (const entry of entries) {
      const button = document.createElement("button");
      button.className = entry.active ? "file active" : "file";
      button.dataset.file = entry.relativePath;
      button.textContent = entry.dirty ? `${entry.relativePath} \u25CF` : entry.relativePath;
      button.addEventListener("click", () => project.switchTo(entry.relativePath));
      fileExplorer.appendChild(button);
    }
  },
  setDirtyIndicator: anyDirty => {
    const dot = document.getElementById("dirty-indicator");
    const text = document.getElementById("dirty-indicator-text");
    if (dot) { dot.textContent = anyDirty ? " \u25CF" : ""; dot.hidden = !anyDirty; }
    if (text) text.textContent = anyDirty ? "Unsaved changes" : "";
  },
  showError: showModalError,
});

// Wire live buffer edits into the dirty tracker so the indicator updates on
// every keystroke and New/Open gating can detect unsaved changes. When a
// folder project is open, issue 51's per-file tracker owns dirty state.
editor.onDidChangeContent(() => {
  if (project.hasProject()) {
    project.syncActiveBuffer();
  } else {
    tracker.setBuffer(editor.getValue());
  }
});

// Wire Open Folder: prompt if dirty, then pick a folder, list its .cs files,
// and switch into folder-project mode (Save becomes Save All).
const openFolderButton = document.getElementById("open-folder-button");
if (openFolderButton) {
  openFolderButton.addEventListener("click", async () => {
    const dirty = project.hasProject() ? project.isDirty() : tracker.isDirty();
    if (dirty) {
      const proceed = await tracker.promptBeforeNew();
      if (!proceed) return;
    }
    const opened = await project.openFolder();
    if (opened) {
      if (saveAllButton) saveAllButton.hidden = false;
      if (projectLabel) projectLabel.textContent = "Project (folder)";
    }
  });
}

// Wire Save All (folder-project mode): atomically writes every dirty file plus
// playground.json.
if (saveAllButton) {
  saveAllButton.addEventListener("click", async () => {
    await project.saveAll();
  });
}

// Wire New button: prompt if dirty, then reset the editor to the default
// example and adopt it as the clean baseline.
const newButton = document.getElementById("new-button");
if (newButton) {
  newButton.addEventListener("click", async () => {
    const proceed = await tracker.promptBeforeNew();
    if (proceed) {
      editor.setValue(defaultExampleSource);
      tracker.loadBaseline(defaultExampleSource, "Game1.cs");
    }
  });
}

// Wire Open button: prompt if dirty, then open a file via the native dialog
// and load its contents as the clean baseline.
const openButton = document.getElementById("open-button");
if (openButton) {
  openButton.addEventListener("click", async () => {
    const proceed = await tracker.promptBeforeNew();
    if (!proceed) return;
    const opened = await tracker.openFile();
    if (opened) {
      editor.setValue(opened.content);
      tracker.loadBaseline(opened.content, opened.fileName);
    }
  });
}

// Wire Save button to saveAs flow
const saveButton = document.getElementById("save-button");
if (saveButton) {
  saveButton.addEventListener("click", async () => {
    await tracker.saveAs();
  });
}

// Issue 048: Problems panel — renders compiler diagnostics, wires drawer tab
// switching, adds Monaco markers, and supports click-to-navigate. Its
// onDiagnostics hook is handed to the Run control below so a failed compile
// populates and reveals the Problems tab.
const problems = installIssue048ProblemsPanel({
  setMarkers: editor.setMarkers,
  revealAndFocus: editor.revealAndFocus,
});

// Issue 049: Output panel — renders managed/native preview output (tagged) and
// runtime failures (distinct blocks). Its hooks are handed to the Run control
// so live output streams in and a runtime exception is displayed. The editor
// and Problems tab stay interactive after a failure (PRD 8.5).
const output = installIssue049OutputPanel();

// Issue 052: preview-panel focus/input routing + status indicator. Returns the
// lifecycle callback that drives the indicator from the Run/Stop controller.
const previewPanel = installIssue052PreviewPanel();

installIssue024RunStopControl(() => {
  // Gate Run behind first-run warning acknowledgement.
  // In non-Tauri environments (dev mode), allow Run without gating.
  if (!(window as any).__TAURI_INTERNALS__?.invoke) return Promise.resolve(true);
  return gateFirstRun();
}, editor.getValue, problems.onDiagnostics, {
  onRunStart: () => output.clear(),
  onOutputLine: event => output.appendOutput(event),
  onRuntimeFailure: payload => output.appendFailure(payload),
  // Issue 052: drive the preview-panel status indicator (loading/running/
  // stopped/error) from the Run/Stop lifecycle.
  onLifecycle: previewPanel.onLifecycle,
  // Issue 051: when a folder project is open, Run compiles every open .cs file
  // together (primary = Game1.cs if present). Returns null for the scratch
  // single-file flow so issue 47/50 behaviour is unchanged.
  multiSourceProvider: () => {
    if (!project.hasProject()) return null;
    const sources = project.getSources();
    const primary = project.primarySourcePath();
    if (sources.length === 0 || primary === null) return null;
    return { sources, primarySourcePath: primary };
  },
});

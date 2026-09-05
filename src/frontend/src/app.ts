import { installIssue024RunStopControl } from "./issue24";
import { gateFirstRun } from "./issue37";
import { installIssue047Editor, defaultExampleSource } from "./issue047";
import { installIssue048ProblemsPanel } from "./issue048";
import installIssue050Tracker from "./issue050";

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

// Wire live buffer edits into the dirty tracker so the indicator updates on
// every keystroke and New/Open gating can detect unsaved changes.
editor.onDidChangeContent(() => {
  tracker.setBuffer(editor.getValue());
});

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

installIssue024RunStopControl(() => {
  // Gate Run behind first-run warning acknowledgement.
  // In non-Tauri environments (dev mode), allow Run without gating.
  if (!(window as any).__TAURI_INTERNALS__?.invoke) return Promise.resolve(true);
  return gateFirstRun();
}, editor.getValue, problems.onDiagnostics);

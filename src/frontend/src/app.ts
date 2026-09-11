import { installRunStopControl } from "./run-stop";
import { gateFirstRun, SCRATCH_PROJECT_IDENTITY } from "./first-run-warning";
import { installEditor, defaultExampleSource } from "./monaco-editor";
import { installProblemsPanel } from "./problems-panel";
import { installOutputPanel } from "./output-panel";
import installDirtyStateTracker, { setApplicationDirtyState } from "./dirty-state";
import { installProjectManager } from "./project-manager";
import { installPreviewPanel } from "./preview-panel";
import { installStatusBar, type FileStatus } from "./status-bar";
import { prepareProjectContent } from "./project-content";

// Workbench application controller wiring
// Run/Stop buttons are wired into the workbench toolbar (see index.html)
// This module is imported by main.ts at the bottom; DOM is already parsed
// by the time this module-level code executes.

// Issue 047: mount the real Monaco editor with the default HelloWorld example
// before wiring Run, so Run can read the live editor buffer.
const editor = installEditor();

// Issue 050: dirty-state tracking for the Monaco editor
// Initialize with the default example content
const tracker = installDirtyStateTracker(editor.getValue);

// Issue 060: live editor status bar. Seed it with the real initial file
// identity (the default scratch Game1.cs, clean) and the editor's actual
// starting cursor/selection/indentation so the first paint shows no sample
// values. The editor's public status events then drive live updates, while
// the workspace controllers below drive the active file name + dirty cue.
let currentFileStatus: FileStatus = { name: "Game1.cs", dirty: false };
const statusBar = installStatusBar({
  file: currentFileStatus,
  status: editor.getStatus(),
});
editor.onStatusChange(status => statusBar.setEditorStatus(status));

// Issue 060: the editor panel header shows the same real filename + dirty cue
// as the status bar. It used to carry a hard-coded "Game1.cs" / "● UNSAVED"
// label that conflicted with the live state; drive it from the one source of
// truth instead so the two never disagree.
const editorFilenameEl = document.getElementById("editor-filename");
const editorDirtyCueEl = document.getElementById("editor-dirty-cue");
function renderEditorHeader(file: FileStatus): void {
  if (editorFilenameEl) editorFilenameEl.textContent = file.name;
  if (editorDirtyCueEl) editorDirtyCueEl.hidden = !file.dirty;
}
renderEditorHeader(currentFileStatus);

// Update the active file name / dirty cue in every live surface (status bar and
// editor header). Skip the write entirely when nothing actually changed so the
// status bar's aria-live file region is not re-announced on every scratch
// keystroke (the content-change handler calls this with an unchanged name).
function setStatusFile(next: Partial<FileStatus>): void {
  const merged = { ...currentFileStatus, ...next };
  if (merged.name === currentFileStatus.name && merged.dirty === currentFileStatus.dirty) {
    return;
  }
  currentFileStatus = merged;
  statusBar.setFile(currentFileStatus);
  renderEditorHeader(currentFileStatus);
}

// Issue 051: folder-based multi-file project manager. Coexists with the
// single-scratch-file tracker (issue 50): when a folder project is open, issue
// 51 owns the file list, per-file dirty state, Save All, and multi-file Run;
// otherwise the scratch flow (New/Open/Save of one Game1.cs) stays active.
const fileExplorer = document.getElementById("file-explorer");
const projectLabel = document.getElementById("project-label");
const saveButton = document.getElementById("save-button");
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

const project = installProjectManager({
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
    // Issue 060: mirror the active folder file + its dirty state into the
    // status bar so filename/dirty cues track file switches and edits.
    const active = entries.find(entry => entry.active);
    if (active) setStatusFile({ name: active.relativePath, dirty: active.dirty });
  },
  // Publish folder dirty state through the same application-level path as the
  // scratch tracker. This keeps both the visible indicator and the native
  // close/quit guard synchronized.
  setDirtyIndicator: setApplicationDirtyState,
  showError: showModalError,
});

function renderScratchExplorer(fileName: string): void {
  if (!fileExplorer) return;
  const entry = document.createElement("button");
  entry.className = "file active";
  entry.dataset.file = fileName;
  entry.textContent = fileName;
  fileExplorer.replaceChildren(entry);
}

function showScratchWorkspace(fileName: string): void {
  if (saveButton) saveButton.hidden = false;
  if (saveAllButton) saveAllButton.hidden = true;
  if (projectLabel) projectLabel.textContent = "Project / scratch";
  // Issue 060: reflect the active scratch file in the status bar. The dirty
  // cue is refreshed separately by the content-change handler / baseline load.
  setStatusFile({ name: fileName });
  renderScratchExplorer(fileName);
}

function showFolderWorkspace(): void {
  if (saveButton) saveButton.hidden = true;
  if (saveAllButton) saveAllButton.hidden = false;
  if (projectLabel) projectLabel.textContent = "Project (folder)";
}

function workspaceIsDirty(): boolean {
  if (!project.hasProject()) return tracker.isDirty();
  project.syncActiveBuffer();
  return project.isDirty();
}

async function confirmWorkspaceDiscard(): Promise<boolean> {
  return tracker.promptBeforeDiscard(workspaceIsDirty());
}

function enterScratchWorkspace(content: string, fileName: string): void {
  if (project.hasProject()) project.closeProject();
  // Adopt the baseline before setValue fires Monaco's change event, ensuring
  // the new scratch buffer is never momentarily published as dirty.
  tracker.loadBaseline(content, fileName);
  editor.setValue(content);
  showScratchWorkspace(fileName);
  // Issue 060: a freshly loaded baseline is clean.
  setStatusFile({ name: fileName, dirty: false });
}

// Wire live buffer edits into the dirty tracker so the indicator updates on
// every keystroke and New/Open gating can detect unsaved changes. When a
// folder project is open, issue 51's per-file tracker owns dirty state.
editor.onDidChangeContent(() => {
  if (project.hasProject()) {
    project.syncActiveBuffer();
  } else {
    tracker.setBuffer(editor.getValue());
    // Issue 060: keep the scratch file's dirty cue in sync with each edit.
    setStatusFile({ dirty: tracker.isDirty() });
  }
});

// Wire Open Folder: prompt if dirty, then pick a folder, list its .cs files,
// and switch into folder-project mode (Save becomes Save All).
const openFolderButton = document.getElementById("open-folder-button");
if (openFolderButton) {
  openFolderButton.addEventListener("click", async () => {
    if (!(await confirmWorkspaceDiscard())) return;
    // openFolder commits new project state only after the picker, read, and
    // manifest validation all succeed. Cancellation therefore leaves the
    // current scratch/folder workspace untouched.
    if (await project.openFolder()) showFolderWorkspace();
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
    if (!(await confirmWorkspaceDiscard())) return;
    enterScratchWorkspace(defaultExampleSource, "Game1.cs");
  });
}

// Wire Open button: prompt if dirty, then open a file via the native dialog
// and load its contents as the clean baseline.
const openButton = document.getElementById("open-button");
if (openButton) {
  openButton.addEventListener("click", async () => {
    if (!(await confirmWorkspaceDiscard())) return;
    const opened = await tracker.openFile();
    if (opened) enterScratchWorkspace(opened.content, opened.fileName);
  });
}

// Save owns the scratch workspace; Save All owns a folder project. The hidden
// state is a UI cue, while this branch is the behavioral safety net.
if (saveButton) {
  saveButton.addEventListener("click", async () => {
    if (project.hasProject()) await project.saveAll();
    else {
      const saved = await tracker.saveAs();
      // Issue 060: a successful scratch Save As can retarget the file to a new
      // name and always clears the dirty cue. Reflect the tracker's post-save
      // filename + dirty state in the status bar, editor header, and explorer.
      if (saved) {
        const savedName = tracker.getFileName();
        setStatusFile({ name: savedName, dirty: tracker.isDirty() });
        renderScratchExplorer(savedName);
      } else {
        setStatusFile({ dirty: tracker.isDirty() });
      }
    }
  });
}

// Issue 048: Problems panel — renders compiler diagnostics, wires drawer tab
// switching, adds Monaco markers, and supports click-to-navigate. Its
// onDiagnostics hook is handed to the Run control below so a failed compile
// populates and reveals the Problems tab.
const problems = installProblemsPanel({
  setMarkers: editor.setMarkers,
  revealAndFocus: editor.revealAndFocus,
});

// Issue 049: Output panel — renders managed/native preview output (tagged) and
// runtime failures (distinct blocks). Its hooks are handed to the Run control
// so live output streams in and a runtime exception is displayed. The editor
// and Problems tab stay interactive after a failure (PRD 8.5).
const output = installOutputPanel();

// Issue 052: preview-panel focus/input routing + status indicator. Returns the
// lifecycle callback that drives the indicator from the Run/Stop controller.
const previewPanel = installPreviewPanel();

installRunStopControl(() => {
  // Gate Run behind first-run warning acknowledgement.
  // In non-Tauri environments (dev mode), allow Run without gating.
  if (!(window as any).__TAURI_INTERNALS__?.invoke) return Promise.resolve(true);
  // Folder identities are SHA-256 digests of shell-canonicalized roots, so a
  // different opened project gets its own acknowledgement without persisting
  // the user's filesystem path. Fail closed if folder state ever lacks one;
  // never silently reuse the built-in scratch acknowledgement.
  const folderIdentity = project.identity();
  if (project.hasProject() && folderIdentity === null) {
    return Promise.reject(new Error("The open folder project has no stable identity."));
  }
  return gateFirstRun(folderIdentity ?? SCRATCH_PROJECT_IDENTITY);
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
  // Issue 052: mount the open project's Content/ assets before Run. A non-Web
  // contentProfile is surfaced as an Output-panel content error and aborts the
  // run before anything is mounted (PRD §15). Per-asset mount/validation
  // failures are surfaced by the runner via onContentError below.
  contentProvider: () => {
    const prepared = prepareProjectContent(project.getContent());
    if (prepared === null) return null;
    if (!prepared.ok) {
      output.appendContentError(prepared.code, prepared.message);
      throw new Error(`${prepared.code}: ${prepared.message}`);
    }
    return { assets: prepared.assets, contentRootDirectory: "Content" };
  },
  onContentError: (code, message) => output.appendContentError(code, message),
});

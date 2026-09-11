// Live editor status bar (issue 060).
//
// Renders honest, live editor state into the footer status bar that issue 059
// left as an empty container: the active file name + dirty cue, the cursor
// line/column, the selected-character count (only while a selection is
// non-empty), and Monaco's current indentation mode/width. Every value is fed
// from real editor/model state through the Monaco adapter's public status
// events (see monaco-editor.ts) or from the workspace controllers that already
// own the active file name and dirty state (app.ts). Nothing here is
// fabricated, and no sample value is shown before the first real read.
//
// Accessibility: the file-status element is a polite `role=status` live region
// so switching files or toggling dirty state is announced once, calmly. The
// cursor/selection/indentation elements are plain labelled text that a screen
// reader user can read on demand — they deliberately do NOT announce on every
// cursor movement, which would be intrusive (issue 060 scope).

import type { EditorStatusState } from "./monaco-editor";

/** The formatted, human-readable strings the status bar renders. */
export interface StatusBarLabels {
  /** Visible file text, including a trailing dot cue when dirty. */
  fileText: string;
  /** Accessible label for the file element (announces modified state). */
  fileAriaLabel: string;
  /** Cursor position, e.g. `Ln 18, Col 29`. */
  positionText: string;
  /** Selection summary, or empty string when the selection is empty. */
  selectionText: string;
  /** Indentation model, e.g. `Spaces: 4` or `Tab Size: 2`. */
  indentationText: string;
}

/** The file-identity portion of the status bar. */
export interface FileStatus {
  name: string;
  dirty: boolean;
}

/**
 * Whether two file-identity snapshots are equivalent. Used to skip redundant
 * DOM writes to the polite aria-live file region so it is not re-announced when
 * neither the name nor the dirty state actually changed (e.g. on every scratch
 * keystroke, which only ever toggles dirty on the first edit).
 */
export function fileStatusEquals(a: FileStatus, b: FileStatus): boolean {
  return a.name === b.name && a.dirty === b.dirty;
}

/** Format `Ln L, Col C` from a live editor status snapshot. */
export function formatPosition(status: EditorStatusState): string {
  return `Ln ${status.line}, Col ${status.column}`;
}

/**
 * Format the selection summary. Returns `""` for an empty selection so the
 * element can be hidden — the count appears only for a non-empty selection.
 */
export function formatSelection(status: EditorStatusState): string {
  if (status.selectionLength <= 0) return "";
  return status.selectionLength === 1
    ? "1 selected"
    : `${status.selectionLength} selected`;
}

/** Format the indentation model from Monaco's live insert-spaces/tab-size. */
export function formatIndentation(status: EditorStatusState): string {
  return status.insertSpaces ? `Spaces: ${status.tabSize}` : `Tab Size: ${status.tabSize}`;
}

/** Format the visible file text, appending a dot cue when dirty. */
export function formatFileText(file: FileStatus): string {
  return file.dirty ? `${file.name} \u25CF` : file.name;
}

/** Format the accessible file label, spelling out the modified state. */
export function formatFileAriaLabel(file: FileStatus): string {
  return file.dirty ? `${file.name}, modified` : file.name;
}

/** Compute every rendered label from live file + editor state. */
export function computeStatusBarLabels(
  file: FileStatus,
  status: EditorStatusState,
): StatusBarLabels {
  return {
    fileText: formatFileText(file),
    fileAriaLabel: formatFileAriaLabel(file),
    positionText: formatPosition(status),
    selectionText: formatSelection(status),
    indentationText: formatIndentation(status),
  };
}

/** Live status bar API consumed by app.ts. */
export interface StatusBarApi {
  /** Update the active file name / dirty cue (scratch + folder switches). */
  setFile: (file: FileStatus) => void;
  /** Update cursor/selection/indentation from a live editor snapshot. */
  setEditorStatus: (status: EditorStatusState) => void;
}

/**
 * Build the status-bar DOM inside the retained `#status-bar` footer and return
 * an API to keep it in sync. Callers must supply the initial file identity and
 * editor status so the first paint shows real values (no placeholder flash).
 */
export function installStatusBar(initial: {
  file: FileStatus;
  status: EditorStatusState;
}): StatusBarApi {
  const bar = document.getElementById("status-bar");
  if (!bar) throw new Error("Status bar container (#status-bar) is missing.");

  bar.setAttribute("aria-label", "Editor status");

  const fileEl = document.createElement("span");
  fileEl.id = "status-file";
  fileEl.className = "status-item status-file";
  // Polite live region: announce file switches / dirty changes once, calmly.
  fileEl.setAttribute("role", "status");
  fileEl.setAttribute("aria-live", "polite");

  const positionEl = document.createElement("span");
  positionEl.id = "status-position";
  positionEl.className = "status-item";

  // The selection element stays hidden (and out of the accessibility tree)
  // whenever the selection is empty, so it appears only when meaningful.
  const selectionEl = document.createElement("span");
  selectionEl.id = "status-selection";
  selectionEl.className = "status-item";
  selectionEl.hidden = true;

  const indentationEl = document.createElement("span");
  indentationEl.id = "status-indentation";
  indentationEl.className = "status-item";

  bar.replaceChildren(fileEl, positionEl, selectionEl, indentationEl);

  // Remember the last file identity actually written so we can skip redundant
  // updates to the polite aria-live region (see fileStatusEquals). `null` until
  // the first render below establishes the seeded state.
  let lastFile: FileStatus | null = null;
  const renderFile = (file: FileStatus): void => {
    if (lastFile && fileStatusEquals(lastFile, file)) return;
    lastFile = { ...file };
    fileEl.textContent = formatFileText(file);
    fileEl.setAttribute("aria-label", formatFileAriaLabel(file));
    fileEl.dataset.dirty = file.dirty ? "true" : "false";
  };

  const renderEditorStatus = (status: EditorStatusState): void => {
    positionEl.textContent = formatPosition(status);
    const selectionText = formatSelection(status);
    if (selectionText === "") {
      selectionEl.hidden = true;
      selectionEl.textContent = "";
    } else {
      selectionEl.hidden = false;
      selectionEl.textContent = selectionText;
    }
    indentationEl.textContent = formatIndentation(status);
  };

  // Initialise from real state so nothing sample-like ever flashes.
  renderFile(initial.file);
  renderEditorStatus(initial.status);

  return {
    setFile: renderFile,
    setEditorStatus: renderEditorStatus,
  };
}

export default installStatusBar;

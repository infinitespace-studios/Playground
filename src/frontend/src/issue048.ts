// Issue 048 — Problems panel with Monaco markers and click-to-navigate.
//
// Wires the diagnostics produced by the compiler (issue 18 syntax errors,
// issue 22 playground Game-discovery diagnostics PG0001/2/3, issues 31-32
// policy diagnostics) into the bottom drawer's Problems tab. On a failed
// compilation the tab is populated (one row per diagnostic), revealed
// automatically, and the same diagnostics are mirrored as inline Monaco
// markers. Clicking a row moves the editor cursor to that diagnostic's
// location.
//
// PRD 14.2: Problems shows severity, ID, message, filename, line, column and
// selecting a row focuses its source location.
// PRD 8.4: on compile failure an existing preview keeps running and no new
// preview is created — that guarantee is enforced upstream in
// compileLoadStartIssue23 (it throws before retiring the old preview); this
// module only reflects the diagnostics and never touches the preview.

import type { Diagnostic, DiagnosticSeverity } from "../../shared/MessageContracts";
import type * as monaco from "monaco-editor";

// Monaco marker severity constants (avoids importing the monaco runtime here;
// values are stable in the editor API: Hint=1, Info=2, Warning=4, Error=8).
const MARKER_SEVERITY = { Hint: 1, Info: 2, Warning: 4, Error: 8 } as const;

interface Issue048EditorHooks {
  setMarkers: (markers: monaco.editor.IMarkerData[]) => void;
  revealAndFocus: (line: number, column: number) => void;
}

function severityLabel(severity: DiagnosticSeverity): string {
  switch (severity) {
    case "error":
      return "ERROR";
    case "warning":
      return "WARNING";
    default:
      return "INFO";
  }
}

function markerSeverity(severity: DiagnosticSeverity): number {
  switch (severity) {
    case "error":
      return MARKER_SEVERITY.Error;
    case "warning":
      return MARKER_SEVERITY.Warning;
    default:
      return MARKER_SEVERITY.Info;
  }
}

/** A diagnostic with a concrete source position (line >= 1) can be navigated
 *  to and marked in Monaco. Project-level diagnostics (e.g. PG0001 with no
 *  file/line, per PRD 13.2) still appear in the list but are not navigable. */
function hasSourcePosition(d: Diagnostic): boolean {
  return typeof d.line === "number" && d.line >= 1;
}

function formatLocation(d: Diagnostic): string {
  const file = d.file && d.file.length > 0 ? d.file : "Game1.cs";
  if (!hasSourcePosition(d)) {
    return `${file}`;
  }
  return `${file}:${d.line}:${d.column}`;
}

/**
 * Install the Problems panel controller. Wires drawer tab switching and
 * returns an `onDiagnostics` callback to hand to the Run flow (issue 24), plus
 * a helper to imperatively reveal the Problems tab.
 */
export function installIssue048ProblemsPanel(editor: Issue048EditorHooks): {
  /** Pass to installIssue024RunStopControl as its onDiagnostics hook. */
  onDiagnostics: (diagnostics: readonly Diagnostic[], outcome: "success" | "failure") => void;
  /** Reveal a named drawer tab (e.g. "problems"). */
  revealTab: (panel: string) => void;
} {
  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>(".tabs .tab"));
  const views = Array.from(document.querySelectorAll<HTMLElement>("[data-panel-view]"));
  const problemsView = document.querySelector<HTMLElement>('[data-panel-view="problems"]');
  const problemsTab = document.querySelector<HTMLButtonElement>('.tab[data-panel="problems"]');
  const problemsCount = problemsTab?.querySelector<HTMLElement>("em") ?? null;

  function revealTab(panel: string): void {
    for (const tab of tabs) {
      tab.classList.toggle("active", tab.dataset.panel === panel);
    }
    for (const view of views) {
      view.hidden = view.dataset.panelView !== panel;
    }
  }

  // Wire drawer tab switching (previously static markup with no handler).
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const panel = tab.dataset.panel;
      if (panel) revealTab(panel);
    });
  }

  function updateCount(errorCount: number): void {
    if (!problemsCount) return;
    if (errorCount > 0) {
      problemsCount.textContent = String(errorCount);
      problemsCount.hidden = false;
    } else {
      problemsCount.textContent = "";
      problemsCount.hidden = true;
    }
  }

  function renderRows(diagnostics: readonly Diagnostic[]): void {
    if (!problemsView) return;
    problemsView.replaceChildren();

    if (diagnostics.length === 0) {
      const empty = document.createElement("div");
      empty.className = "problem-empty";
      empty.textContent = "No problems detected.";
      problemsView.appendChild(empty);
      return;
    }

    for (const d of diagnostics) {
      const row = document.createElement("div");
      row.className = "problem";
      row.dataset.diagnostic = "";
      row.dataset.severity = d.severity;

      const sev = document.createElement("b");
      sev.textContent = severityLabel(d.severity);

      const message = document.createElement("span");
      // `id` distinguishes e.g. CS1002 vs PG0001; message is the human text.
      message.textContent = `${d.id} ${d.message}`;

      const location = document.createElement("span");
      location.className = "problem-location";
      location.textContent = formatLocation(d);

      row.append(sev, message, location);

      if (hasSourcePosition(d)) {
        row.setAttribute("role", "button");
        row.tabIndex = 0;
        const navigate = () => editor.revealAndFocus(d.line, d.column);
        row.addEventListener("click", navigate);
        row.addEventListener("keydown", event => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            navigate();
          }
        });
      } else {
        // Project-level diagnostic (no source position): not navigable.
        row.dataset.projectLevel = "";
        row.setAttribute("aria-disabled", "true");
      }

      problemsView.appendChild(row);
    }
  }

  function applyMarkers(diagnostics: readonly Diagnostic[]): void {
    const markers: monaco.editor.IMarkerData[] = diagnostics
      .filter(hasSourcePosition)
      .map(d => ({
        severity: markerSeverity(d.severity),
        message: `${d.id}: ${d.message}`,
        startLineNumber: d.line,
        startColumn: d.column,
        endLineNumber: d.line,
        endColumn: d.column + 1,
      }));
    editor.setMarkers(markers);
  }

  function onDiagnostics(
    diagnostics: readonly Diagnostic[],
    outcome: "success" | "failure",
  ): void {
    renderRows(diagnostics);
    applyMarkers(diagnostics);
    const errorCount = diagnostics.filter(d => d.severity === "error").length;
    updateCount(errorCount);

    // PRD 8.4: reveal the Problems tab automatically when a compilation fails.
    // On success we leave the active tab as-is (Output stays foregrounded for
    // the running preview's logs) but still refresh rows/markers/count above.
    if (outcome === "failure") {
      revealTab("problems");
    }
  }

  return { onDiagnostics, revealTab };
}

export default installIssue048ProblemsPanel;

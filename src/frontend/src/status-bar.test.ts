// Focused unit tests for the live status-bar formatting helpers (issue 060).
//
// These cover the pure label computation that turns live editor/file state into
// the exact strings rendered in the footer: cursor position, selection-count
// visibility, indentation mode/width, and the dirty file cue + accessible
// label. They run under `node --test` with no DOM (the DOM wiring in
// installStatusBar is exercised manually in PRODUCT per the issue's
// Verification section).

import assert from "node:assert/strict";
import test from "node:test";
import {
  computeStatusBarLabels,
  fileStatusEquals,
  formatFileAriaLabel,
  formatFileText,
  formatIndentation,
  formatPosition,
  formatSelection,
} from "./status-bar.ts";
import type { EditorStatusState } from "./monaco-editor.ts";

function status(overrides: Partial<EditorStatusState> = {}): EditorStatusState {
  return {
    line: 1,
    column: 1,
    selectionLength: 0,
    insertSpaces: true,
    tabSize: 4,
    ...overrides,
  };
}

test("position formats 1-based line/column", () => {
  assert.equal(formatPosition(status({ line: 18, column: 29 })), "Ln 18, Col 29");
});

test("selection is empty text when nothing is selected", () => {
  assert.equal(formatSelection(status({ selectionLength: 0 })), "");
});

test("selection singular vs plural", () => {
  assert.equal(formatSelection(status({ selectionLength: 1 })), "1 selected");
  assert.equal(formatSelection(status({ selectionLength: 12 })), "12 selected");
});

test("indentation reflects insert-spaces and tab size", () => {
  assert.equal(formatIndentation(status({ insertSpaces: true, tabSize: 4 })), "Spaces: 4");
  assert.equal(formatIndentation(status({ insertSpaces: false, tabSize: 2 })), "Tab Size: 2");
});

test("dirty file text appends a dot cue; clean does not", () => {
  assert.equal(formatFileText({ name: "Game1.cs", dirty: false }), "Game1.cs");
  assert.equal(formatFileText({ name: "Game1.cs", dirty: true }), "Game1.cs \u25CF");
});

test("dirty file aria-label spells out modified state", () => {
  assert.equal(formatFileAriaLabel({ name: "Player.cs", dirty: false }), "Player.cs");
  assert.equal(formatFileAriaLabel({ name: "Player.cs", dirty: true }), "Player.cs, modified");
});

test("computeStatusBarLabels bundles every rendered string", () => {
  const labels = computeStatusBarLabels(
    { name: "Player.cs", dirty: true },
    status({ line: 5, column: 3, selectionLength: 7, insertSpaces: false, tabSize: 2 }),
  );
  assert.deepEqual(labels, {
    fileText: "Player.cs \u25CF",
    fileAriaLabel: "Player.cs, modified",
    positionText: "Ln 5, Col 3",
    selectionText: "7 selected",
    indentationText: "Tab Size: 2",
  });
});

test("fileStatusEquals treats identical name+dirty as equal", () => {
  assert.equal(
    fileStatusEquals({ name: "Game1.cs", dirty: false }, { name: "Game1.cs", dirty: false }),
    true,
  );
});

test("fileStatusEquals detects a dirty-state change", () => {
  assert.equal(
    fileStatusEquals({ name: "Game1.cs", dirty: false }, { name: "Game1.cs", dirty: true }),
    false,
  );
});

test("fileStatusEquals detects a Save-As rename", () => {
  assert.equal(
    fileStatusEquals({ name: "Game1.cs", dirty: false }, { name: "Renamed.cs", dirty: false }),
    false,
  );
});

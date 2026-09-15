// Monaco editor adapter — wire a real Monaco editor to the default HelloWorld
// example. (Formerly issue047.ts.)
//
// Replaces issue 045's placeholder <textarea> with a live Monaco Editor
// instance mounted into the Workbench editor region, loads the default
// examples/HelloWorld/Game1.cs source on first launch, and exposes the live
// buffer text so the Run button (issue 024) can compile the current
// in-memory source — including unsaved edits (PRD 8.6) — on every Run.
//
// C# highlighting uses Monaco's built-in `csharp` Monarch language mode,
// which is sufficient for the MVP (PRD 14.1 — full Roslyn-backed IntelliSense
// is explicitly out of scope). Monaco's editor worker is routed through
// MonacoEnvironment.getWorker so it loads under the desktop shell CSP.

import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { ProjectEditorModel } from "./project-manager";
import {
  readPersistedAppScale,
  monacoFontSizeForScale,
  type AppScaleLevel,
} from "./scaling-controller";

// The default example loaded into the editor on first launch. Imported as raw
// text from the canonical example file (examples/HelloWorld/Game1.cs) so the
// editor and the on-disk example never drift apart.
import defaultGame1Source from "../../../examples/HelloWorld/Game1.cs?raw";

// Monaco only ever creates the plain editor worker here: the workbench creates
// C# models exclusively, and C# uses Monarch tokenization (no language-service
// worker). Routing every label to the editor worker keeps a single code path.
(self as unknown as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  },
};

const DARK_THEME = "workbench-dark";
const LIGHT_THEME = "workbench-light";

let editorInstance: monaco.editor.IStandaloneCodeEditor | null = null;

/**
 * A snapshot of the live editor state the status bar (issue 060) renders:
 * cursor line/column, selected character count (0 when the selection is empty),
 * and Monaco's current indentation model options. Every value is read from the
 * editor/model through public Monaco APIs — nothing is fabricated.
 */
export interface EditorStatusState {
  /** 1-based cursor line. */
  line: number;
  /** 1-based cursor column. */
  column: number;
  /** Characters covered by the primary selection; 0 when it is empty. */
  selectionLength: number;
  /** True when the model inserts spaces for indentation, false for tabs. */
  insertSpaces: boolean;
  /** The model's active tab size. */
  tabSize: number;
}

/** Resolve the Monaco theme name from the workbench <body data-theme>. */
function resolveMonacoTheme(): string {
  return document.body.dataset.theme === "light" ? LIGHT_THEME : DARK_THEME;
}

/** Define Workbench-matched Monaco color themes (dark + light). */
function defineThemes(): void {
  monaco.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#111616",
      "editor.foreground": "#d9ded8",
    },
  });
  monaco.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": "#f3f3ec",
      "editor.foreground": "#202522",
    },
  });
}

/** True on macOS, where the toggle shortcut is Ctrl+Shift+M (Ctrl+M elsewhere). */
function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  return /mac/i.test(platform);
}

/**
 * Issue 052 (option B): show whether Tab moves focus or indents, in the editor
 * panel header, and let the user toggle it.
 *
 * Monaco ships a built-in "Toggle Tab Key Moves Focus" action, but it mutates a
 * GLOBAL `TabFocus` singleton that the public `getOption(tabFocusMode)` does not
 * reflect (the editor honours `options.get(164) || TabFocus.getTabFocusMode()`,
 * so behaviour toggles while the readable option stays false). To keep a single,
 * observable source of truth we own the toggle here: a keybinding flips the
 * PER-EDITOR `tabFocusMode` option via `updateOptions`, which both drives Tab
 * behaviour and is read back for the indicator label — all public API.
 */
function installTabFocusIndicator(editor: monaco.editor.IStandaloneCodeEditor): void {
  const head = document.querySelector<HTMLElement>(".editor .panel-head");
  if (!head) return;

  const mac = isMacPlatform();
  const shortcut = mac ? "⌃⇧M" : "Ctrl+M";
  const indicator = document.createElement("span");
  indicator.id = "editor-tabfocus-indicator";
  indicator.className = "tabfocus-indicator";
  indicator.setAttribute("role", "status");
  indicator.setAttribute("aria-live", "polite");
  head.appendChild(indicator);

  const render = (tabMovesFocus: boolean) => {
    indicator.dataset.state = tabMovesFocus ? "focus" : "indent";
    if (tabMovesFocus) {
      indicator.textContent = `⇥ Tab moves focus · ${shortcut} to restore indent`;
      indicator.setAttribute("aria-label",
        `Tab key moves focus. Press ${shortcut} to make Tab insert indentation.`);
    } else {
      indicator.textContent = `⇥ Tab indents · ${shortcut} to move focus`;
      indicator.setAttribute("aria-label",
        `Tab key inserts indentation. Press ${shortcut} to make Tab move focus out of the editor.`);
    }
  };

  const setTabMovesFocus = (next: boolean) => {
    editor.updateOptions({ tabFocusMode: next });
    render(next);
  };

  // Own the same shortcut Monaco uses (Ctrl+Shift+M on mac / Ctrl+M elsewhere)
  // so there is one source of truth. addCommand's handler toggles the
  // per-editor option and repaints the indicator synchronously.
  const chord = mac
    ? monaco.KeyMod.WinCtrl | monaco.KeyMod.Shift | monaco.KeyCode.KeyM
    : monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyM;
  editor.addAction({
    id: "editor.toggleTabMovesFocus",
    label: "Toggle Tab Key Moves Focus",
    keybindings: [chord],
    run: ed => {
      const current = ed.getOption(monaco.editor.EditorOption.tabFocusMode);
      setTabMovesFocus(!current);
    },
  });

  render(editor.getOption(monaco.editor.EditorOption.tabFocusMode));
}

/**
 * Issue 062: re-layout Monaco while preserving the cursor position and any
 * selection. Monaco's `automaticLayout` already reflows on host resize, but a
 * UI-scale change resizes the host synchronously and an explicit
 * capture/`layout()`/restore is a deterministic safety net that guarantees the
 * cursor/selection survive the reflow. Everything here is public Monaco API.
 */
export function relayoutPreservingSelection(
  editor: monaco.editor.IStandaloneCodeEditor,
): void {
  const selections = editor.getSelections();
  const position = editor.getPosition();
  editor.layout();
  if (selections && selections.length > 0) {
    editor.setSelections(selections);
  } else if (position) {
    editor.setPosition(position);
  }
}

/**
 * Mount the Monaco editor into the editor region and load the default
 * `Game1.cs` example. Returns a live source provider that reads the current
 * editor buffer (unsaved edits included). Must be called after the DOM has
 * been parsed.
 */
export function installEditor(): {
  getValue: () => string;
  setValue: (content: string) => void;
  onDidChangeContent: (listener: () => void) => void;
  createProjectModel: (key: string, content: string) => ProjectEditorModel;
  renameProjectModel: (model: ProjectEditorModel, key: string) => ProjectEditorModel;
  setActiveProjectModel: (model: ProjectEditorModel | null) => void;
  getProjectModelKeys: () => string[];
  setMarkers: (markers: monaco.editor.IMarkerData[], modelKey?: string) => void;
  clearAllMarkers: () => void;
  revealAndFocus: (line: number, column: number) => void;
  getStatus: () => EditorStatusState;
  onStatusChange: (listener: (status: EditorStatusState) => void) => void;
  applyScale: (level: AppScaleLevel) => void;
} {
  const host = document.querySelector<HTMLElement>("#editor-host");
  if (!host) throw new Error("Issue 047 editor host (#editor-host) is missing.");

  defineThemes();

  // Issue 062: resolve the persisted application scale before creating the
  // editor and derive Monaco's font size from it. The default level (100 %)
  // yields the readable 14 px floor (issue 061); a malformed persisted value
  // falls back to that default. Applying it as the create-time option means the
  // editor renders at the saved size immediately (no flash).
  const initialFontSize = monacoFontSizeForScale(readPersistedAppScale());

  const scratchModel = monaco.editor.createModel(defaultGame1Source, "csharp");
  type ManagedProjectModel = ProjectEditorModel & { raw: monaco.editor.ITextModel };
  const projectModels = new Map<string, ManagedProjectModel>();
  const viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
  let activeProjectModelKey: string | null = null;

  const createProjectModel = (key: string, content: string): ManagedProjectModel => {
    const raw = monaco.editor.createModel(content, "csharp", monaco.Uri.parse(key));
    const managed: ManagedProjectModel = {
      key,
      raw,
      getValue: () => raw.getValue(),
      dispose: () => {
        if (activeProjectModelKey === key) {
          editorInstance?.setModel(scratchModel);
          activeProjectModelKey = null;
        }
        monaco.editor.setModelMarkers(raw, "playground", []);
        viewStates.delete(key);
        projectModels.delete(key);
        raw.dispose();
      },
    };
    projectModels.set(key, managed);
    return managed;
  };

  editorInstance = monaco.editor.create(host, {
    model: scratchModel,
    theme: resolveMonacoTheme(),
    automaticLayout: true,
    // Issue 061: editor text defaults to >= 14 px for readability. Issue 062:
    // the persisted application scale drives this font size via `applyScale`.
    fontSize: initialFontSize,
    fontFamily: '"SFMono-Regular", "Cascadia Code", monospace',
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    tabSize: 4,
    renderWhitespace: "none",
  });

  // Keep the editor theme in sync with the workbench dark/light toggle
  // (issue 046 flips <body data-theme>).
  const themeObserver = new MutationObserver(() => {
    monaco.editor.setTheme(resolveMonacoTheme());
  });
  themeObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });

  // Issue 052 (option B): Monaco captures Tab for indentation, which traps
  // keyboard focus in the editor. Monaco ships the VS Code convention for
  // escaping it — "Toggle Tab Key Moves Focus" (editor.action.toggleTabFocusMode,
  // Ctrl+Shift+M on mac / Ctrl+M elsewhere). That toggle is discoverable only if
  // its state is visible, so surface it in the editor panel header: when Tab
  // moves focus, show an explicit badge; otherwise show the shortcut hint. The
  // state is the public `tabFocusMode` editor option, observed via
  // onDidChangeConfiguration (no reliance on Monaco internals).
  installTabFocusIndicator(editorInstance);

  // Issue 060: expose live cursor/selection/indentation state through public
  // Monaco events so the status bar can render honest values. `computeStatus`
  // reads directly from the editor and its model every time, so callers always
  // get the current truth (no cached sample values).
  const computeStatus = (): EditorStatusState => {
    const ed = editorInstance;
    const position = ed?.getPosition() ?? { lineNumber: 1, column: 1 };
    const model = ed?.getModel() ?? null;
    const selection = ed?.getSelection() ?? null;
    let selectionLength = 0;
    if (model && selection && !selection.isEmpty()) {
      selectionLength = model.getValueInRange(selection).length;
    }
    const options = model?.getOptions();
    return {
      line: position.lineNumber,
      column: position.column,
      selectionLength,
      insertSpaces: options?.insertSpaces ?? true,
      tabSize: options?.tabSize ?? 4,
    };
  };

  const statusListeners: Array<(status: EditorStatusState) => void> = [];
  const emitStatus = (): void => {
    const snapshot = computeStatus();
    for (const listener of statusListeners) listener(snapshot);
  };

  // Cursor moves (keyboard, mouse, Problems-row reveal via setPosition) and
  // selection changes both flow through these public events.
  editorInstance.onDidChangeCursorPosition(() => emitStatus());
  editorInstance.onDidChangeCursorSelection(() => emitStatus());
  // Indentation is a model option; re-attach if the model is ever swapped so we
  // never listen to a stale model. The workbench reuses one model today, but
  // this keeps the wiring correct regardless.
  let optionsSubscription = scratchModel.onDidChangeOptions(() => emitStatus());
  editorInstance.onDidChangeModel(() => {
    optionsSubscription.dispose();
    const nextModel = editorInstance?.getModel();
    if (nextModel) optionsSubscription = nextModel.onDidChangeOptions(() => emitStatus());
    emitStatus();
  });

  const setActiveProjectModel = (next: ProjectEditorModel | null): void => {
    if (!editorInstance) return;
    const current = editorInstance.getModel();
    if (current && activeProjectModelKey && current === projectModels.get(activeProjectModelKey)?.raw) {
      const state = editorInstance.saveViewState();
      if (state) viewStates.set(activeProjectModelKey, state);
    }
    const nextRaw = next ? projectModels.get(next.key)?.raw : scratchModel;
    if (!nextRaw) return;
    activeProjectModelKey = next?.key ?? null;
    editorInstance.setModel(nextRaw);
    if (next) {
      const state = viewStates.get(next.key);
      if (state) editorInstance.restoreViewState(state);
    }
  };

  const renameProjectModel = (model: ProjectEditorModel, key: string): ProjectEditorModel => {
    const old = projectModels.get(model.key);
    if (!old) throw new Error("cannot rename an unknown Monaco project model");
    if (activeProjectModelKey === model.key && editorInstance) {
      const state = editorInstance.saveViewState();
      if (state) viewStates.set(model.key, state);
    }
    const next = createProjectModel(key, model.getValue());
    const state = viewStates.get(model.key);
    if (state) {
      viewStates.set(key, state);
      viewStates.delete(model.key);
    }
    return next;
  };

  const setMarkers = (markers: monaco.editor.IMarkerData[], modelKey?: string): void => {
    const target = modelKey
      ? projectModels.get(modelKey)?.raw
      : editorInstance?.getModel();
    if (target) monaco.editor.setModelMarkers(target, "playground", markers);
  };

  const clearAllMarkers = (): void => {
    const active = editorInstance?.getModel();
    if (active) monaco.editor.setModelMarkers(active, "playground", []);
    for (const projectModel of projectModels.values()) {
      monaco.editor.setModelMarkers(projectModel.raw, "playground", []);
    }
  };

  return {
    // PRD 8.6: Run must compile the current in-memory source, so always read
    // the live buffer rather than any previously saved copy.
    getValue: () => editorInstance?.getValue() ?? defaultGame1Source,
    // Replace the entire buffer (used by New/Open to load fresh content).
    setValue: (content: string) => {
      editorInstance?.setValue(content);
    },
    // Subscribe to live buffer edits so callers (issue 050 dirty tracking)
    // can recompute dirty state on every keystroke.
    onDidChangeContent: (listener: () => void) => {
      editorInstance?.onDidChangeModelContent(() => listener());
    },
    createProjectModel,
    renameProjectModel,
    setActiveProjectModel,
    getProjectModelKeys: () => [...projectModels.keys()],
    // Issue 048/069: markers can target an inactive persistent model by its
    // stable key; omitting the key targets the visible scratch/active model.
    setMarkers,
    clearAllMarkers,
    // Issue 048: move the cursor to a diagnostic's location, scroll it into
    // view, and focus the editor (click-to-navigate from the Problems panel).
    revealAndFocus: (line: number, column: number) => {
      if (!editorInstance) return;
      const safeLine = Math.max(1, line);
      const safeColumn = Math.max(1, column);
      editorInstance.revealLineInCenter(safeLine);
      editorInstance.setPosition({ lineNumber: safeLine, column: safeColumn });
      editorInstance.focus();
    },
    // Issue 060: current cursor/selection/indentation snapshot, read live.
    getStatus: () => computeStatus(),
    // Issue 060: subscribe to live cursor/selection/indentation changes.
    onStatusChange: (listener: (status: EditorStatusState) => void) => {
      statusListeners.push(listener);
    },
    // Issue 062: apply an application-scale level to Monaco by deriving its font
    // size from the same single preference that drives the Workbench typography,
    // then re-laying-out while preserving cursor/selection. Monaco is updated
    // ONLY through its public options API (updateOptions), and the manual
    // layout() reflow keeps the cursor/selection correct as glyph metrics change.
    applyScale: (level: AppScaleLevel) => {
      if (!editorInstance) return;
      editorInstance.updateOptions({ fontSize: monacoFontSizeForScale(level) });
      relayoutPreservingSelection(editorInstance);
    },
  };
}

/** The default example source, exported for callers that need a fallback. */
export const defaultExampleSource = defaultGame1Source;

// Issue 047 — Wire a real Monaco editor to the default HelloWorld example.
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

/**
 * Mount the Monaco editor into the editor region and load the default
 * `Game1.cs` example. Returns a live source provider that reads the current
 * editor buffer (unsaved edits included). Must be called after the DOM has
 * been parsed.
 */
export function installIssue047Editor(): {
  getValue: () => string;
  setValue: (content: string) => void;
  onDidChangeContent: (listener: () => void) => void;
} {
  const host = document.querySelector<HTMLElement>("#editor-host");
  if (!host) throw new Error("Issue 047 editor host (#editor-host) is missing.");

  defineThemes();

  const model = monaco.editor.createModel(defaultGame1Source, "csharp");
  editorInstance = monaco.editor.create(host, {
    model,
    theme: resolveMonacoTheme(),
    automaticLayout: true,
    fontSize: 12,
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
  };
}

/** The default example source, exported for callers that need a fallback. */
export const defaultExampleSource = defaultGame1Source;

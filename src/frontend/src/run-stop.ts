// Production Run/Stop control (Stage-2 extraction of the product path formerly
// in the mixed issue24.ts). Wires the workbench toolbar Run/Stop buttons to the
// neutral run/stop lifecycle controller (lifecycle-controller.ts) driving the
// in-page live preview (live-preview.ts). It is production-neutral: no proof
// markers and no auto-proof entry. The historical cooperative-stop AUTO-PROOF
// (`runIssue024AutoProof`) stays in issue24.ts.
//
// `issue24.ts` re-exports `installRunStopControl` under its historical name
// `installIssue024RunStopControl` for entry.proof.ts.

import { createRunStopController, type PreviewLifecycleState } from "./lifecycle-controller";
import { runLivePreviewInPage } from "./live-preview";
import type { PreviewOutput } from "../../shared/MessageContracts";

type CompileDiagnostics = Parameters<
  NonNullable<Parameters<typeof runLivePreviewInPage>[0]["onDiagnostics"]>
>;

export interface RunStopOutputHooks {
  onOutputLine?: (event: PreviewOutput) => void;
  onRuntimeFailure?: (payload: Record<string, unknown>) => void;
  onRunStart?: () => void;
  /** Issue 051: when set and it returns sources, Run compiles them together. */
  multiSourceProvider?: () => { sources: Array<{ path: string; text: string }>; primarySourcePath: string } | null;
  /** Issue 052: preview-panel status indicator lifecycle updates. */
  onLifecycle?: (state: PreviewLifecycleState) => void;
  /** Issue 052: the open project's prepared Content/ assets to mount before Run. */
  contentProvider?: () => { assets: ReadonlyArray<{ path: string; bytes: ArrayBuffer }>; contentRootDirectory?: string } | null;
  /** Issue 052: labelled content-error entry for the Output panel. */
  onContentError?: (code: string, message: string) => void;
}

// The real (non-proof) Run: compile the live editor buffer — including unsaved
// edits (PRD 8.6) — as Game1.cs and render it in the on-page sandboxed iframe.
// When a folder project is open, compile ALL its .cs files together (issue 30
// multi-file pattern). Content/ assets are mounted before start (issue 052).
function startLivePreview(
  sourceProvider: () => string,
  onOutput?: (event: PreviewOutput) => void,
  onDiagnostics?: (diagnostics: CompileDiagnostics[0], outcome: CompileDiagnostics[1]) => void,
  multiSourceProvider?: RunStopOutputHooks["multiSourceProvider"],
  contentProvider?: RunStopOutputHooks["contentProvider"],
  onContentError?: (code: string, message: string) => void,
) {
  const multi = multiSourceProvider?.();
  const sources = multi && multi.sources.length > 0
    ? multi.sources
    : [{ path: "Game1.cs", text: sourceProvider() }];
  const primarySourcePath = multi && multi.sources.length > 0
    ? multi.primarySourcePath
    : "Game1.cs";
  const content = contentProvider?.();
  return runLivePreviewInPage({
    assemblyName: "PlaygroundGame",
    sources,
    primarySourcePath,
    onOutput,
    onDiagnostics,
    contentAssets: content?.assets,
    contentRootDirectory: content?.contentRootDirectory,
    onContentError,
  });
}

export function installRunStopControl(
  gate?: () => Promise<boolean>,
  sourceProvider?: () => string,
  onDiagnostics?: (diagnostics: CompileDiagnostics[0], outcome: CompileDiagnostics[1]) => void,
  outputHooks?: RunStopOutputHooks,
): void {
  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const stopButton = document.querySelector<HTMLButtonElement>("#stop-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!runButton || !stopButton || !status)
    throw new Error("Run/Stop control is missing.");
  const controller = createRunStopController({
    start: () => {
      // Issue 049: each Run clears the Output panel, then streams live output
      // into it (replacing the temporary #preview-managed-output stand-in).
      outputHooks?.onRunStart?.();
      return startLivePreview(
        sourceProvider ?? (() => ""),
        event => { outputHooks?.onOutputLine?.(event); },
        onDiagnostics,
        outputHooks?.multiSourceProvider,
        outputHooks?.contentProvider,
        outputHooks?.onContentError,
      );
    },
    stop: (preview, reason) => preview.stop(reason),
    observeFailure: preview => {
      // Issue 049: render the runtime failure in the Output panel when the
      // preview's failure promise resolves, then hand the result back to the
      // controller unchanged so its own recovery/status logic still runs.
      const failure = preview.failure;
      const onRuntimeFailure = outputHooks?.onRuntimeFailure;
      if (onRuntimeFailure) {
        void failure.then(
          result => {
            const failedPayload =
              (result as { failedEvent?: { payload?: Record<string, unknown> } })
                .failedEvent?.payload;
            if (failedPayload) onRuntimeFailure(failedPayload);
          },
          () => { /* rejection surfaces through the controller's own path */ },
        );
      }
      return failure;
    },
    setRunDisabled: disabled => { runButton.disabled = disabled; },
    setStopDisabled: disabled => { stopButton.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    onLifecycle: outputHooks?.onLifecycle,
    reportError: error => { console.error("Clear-color Game lifecycle failed", error); },
  });
  runButton.addEventListener("click", () => {
    if (gate) {
      void gate().then(proceed => {
        if (proceed) void controller.run().catch(() => {});
      }).catch(() => {});
    } else {
      void controller.run().catch(() => {});
    }
  });
  stopButton.addEventListener("click", () => { void controller.stop().catch(() => {}); });
}

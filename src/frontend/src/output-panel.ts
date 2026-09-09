// Output panel — managed/native output + runtime failures. (Formerly
// issue049.ts.)
//
// Wires the already-proven output-capture (issue 27 managed, issue 28 native)
// and exception-mapping (issue 29) pipelines into the real Output tab in the
// bottom drawer (issue 45), replacing the temporary stand-in <pre> elements
// used by those issues' proofs.
//
// PRD 14.3: the Output panel receives Console output, startup messages,
// runtime exceptions, content/shader errors and lifecycle messages, with
// managed and native output both captured and tagged.
// PRD 8.5: on an unhandled runtime exception the preview stops, the exception
// appears with the user's source file/line (when the PDB resolved it), and the
// editor stays responsive. Per ADR 0003 the embedded preview shares the
// Workbench WebView thread, so responsiveness holds for supported code that
// yields between frames (a synchronous non-yielding callback is outside the
// supported contract); this module only renders the captured output.

import type { PreviewOutput } from "../../shared/MessageContracts";

// The shape of the resolved runtime-failure payload surfaced by
// compileLoadStartIssue23's `failure` promise (its `failedEvent.payload`).
interface RuntimeFailurePayload {
  readonly phase?: string;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
    readonly details?: Readonly<Record<string, unknown>>;
  };
}

export interface OutputPanel {
  /** Append one preview.output line, tagged by source/stream. */
  appendOutput: (event: PreviewOutput) => void;
  /** Append a distinctly-formatted runtime-failure block (preview.failed). */
  appendFailure: (payload: RuntimeFailurePayload) => void;
  /** Issue 052: append a labelled content-loading error (mount/validation). */
  appendContentError: (code: string, message: string) => void;
  /** Clear all rendered entries (called at the start of each Run). */
  clear: () => void;
  /** Literal text of each rendered output row, in order (for proofs). */
  outputLineTexts: () => string[];
  /** Count of output rows currently rendered (for proofs). */
  outputCount: () => number;
}

/**
 * Canonical single-source-of-truth format for an output line's literal text:
 * a tag badge plus the message, e.g. `[managed:stdout] Hello`. Both the panel
 * and the issue 27/28 proofs use this so their rendered/expected text agree.
 */
export function formatOutputLine(event: PreviewOutput): string {
  const { source, stream } = event.payload;
  return `[${source}:${stream}] ${event.payload.text}`;
}

let installed: OutputPanel | null = null;

/**
 * Install the Output panel controller over the drawer's `[data-panel-view=
 * "output"]` container. Idempotent: a second call returns the same instance.
 * Tab switching itself is wired by issue 048's panel controller.
 */
export function installOutputPanel(): OutputPanel {
  if (installed) return installed;

  const view = document.querySelector<HTMLElement>('[data-panel-view="output"]');
  if (!view) throw new Error("Issue 049 output view ([data-panel-view=output]) is missing.");
  const outputView: HTMLElement = view;

  // Retire the static placeholder log rows shipped in the markup.
  outputView.replaceChildren();

  function appendOutput(event: PreviewOutput): void {
    const { source, stream } = event.payload;
    const row = document.createElement("div");
    row.className = "log-row output-row";
    row.dataset.source = source;
    row.dataset.stream = stream;

    // Tag is BOTH a styled badge AND literal text (issue 46: non-color cue).
    const tag = document.createElement("span");
    tag.className = "output-tag";
    tag.textContent = `[${source}:${stream}]`;

    const text = document.createElement("span");
    text.className = "output-text";
    text.textContent = event.payload.text;

    row.append(tag, text);
    outputView.appendChild(row);
    outputView.scrollTop = outputView.scrollHeight;
  }

  function appendFailure(payload: RuntimeFailurePayload): void {
    const details = payload.error?.details ?? {};
    const exceptionType =
      typeof details.exceptionType === "string" && details.exceptionType.length > 0
        ? details.exceptionType
        : payload.error?.code ?? "Runtime error";
    const message = payload.error?.message ?? "The preview stopped after an unhandled exception.";

    const block = document.createElement("div");
    block.className = "runtime-error";
    block.setAttribute("role", "group");

    const heading = document.createElement("div");
    heading.className = "runtime-error-heading";
    // Literal "Runtime error" label + exception type (non-color cue).
    heading.textContent = `Runtime error — ${exceptionType}`;

    const messageEl = document.createElement("div");
    messageEl.className = "runtime-error-message";
    messageEl.textContent = message;

    block.append(heading, messageEl);

    // The pipeline currently serialises resolved frames as flat frameN* keys
    // (see PreviewStartRuntime.js). Iterate defensively so any additional
    // frames the pipeline may emit in future are shown too.
    const frames = document.createElement("ul");
    frames.className = "runtime-error-frames";
    for (let i = 0; ; i += 1) {
      const file = details[`frame${i}File`];
      const line = details[`frame${i}Line`];
      const method = details[`frame${i}Method`];
      if (typeof file !== "string" || file.length === 0) break;
      const frame = document.createElement("li");
      const methodText = typeof method === "string" && method.length > 0 ? method : "<unknown>";
      const lineText = typeof line === "number" ? line : "?";
      frame.textContent = `at ${methodText} in ${file}:${lineText}`;
      frames.appendChild(frame);
    }
    if (frames.childElementCount > 0) {
      block.appendChild(frames);
    } else {
      const noFrames = document.createElement("div");
      noFrames.className = "runtime-error-noframes";
      noFrames.textContent = "No source-mapped stack frames available.";
      block.appendChild(noFrames);
    }

    outputView.appendChild(block);
    outputView.scrollTop = outputView.scrollHeight;
  }

  function appendContentError(code: string, message: string): void {
    // Issue 052: a clear, user-facing content error (non-Web contentProfile, an
    // unsupported/incompatible asset, a failed mount). Reuses the runtime-error
    // visual block but with a literal "Content error" label (non-color cue).
    const block = document.createElement("div");
    block.className = "runtime-error";
    block.setAttribute("role", "group");

    const heading = document.createElement("div");
    heading.className = "runtime-error-heading";
    heading.textContent = code && code.length > 0
      ? `Content error \u2014 ${code}`
      : "Content error";

    const messageEl = document.createElement("div");
    messageEl.className = "runtime-error-message";
    messageEl.textContent = message;

    block.append(heading, messageEl);
    outputView.appendChild(block);
    outputView.scrollTop = outputView.scrollHeight;
  }

  function clear(): void {
    outputView.replaceChildren();
  }

  function outputLineTexts(): string[] {
    return Array.from(outputView.querySelectorAll<HTMLElement>(".output-row")).map(row => {
      const tag = row.querySelector<HTMLElement>(".output-tag")?.textContent ?? "";
      const text = row.querySelector<HTMLElement>(".output-text")?.textContent ?? "";
      return `${tag} ${text}`;
    });
  }

  function outputCount(): number {
    return outputView.querySelectorAll(".output-row").length;
  }

  installed = { appendOutput, appendFailure, appendContentError, clear, outputLineTexts, outputCount };
  return installed;
}

/**
 * Return the installed Output panel, installing it on first use. Lets the
 * env-gated issue 27/28 proofs render into the same real panel regardless of
 * module evaluation order.
 */
export function getOutputPanel(): OutputPanel {
  return installed ?? installOutputPanel();
}

export default installOutputPanel;

// Proof frontend entry (Stage 1 of the production/proof split).
//
// This is the compile-time PROOF entry point, selected only when the Vite
// build is invoked with MONOGAME_FRONTEND_PROFILE=proof (see vite.config.ts and
// the `build:proof` / `dev:proof` npm scripts). It preserves the historical
// `main.ts` behavior: it imports and invokes the full per-issue auto-proof
// graph plus the Workbench app, theme, and benchmark instrumentation.
//
// The default PRODUCT build (`entry.product.ts`) must NEVER import this module,
// so the auto-proof environment markers below (MONOGAME_ISSUE0xx_PROOF) stay
// out of the shipping product dist.
import "./style.css";
// Proof frontend entry. `entry.proof.ts` dispatches the EIGHT
// responsibility-named durable scenario entrypoints below. Each scenario driver
// owns its own sub-proof selection and failure reporting; the packaged proof
// Rust env gates and report command names are preserved internally by the
// drivers. PRODUCT (`entry.product.ts`) must NEVER import this module.
//
// Stage 7 removed the four obsolete top-level-shell inline proofs (009/010/011/
// 020). They rendered into a `#canvas` element that the workbench UI no longer
// has, the canonical `prove-scenarios-macos.sh` runner never invoked them, and
// their Rust commands/ACLs were retired with them. Historical evidence remains
// in issues/009|010|011|020-*.
//
// Stage 5 retired the isolated-window issue038 force-stop harness (issue38.ts /
// issue38-bridge.ts) and its Rust bridge/transfer/relay command surface. ADR
// 0003 classifies the hostile synchronous non-yielding program as unsupported,
// so it is never run inside the product WebView. Issue 038 remains historical
// evidence in issues/038-* and ADR 0002.
import { runCompileRunStopScenario } from "./proof-compile-run-stop";
import { runCompilerDiagnosticsScenario } from "./proof-compiler-diagnostics";
import { runRuntimeExceptionScenario } from "./proof-runtime-exception";
import { runOutputCaptureScenario } from "./proof-output";
import { runContentWorkflowScenario } from "./proof-content";
import { runPreviewSecurityScenario } from "./proof-preview-security";
import { runProjectLifecycleScenario } from "./proof-project-lifecycle";
import { runPerformanceScenario } from "./proof-performance";
import { initTheme } from "./theme-controller";

interface RuntimeDiagnostics {
  consoleErrors: string[];
  mimeWarnings: string[];
  unhandledErrors: string[];
  renderedFramesObserved: number;
}

declare global {
  interface Window {
    __MONOGAME_DIAGNOSTICS__: RuntimeDiagnostics;
    __TAURI_INTERNALS__?: {
      invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
    };
    __TAURI__?: unknown;
    isTauri?: boolean;
    __ISSUE034_EXPECTED_IPC_ERRORS__?: {
      remaining: number;
      observed: string[];
    };
  }
}

const previewFrame = document.querySelector<HTMLIFrameElement>("#preview-frame");
if (!previewFrame) throw new Error("Preview iframe element is missing");
void previewFrame;

const diagnostics: RuntimeDiagnostics = {
  consoleErrors: [],
  mimeWarnings: [],
  unhandledErrors: [],
  renderedFramesObserved: 0,
};

window.__MONOGAME_DIAGNOSTICS__ = diagnostics;

window.addEventListener("error", (event) => {
  const message = event.error instanceof Error ? event.error.stack ?? event.error.message : event.message;
  diagnostics.unhandledErrors.push(message);
  document.documentElement.dataset.runtime = "error";
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error ? event.reason.stack ?? event.reason.message : String(event.reason);
  diagnostics.unhandledErrors.push(message);
  document.documentElement.dataset.runtime = "error";
});

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const message = args.map(String).join(" ");
  const expectedIpc = window.__ISSUE034_EXPECTED_IPC_ERRORS__;
  if (expectedIpc && expectedIpc.remaining > 0 &&
      /^JSON error: missing field `__TAURI_INVOKE_KEY__` at line 1 column \d+$/
        .test(message)) {
    expectedIpc.remaining -= 1;
    expectedIpc.observed.push(message.slice(0, 160));
    originalConsoleError(...args);
    return;
  }
  diagnostics.consoleErrors.push(message);
  document.documentElement.dataset.runtime = "error";
  originalConsoleError(...args);
};

const originalConsoleWarn = console.warn.bind(console);
console.warn = (...args: unknown[]) => {
  const message = args.map(String).join(" ");
  if (/mime|content[- ]type|streaming compile|arraybuffer instantiation/i.test(message)) {
    diagnostics.mimeWarnings.push(message);
    document.documentElement.dataset.runtime = "error";
  }
  originalConsoleWarn(...args);
};

const originalConsoleLog = console.log.bind(console);
console.log = (...args: unknown[]) => {
  const message = args.map(String).join(" ");

  if (/Draw #\d+: complete/.test(message)) {
    diagnostics.renderedFramesObserved += 1;
    if (diagnostics.consoleErrors.length === 0 && diagnostics.unhandledErrors.length === 0) {
      document.documentElement.dataset.runtime = "rendering";
    }
  }

  originalConsoleLog(...args);
};

// ── Durable scenario dispatch (Stage 4) ──────────────────────────────────────
// Each of the eight responsibility-named scenario entrypoints internally selects
// and reports its own sub-proofs. Scenarios are dispatched concurrently (each
// self-gates on its Rust env flag, so only the requested one does work in a
// packaged run); this preserves the previous per-issue concurrency and timing
// while collapsing fifteen-plus per-issue dispatch/report blocks into eight.
void runCompileRunStopScenario();
void runCompilerDiagnosticsScenario();
void runRuntimeExceptionScenario();
void runOutputCaptureScenario();
void runContentWorkflowScenario();
void runPreviewSecurityScenario();
void runProjectLifecycleScenario();

// Workbench application controller wiring (imported after main module)
import "./app";

// Issue 046: persistent theme + accessibility
initTheme();

// Performance & memory scenario (former issue041). Its driver reports shell
// readiness first (so the startup sample is never delayed) and then runs the
// benchmark; both self-gate on the benchmark env flag.
void runPerformanceScenario();

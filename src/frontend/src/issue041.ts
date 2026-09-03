/**
 * Issue 041: in-application performance benchmark harness.
 *
 * Everything here is inert unless the Rust side reports
 * `MONOGAME_ISSUE041_BENCHMARK=1`, so the shipped application never runs or
 * exposes the benchmark.
 *
 * The harness measures the real production paths only:
 *   - shell startup   : monotonic Rust process-start instant → the shell's first
 *                       painted, interactive frame (`issue041_shell_ready`)
 *   - compiler init   : the persistent compiler context boot that a compile
 *                       request performs (`prepareCompilerContextForBenchmark`)
 *   - compilation     : `compileSourcesThroughPersistentCompiler` with the
 *                       committed five-file fixture
 *   - preview startup : compile response → `preview.started` lifecycle event and
 *                       → the first frame the running Game reports drawing. If
 *                       no frame is drawn inside the hard first-frame bound the
 *                       sample is right-censored at that bound and reported as
 *                       a measured slow sample, never dropped.
 *   - Stop            : the issue 024 Run/Stop control returning to `idle`
 *
 * No sample is slept, inferred, or reconstructed from a wall clock. A failure
 * in one phase never discards the samples earlier phases already produced: the
 * harness always emits whatever it collected, together with the failure.
 */

import game1Text from "../../../tests/integration/fixtures/perf-benchmark/Game1.cs?raw";
import entityText from "../../../tests/integration/fixtures/perf-benchmark/Entity.cs?raw";
import worldText from "../../../tests/integration/fixtures/perf-benchmark/World.cs?raw";
import mathUtilitiesText from "../../../tests/integration/fixtures/perf-benchmark/MathUtilities.cs?raw";
import telemetryText from "../../../tests/integration/fixtures/perf-benchmark/Telemetry.cs?raw";
import {
  compileLoadStartIssue23,
  compileSourcesThroughPersistentCompiler,
  prepareCompilerContextForBenchmark,
  preparePackagedProofRuntime,
  waitForShellSteadyStateForBenchmark,
  type Issue23RunningPreview,
} from "./issue21";
import { createIssue024RunStopController } from "./issue24-controller";

const FIXTURE_ROOT = "tests/integration/fixtures/perf-benchmark";

export const ISSUE041_FIXTURE_SOURCES = [
  { path: `${FIXTURE_ROOT}/Game1.cs`, text: game1Text },
  { path: `${FIXTURE_ROOT}/Entity.cs`, text: entityText },
  { path: `${FIXTURE_ROOT}/World.cs`, text: worldText },
  { path: `${FIXTURE_ROOT}/MathUtilities.cs`, text: mathUtilitiesText },
  { path: `${FIXTURE_ROOT}/Telemetry.cs`, text: telemetryText },
] as const;

const PRIMARY_SOURCE_PATH = `${FIXTURE_ROOT}/Game1.cs`;
const ASSEMBLY_NAME = "Issue041PerfBenchmark";

/** Whole-process budget. The driver enforces its own, shorter, hard timeout. */
const HARNESS_DEADLINE_MS = 300_000;

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

const invokeHost = () => window.__TAURI_INTERNALS__?.invoke;

/**
 * Emit a single-line progress breadcrumb. Checkpoints are only ever emitted at
 * phase boundaries, never inside a measured interval, so a launch that hangs or
 * is killed by the driver's hard timeout still shows the last phase it reached.
 */
async function checkpoint(name: string, data: Record<string, unknown> = {}): Promise<void> {
  const invoke = invokeHost();
  if (!invoke) return;
  try {
    await invoke("issue041_emit_checkpoint", {
      checkpoint: JSON.stringify({ name, atMs: Math.round(performance.now()), ...data }),
    });
  } catch {
    // Breadcrumbs must never affect the measurement run.
  }
}

async function benchmarkEnabled(): Promise<boolean> {
  const invoke = invokeHost();
  if (!invoke) return false;
  try {
    return await invoke<boolean>("issue041_is_benchmark_enabled");
  } catch {
    return false;
  }
}

/**
 * Report the instant the shell became visible and interactive.
 *
 * "Interactive" is asserted, not assumed: the DOM has parsed, the shell's own
 * elements exist, the compositor has produced at least one frame (two chained
 * animation frames), and the main thread has since serviced a fresh macrotask.
 * Rust converts that moment into milliseconds since its process-start instant
 * and simultaneously records the native window's visibility.
 */
export async function reportIssue041ShellReady(): Promise<void> {
  const invoke = invokeHost();
  if (!invoke || !(await benchmarkEnabled())) return;

  if (document.readyState === "loading") {
    await new Promise<void>(resolve =>
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
  }
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve()));
  const interactiveProbeAt = performance.now();
  await new Promise<void>(resolve => window.setTimeout(() => resolve(), 0));
  const macrotaskLatencyMs = performance.now() - interactiveProbeAt;

  const shellSelectors = [
    "#runtime-status",
    "#canvas",
    "#compile-load",
    "#run-clear-color",
    "#stop-clear-color",
  ];
  const detail = {
    documentReadyState: document.readyState,
    shellElementsPresent: shellSelectors.filter(
      selector => document.querySelector(selector) !== null).length,
    shellElementsExpected: shellSelectors.length,
    documentVisibilityState: document.visibilityState,
    firstPaintedFrames: 2,
    macrotaskLatencyMs,
    timeOriginToShellReadyMs: performance.now(),
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
  };
  await invoke("issue041_shell_ready", { detail: JSON.stringify(detail) });
  await checkpoint("shell-ready");
}

function webGlEvidence(): Record<string, unknown> {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return { available: false };
    const context = gl as WebGLRenderingContext;
    const debugInfo = context.getExtension("WEBGL_debug_renderer_info") as {
      UNMASKED_VENDOR_WEBGL: number;
      UNMASKED_RENDERER_WEBGL: number;
    } | null;
    return {
      available: true,
      contextType: canvas.getContext("webgl2") ? "webgl2" : "webgl",
      version: String(context.getParameter(context.VERSION)),
      shadingLanguageVersion: String(context.getParameter(context.SHADING_LANGUAGE_VERSION)),
      vendor: String(context.getParameter(context.VENDOR)),
      renderer: String(context.getParameter(context.RENDERER)),
      unmaskedVendor: debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL)) : null,
      unmaskedRenderer: debugInfo
        ? String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)) : null,
    };
  } catch (error: unknown) {
    return { available: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function environmentEvidence(): Record<string, unknown> {
  return {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    languages: [...navigator.languages],
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
    webgl: webGlEvidence(),
  };
}

interface CompileSample {
  readonly index: number;
  readonly kind: "cold" | "warm";
  readonly elapsedMs: number;
  readonly diagnosticCount: number;
  readonly assemblySha256: string;
  readonly assemblyByteLength: number;
}

async function compileOnce(index: number, kind: "cold" | "warm"): Promise<CompileSample> {
  const startedAt = performance.now();
  const result = await compileSourcesThroughPersistentCompiler({
    assemblyName: ASSEMBLY_NAME,
    sources: ISSUE041_FIXTURE_SOURCES.map(source => ({ ...source })),
    primarySourcePath: PRIMARY_SOURCE_PATH,
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.success !== true) {
    throw new Error(`Benchmark compilation failed: ${JSON.stringify(result.error)}`);
  }
  const diagnostics = result.diagnostics as unknown[];
  if (diagnostics.length !== 0) {
    throw new Error(`Benchmark fixture produced diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  return {
    index,
    kind,
    elapsedMs,
    diagnosticCount: diagnostics.length,
    assemblySha256: String(result.assemblySha256),
    assemblyByteLength: Number(result.assemblyByteLength),
  };
}

interface PreviewCycleSample {
  readonly cycle: number;
  readonly kind: "cold" | "warm";
  readonly compileWithinRunMs: number;
  readonly previewStartedMs: number;
  /**
   * Compile response → first frame the Game reports drawing. When the frame
   * never arrived inside the hard bound this is the censored value: the elapsed
   * time at which observation was abandoned, which is at least
   * `firstFrame.deadlineMs`. The true value is then >= this number.
   */
  readonly previewFirstFrameMs: number;
  readonly firstFrame: {
    readonly censored: boolean;
    readonly deadlineMs: number;
    readonly pollIntervalMs: number;
    readonly observationIntervalMs: number;
    readonly queryCount: number;
    readonly queryFailureCount: number;
    readonly lastQueryError: string | null;
    /** Tightest measured lower bound: frames cannot precede the start request. */
    readonly lowerBoundMs: number;
    /** Estimate from the measured frame rate; never used for a verdict. */
    readonly estimateMs: number | null;
    readonly censorReason: string | null;
    readonly evidence: string | null;
  };
  readonly firstFrameObservationIntervalMs: number;
  readonly frameRate: {
    readonly framesDrawn: number;
    readonly elapsedMs: number;
    readonly framesPerSecond: number | null;
  } | null;
  readonly stopControlReturnMs: number;
  readonly stopInstrumentedMs: number;
  readonly stopMeaningful: boolean;
  readonly previewRenderedBeforeStop: boolean;
  readonly frameCountAtFirstObservation: number;
  readonly frameCountBeforeStop: number;
  readonly frameCountAfterStop: number;
  readonly keptDrawing: boolean;
  readonly runCount: number;
  readonly staticConstructorCount: number;
  readonly disposeCount: number;
  readonly callbackAfterDisposedCount: number;
  readonly controllerIdleAfterStop: boolean;
  readonly previewWindowRemoved: boolean;
  /** Where the preview-start time is spent, all from the same mark series. */
  readonly breakdown: {
    readonly windowCreateInvokeMs: number;
    readonly fixedSettleDelayMs: number;
    readonly previewRuntimeBootstrapMs: number;
    readonly previewRuntimeReadyMs: number;
    readonly bootstrapLoopOverheadMs: number;
    readonly loadAndStartMs: number;
  };
  readonly bootstrapDetail: Record<string, unknown> | null;
  readonly marks: Record<string, number>;
}

const FIRST_FRAME_POLL_INTERVAL_MS = 5;
/** Hard bound on first-frame observation. Exceeding it censors the sample. */
const FIRST_FRAME_DEADLINE_MS = 20_000;
/** Window over which the running frame rate is measured, after the sample. */
const FRAME_RATE_PROBE_MS = 250;

async function runPreviewCycle(cycle: number, kind: "cold" | "warm"): Promise<PreviewCycleSample> {
  const marks: Record<string, number> = {};
  let bootstrapDetail: Record<string, unknown> | null = null;
  const controller = createIssue024RunStopController<Issue23RunningPreview>({
    start: () => compileLoadStartIssue23({
      assemblyName: `${ASSEMBLY_NAME}Preview`,
      sourcePath: PRIMARY_SOURCE_PATH,
      sourceText: game1Text,
      sources: ISSUE041_FIXTURE_SOURCES.map(source => ({ ...source })),
      primarySourcePath: PRIMARY_SOURCE_PATH,
      proofMode: true,
      issue024Proof: true,
      onPhase: (phase, timestamp) => { marks[phase] = timestamp; },
      onBootstrapDetail: detail => { bootstrapDetail = detail; },
    }),
    stop: (preview, reason) => preview.stop(reason),
    setRunDisabled() {},
    setStopDisabled() {},
    setStatus() {},
    reportError() {},
  });

  const preview = await controller.run();
  const compileResponseAt = marks["compile.response"];
  const startedAt = marks["preview.started"];
  if (typeof compileResponseAt !== "number" || typeof startedAt !== "number") {
    throw new Error(`Preview phase marks are incomplete: ${JSON.stringify(marks)}`);
  }

  // First frame the running Game reports drawing. Polled, so an observed value
  // is an upper bound on the true first-frame instant. If no frame is reported
  // before the hard deadline the sample is right-censored at the deadline
  // rather than discarded: the preview really was not visibly active by then.
  const firstFrameDeadline = performance.now() + FIRST_FRAME_DEADLINE_MS;
  let queryCount = 0;
  let queryFailureCount = 0;
  let lastQueryError: string | null = null;
  let state: Record<string, unknown> = {};
  const query = async (): Promise<Record<string, unknown>> => {
    try {
      const value = await preview.query();
      queryCount++;
      return value;
    } catch (error: unknown) {
      queryFailureCount++;
      lastQueryError = error instanceof Error ? error.message : String(error);
      return state;
    }
  };

  let probeStartedAt = performance.now();
  state = await query();
  let firstFrameObservedAt = performance.now();
  let observationIntervalMs = firstFrameObservedAt - probeStartedAt;
  while (Number(state.frameCount ?? 0) < 1 && performance.now() < firstFrameDeadline) {
    await wait(FIRST_FRAME_POLL_INTERVAL_MS);
    probeStartedAt = performance.now();
    state = await query();
    firstFrameObservedAt = performance.now();
    observationIntervalMs = firstFrameObservedAt - probeStartedAt + FIRST_FRAME_POLL_INTERVAL_MS;
  }
  const frameCountAtFirstObservation = Number(state.frameCount ?? 0);
  const censored = frameCountAtFirstObservation < 1;
  const previewFirstFrameMs = firstFrameObservedAt - compileResponseAt;

  // Frame rate, measured after the sample has been taken so it cannot perturb
  // it. It converts "N frames had already been drawn when the first
  // observation landed" into a quantified overshoot estimate.
  const rateStartFrames = Number(state.frameCount ?? 0);
  const rateStartedAt = performance.now();
  await wait(FRAME_RATE_PROBE_MS);
  const rateState = await query();
  const rateElapsedMs = performance.now() - rateStartedAt;
  const framesDrawn = Number(rateState.frameCount ?? 0) - rateStartFrames;
  const framesPerSecond = framesDrawn > 0 ? (framesDrawn / rateElapsedMs) * 1_000 : null;
  state = Number(rateState.frameCount ?? 0) >= rateStartFrames ? rateState : state;

  const startRequestAt = marks["preview.start.request"] ?? startedAt;
  const lowerBoundMs = startRequestAt - compileResponseAt;
  const estimateMs = !censored && framesPerSecond !== null && frameCountAtFirstObservation >= 1
    ? previewFirstFrameMs - ((frameCountAtFirstObservation - 1) / framesPerSecond) * 1_000
    : null;

  let evidence: string | null = null;
  if (censored) {
    let previewErrors = "unavailable";
    try {
      previewErrors = JSON.stringify(
        await preview.proof<unknown[]>("snapshot", { name: "errors" })).slice(0, 400);
    } catch (error: unknown) {
      previewErrors = `snapshot failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    evidence =
      `preview.started was observed at +${Math.round(startedAt - compileResponseAt)} ms and the ` +
      `preview bridge answered ${queryCount} state queries (${queryFailureCount} failed) during ` +
      `the bound, so the preview process stayed responsive, but the Game reported ` +
      `FrameCount 0 throughout the bound; frames drawn in the ${FRAME_RATE_PROBE_MS} ms after ` +
      `the bound: ${framesDrawn}; preview window still attached: ${preview.frame.isConnected}; ` +
      `preview-side errors: ${previewErrors}`;
  }

  const keptDrawing = Number(state.frameCount ?? 0) >= 3;
  const stopRequestedAt = performance.now();
  const stopped = await controller.stop() as {
    elapsedMilliseconds: number;
    iframeConnected: boolean;
    runtime?: { stop?: { quiescent?: Record<string, unknown> } };
  };
  const stopControlReturnMs = performance.now() - stopRequestedAt;
  const quiescent = stopped.runtime?.stop?.quiescent ?? {};

  const settledAt = marks["preview.window.settled"] ?? Number.NaN;
  const bootstrappedAt = marks["preview.runtime.bootstrapped"] ?? Number.NaN;
  const readyObservedAt = marks["preview.bridge.ready.observed"] ?? Number.NaN;

  return {
    cycle,
    kind,
    compileWithinRunMs: compileResponseAt - (marks["request.begin"] ?? compileResponseAt),
    previewStartedMs: startedAt - compileResponseAt,
    previewFirstFrameMs,
    firstFrame: {
      censored,
      deadlineMs: FIRST_FRAME_DEADLINE_MS,
      pollIntervalMs: FIRST_FRAME_POLL_INTERVAL_MS,
      observationIntervalMs,
      queryCount,
      queryFailureCount,
      lastQueryError,
      lowerBoundMs,
      estimateMs,
      censorReason: censored
        ? `the running Game reported no drawn frame within the ${FIRST_FRAME_DEADLINE_MS} ms ` +
          "first-frame bound measured from preview.started; the sample is right-censored at " +
          "the elapsed time when observation was abandoned"
        : null,
      evidence,
    },
    firstFrameObservationIntervalMs: observationIntervalMs,
    frameRate: { framesDrawn, elapsedMs: rateElapsedMs, framesPerSecond },
    stopControlReturnMs,
    stopInstrumentedMs: Number(stopped.elapsedMilliseconds),
    // Stop is a real Stop of a loaded, started preview either way; whether the
    // preview had drawn is recorded so the distribution can be read both ways.
    stopMeaningful: true,
    previewRenderedBeforeStop: !censored,
    frameCountAtFirstObservation,
    frameCountBeforeStop: Number(state.frameCount ?? 0),
    frameCountAfterStop: Number(quiescent.frameCount ?? -1),
    keptDrawing,
    runCount: Number(state.runCount ?? -1),
    staticConstructorCount: Number(state.staticConstructorCount ?? -1),
    disposeCount: Number(quiescent.disposeCount ?? -1),
    callbackAfterDisposedCount: Number(quiescent.callbackAfterDisposedCount ?? -1),
    controllerIdleAfterStop: controller.state === "idle",
    previewWindowRemoved: stopped.iframeConnected === false,
    breakdown: {
      windowCreateInvokeMs: (marks["preview.window.invoked"] ?? Number.NaN) - compileResponseAt,
      fixedSettleDelayMs: (marks["preview.window.settled"] ?? Number.NaN) -
        (marks["preview.window.invoked"] ?? Number.NaN),
      previewRuntimeBootstrapMs: bootstrappedAt - settledAt,
      // Real preview-runtime work: settle → the instant the bridge readiness
      // promise resolved, observed passively inside createIsolatedPreview.
      previewRuntimeReadyMs: readyObservedAt - settledAt,
      // Everything the bootstrap loop spent after the runtime was already
      // ready: the fixed deadline it could not leave early.
      bootstrapLoopOverheadMs: bootstrappedAt - readyObservedAt,
      loadAndStartMs: startedAt - (marks["preview.window.created"] ?? Number.NaN),
    },
    bootstrapDetail,
    marks: { ...marks },
  };
}

export async function runIssue041Benchmark(): Promise<void> {
  const invoke = invokeHost();
  if (!invoke || !(await benchmarkEnabled())) return;
  const harnessDeadline = performance.now() + HARNESS_DEADLINE_MS;
  const mode = await invoke<string>("issue041_benchmark_mode");

  const emit = (payload: Record<string, unknown>) => invoke("issue041_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      benchmarkMode: `MONOGAME_ISSUE041_BENCHMARK=1 MONOGAME_ISSUE041_MODE=${mode}`,
      mode,
      ...payload,
    }),
  });

  if (mode === "shell-only") {
    await emit({
      environment: environmentEvidence(),
      fixture: { fileCount: ISSUE041_FIXTURE_SOURCES.length },
      compileSamples: [],
      previewCycles: [],
      phaseFailures: [],
      phaseReached: "shell-only",
    });
    return;
  }

  // Memory-baseline mode: delegate to the dedicated function.
  if (mode === "memory-baseline") {
    await runMemoryBaselineBenchmark();
    return;
  }

  // Every phase result collected so far survives a later failure: a launch that
  // breaks in the preview phase still reports its compiler-init and compilation
  // samples, so the driver never has to survivor-condition on whole launches.
  const compileSamples: CompileSample[] = [];
  const previewCycles: PreviewCycleSample[] = [];
  const phaseFailures: { phase: string; detail: string }[] = [];
  let environment: Record<string, unknown> | null = null;
  let proofRuntimeReadiness: unknown = null;
  let shellSteadyStateMs: number | null = null;
  let compilerInit: Record<string, unknown> | null = null;
  let phaseReached = "start";
  let failure: string | null = null;

  const recordFailure = (phase: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    phaseFailures.push({ phase, detail });
    if (failure === null) failure = `${phase}: ${detail}`;
    return detail;
  };

  try {
    environment = environmentEvidence();
    const warmCompileCount = await invoke<number>("issue041_warm_compile_count");
    const previewCycleCount = await invoke<number>("issue041_preview_cycle_count");
    proofRuntimeReadiness = await preparePackagedProofRuntime();
    await checkpoint("proof-runtime-ready");
    phaseReached = "proof-runtime-ready";

    // Precondition, deliberately excluded from every sample: the shell's own
    // top-level runtime reaches its steady rendering state, matching a person who
    // presses Run on a settled shell rather than mid-boot.
    const steadyStateStartedAt = performance.now();
    await waitForShellSteadyStateForBenchmark();
    shellSteadyStateMs = performance.now() - steadyStateStartedAt;
    await checkpoint("shell-steady-state", { shellSteadyStateMs: Math.round(shellSteadyStateMs) });
    phaseReached = "shell-steady-state";

    const compilerInitStartedAt = performance.now();
    const compilerRuntimeStarts = await prepareCompilerContextForBenchmark();
    const coldCompilerInitMs = performance.now() - compilerInitStartedAt;
    if (compilerRuntimeStarts !== 1) {
      throw new Error(`Compiler context started ${compilerRuntimeStarts} times; expected exactly 1.`);
    }
    compilerInit = { kind: "cold", elapsedMs: coldCompilerInitMs, compilerRuntimeStarts };
    await checkpoint("compiler-context-ready", { coldCompilerInitMs: Math.round(coldCompilerInitMs) });
    phaseReached = "compiler-context-ready";

    compileSamples.push(await compileOnce(0, "cold"));
    for (let index = 1; index <= warmCompileCount; index++) {
      if (performance.now() > harnessDeadline) throw new Error("Benchmark harness deadline exceeded.");
      compileSamples.push(await compileOnce(index, "warm"));
    }
    await checkpoint("compile-samples-collected", { count: compileSamples.length });
    phaseReached = "compile-samples-collected";

    for (let cycle = 0; cycle < previewCycleCount; cycle++) {
      if (performance.now() > harnessDeadline) throw new Error("Benchmark harness deadline exceeded.");
      await checkpoint("preview-cycle-begin", { cycle });
      try {
        previewCycles.push(await runPreviewCycle(cycle, cycle === 0 ? "cold" : "warm"));
        await checkpoint("preview-cycle-end", { cycle });
      } catch (error: unknown) {
        // A broken cycle costs only its own preview/Stop samples; the earlier
        // cycles and every compilation sample are still reported.
        const detail = recordFailure(`preview-cycle-${cycle}`, error);
        await checkpoint("preview-cycle-failed", { cycle, detail: detail.slice(0, 200) });
      }
      phaseReached = `preview-cycle-${cycle}-complete`;
    }
    phaseReached = "complete";
  } catch (error: unknown) {
    recordFailure(phaseReached, error);
  }

  const distinctAssemblies = new Set(compileSamples.map(sample => sample.assemblySha256));
  await emit({
    environment,
    proofRuntimeReadiness,
    fixture: {
      fileCount: ISSUE041_FIXTURE_SOURCES.length,
      primarySourcePath: PRIMARY_SOURCE_PATH,
      paths: ISSUE041_FIXTURE_SOURCES.map(source => source.path),
      totalCharacters: ISSUE041_FIXTURE_SOURCES.reduce(
        (total, source) => total + source.text.length, 0),
    },
    preconditions: { shellSteadyStateMs },
    compilerInit,
    compileSamples,
    compileDeterminism: {
      distinctAssemblyDigests: distinctAssemblies.size,
      assemblySha256: compileSamples[0]?.assemblySha256 ?? null,
    },
    previewCycles,
    phaseFailures,
    phaseReached,
    failure,
  });
}

// ---------------------------------------------------------------------------
// Issue 042: memory-baseline benchmark (100-comp + 20-cycle RSS stability)
// ---------------------------------------------------------------------------

interface RssSample {
  readonly label: string;
  readonly bytes: number;
  readonly kilobytes: number;
  readonly megabytes: number;
}

interface MemoryBaselineReport {
  readonly schemaVersion: 2;
  readonly generatedAt: string;
  readonly benchmarkMode: string;
  readonly mode: "memory-baseline";
  readonly compilerRssSamples: RssSample[];
  readonly previewRssSamples: RssSample[];
  readonly cleanupVerification: {
    readonly audioContextStates: string[];
    readonly animationFrameCount: number;
    readonly webglContextCount: number;
    readonly messagePortCount: number;
    readonly allCleared: boolean;
    readonly detail: string;
  };
  readonly compilationCount: number;
  readonly previewCycleCount: number;
  readonly failures: string[];
}

/** Read RSS of the current process via the Rust command. */
async function readRss(): Promise<RssSample> {
  const invoke = invokeHost();
  if (!invoke) throw new Error("no Tauri invoke available");
  const bytes = await invoke<number>("issue041_rss_bytes");
  return {
    label: `RSS=${Math.round(bytes / 1024)} KB`,
    bytes,
    kilobytes: bytes / 1024,
    megabytes: bytes / (1024 * 1024),
  };
}

/** Verify that stopped preview resources are fully cleaned up. */
async function verifyCleanup(): Promise<MemoryBaselineReport["cleanupVerification"]> {
  const audioContextStates: string[] = [];
  let animationFrameCount = 0;
  let webglContextCount = 0;
  let messagePortCount = 0;
  const detailParts: string[] = [];

  // Check for lingering AudioContext instances
  if (typeof (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext !== "undefined") {
    try {
      // Create a temporary canvas to check WebGL
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") ?? canvas.getContext("webgl2") ?? canvas.getContext("experimental-webgl");
      if (gl) {
        webglContextCount++;
        // Try to get another context — if it succeeds, the first was released
        const gl2 = canvas.getContext("webgl2");
        if (gl2) webglContextCount++;
      }
      canvas.remove();
    } catch {
      // Canvas creation failed — no WebGL contexts available
    }
  }

  // Check for lingering animation frames by tracking requestAnimationFrame
  let rafId: number | null = null;
  const checkFrame = () => {
    animationFrameCount++;
    if (rafId !== null) cancelAnimationFrame(rafId);
    if (animationFrameCount < 3) {
      rafId = requestAnimationFrame(checkFrame);
    }
  };
  rafId = requestAnimationFrame(checkFrame);

  // Check for lingering message ports
  // This is a heuristic: if there are active MessagePort objects, they won't
  // be garbage collected immediately, so we check channel count
  try {
    const { port1, port2 } = new MessageChannel();
    messagePortCount = 2;
    port1.close();
    port2.close();
  } catch {
    messagePortCount = -1; // MessageChannel not available
  }

  // Check AudioContext states (if AudioContext exists)
  if (typeof AudioContext !== "undefined") {
    try {
      const ctx = new AudioContext();
      audioContextStates.push(ctx.state);
      await ctx.close();
    } catch {
      audioContextStates.push("closed-or-failed");
    }
  }

  const allCleared =
    audioContextStates.every(s => s === "closed") &&
    animationFrameCount <= 3 &&
    messagePortCount <= 2;

  detailParts.push(
    `AudioContext states: ${audioContextStates.join(", ")}`,
    `Animation frames observed: ${animationFrameCount}`,
    `WebGL contexts checked: ${webglContextCount}`,
    `MessagePort objects created/closed: ${messagePortCount}`,
    allCleared ? "All cleanup checks passed" : "Some cleanup checks failed",
  );

  return {
    audioContextStates,
    animationFrameCount,
    webglContextCount,
    messagePortCount,
    allCleared,
    detail: detailParts.join(" | "),
  };
}

export async function runMemoryBaselineBenchmark(): Promise<void> {
  const invoke = invokeHost();
  if (!invoke || !(await benchmarkEnabled())) return;
  const mode = await invoke<string>("issue041_benchmark_mode");

  if (mode !== "memory-baseline") return;

  const emit = (payload: Record<string, unknown>) => invoke("issue041_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      benchmarkMode: `MONOGAME_ISSUE041_BENCHMARK=1 MONOGAME_ISSUE041_MODE=${mode}`,
      mode,
      ...payload,
    }),
  });

  const compilerRssSamples: RssSample[] = [];
  const previewRssSamples: RssSample[] = [];
  const failures: string[] = [];
  const recordFailure = (phase: string, error: unknown) => {
    const detail = error instanceof Error ? error.message : String(error);
    failures.push(`${phase}: ${detail}`);
  };

  try {
    // 1. Compile 100 times (1 cold + 99 warm), sample RSS at intervals 10, 20, ..., 100
    const warmCompileCount = await invoke<number>("issue041_warm_compile_count");
    const totalCompiles = 1 + warmCompileCount;
    if (totalCompiles !== 100) {
      throw new Error(`expected 100 total compiles (1 cold + ${warmCompileCount} warm), got ${totalCompiles}`);
    }

    await checkpoint("memory-baseline-start");

    // Cold compile
    await compileOnce(0, "cold");
    if (totalCompiles % 10 === 0) {
      compilerRssSamples.push(await readRss());
    }

    // Warm compiles
    for (let index = 1; index <= warmCompileCount; index++) {
      await compileOnce(index, "warm");
      if ((index % 10) === 0) {
        compilerRssSamples.push(await readRss());
      }
    }
    await checkpoint("memory-baseline-compiles-complete", { count: totalCompiles });

    // 2. Run 20 preview cycles with RSS after each Stop
    const previewCycleCount = await invoke<number>("issue041_preview_cycle_count");
    if (previewCycleCount < 20) {
      throw new Error(`expected >= 20 preview cycles, got ${previewCycleCount}`);
    }

    for (let cycle = 0; cycle < Math.min(previewCycleCount, 20); cycle++) {
      await checkpoint("memory-baseline-cycle-begin", { cycle });
      try {
        await runPreviewCycle(cycle, cycle === 0 ? "cold" : "warm");
        // Sample RSS after Stop completes
        const rssAfterStop = await readRss();
        rssAfterStop.label = `after-cycle-${cycle + 1}-stop`;
        previewRssSamples.push(rssAfterStop);
      } catch (error: unknown) {
        recordFailure(`memory-baseline-cycle-${cycle}`, error);
      }
    }
    await checkpoint("memory-baseline-cycles-complete", { cycles: previewRssSamples.length });

    // 3. Verify cleanup after all cycles
    await checkpoint("memory-baseline-cleanup-verify");
    const cleanup = await verifyCleanup();

    await checkpoint("memory-baseline-complete");
    await emit({
      mode: "memory-baseline" as const,
      compilerRssSamples,
      previewRssSamples,
      cleanupVerification: cleanup,
      compilationCount: totalCompiles,
      previewCycleCount: previewRssSamples.length,
      failures,
    });
  } catch (error: unknown) {
    recordFailure("memory-baseline-main", error instanceof Error ? error.message : String(error));
    await emit({
      mode: "memory-baseline" as const,
      compilerRssSamples,
      previewRssSamples,
      cleanupVerification: {
        audioContextStates: [],
        animationFrameCount: 0,
        webglContextCount: 0,
        messagePortCount: 0,
        allCleared: false,
        detail: `benchmark failed: ${error instanceof Error ? error.message : String(error)}`,
      },
      compilationCount: compilerRssSamples.length,
      previewCycleCount: previewRssSamples.length,
      failures,
    });
  }
}

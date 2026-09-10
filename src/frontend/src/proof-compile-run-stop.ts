// Scenario proof suite — Compile → Run → Stop → rerun (durable feature-level).
//
// Durable scenario 1. Orchestrated by the single `runCompileRunStopScenario`
// entrypoint below, which drives, in order: the shared runtime load/transfer
// proof (former issue021 — DLL + portable-PDB transfer, managed/native load),
// retain-async-Game + render clear color (former issue23), cooperative stop of
// a yielding loop + resource release (former issue24), restart preview with
// clean static state (former issue25), and compile+run two files with cross-file
// calls (former issue30). Shared helpers (`wait`) are deduplicated at module
// scope; per-sub-proof fixtures keep distinct names. The per-issue env gates and
// `issueNN_emit_report` commands are preserved verbatim for Stage-6
// compatibility. PRODUCT never imports this module.
import game1Text from "../../../tests/compiler/fixtures/cross-file/Game1.cs?raw";
import playerText from "../../../tests/compiler/fixtures/cross-file/Player.cs?raw";
import {
  compileLoadStartIssue23,
  compileSourcesThroughPersistentCompiler,
  preparePackagedProofRuntime,
  runIssue021AutoProof,
  type Issue23RunningPreview,
} from "./scenario-toolkit";
import { createRunStopController } from "./lifecycle-controller";
import { runScenario, type SubProof } from "./scenario-runner";

// Deduplicated shared delay helper (was redeclared inside every namespace).
const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

// ── Clear-color async retention (former issue23) ──
const sourceText = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using System.Threading;

public sealed class ClearColorGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    private static int _disposeCount;

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);

    public ClearColorGame()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
    }

    protected override void Draw(GameTime gameTime)
    {
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing) Interlocked.Increment(ref _disposeCount);
        base.Dispose(disposing);
    }
}`;

interface PixelSample {
  sampledAt: number;
  canvasBacking: { width: number; height: number };
  drawingBuffer: { width: number; height: number };
  pixels: number[][];
  glError: number;
  contextLost: boolean;
}

async function samplePixels(preview: Issue23RunningPreview): Promise<PixelSample> {
  return preview.proof<PixelSample>("sample-webgl");
}

function assertCornflowerBlue(sample: PixelSample): void {
  const expected = [100, 149, 237, 255];
  if (sample.glError !== 0 || sample.contextLost ||
      sample.pixels.some(pixel =>
        pixel.some((channel, index) => Math.abs(channel - expected[index]) > 3))) {
    throw new Error(`Issue 023 pixel readback was not CornflowerBlue: ${JSON.stringify(sample)}`);
  }
}

async function startClearColorGame(
  proofMode: boolean,
  source = sourceText,
  assemblyName = proofMode ? "Issue023ProofGame" : "ClearColorGame",
  runtimeCase: "normal" | "delay-run" | "delay-run-late" | "delay-run-long" | "delay-event" | "unexpected" = "normal",
  startTimeoutMs = 10_000,
  startPattern: "normal" | "same-concurrent" | "distinct-concurrent" | "repeated" | "before-load" = "normal",
  requesterTimeoutMs = 10_000,
  auxiliary = assemblyName.startsWith("Issue023") && assemblyName !== "Issue023ProofGame",
  timeoutRetirementGraceMs = 0,
  expectedStartCode?: "INTERNAL_ERROR",
): Promise<Issue23RunningPreview> {
  return compileLoadStartIssue23({
    assemblyName,
    sourcePath: "src/ClearColorGame.cs",
    sourceText: source,
    proofMode,
    runtimeCase,
    startTimeoutMs,
    startPattern,
    requesterTimeoutMs,
    auxiliary,
    timeoutRetirementGraceMs,
    expectedStartCode,
  });
}

// (Former `installIssue023RunControl` proof-only Run wiring removed in Stage 4:
// it duplicated the production Run/Stop control in `app.ts` via
// `run-stop.ts`/`issue23-controller.ts` and had no caller.)

export async function runIssue023AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue023_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  await invoke("issue023_emit_checkpoint", {
    checkpoint: JSON.stringify({ phase: "runtime-cases-started" }),
  });
  const preview = await startClearColorGame(true);
  const initialState = await preview.query();
  let firstSample: PixelSample | null = null;
  const firstDeadline = performance.now() + 10_000;
  while (performance.now() < firstDeadline) {
    const candidate = await samplePixels(preview);
    try {
      assertCornflowerBlue(candidate);
      firstSample = candidate;
      break;
    } catch {
      await wait(100);
    }
  }
  if (!firstSample) throw new Error("Issue 023 never rendered the expected clear color.");
  const firstManaged = await preview.query();
  await invoke("issue023_emit_checkpoint", {
    checkpoint: JSON.stringify({
      stage: "running",
      previewId: preview.previewId,
      frameCount: firstManaged.frameCount,
      canvasBacking: firstSample.canvasBacking,
      pixels: firstSample.pixels,
    }),
  });
  await wait(5_100);
  const secondSample = await samplePixels(preview);
  const secondManaged = await preview.query();
  assertCornflowerBlue(secondSample);
  const runtimeLifecycleCases: Record<string, unknown> = {};
  let synchronousFailure: unknown = null;
  try {
    await startClearColorGame(true, `
using Microsoft.Xna.Framework;
public sealed class ThrowingRunGame : Game
{
    public static int DisposeCount { get; private set; }
    protected override void BeginRun() => throw new System.InvalidOperationException("private detail");
    protected override void Dispose(bool disposing)
    {
        if (disposing) DisposeCount++;
        base.Dispose(disposing);
    }
}`, "Issue023ThrowingRun");
    throw new Error("Issue 023 synchronous Run failure was unexpectedly accepted.");
  } catch (error) {
    await invoke("issue023_emit_checkpoint", {
      checkpoint: JSON.stringify({
        phase: "runtime-case-result",
        id: "synchronousRunFailure",
        message: error instanceof Error ? error.message : String(error),
        failureProof: (error as Error & { failureProof?: unknown }).failureProof,
      }),
    });
    if (!(error instanceof Error) || !error.message.startsWith("PREVIEW_START_FAILED:")) throw error;
    synchronousFailure = (error as Error & { failureProof?: unknown }).failureProof;
  }
  runtimeLifecycleCases.synchronousRunFailure = synchronousFailure;
  await invoke("issue023_emit_checkpoint", {
    checkpoint: JSON.stringify({ phase: "runtime-case", id: "synchronousRunFailure" }),
  });
  const failure = synchronousFailure as {
    wireOrder?: string[];
    preview?: {
      start?: { managed?: {
        runAttempts?: number;
        retainedGame?: boolean;
        disposed?: boolean;
        disposeAttempts?: number;
        error?: { message?: string };
      } };
      events?: Array<{ type?: string; correlationId?: string; sequence?: number }>;
      failureTeardown?: { hadGame?: boolean; disposeAttempts?: number };
    };
  };
  const failureEvents = (failure.preview?.events ?? []).filter(
    event => event.type === "preview.failed" || event.type === "preview.stopped");
  if (failure.wireOrder?.filter(type => type !== "preview.output").join(",") !==
      "preview.start.response,preview.failed,preview.stopped" ||
      failureEvents.map(event => event.type).join(",") !== "preview.failed,preview.stopped" ||
      failureEvents[0]?.sequence === undefined ||
      failureEvents[1]?.sequence !== failureEvents[0].sequence + 1 ||
      failureEvents[0]?.correlationId !== failureEvents[1]?.correlationId ||
      failure.preview?.start?.managed?.runAttempts !== 1 ||
      failure.preview.start.managed.retainedGame !== false ||
      failure.preview.start.managed.disposed !== true ||
      failure.preview.start.managed.disposeAttempts !== 1 ||
      failure.preview.start.managed.error?.message?.includes("private detail") ||
      failure.preview?.failureTeardown?.hadGame !== false) {
    throw new Error("Issue 023 synchronous Run failure lifecycle proof did not match.");
  }

  for (const definition of [
    { id: "receiverDeadline", runtimeCase: "delay-run" as const, timeout: 100, code: "TIMEOUT" },
    { id: "unexpectedBoundary", runtimeCase: "unexpected" as const, timeout: 10_000, code: "INTERNAL_ERROR" },
  ]) {
    try {
      await startClearColorGame(
        true, sourceText, `Issue023${definition.id}`,
        definition.runtimeCase, definition.timeout, "normal", 10_000, true, 0,
        definition.id === "unexpectedBoundary" ? "INTERNAL_ERROR" : undefined);
      throw new Error(`${definition.id} was unexpectedly accepted.`);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith(`${definition.code}:`)) throw error;
      runtimeLifecycleCases[definition.id] =
        (error as Error & { failureProof?: unknown }).failureProof;
      await invoke("issue023_emit_checkpoint", {
        checkpoint: JSON.stringify({ phase: "runtime-case", id: definition.id }),
      });
    }
  }
  const unexpectedBoundary = runtimeLifecycleCases.unexpectedBoundary as {
    endpointSnapshot?: {
      closed?: boolean;
      closeReasons?: string[];
      expectedRejections?: Array<{ observedCode?: string; probePhase?: string }>;
      unexpectedErrors?: string[];
      lifecycleEvents?: unknown[];
    };
    subsequentRequestFailure?: string;
    beforeRetirement?: { iframeConnected?: boolean; portClosed?: boolean };
    afterRetirement?: {
      iframeConnected?: boolean;
      portClosed?: boolean;
      hostCloseReason?: string;
    };
  };
  if (unexpectedBoundary.endpointSnapshot?.closed !== true ||
      unexpectedBoundary.endpointSnapshot.closeReasons?.at(-1) !==
        "unexpected-start-boundary" ||
      unexpectedBoundary.endpointSnapshot.expectedRejections?.length !== 1 ||
      unexpectedBoundary.endpointSnapshot.expectedRejections[0]?.observedCode !==
        "INTERNAL_ERROR" ||
      unexpectedBoundary.endpointSnapshot.expectedRejections[0]?.probePhase !==
        "unexpected-start-boundary" ||
      unexpectedBoundary.endpointSnapshot.unexpectedErrors?.length !== 0 ||
      unexpectedBoundary.endpointSnapshot.lifecycleEvents?.length !== 0 ||
      unexpectedBoundary.subsequentRequestFailure !== "TIMEOUT" ||
      unexpectedBoundary.beforeRetirement?.iframeConnected !== true ||
      unexpectedBoundary.beforeRetirement?.portClosed !== false ||
      unexpectedBoundary.afterRetirement?.iframeConnected !== false ||
      unexpectedBoundary.afterRetirement?.portClosed !== true ||
      unexpectedBoundary.afterRetirement?.hostCloseReason !==
        "Failed preview retired.") {
    throw new Error("Unexpected start boundary closure proof did not match.");
  }

  const delayedStarted = await startClearColorGame(
    true, sourceText, "Issue023DelayedStarted", "delay-event");
  runtimeLifecycleCases.delayedStarted = {
    wireOrder: delayedStarted.wireOrder,
    managed: await delayedStarted.query(),
    teardown: await delayedStarted.teardown(),
  };
  await invoke("issue023_emit_checkpoint", {
    checkpoint: JSON.stringify({ phase: "runtime-case", id: "delayedStarted" }),
  });

  for (const definition of [
    { id: "beforeLoad", pattern: "before-load" as const, runtimeCase: "normal" as const },
    { id: "sameCorrelationConcurrent", pattern: "same-concurrent" as const, runtimeCase: "delay-run" as const },
    { id: "distinctCorrelationConcurrent", pattern: "distinct-concurrent" as const, runtimeCase: "delay-run" as const },
    { id: "successfulThenRepeated", pattern: "repeated" as const, runtimeCase: "normal" as const },
  ]) {
    const lifecyclePreview = await startClearColorGame(
      true,
      sourceText,
      `Issue023${definition.id}`,
      definition.runtimeCase,
      10_000,
      definition.pattern,
    );
    runtimeLifecycleCases[definition.id] = {
      probes: lifecyclePreview.probes,
      wireOrder: lifecyclePreview.wireOrder,
      managed: await lifecyclePreview.query(),
      teardown: await lifecyclePreview.teardown(),
    };
    await invoke("issue023_emit_checkpoint", {
      checkpoint: JSON.stringify({ phase: "runtime-case", id: definition.id }),
    });
  }
  try {
    await startClearColorGame(
      true, sourceText, "Issue023RequesterTimeout",
      "delay-run-long", 10_000, "normal", 500);
    throw new Error("Requester timeout was unexpectedly accepted.");
  } catch (error) {
    const proof = (error as Error & { failureProof?: {
      elapsedMilliseconds?: number;
      iframeConnected?: boolean;
      portClosed?: boolean;
    } }).failureProof;
    if (!proof ||
        (proof.elapsedMilliseconds ?? 2_000) >= 2_000 ||
        proof.iframeConnected !== false ||
        proof.portClosed !== true) {
      throw new Error(`Requester timeout did not force retirement within two seconds: ${JSON.stringify(proof)}`);
    }
    runtimeLifecycleCases.requesterTimeout = proof;
    await invoke("issue023_emit_checkpoint", {
      checkpoint: JSON.stringify({ phase: "runtime-case", id: "requesterTimeout" }),
    });
  }
  try {
    await startClearColorGame(
      true, sourceText, "Issue023ActualLateDiscard",
      "delay-run-late", 10_000, "normal", 250, true, 1_100);
    throw new Error("Actual late-discard request was unexpectedly accepted.");
  } catch (error) {
    const proof = (error as Error & { failureProof?: {
      elapsedMilliseconds?: number;
      iframeConnected?: boolean;
      portClosed?: boolean;
      clientObservations?: {
        discardedUnknownOrLate?: number;
        terminalResponses?: number;
        lifecycleEvents?: number;
      };
      endpointSnapshot?: {
        terminals?: string[];
        lifecycleEvents?: Array<{ type?: string }>;
      };
      beforeRetirement?: { iframeConnected?: boolean; portClosed?: boolean };
    } }).failureProof;
    const lateEndpointEvents = proof?.endpointSnapshot?.lifecycleEvents?.length ?? 0;
    if (!proof ||
        (proof.elapsedMilliseconds ?? 2_000) >= 2_000 ||
        proof.clientObservations?.discardedUnknownOrLate !== lateEndpointEvents + 1 ||
        proof.clientObservations?.terminalResponses !== 1 ||
        proof.clientObservations?.lifecycleEvents !== 0 ||
        proof.endpointSnapshot?.terminals?.length !== 2 ||
        proof.endpointSnapshot.lifecycleEvents?.filter(
          event => event.type !== "preview.output").map(event => event.type).join(",") !==
          "preview.started" ||
        proof.beforeRetirement?.iframeConnected !== true ||
        proof.beforeRetirement?.portClosed !== false ||
        proof.iframeConnected !== false ||
        proof.portClosed !== true) {
      throw new Error(`Actual late-discard proof did not match: ${JSON.stringify(proof)}`);
    }
    runtimeLifecycleCases.actualLateDiscard = proof;
    await invoke("issue023_emit_checkpoint", {
      checkpoint: JSON.stringify({ phase: "runtime-case", id: "actualLateDiscard" }),
    });
  }

  const managedSelfTest = await preview.proof<Record<string, unknown>>("issue023-self-test");
  const fatalClassifications = managedSelfTest?.fatalClassifications as
    Record<string, boolean> | undefined;
  if (!managedSelfTest ||
      managedSelfTest.runCallbacks !== 1 ||
      managedSelfTest.runAttempts !== 1 ||
      managedSelfTest.competingErrorCode !== "INVALID_STATE" ||
      managedSelfTest.racingDisposeAttempts !== 1 ||
      managedSelfTest.repeatedTeardownHadGame !== false ||
      managedSelfTest.gameDisposeCount !== 1 ||
      fatalClassifications?.OutOfMemoryException !== true ||
      fatalClassifications?.StackOverflowException !== true ||
      fatalClassifications?.AccessViolationException !== true ||
      fatalClassifications?.InvalidOperationException !== false) {
    throw new Error(
      `Issue 023 managed GameRunner behavioral self-test failed: ${JSON.stringify(managedSelfTest)}`);
  }
  runtimeLifecycleCases.managedGameRunner = managedSelfTest;
  const firstFrames = Number(firstManaged.frameCount);
  const secondFrames = Number(secondManaged.frameCount);
  if (!Number.isSafeInteger(firstFrames) || !Number.isSafeInteger(secondFrames) ||
      secondFrames <= firstFrames || secondFrames - firstFrames < 2 ||
      secondSample.sampledAt - firstSample.sampledAt < 5_000 ||
      initialState.runReturned !== true || initialState.retainedGame !== true ||
      initialState.disposed !== false || initialState.runAttempts !== 1 ||
      firstManaged.runAttempts !== 1 || secondManaged.runAttempts !== 1 ||
      Number(secondManaged.proofDisposeCount) !== 0 ||
      preview.compilerRuntimeStarts !== 1 || preview.previewRuntimeStarts !== 1 ||
      preview.wireOrder.filter(type => type !== "preview.output").join(",") !==
        "preview.start.response,preview.started") {
    throw new Error("Issue 023 asynchronous retention assertions failed.");
  }

  const childProof = await preview.proof<{
    errors?: string[];
    events?: unknown[];
  }>("snapshot", { name: "issue023" });
  const unexpectedErrors = {
    topLevelConsoleErrors: window.__MONOGAME_DIAGNOSTICS__.consoleErrors,
    topLevelUnhandledErrors: window.__MONOGAME_DIAGNOSTICS__.unhandledErrors,
    compilerErrors: document.querySelector<HTMLIFrameElement>("#compiler-frame")
      ?.contentWindow?.compilerIssue21Proof?.errors ?? [],
    previewErrors: await preview.proof<string[]>("snapshot", { name: "errors" }),
  };
  if (Object.values(unexpectedErrors).some(errors => errors.length !== 0) ||
      preview.compileDiagnostics.length !== 0) {
    throw new Error("Issue 023 unexpected error channel is not empty.");
  }
  const externalResourceRequests = performance.getEntriesByType("resource")
    .map(entry => entry.name)
    .filter(name => /^https?:/i.test(name) && new URL(name).origin !== window.location.origin);
  if (externalResourceRequests.length !== 0) {
    throw new Error("Issue 023 observed an external resource request.");
  }

  await invoke("issue023_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE023_PROOF=1",
      proofWaitSeconds: 20,
      proofRuntimeReadiness,
      previewFrameReadiness: preview.frameReadiness,
      ids: {
        compileId: preview.compileId,
        previewId: preview.previewId,
        compileCorrelationId: preview.compileCorrelationId,
        loadCorrelationId: preview.loadCorrelationId,
        startCorrelationId: preview.startCorrelationId,
      },
      protocol: {
        loadResponse: preview.loadResponse,
        startResponse: preview.startResponse,
        startedEvent: preview.startedEvent,
        wireOrder: preview.wireOrder,
        lifecycleEvents: childProof?.events,
        synchronousFailure,
        runtimeLifecycleCases,
      },
      runtime: {
        compilerRuntimeStarts: preview.compilerRuntimeStarts,
        previewRuntimeStarts: preview.previewRuntimeStarts,
        topLevelFrames: window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved,
        initialState,
        firstManaged,
        secondManaged,
        frameDelta: secondFrames - firstFrames,
      },
      rendering: {
        expectedRgba: [100, 149, 237, 255],
        firstSample,
        secondSample,
        separationMilliseconds: secondSample.sampledAt - firstSample.sampledAt,
      },
      transfer: preview.transfer,
      observationWindow: {
        retainedAtReport: secondManaged.retainedGame,
        disposedAtReport: secondManaged.disposed,
        cleanupScheduledAfterReportMilliseconds: 18_000,
      },
      diagnostics: {
        ...unexpectedErrors,
        externalResourceRequests,
        socketClaim: "not observed in renderer; verify externally during proofWaitSeconds",
      },
    }),
  });
  window.setTimeout(() => {
    void preview.teardown().then(teardown =>
      invoke("issue023_emit_checkpoint", {
        checkpoint: JSON.stringify({ stage: "post-report-cleanup", teardown }),
      })).catch(error =>
      invoke("issue023_emit_checkpoint", {
        checkpoint: JSON.stringify({
          stage: "post-report-cleanup-failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      }));
  }, 18_000);
}

// ── Cooperative stop of a yielding loop (former issue24) ──
const cooperativeStopSource = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Graphics;
using Microsoft.Xna.Framework.Audio;
using System.Threading;

public sealed class CooperativeStopGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _frameCount;
    private static int _updateCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;
    private static int _audioCreateCount;
    private static int _audioPlayCount;
    private static int _audioDisposeCount;
    private SoundEffect _sound;

    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int UpdateCount => Volatile.Read(ref _updateCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount => Volatile.Read(ref _callbackAfterDisposedCount);
    public static int AudioCreateCount => Volatile.Read(ref _audioCreateCount);
    public static int AudioPlayCount => Volatile.Read(ref _audioPlayCount);
    public static int AudioDisposeCount => Volatile.Read(ref _audioDisposeCount);

    public CooperativeStopGame()
    {
        _graphics = new GraphicsDeviceManager(this);
        Content.RootDirectory = "Content";
    }

    protected override void LoadContent()
    {
        _sound = new SoundEffect(new byte[1600], 8000, AudioChannels.Mono);
        Interlocked.Increment(ref _audioCreateCount);
        if (_sound.Play()) Interlocked.Increment(ref _audioPlayCount);
        base.LoadContent();
    }

    protected override void Update(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        Interlocked.Increment(ref _updateCount);
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Exchange(ref _disposed, 1);
            Interlocked.Increment(ref _disposeCount);
            if (_sound != null)
            {
                _sound.Dispose();
                Interlocked.Increment(ref _audioDisposeCount);
                _sound = null;
            }
        }
        base.Dispose(disposing);
    }
}`;

// Proof Run/Stop control: renders the fixed cooperative-stop source in the
// isolated preview window so the issue 024 stop proof stays deterministic.
function createProofRunStopController() {
  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const stopButton = document.querySelector<HTMLButtonElement>("#stop-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!runButton || !stopButton || !status)
    throw new Error("Issue 024 Run/Stop control is missing.");
  const controller = createRunStopController<Issue23RunningPreview>({
    start: () => compileLoadStartIssue23({
      assemblyName: "Issue024ProofGame",
      sourcePath: "src/CooperativeStopGame.cs",
      sourceText: cooperativeStopSource,
      proofMode: true,
      issue024Proof: true,
    }),
    stop: (preview, reason) => preview.stop(reason),
    observeFailure: preview => preview.failure,
    setRunDisabled: disabled => { runButton.disabled = disabled; },
    setStopDisabled: disabled => { stopButton.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    reportError: error => { console.error("Clear-color Game lifecycle failed", error); },
  });
  return { controller, runButton, stopButton, status };
}

export async function runIssue024AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue024_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  const { controller, runButton, stopButton, status } = createProofRunStopController();
  const preview = await controller.run() as Issue23RunningPreview;
  const deadline = performance.now() + 10_000;
  let running = await preview.query();
  while (Number(running.frameCount) < 3 && performance.now() < deadline) {
    await wait(50);
    running = await preview.query();
  }
  if (Number(running.frameCount) < 3) throw new Error("Issue 024 game did not begin drawing.");

  const firstStop = controller.stop();
  const duplicateStop = controller.stop();
  const duplicateResolvedToSameOperation = firstStop === duplicateStop;
  const stopped = await firstStop as {
    elapsedMilliseconds: number;
    iframeConnected: boolean;
    portClosed: boolean;
    wasConnectedAtStopped: boolean;
    revokedObjectUrls: number;
    objectUrlsUnavailable: boolean;
    wireOrder: string[];
    stoppedEvent?: { payload?: { reason?: string } };
    runtime?: Record<string, unknown>;
  };
  const runtime = stopped.runtime as {
    stop?: {
      frameCount?: number;
      disposeAttempts?: number;
      proofDisposeCount?: number;
      quiescent?: {
        frameCount?: number;
        updateCount?: number;
        disposeCount?: number;
        callbackAfterDisposedCount?: number;
        audioCreateCount?: number;
        audioPlayCount?: number;
        audioDisposeCount?: number;
      };
    };
    animationFrameCancellations?: number;
    webglDeleteCalls?: number;
    audioCloseCalls?: number;
  } | null;
  const managed = runtime?.stop;
  const quiescent = managed?.quiescent;
  if (!duplicateResolvedToSameOperation ||
      stopped.elapsedMilliseconds >= 2_000 ||
      stopped.iframeConnected !== false ||
      stopped.portClosed !== true ||
      stopped.wasConnectedAtStopped !== true ||
      stopped.revokedObjectUrls !== 1 ||
      stopped.objectUrlsUnavailable !== true ||
      stopped.wireOrder.filter(type => type !== "preview.output").join(",") !==
        "preview.stop.response,preview.stopped" ||
      stopped.stoppedEvent?.payload?.reason !== "requested" ||
      managed?.proofDisposeCount !== 1 ||
      quiescent?.disposeCount !== 1 ||
      quiescent?.callbackAfterDisposedCount !== 0 ||
      quiescent?.audioCreateCount !== 1 ||
      quiescent?.audioPlayCount !== 1 ||
      quiescent?.audioDisposeCount !== 1 ||
      quiescent?.frameCount !== managed.frameCount ||
      managed?.disposeAttempts !== 1) {
    throw new Error(`Issue 024 cooperative stop proof failed: ${JSON.stringify(stopped)}`);
  }

  await invoke("issue024_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE024_PROOF=1",
      proofRuntimeReadiness,
      running,
      stop: stopped,
      assertions: {
        cancellationOwnershipInvariants:
          managed.disposeAttempts === 1 && quiescent.frameCount === managed.frameCount,
        cancellationEvidenceKind:
          "external invariants: one Dispose-owned cancellation transition, stable managed callbacks, and one stopped event; Emscripten internal call is not directly exported",
        noDrawAfterStop: quiescent.frameCount === managed.frameCount,
        disposalExactlyOnce: quiescent.disposeCount === 1,
        noCallbackIntoDisposedState: quiescent.callbackAfterDisposedCount === 0,
        webglCleanupCallsObserved: runtime?.webglDeleteCalls ?? 0,
        audioCloseCallsObserved: runtime?.audioCloseCalls ?? 0,
        managedAudioResourceCreated: quiescent.audioCreateCount,
        managedAudioPlayAccepted: quiescent.audioPlayCount,
        managedAudioResourceDisposed: quiescent.audioDisposeCount,
        eventOrdering: stopped.wireOrder.join(","),
        frontendRecovered:
          controller.state === "idle" &&
          !runButton.disabled &&
          stopButton.disabled &&
          status.textContent === "Preview stopped; editor controls recovered.",
        duplicateResolvedToSameOperation,
        iframeRemoved: stopped.iframeConnected === false,
        portClosed: stopped.portClosed === true,
        objectUrlRevokedCount: stopped.revokedObjectUrls,
        objectUrlsUnavailable: stopped.objectUrlsUnavailable,
        underTwoSeconds: stopped.elapsedMilliseconds < 2_000,
      },
    }),
  });
}

// ── Restart preview with clean static state (former issue25) ──
const cleanStateSource = `
using Microsoft.Xna.Framework;
using Microsoft.Xna.Framework.Audio;
using System.Threading;

public sealed class CleanStateGame : Game
{
    private readonly GraphicsDeviceManager _graphics;
    private static int _staticConstructorCount;
    private static int _runCount;
    private static int _frameCount;
    private static int _disposeCount;
    private static int _disposed;
    private static int _callbackAfterDisposedCount;
    private static int _audioCreateCount;
    private static int _audioPlayCount;
    private static int _audioDisposeCount;
    private SoundEffect _sound;

    static CleanStateGame() { Interlocked.Increment(ref _staticConstructorCount); }

    public CleanStateGame()
    {
        Interlocked.Increment(ref _runCount);
        _graphics = new GraphicsDeviceManager(this);
    }

    public static int StaticConstructorCount => Volatile.Read(ref _staticConstructorCount);
    public static int RunCount => Volatile.Read(ref _runCount);
    public static int FrameCount => Volatile.Read(ref _frameCount);
    public static int DisposeCount => Volatile.Read(ref _disposeCount);
    public static int CallbackAfterDisposedCount => Volatile.Read(ref _callbackAfterDisposedCount);
    public static int AudioCreateCount => Volatile.Read(ref _audioCreateCount);
    public static int AudioPlayCount => Volatile.Read(ref _audioPlayCount);
    public static int AudioDisposeCount => Volatile.Read(ref _audioDisposeCount);

    protected override void LoadContent()
    {
        _sound = new SoundEffect(new byte[1600], 8000, AudioChannels.Mono);
        Interlocked.Increment(ref _audioCreateCount);
        if (_sound.Play()) Interlocked.Increment(ref _audioPlayCount);
        base.LoadContent();
    }

    protected override void Update(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        base.Update(gameTime);
    }

    protected override void Draw(GameTime gameTime)
    {
        if (Volatile.Read(ref _disposed) != 0)
            Interlocked.Increment(ref _callbackAfterDisposedCount);
        GraphicsDevice.Clear(Color.CornflowerBlue);
        Interlocked.Increment(ref _frameCount);
        base.Draw(gameTime);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Interlocked.Exchange(ref _disposed, 1);
            Interlocked.Increment(ref _disposeCount);
            if (_sound != null)
            {
                _sound.Dispose();
                Interlocked.Increment(ref _audioDisposeCount);
                _sound = null;
            }
        }
        base.Dispose(disposing);
    }
}`;

const start = () => compileLoadStartIssue23({
  assemblyName: "Issue025CleanStateGame",
  sourcePath: "src/CleanStateGame.cs",
  sourceText: cleanStateSource,
  proofMode: true,
  issue024Proof: true,
});

async function waitForFrames(preview: Issue23RunningPreview) {
  const deadline = performance.now() + 10_000;
  let state = await preview.query();
  while (Number(state.frameCount) < 3 && performance.now() < deadline) {
    await wait(50);
    state = await preview.query();
  }
  if (state.runCount !== 1 || state.staticConstructorCount !== 1 ||
      Number(state.frameCount) < 3) {
    throw new Error(`Fresh managed state was not observed: ${JSON.stringify(state)}`);
  }
  return state;
}

function assertCleanup(stop: Record<string, unknown>) {
  const runtime = stop.runtime as {
    stop?: {
      disposeAttempts?: number;
      quiescent?: {
        disposeCount?: number;
        callbackAfterDisposedCount?: number;
        audioCreateCount?: number;
        audioPlayCount?: number;
        audioDisposeCount?: number;
      };
    };
    webglDeleteCalls?: number;
    audioCloseCalls?: number;
  };
  const quiescent = runtime.stop?.quiescent;
  if (Number(stop.elapsedMilliseconds) >= 2_000 ||
      stop.iframeConnected !== false ||
      stop.portClosed !== true ||
      stop.wasConnectedAtStopped !== true ||
      stop.revokedObjectUrls !== 1 ||
      stop.objectUrlsUnavailable !== true ||
      (stop.wireOrder as string[]).filter(type => type !== "preview.output").join(",") !==
        "preview.stop.response,preview.stopped" ||
      runtime.stop?.disposeAttempts !== 1 ||
      quiescent?.disposeCount !== 1 ||
      quiescent?.callbackAfterDisposedCount !== 0 ||
      quiescent?.audioCreateCount !== 1 ||
      quiescent?.audioPlayCount !== 1 ||
      quiescent?.audioDisposeCount !== 1 ||
      Number(runtime.webglDeleteCalls) < 1 ||
      Number(runtime.audioCloseCalls) < 1) {
    throw new Error(`Restart cleanup failed: ${JSON.stringify(stop)}`);
  }
}

async function identity(preview: Issue23RunningPreview, managed: Record<string, unknown>) {
  const proof = await preview.proof<{
    autoReadyPing?: { runtimeIdentity?: unknown };
  }>("snapshot", { name: "proof" });
  const runtimeIdentity = proof.autoReadyPing?.runtimeIdentity;
  if (typeof runtimeIdentity !== "string") {
    throw new Error("Fresh preview runtime identity is unavailable.");
  }
  return {
    previewId: preview.previewId,
    contextGeneration: preview.contextGeneration,
    portIdentity: preview.portIdentity,
    frameDomIdentity: preview.frameDomIdentity,
    contentWindowIdentity: preview.contentWindowIdentity,
    documentUrl: preview.documentUrl,
    runtimeIdentity,
    previousIframeRemovedBeforeCreation: preview.previousIframeRemovedBeforeCreation,
    previewRuntimeStarts: preview.previewRuntimeStarts,
    runCount: managed.runCount,
    staticConstructorCount: managed.staticConstructorCount,
    frameCount: managed.frameCount,
    errors: await preview.proof<string[]>("snapshot", { name: "errors" }),
  };
}

export async function runIssue025AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue025_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  const controller = createRunStopController({
    start,
    stop: (preview, reason) => preview.stop(reason),
    setRunDisabled() {},
    setStopDisabled() {},
    setStatus() {},
    reportError() {},
  });

  const firstRun = controller.run();
  const duplicateFirstRun = controller.run();
  const duplicateRunCoalesced = firstRun === duplicateFirstRun;
  const first = await firstRun;
  const firstManaged = await waitForFrames(first);
  const identities = [await identity(first, firstManaged)];
  const stopped: Record<string, unknown>[] = [];
  const staleChecks: Record<string, unknown>[] = [];

  const stopAndObserve = async (preview: Issue23RunningPreview, stopOperation: Promise<unknown>) => {
    const result = await stopOperation as Record<string, unknown>;
    assertCleanup(result);
    const observations = { ...preview.client.observations };
    await wait(100);
    const unchanged = Object.entries(observations).every(
      ([key, value]) =>
        preview.client.observations[key as keyof typeof preview.client.observations] === value);
    staleChecks.push({
      iframeRemoved: !preview.frame.isConnected,
      portClosed: preview.client.isClosed,
      observationsUnchangedAfterRetirement: unchanged,
    });
    stopped.push(result);
    return result;
  };

  await stopAndObserve(first, controller.stop());

  const second = await controller.run();
  const secondManaged = await waitForFrames(second);
  identities.push(await identity(second, secondManaged));
  const secondStop = controller.stop();
  const thirdRun = controller.run();
  const duplicateThirdRun = controller.run();
  const queuedRunCoalesced = thirdRun === duplicateThirdRun;
  await stopAndObserve(second, secondStop);
  const third = await thirdRun;
  const thirdManaged = await waitForFrames(third);
  identities.push(await identity(third, thirdManaged));
  await stopAndObserve(third, controller.stop());

  const distinct = (key: keyof typeof identities[number]) =>
    new Set(identities.map(value => value[key])).size === identities.length;
  const noConsoleErrors =
    window.__MONOGAME_DIAGNOSTICS__.consoleErrors.length === 0 &&
    identities.every(value => value.errors.length === 0);
  if (!duplicateRunCoalesced || !queuedRunCoalesced ||
      !identities.every(value =>
        value.runCount === 1 &&
        value.staticConstructorCount === 1 &&
        value.previewRuntimeStarts === 1 &&
        value.previousIframeRemovedBeforeCreation) ||
      !distinct("previewId") ||
      !distinct("contextGeneration") ||
      !distinct("portIdentity") ||
      !distinct("frameDomIdentity") ||
      !distinct("contentWindowIdentity") ||
      !distinct("documentUrl") ||
      !distinct("runtimeIdentity") ||
      !staleChecks.every(value =>
        value.iframeRemoved && value.portClosed && value.observationsUnchangedAfterRetirement) ||
      !noConsoleErrors ||
      controller.state !== "idle") {
    throw new Error(`Issue 025 restart assertions failed: ${JSON.stringify({
      identities, staleChecks, duplicateRunCoalesced, queuedRunCoalesced, noConsoleErrors,
    })}`);
  }

  await invoke("issue025_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE025_PROOF=1",
      proofRuntimeReadiness,
      cycles: identities.map((value, index) => ({
        ...value,
        stop: stopped[index],
        staleAfterRetirement: staleChecks[index],
      })),
      raceEvidence: { duplicateRunCoalesced, queuedRunCoalesced },
      assertions: {
        everyRuntimeRunCountOne: true,
        everyStaticConstructorCountOne: true,
        distinctIframeDomIdentities: true,
        distinctContentWindowIdentities: true,
        distinctContextGenerations: true,
        distinctPorts: true,
        distinctPreviewIds: true,
        distinctRuntimeIdentities: true,
        previousRemovedBeforeNextCreation: true,
        noStaleEventsOrCallbacks: true,
        noConsoleErrors,
        issue024CleanupEveryCycle: true,
        controllerRecovered: true,
      },
    }),
  });
}

// ── Compile+run two files with cross-file calls (former issue30) ──
const gamePath = "tests/compiler/fixtures/cross-file/Game1.cs";
const playerPath = "tests/compiler/fixtures/cross-file/Player.cs";
const outputText = "issue030-cross-file:value=42;color=LimeGreen";
const limeGreenRgba = [50, 205, 50, 255];
const sources = [
  { path: gamePath, text: game1Text },
  { path: playerPath, text: playerText },
];

export async function runIssue030AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue030_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  if (!game1Text.includes("_player.CrossFileValue()") ||
      !playerText.includes("CrossFileValue() => 42"))
    throw new Error("Packaged cross-file fixtures do not match the repository sources.");

  const assemblyName = "Issue030CrossFileDeterministic";
  const first = await compileSourcesThroughPersistentCompiler({
    assemblyName, sources, primarySourcePath: gamePath,
  });
  const repeated = await compileSourcesThroughPersistentCompiler({
    assemblyName, sources, primarySourcePath: gamePath,
  });
  const reversed = await compileSourcesThroughPersistentCompiler({
    assemblyName, sources: [...sources].reverse(), primarySourcePath: gamePath,
  });
  const deterministic = [first, repeated, reversed];
  if (deterministic.some(result => result.success !== true) ||
      deterministic.some(result =>
        (result.diagnostics as unknown[])?.length !== 0) ||
      new Set(deterministic.map(result => result.compileId)).size !== 3 ||
      new Set(deterministic.map(result => result.assemblySha256)).size !== 1 ||
      new Set(deterministic.map(result => result.pdbSha256)).size !== 1)
    throw new Error(`Two-file deterministic compilation failed: ${JSON.stringify(deterministic)}`);

  const brokenPlayer = playerText.replace(
    "public int CrossFileValue() => 42;",
    "public MissingType CrossFileValue() => null;",
  );
  if (brokenPlayer === playerText) throw new Error("Player error fixture generation failed.");
  const deliberateError = await compileSourcesThroughPersistentCompiler({
    assemblyName: "Issue030PlayerDiagnostic",
    sources: [
      { path: gamePath, text: game1Text },
      { path: playerPath, text: brokenPlayer },
    ],
    primarySourcePath: gamePath,
  });
  const error = deliberateError.error as {
    code?: string;
    diagnostics?: Array<{
      id?: string;
      file?: string;
      line?: number;
      column?: number;
      severity?: string;
    }>;
  };
  const target = error?.diagnostics?.find(diagnostic => diagnostic.id === "CS0246");
  if (deliberateError.success !== false || error?.code !== "COMPILE_FAILED" ||
      target?.file !== playerPath || target.line !== 5 || target.column !== 12 ||
      target.severity !== "error" ||
      error.diagnostics?.some(diagnostic => diagnostic.file === gamePath))
    throw new Error(`Player diagnostic attribution failed: ${JSON.stringify(deliberateError)}`);

  const duplicatePath = await compileSourcesThroughPersistentCompiler({
    assemblyName: "Issue030DuplicatePath",
    sources: [
      { path: gamePath, text: game1Text },
      { path: gamePath, text: playerText },
    ],
    primarySourcePath: gamePath,
  });
  if (duplicatePath.success !== false ||
      (duplicatePath.error as { code?: string })?.code !== "MALFORMED_PAYLOAD")
    throw new Error(`Duplicate logical path was accepted: ${JSON.stringify(duplicatePath)}`);

  const runButton = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const stopButton = document.querySelector<HTMLButtonElement>("#stop-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!runButton || !stopButton || !status)
    throw new Error("Production Run/Stop controls are unavailable.");
  const controller = createRunStopController({
    start: () => compileLoadStartIssue23({
      assemblyName,
      sourcePath: gamePath,
      sourceText: game1Text,
      sources,
      primarySourcePath: gamePath,
      proofMode: true,
      issue024Proof: true,
      issue030Proof: true,
    }),
    stop: (preview, reason) => preview.stop(reason),
    observeFailure: preview => preview.failure,
    setRunDisabled: disabled => { runButton.disabled = disabled; },
    setStopDisabled: disabled => { stopButton.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    reportError: failure => { console.error("Issue 030 lifecycle failed", failure); },
  });
  const preview = await controller.run();
  const deadline = performance.now() + 10_000;
  let state = await preview.query();
  let pixels = await preview.proof<Record<string, unknown>>(
    "snapshot", { name: "pixels" });
  while ((Number(state.frameCount) < 3 ||
      !(pixels?.samples as number[][] | undefined)?.some(sample =>
        sample.every((value, index) => value === limeGreenRgba[index]))) &&
      performance.now() < deadline) {
    await wait(50);
    state = await preview.query();
    pixels = await preview.proof<Record<string, unknown>>(
      "snapshot", { name: "pixels" });
  }
  const managedLines = preview.outputEvents.filter(event =>
    event.payload.source === "managed" &&
    event.payload.stream === "stdout" &&
    event.payload.category === "console" &&
    event.payload.text === outputText);
  const acceptanceErrors = {
    console: [...window.__MONOGAME_DIAGNOSTICS__.consoleErrors],
    unhandled: [...window.__MONOGAME_DIAGNOSTICS__.unhandledErrors],
    preview: [...((await preview.proof<{ errors?: string[] }>(
      "snapshot", { name: "issue21" })).errors ?? [])],
  };
  const sourcePaths = preview.binaryProof.sourcePaths;
  if (preview.compileDiagnostics.length !== 0 ||
      preview.binaryProof.assemblySha256 !== first.assemblySha256 ||
      preview.binaryProof.pdbSha256 !== first.pdbSha256 ||
      sourcePaths.length !== 2 ||
      sourcePaths[0] !== gamePath || sourcePaths[1] !== playerPath ||
      preview.managedLoad?.documentCount !== 2 ||
      preview.managedLoad.expectedSourcePaths?.join(",") !== `${gamePath},${playerPath}` ||
      preview.compilerRuntimeStarts !== 1 ||
      managedLines.length !== 1 ||
      !(pixels?.samples as number[][] | undefined)?.some(sample =>
        sample.every((value, index) => value === limeGreenRgba[index])) ||
      (pixels?.errors as unknown[] | undefined)?.length !== 0)
    throw new Error(`Packaged cross-file runtime evidence failed: ${JSON.stringify({
      preview, state, pixels, managedLines,
    })}`);
  if (Object.values(acceptanceErrors).some(errors => errors.length !== 0))
    throw new Error(`Unexpected issue-030 error channels: ${JSON.stringify(acceptanceErrors)}`);

  const stop = await controller.stop() as {
    elapsedMilliseconds?: number;
    iframeConnected?: boolean;
    portClosed?: boolean;
    runtime?: {
      stop?: {
        disposeAttempts?: number;
        proofDisposeCount?: number;
        frameCount?: number;
        quiescent?: {
          frameCount?: number;
          disposeCount?: number;
          callbackAfterDisposedCount?: number;
        };
      };
    };
  };
  const stopped = stop.runtime?.stop;
  if (stopped?.disposeAttempts !== 1 || stopped.proofDisposeCount !== 1 ||
      stopped.quiescent?.disposeCount !== 1 ||
      stopped.quiescent.callbackAfterDisposedCount !== 0 ||
      stopped.frameCount !== stopped.quiescent.frameCount ||
      stop.iframeConnected !== false || stop.portClosed !== true ||
      Number(stop.elapsedMilliseconds) >= 2_000 ||
      controller.state !== "idle" || runButton.disabled || !stopButton.disabled)
    throw new Error(`Cross-file cleanup/recovery failed: ${JSON.stringify(stop)}`);

  await invoke("issue030_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE030_PROOF=1",
      proofRuntimeReadiness,
      fixtures: {
        paths: [gamePath, playerPath],
        sourceCount: 2,
        playerDiagnostic: target,
      },
      deterministic,
      duplicatePath,
      runtime: {
        compileId: preview.compileId,
        previewId: preview.previewId,
        compilerRuntimeStarts: preview.compilerRuntimeStarts,
        frameReadiness: preview.frameReadiness,
        binaryProof: preview.binaryProof,
        managedLoad: preview.managedLoad,
        state,
        managedOutput: managedLines[0],
        pixelProof: pixels,
        acceptanceErrors,
        stop,
      },
      assertions: {
        oneAssemblyForTwoSources: true,
        distinctCompileCorrelationsNoStaleReuse: true,
        reversedOrderDeterministic: true,
        portablePdbContainsBothPaths: true,
        playerDiagnosticExact: true,
        duplicatePathRejected: true,
        runtimeCrossFileCallObserved: true,
        actualLimeGreenFramebufferPixel: true,
        oneTimeManagedOutput: true,
        cleanupExactlyOnce: true,
        editorControlsRecovered: true,
      },
    }),
  });
}

// Single durable-scenario entrypoint. Orchestrates the shared load/transfer
// proof plus the four compile→run→stop→rerun sub-proofs. Each sub-proof
// self-gates on its own `issueNN_is_proof_enabled` env flag and emits its own
// success report; this driver owns per-sub-proof failure reporting.
export async function runCompileRunStopScenario(): Promise<void> {
  const subProofs: SubProof[] = [
    {
      label: "shared runtime load/transfer (issue021)",
      reportCommand: "issue021_emit_report",
      run: runIssue021AutoProof,
      buildFailure: error => ({
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        failure: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack ?? error.message : String(error),
        },
        diagnostics: window.__MONOGAME_DIAGNOSTICS__,
      }),
    },
    { label: "clear-color async retention (issue023)", reportCommand: "issue023_emit_report", run: runIssue023AutoProof },
    { label: "cooperative stop (issue024)", reportCommand: "issue024_emit_report", run: runIssue024AutoProof },
    { label: "restart clean static state (issue025)", reportCommand: "issue025_emit_report", run: runIssue025AutoProof },
    { label: "cross-file compile+run (issue030)", reportCommand: "issue030_emit_report", run: runIssue030AutoProof },
  ];
  await runScenario(subProofs);
}

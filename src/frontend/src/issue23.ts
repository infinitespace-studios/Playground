import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
  type Issue23RunningPreview,
} from "./issue21";
import { createIssue023RunController } from "./issue23-controller";

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

const wait = (milliseconds: number) =>
  new Promise(resolve => window.setTimeout(resolve, milliseconds));

async function samplePixels(preview: Issue23RunningPreview): Promise<PixelSample> {
  const childDocument = preview.frame.contentDocument;
  const canvas = childDocument?.querySelector<HTMLCanvasElement>("#canvas");
  if (!canvas) throw new Error("Issue 023 preview canvas is unavailable.");
  await new Promise<void>(resolve =>
    preview.frame.contentWindow?.requestAnimationFrame(() => resolve()));
  const gl = canvas.getContext("webgl2");
  if (!gl || gl.drawingBufferWidth < 1 || gl.drawingBufferHeight < 1 ||
      canvas.width < 1 || canvas.height < 1) {
    throw new Error("Issue 023 preview canvas has no usable WebGL backing store.");
  }
  const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.finish();
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const points = [
    [Math.floor(width / 2), Math.floor(height / 2)],
    [1, 1],
    [Math.max(0, width - 2), 1],
    [1, Math.max(0, height - 2)],
    [Math.max(0, width - 2), Math.max(0, height - 2)],
  ];
  const pixels = points.map(([x, y]) => {
    const pixel = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return [...pixel];
  });
  const glError = gl.getError();
  gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
  return {
    sampledAt: performance.now(),
    canvasBacking: { width: canvas.width, height: canvas.height },
    drawingBuffer: { width, height },
    pixels,
    glError,
    contextLost: gl.isContextLost(),
  };
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

export function installIssue023RunControl(): void {
  const button = document.querySelector<HTMLButtonElement>("#run-clear-color");
  const status = document.querySelector<HTMLElement>("#run-clear-color-status");
  if (!button || !status) throw new Error("Issue 023 Run control is missing.");
  const controller = createIssue023RunController({
    start: () => startClearColorGame(false),
    setDisabled: disabled => { button.disabled = disabled; },
    setStatus: (state, text) => {
      status.dataset.state = state;
      status.textContent = text;
    },
    reportError: error => { console.error("Clear-color Game start failed", error); },
  });
  button.addEventListener("click", () => { void controller.run().catch(() => {}); });
}

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
    await startClearColorGame(false, `
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
  const failureEvents = failure.preview?.events ?? [];
  if (failure.wireOrder?.join(",") !==
      "preview.start.response,preview.failed,preview.stopped" ||
      failureEvents.map(event => event.type).join(",") !== "preview.failed,preview.stopped" ||
      failureEvents[0]?.sequence !== 1 || failureEvents[1]?.sequence !== 2 ||
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
      throw new Error("Requester timeout did not force retirement within two seconds.");
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
    if (!proof ||
        (proof.elapsedMilliseconds ?? 2_000) >= 2_000 ||
        proof.clientObservations?.discardedUnknownOrLate !== 2 ||
        proof.clientObservations?.terminalResponses !== 1 ||
        proof.clientObservations?.lifecycleEvents !== 0 ||
        proof.endpointSnapshot?.terminals?.length !== 2 ||
        proof.endpointSnapshot.lifecycleEvents?.map(event => event.type).join(",") !==
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

  const managedSelfTest = await preview.frame.contentWindow?.previewIssue023RunnerSelfTest?.();
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
      preview.wireOrder.join(",") !== "preview.start.response,preview.started") {
    throw new Error("Issue 023 asynchronous retention assertions failed.");
  }

  const child = preview.frame.contentWindow as (Window & {
    previewProof?: { errors: string[] };
  }) | null;
  const childProof = child?.previewIssue023Proof;
  const unexpectedErrors = {
    topLevelConsoleErrors: window.__MONOGAME_DIAGNOSTICS__.consoleErrors,
    topLevelUnhandledErrors: window.__MONOGAME_DIAGNOSTICS__.unhandledErrors,
    compilerErrors: document.querySelector<HTMLIFrameElement>("#compiler-frame")
      ?.contentWindow?.compilerIssue21Proof?.errors ?? [],
    previewErrors: [
      ...(child?.previewProof?.errors ?? []),
      ...(child?.previewIssue21Proof?.errors ?? []),
      ...(childProof?.errors ?? []),
    ],
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

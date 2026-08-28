import {
  compileLoadStartIssue23,
  preparePackagedProofRuntime,
  type Issue23RunningPreview,
} from "./issue21";
import { createIssue024RunStopController } from "./issue24-controller";

const sourceText = `
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

const wait = (milliseconds: number) =>
  new Promise<void>(resolve => window.setTimeout(resolve, milliseconds));

const start = () => compileLoadStartIssue23({
  assemblyName: "Issue025CleanStateGame",
  sourcePath: "src/CleanStateGame.cs",
  sourceText,
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
      (stop.wireOrder as string[]).join(",") !== "preview.stop.response,preview.stopped" ||
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

function identity(preview: Issue23RunningPreview, managed: Record<string, unknown>) {
  const child = preview.frame.contentWindow as (Window & {
    previewProof?: { autoReadyPing?: { runtimeIdentity?: unknown }; errors?: string[] };
  }) | null;
  const runtimeIdentity = child?.previewProof?.autoReadyPing?.runtimeIdentity;
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
    errors: [
      ...(child?.previewProof?.errors ?? []),
      ...(child?.previewIssue21Proof?.errors ?? []),
      ...(child?.previewIssue023Proof?.errors ?? []),
    ],
  };
}

export async function runIssue025AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue025_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();
  const controller = createIssue024RunStopController({
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
  const identities = [identity(first, firstManaged)];
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
  identities.push(identity(second, secondManaged));
  const secondStop = controller.stop();
  const thirdRun = controller.run();
  const duplicateThirdRun = controller.run();
  const queuedRunCoalesced = thirdRun === duplicateThirdRun;
  await stopAndObserve(second, secondStop);
  const third = await thirdRun;
  const thirdManaged = await waitForFrames(third);
  identities.push(identity(third, thirdManaged));
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

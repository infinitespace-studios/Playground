// In-page live preview runner (Stage-2 production extraction of the real Run
// flow, formerly `runLivePreviewInPage` in the mixed `issue21.ts`).
//
// The real Run flow renders the user's game in the on-page `#preview-frame`
// panel iframe rather than the isolated WebviewWindow (issue 038). Per the issue
// 052 decision: a same-process sandboxed iframe keeps the issue 033/034 security
// boundary (opaque origin — `sandbox="allow-scripts"` with no
// `allow-same-origin`, so `__TAURI_INTERNALS__` is never injected and no app
// command is reachable) while giving an embedded preview. The tradeoff
// (accepted): an infinite loop inside a single Game.Tick freezes the shared
// thread. Stop is cooperative (issue 024) and removes the iframe after cleanup.
//
// This is production-neutral (no proof markers). It depends only on the shared
// compiler context, protocol validation, and neutral preview-frame helpers. The
// proof-capable in-page runner (`runInPagePreviewForProof`) stays in
// `issue21.ts`; both share this module's compiler context via compiler-context.ts.

import {
  PROTOCOL_VERSION,
  type AssetMountRequest,
  type CompileRequest,
  type Diagnostic,
  type PreviewLoadRequest,
  type PreviewOutput,
  type PreviewStartRequest,
  type PreviewStopRequest,
} from "../../shared/MessageContracts";
import {
  ProtocolPortClient,
  standaloneBuffer,
  validateAssetMountResponse,
  validateCompileResponse,
  validatePreviewLoadResponse,
  validatePreviewLifecycleEvent,
  validatePreviewOutputEvent,
  validatePreviewStartResponse,
  validatePreviewStopResponse,
} from "./protocol";
import {
  createPreviewBridge,
  createPreviewIframe,
  loadPreviewIframe,
} from "./preview-frame";
import {
  compilerClient,
  createUuid,
  ensureContexts,
  getLivePreviewFrame,
  retireInitialPreviewContext,
  setLivePreviewFrame,
} from "./compiler-context";

export interface LivePreviewHandle {
  /** Resolves if the running game reports an unhandled runtime failure. */
  readonly failure: Promise<Record<string, unknown>>;
  /** Cooperatively stop the game and remove the preview iframe. */
  stop: (reason?: "user" | "restart") => Promise<Record<string, unknown>>;
}

/**
 * Compile the given sources and run the resulting game in a fresh sandboxed
 * iframe mounted into the preview panel. Returns a handle exposing the runtime
 * failure promise and a cooperative stop. Fires onDiagnostics (issue 048) and
 * onOutput (issue 049) exactly like the isolated path.
 */
export async function runLivePreviewInPage(input: {
  assemblyName: string;
  sources: readonly { path: string; text: string }[];
  primarySourcePath: string;
  onOutput?: (event: PreviewOutput) => void;
  onDiagnostics?: (diagnostics: readonly Diagnostic[], outcome: "success" | "failure") => void;
  // Issue 052: content assets discovered under the project's Content/ folder,
  // mounted into the preview VFS AFTER load and BEFORE start so
  // Content.Load<T>(...) resolves. `path` is the logical Content-relative path
  // (e.g. "textures/player.png" or "audio/blip.xnb"); `bytes` is a standalone
  // ArrayBuffer transferred to the preview. `.wav` sources must already have
  // been prepared to a ".xnb" path by the caller (issue052-content).
  contentAssets?: readonly { path: string; bytes: ArrayBuffer }[];
  contentRootDirectory?: string;
  // Issue 052: surface a content-mount failure as a labelled Output-panel entry
  // (issue 049), distinct from compile diagnostics (Problems panel).
  onContentError?: (code: string, message: string) => void;
}): Promise<LivePreviewHandle> {
  await ensureContexts(false, true);

  // ── Compile (keep diagnostics on both outcomes for the Problems panel) ──
  const compileId = createUuid();
  const compileCorrelationId = createUuid();
  const compileRequest: CompileRequest = {
    protocolVersion: PROTOCOL_VERSION,
    correlationId: compileCorrelationId,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: input.assemblyName,
      sources: [...input.sources],
      primarySourcePath: input.primarySourcePath,
      timeoutMs: 30_000,
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    },
  };
  const compiled = await compilerClient.request(
    compileRequest,
    "compile.response",
    value => validateCompileResponse(value, compileCorrelationId, compileId, {
      assemblyName: input.assemblyName,
      sourcePaths: input.sources.map(source => source.path),
      primarySourcePath: input.primarySourcePath,
    }),
    [],
    30_000,
  ) as ReturnType<typeof validateCompileResponse>;
  if (!compiled.message.result.success) {
    // Surface diagnostics to the Problems panel before throwing (PRD 8.4: an
    // already-running preview is left untouched — we have not created one yet).
    input.onDiagnostics?.(compiled.message.result.error.diagnostics ?? [], "failure");
    throw new Error(
      `${compiled.message.result.error.code}: ${compiled.message.result.error.message}`);
  }
  const data = compiled.message.result.data;
  input.onDiagnostics?.(data.diagnostics, "success");
  const assembly = standaloneBuffer(new Uint8Array(data.assembly));
  const pdb = standaloneBuffer(new Uint8Array(data.pdb));

  // ── Retire any previous live preview, then mount a fresh sandboxed iframe ──
  await retireInitialPreviewContext();
  const previousLiveFrame = getLivePreviewFrame();
  if (previousLiveFrame && previousLiveFrame.isConnected) {
    previousLiveFrame.remove();
  }
  const canvasFrame = document.getElementById("canvas-frame");
  if (!canvasFrame) throw new Error("Preview panel host (#canvas-frame) is missing.");
  // Hide the "Press Run to start" placeholder while the game is mounted.
  const statusLabel = document.getElementById("preview-context-status");
  if (statusLabel) statusLabel.hidden = true;

  const frame = createPreviewIframe();
  frame.className = "live-preview-frame";
  frame.title = "Running Game (in-page preview)";
  const bridge = createPreviewBridge(frame);
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, createUuid());
  const previewId = createUuid();
  const generation = createUuid();

  const loaded = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Preview iframe load timed out.")), 60_000);
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      const target = frame.contentWindow;
      if (!target) return reject(new Error("Preview contentWindow is unavailable."));
      // Opaque-origin iframe: post with "*" and transfer the protocol + bridge
      // ports. It has no same-origin access and no Tauri bridge (issue 033/034).
      // preview.js's installPrivatePortBootstrap requires issue021Proof (bool)
      // and runGamePipeline:true to actually run the user's Game (not a proof).
      target.postMessage(
        {
          type: "protocol.bootstrap",
          contextGeneration: generation,
          previewId,
          issue021Proof: false,
          runGamePipeline: true,
        },
        "*",
        [channel.port2, bridge.childPort],
      );
      resolve();
    }, { once: true });
  });

  setLivePreviewFrame(frame);
  // Set srcdoc BEFORE appending to the DOM. Appending first fires a `load`
  // event for the initial about:blank document, which a { once: true } listener
  // would consume — the bootstrap would then post to the blank frame and the
  // real preview.js load would never be observed (bridge.ready hangs). This is
  // the order the proven proof paths use.
  loadPreviewIframe(frame);
  canvasFrame.appendChild(frame);

  const retire = () => {
    client.close(new Error("Live preview retired."));
    bridge.close();
    if (frame.isConnected) frame.remove();
    if (getLivePreviewFrame() === frame) setLivePreviewFrame(null);
    // Restore the placeholder label now the panel is empty again.
    const label = document.getElementById("preview-context-status");
    if (label) label.hidden = false;
  };

  try {
    await loaded;
    await bridge.ready;

    // ── Load the compiled binaries (inline transfer, same-process) ──
    const loadCorrelationId = createUuid();
    const loadRequest: PreviewLoadRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: loadCorrelationId,
      type: "preview.load.request",
      payload: { previewId, compileId, assembly, pdb, binaryProof: data.binaryProof },
    };
    const loadResponse = await client.request(
      loadRequest,
      "preview.load.response",
      value => validatePreviewLoadResponse(value, loadCorrelationId, previewId, compileId),
      [assembly, pdb],
    ) as ReturnType<typeof validatePreviewLoadResponse>;
    if (!loadResponse.message.result.success) {
      retire();
      throw new Error(
        `${loadResponse.message.result.error.code}: ${loadResponse.message.result.error.message}`);
    }

    // ── Mount discovered Content/ assets (issue 052) BEFORE start ──
    // Inline transfer over the same in-page protocol port (no Rust relay). Each
    // asset's bytes go through the preview's content-type-aware mount gate
    // (wav->xnb transcode / image sniff / xnb validate). A mount failure aborts
    // the run and surfaces a labelled content error via onDiagnostics (issue 049
    // Output panel), leaving no preview running.
    if (input.contentAssets && input.contentAssets.length > 0) {
      const mountCorrelationId = createUuid();
      const mountId = createUuid();
      const mountAssets = input.contentAssets.map(asset => ({
        path: asset.path,
        bytes: standaloneBuffer(new Uint8Array(asset.bytes)),
      }));
      const mountRequest: AssetMountRequest = {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: mountCorrelationId,
        type: "asset.mount.request",
        payload: {
          previewId,
          mountId,
          contentRootDirectory: input.contentRootDirectory ?? "Content",
          assets: mountAssets,
        },
      };
      const mountResponse = await client.request(
        mountRequest,
        "asset.mount.response",
        value => validateAssetMountResponse(value, mountCorrelationId, previewId, mountId),
        mountAssets.map(asset => asset.bytes),
      ) as ReturnType<typeof validateAssetMountResponse>;
      if (!mountResponse.message.result.success) {
        const error = mountResponse.message.result.error;
        // Surface the content error in the real Output panel (issue 049), then
        // abort the run without starting a game (PRD 8.4/§15: fail clearly, don't
        // render). Also mirror any structured diagnostics to the Problems panel.
        input.onContentError?.(error.code, error.message);
        const diagnostics = (error as { diagnostics?: Diagnostic[] }).diagnostics;
        if (diagnostics && diagnostics.length > 0) input.onDiagnostics?.(diagnostics, "failure");
        retire();
        throw new Error(`${error.code}: ${error.message}`);
      }
    }

    // ── Wire output + runtime-failure listeners (issues 049 / 029) ──
    const startCorrelationId = createUuid();
    let resolveFailure!: (value: Record<string, unknown>) => void;
    const failure = new Promise<Record<string, unknown>>(resolve => { resolveFailure = resolve; });
    let failureCorrelation: string | null = null;
    let runtimeFailedEvent: unknown = null;

    const removeOutput = client.onOutputEvent(message => {
      if (message.correlationId !== startCorrelationId) return;
      const validated = validatePreviewOutputEvent(message, previewId, startCorrelationId);
      input.onOutput?.(validated.message);
    });
    const removeFailure = client.onLifecycleEvent(message => {
      if (message.type === "preview.failed" && message.payload.phase === "running") {
        if (failureCorrelation !== null) return;
        const validated = validatePreviewLifecycleEvent(message, previewId);
        failureCorrelation = validated.message.correlationId;
        runtimeFailedEvent = validated.message;
        return;
      }
      if (message.type !== "preview.stopped" || message.correlationId !== failureCorrelation) return;
      const validated = validatePreviewLifecycleEvent(message, previewId, failureCorrelation);
      removeOutput();
      removeFailure();
      retire();
      resolveFailure({ failedEvent: runtimeFailedEvent, stoppedEvent: validated.message });
    });

    // ── Start the game ──
    const startedPromise = new Promise<unknown>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("preview.started timed out.")), 10_000);
      const removeStarted = client.onLifecycleEvent(message => {
        if (message.correlationId !== startCorrelationId) return;
        const validated = validatePreviewLifecycleEvent(message, previewId, startCorrelationId);
        if (validated.message.type === "preview.started") {
          window.clearTimeout(timer);
          removeStarted();
          resolve(validated.message);
        }
      });
    });
    const startRequest: PreviewStartRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: startCorrelationId,
      type: "preview.start.request",
      payload: { previewId, timeoutMs: 10_000 },
    };
    const startResponse = await client.request(
      startRequest,
      "preview.start.response",
      value => validatePreviewStartResponse(value, startCorrelationId, previewId),
      [],
    ) as ReturnType<typeof validatePreviewStartResponse>;
    if (!startResponse.message.result.success) {
      removeOutput();
      removeFailure();
      retire();
      throw new Error(
        `${startResponse.message.result.error.code}: ${startResponse.message.result.error.message}`);
    }
    await startedPromise;

    // ── Cooperative stop (issue 024) + iframe removal ──
    let stopOperation: Promise<Record<string, unknown>> | null = null;
    const stop = (reason: "user" | "restart" = "user") => {
      if (stopOperation) return stopOperation;
      stopOperation = (async () => {
        const correlationId = createUuid();
        const request: PreviewStopRequest = {
          protocolVersion: PROTOCOL_VERSION,
          correlationId,
          type: "preview.stop.request",
          payload: { previewId, reason, timeoutMs: 2_000 },
        };
        try {
          const response = await client.request(
            request,
            "preview.stop.response",
            value => validatePreviewStopResponse(value, correlationId, previewId),
            [],
            2_000,
          ) as ReturnType<typeof validatePreviewStopResponse>;
          removeOutput();
          removeFailure();
          retire();
          return { correlationId, response: response.message };
        } catch (error) {
          // Even if the cooperative stop times out (e.g. an in-tick hang), tear
          // the iframe down so the panel returns to a clean state.
          removeOutput();
          removeFailure();
          retire();
          throw error instanceof Error ? error : new Error(String(error));
        }
      })();
      return stopOperation;
    };

    return { failure, stop };
  } catch (error) {
    retire();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

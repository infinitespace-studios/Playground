// ── Embedded / in-page preview lifecycle support ────────────────────────────
//
// Proof-only support module (never imported by the product graph). Split out of
// the former mixed scenario-toolkit.ts by responsibility: it owns the embedded
// (in-page) opaque-origin sandboxed-iframe preview lifecycle the proofs mount —
// the SAME transport the shipping product uses (ADR 0003), not the retired
// isolated WebviewWindow bridge. It hosts three related surfaces:
//
//   * runInPagePreviewForProof — rich-handle in-page runner consumed by the
//     security proofs (proof()/query()/outputEvents/managedLoad/stop).
//   * probeInPageNoWasmEvalBoot — the issue-033 negative probe that mounts a
//     no-'wasm-unsafe-eval' CSP iframe and confirms the .NET WASM runtime never
//     boots (the bridge never becomes ready).
//   * createEmbeddedProofPreview — low-level embedded context (protocol client +
//     bridge + generation/previewId + awaitable retire/exists) that leaves
//     binary/asset transfer to the caller INLINE over the protocol port; used
//     by the content-workflow proof and by compileLoadStartIssue23.
//
// It reuses the neutral preview-frame primitives and the shared compiler
// context and never imports scenario-toolkit, so it introduces no import cycle.

import {
  PROTOCOL_VERSION,
  type CompileRequest,
  type PreviewLoadRequest,
  type PreviewOutput,
  type PreviewStartRequest,
  type PreviewStopRequest,
  type UuidV4,
} from "../../shared/MessageContracts";
import {
  ProtocolPortClient,
  standaloneBuffer,
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
  loadPreviewIframeWithoutWasmEval,
  loadPreviewIframe,
  type PreviewBridge,
} from "./preview-frame";
import {
  compilerClient,
  createUuid,
  ensureContexts,
  getLivePreviewFrame,
  retireInitialPreviewContext,
  setLivePreviewFrame,
} from "./compiler-context";

// ── Issue 052 task 3: proof-capable in-page preview runner ──────────────────
//
// Like runLivePreviewInPage but returns the RICH handle the security proofs
// (issues 33/34/35/36) consume — proof()/query()/outputEvents/managedLoad/stop
// — so those proofs can certify the in-page sandboxed-iframe boundary instead
// of the isolated WebviewWindow. Mounts the same opaque-origin sandboxed iframe
// (sandbox="allow-scripts", no allow-same-origin) with the same load-order and
// bootstrap-field fixes; the ONLY difference from the live runner is that it
// bootstraps with issue021Proof:true (authorises the bridge proof surface) plus
// the requested per-issue proof flags, and exposes the proof/query surface.
//
// compileLoadStartIssue23 now also runs in this embedded opaque-origin iframe
// (via createEmbeddedProofPreview); this runner remains additive and is the
// rich-handle variant consumed by the security proofs.

export interface InPageProofPreview {
  readonly previewId: UuidV4;
  readonly outputEvents: PreviewOutput[];
  readonly managedLoad: Record<string, unknown> | null;
  /** Send a bridge action (e.g. "issue033-security", "sample-webgl"). */
  proof<T = unknown>(action: string, payload?: unknown): Promise<T>;
  /** Runtime query (runReturned/frameCount). */
  query(): Promise<Record<string, unknown>>;
  /** Cooperative stop; returns { runtime: <issue024 snapshot>, ... }. */
  stop(reason?: "user" | "restart"): Promise<Record<string, unknown>>;
}

export async function runInPagePreviewForProof(input: {
  assemblyName: string;
  sourcePath: string;
  sourceText: string;
  sources?: readonly { path: string; text: string }[];
  primarySourcePath?: string;
  issue033Proof?: boolean;
  issue034Proof?: boolean;
  issue035Proof?: boolean;
  issue036Proof?: boolean;
}): Promise<InPageProofPreview> {
  await ensureContexts(false, true);

  const compileSources = input.sources ?? [{ path: input.sourcePath, text: input.sourceText }];
  const primarySourcePath = input.primarySourcePath ?? input.sourcePath;
  const compileId = createUuid();
  const compileCorrelationId = createUuid();
  const compileRequest: CompileRequest = {
    protocolVersion: PROTOCOL_VERSION,
    correlationId: compileCorrelationId,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: input.assemblyName,
      sources: [...compileSources],
      primarySourcePath,
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
      sourcePaths: compileSources.map(source => source.path),
      primarySourcePath,
    }),
    [],
    30_000,
  ) as ReturnType<typeof validateCompileResponse>;
  if (!compiled.message.result.success) {
    throw new Error(
      `${compiled.message.result.error.code}: ${compiled.message.result.error.message}`);
  }
  const data = compiled.message.result.data;
  const assembly = standaloneBuffer(new Uint8Array(data.assembly));
  const pdb = standaloneBuffer(new Uint8Array(data.pdb));

  await retireInitialPreviewContext();
  const existingLiveFrame = getLivePreviewFrame();
  if (existingLiveFrame && existingLiveFrame.isConnected) {
    existingLiveFrame.remove();
  }
  const canvasFrame = document.getElementById("canvas-frame");
  if (!canvasFrame) throw new Error("Preview panel host (#canvas-frame) is missing.");
  const statusLabel = document.getElementById("preview-context-status");
  if (statusLabel) statusLabel.hidden = true;

  const frame = createPreviewIframe();
  frame.className = "live-preview-frame";
  frame.title = "Security proof (in-page preview)";
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
      // issue021Proof:true authorises the bridge proof surface (installPreviewBridge);
      // the per-issue flag enables that issue's security probe in preview.js.
      target.postMessage(
        {
          type: "protocol.bootstrap",
          contextGeneration: generation,
          previewId,
          issue021Proof: true,
          issue023Proof: true,
          issue033Proof: input.issue033Proof === true,
          issue034Proof: input.issue034Proof === true,
          issue035Proof: input.issue035Proof === true,
          issue036Proof: input.issue036Proof === true,
          issue024Proof: true,
          runGamePipeline: true,
        },
        "*",
        [channel.port2, bridge.childPort],
      );
      resolve();
    }, { once: true });
  });

  setLivePreviewFrame(frame);
  loadPreviewIframe(frame);
  canvasFrame.appendChild(frame);

  const outputEvents: PreviewOutput[] = [];
  let removeOutput = () => {};
  const retire = () => {
    removeOutput();
    client.close(new Error("Proof preview retired."));
    bridge.close();
    if (frame.isConnected) frame.remove();
    if (getLivePreviewFrame() === frame) setLivePreviewFrame(null);
    const label = document.getElementById("preview-context-status");
    if (label) label.hidden = false;
  };

  try {
    await loaded;
    await bridge.ready;

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

    const startCorrelationId = createUuid();
    removeOutput = client.onOutputEvent(message => {
      if (message.correlationId !== startCorrelationId) return;
      const validated = validatePreviewOutputEvent(message, previewId, startCorrelationId);
      outputEvents.push(validated.message);
    });
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
      retire();
      throw new Error(
        `${startResponse.message.result.error.code}: ${startResponse.message.result.error.message}`);
    }
    await startedPromise;

    const managedLoad =
      (await bridge.request<{ load?: Record<string, unknown> }>("snapshot", { name: "issue21" }))
        .load ?? null;

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
        const stoppedPromise = new Promise<unknown>(resolve => {
          const removeStopped = client.onLifecycleEvent(message => {
            if (message.correlationId !== correlationId || message.type !== "preview.stopped") return;
            validatePreviewLifecycleEvent(message, previewId, correlationId);
            removeStopped();
            resolve(message);
          });
        });
        const response = await client.request(
          request,
          "preview.stop.response",
          value => validatePreviewStopResponse(value, correlationId, previewId),
          [],
          2_000,
        ) as ReturnType<typeof validatePreviewStopResponse>;
        if (response.message.result.success && response.message.result.data.accepted) {
          await Promise.race([
            stoppedPromise,
            new Promise((_, reject) =>
              window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 2_000)),
          ]);
        }
        const runtime = await bridge.request("snapshot", { name: "issue024" });
        retire();
        return { correlationId, response: response.message, runtime };
      })();
      return stopOperation;
    };

    return {
      previewId,
      outputEvents,
      managedLoad,
      proof<T = unknown>(action: string, payload?: unknown) {
        return bridge.request<T>(action, payload);
      },
      async query() {
        return bridge.request<Record<string, unknown>>("issue023-query");
      },
      stop,
    };
  } catch (error) {
    retire();
    throw error instanceof Error ? error : new Error(String(error));
  }
}

/**
 * Issue 052 task 3 (issue 033 negative): mount an in-page sandboxed iframe whose
 * CSP omits `'wasm-unsafe-eval'` and confirm the .NET WASM runtime never boots
 * (the preview bridge never signals ready) within the given window. Returns
 * whether the bridge became ready — the proof asserts it did NOT. Replaces the
 * old isolated-window (`issue038_create_no_wasm_eval_window`) negative path.
 */
export async function probeInPageNoWasmEvalBoot(
  waitMs = 6_000,
): Promise<{ bridgeReady: boolean }> {
  await ensureContexts(false, true);
  const existingLiveFrame = getLivePreviewFrame();
  if (existingLiveFrame && existingLiveFrame.isConnected) {
    existingLiveFrame.remove();
  }
  const canvasFrame = document.getElementById("canvas-frame");
  if (!canvasFrame) throw new Error("Preview panel host (#canvas-frame) is missing.");

  const frame = createPreviewIframe();
  frame.className = "live-preview-frame";
  frame.title = "Security proof negative (no wasm-unsafe-eval)";
  const bridge = createPreviewBridge(frame);
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, createUuid());
  const previewId = createUuid();
  const generation = createUuid();

  let bridgeReady = false;
  void bridge.ready.then(() => { bridgeReady = true; }, () => { /* closed */ });

  frame.addEventListener("load", () => {
    const target = frame.contentWindow;
    if (!target) return;
    target.postMessage(
      {
        type: "protocol.bootstrap",
        contextGeneration: generation,
        previewId,
        issue021Proof: false,
        runGamePipeline: false,
      },
      "*",
      [channel.port2, bridge.childPort],
    );
  }, { once: true });

  setLivePreviewFrame(frame);
  // No-wasm-eval CSP variant; set srcdoc BEFORE append (about:blank load-race).
  loadPreviewIframeWithoutWasmEval(frame);
  canvasFrame.appendChild(frame);

  try {
    // Give WASM instantiation its chance to fail under the stricter CSP.
    await new Promise(resolve => window.setTimeout(resolve, waitMs));
    return { bridgeReady };
  } finally {
    client.close(new Error("No-wasm-eval negative probe retired."));
    bridge.close();
    if (frame.isConnected) frame.remove();
    if (getLivePreviewFrame() === frame) setLivePreviewFrame(null);
    const label = document.getElementById("preview-context-status");
    if (label) label.hidden = false;
  }
}

// ── Embedded (in-page) proof-preview context ───────────────────────────────
//
// Responsibility-named helper that hosts a preview in the SAME embedded
// opaque-origin sandboxed iframe the shipping product uses (ADR 0003) rather
// than the issue-038 isolated WebviewWindow bridge. It reuses the neutral
// preview-frame primitives (`createPreviewIframe`/`createPreviewBridge` with
// `sandbox="allow-scripts"`, no `allow-same-origin`) and the shared compiler
// context, so it does NOT fork or duplicate the production lifecycle/protocol
// logic (`preview.js` is the identical runtime for both transports; only the
// transport differs — a direct in-page MessageChannel here vs. the Rust relay in
// the isolated bridge).
//
// It returns the same low-level surface the content-workflow proof needs
// (protocol client + bridge + previewId/generation + awaitable retire/exists),
// leaving binary/asset transfer to the caller INLINE over the protocol port
// (like `runLivePreviewInPage`), so no Rust transfer store / `issue038_*`
// asset-store command mediation is required (Stage 6 removed those dead
// commands). Unlike `runInPagePreviewForProof`
// it does not auto load/start/stop — the caller drives mount→load→start→stop
// explicitly (content must be mounted after load and before start).
export interface EmbeddedProofPreviewContext {
  readonly generation: string;
  readonly contextGeneration: UuidV4;
  readonly label: string;
  readonly previewId: UuidV4;
  readonly protocolClient: ProtocolPortClient;
  readonly bridge: PreviewBridge;
  readonly retired: boolean;
  /** Wait for the preview runtime to signal readiness (realmToken/opaqueOrigin/runtimeStarts). */
  waitForReady(): Promise<Record<string, unknown>>;
  /**
   * Move DOM focus onto the embedded opaque-origin preview iframe so a trusted
   * platform key event delivered by the native host (issue 040 Space/Escape)
   * lands on the focused preview document rather than the Monaco editor or the
   * host shell. Best-effort and non-throwing; preserves the sandbox/CSP (only
   * the cross-origin-safe `focus()` is used, never same-origin DOM access).
   */
  focusPreviewFrame(): void;
  /** Force-destroy and retire — awaitable, exactly-once. Returns true if the frame existed. */
  forceDestroyAndRetire(reason: unknown): Promise<boolean>;
  /** Whether the preview iframe is still mounted. */
  exists(): Promise<boolean>;
  /** Resolves when the context is retired (by any cause). */
  readonly onRetired: Promise<{ reason: string }>;
}

export async function createEmbeddedProofPreview(opts: {
  previewId?: UuidV4;
  proofFlags?: Record<string, boolean>;
  runtimeCase?: string;
  /**
   * When false, the caller owns preview-frame placement/retirement (e.g. an
   * auxiliary concurrent-start probe): the iframe is appended hidden to
   * <body> and the shared live-preview registry / initial-preview retirement
   * are left untouched. Defaults to true (visible panel preview).
   */
  manageLiveFrame?: boolean;
  /** Issue 041: passive timing hook; never changes control flow. */
  onPhase?: (phase: string, timestamp: number) => void;
  /** Issue 041: passive bootstrap-detail report; never changes control flow. */
  onBootstrapDetail?: (detail: Record<string, unknown>) => void;
  /**
   * Issue 040 only: register this embedded preview's generation with the Rust
   * host as the single authorized embedded input target, so a trusted
   * Space/Escape/click gesture may be dispatched to the main window that hosts
   * this iframe. Registration happens once the iframe has loaded; the exact
   * generation is RETIRED on every retirement/error path. Defaults to false so
   * no other scenario ever registers an input target.
   */
  issue040EmbeddedInput?: boolean;
} = {}): Promise<EmbeddedProofPreviewContext> {
  const mark = (phase: string) => opts.onPhase?.(phase, performance.now());
  const manageLiveFrame = opts.manageLiveFrame !== false;
  await ensureContexts(false, true);
  mark("contexts.ready");
  const contextGeneration = createUuid();
  const previewId = opts.previewId ?? createUuid();
  const generation = contextGeneration.replace(/-/g, "").slice(0, 32);
  const label = `embedded-proof-preview-${generation}`;

  // Retire any previous live preview, then mount a fresh sandboxed iframe into
  // the visible preview panel (WebGL render + rAF progression + audio need a
  // connected, visible frame). Auxiliary probes mount hidden off <body>.
  let canvasFrame: HTMLElement;
  if (manageLiveFrame) {
    await retireInitialPreviewContext();
    const previousLiveFrame = getLivePreviewFrame();
    if (previousLiveFrame && previousLiveFrame.isConnected) previousLiveFrame.remove();
    const host = document.getElementById("canvas-frame");
    if (!host) throw new Error("Preview panel host (#canvas-frame) is missing.");
    canvasFrame = host;
    const statusLabel = document.getElementById("preview-context-status");
    if (statusLabel) statusLabel.hidden = true;
  } else {
    canvasFrame = document.body;
  }

  const frame = createPreviewIframe();
  frame.className = "live-preview-frame";
  frame.title = "Content workflow proof (in-page preview)";
  if (!manageLiveFrame) frame.hidden = true;
  const bridge = createPreviewBridge(frame);
  const channel = new MessageChannel();
  const protocolClient = new ProtocolPortClient(channel.port1, createUuid());

  // Issue 041 passive timing: observe bridge readiness without competing for
  // the message (the caller's own await is the real consumer). Never changes
  // control flow.
  let bridgeReadyObservedAt: number | null = null;
  void bridge.ready.then(
    () => { bridgeReadyObservedAt = performance.now(); mark("preview.bridge.ready.observed"); },
    () => { /* closed before ready */ },
  );

  const loaded = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error("Preview iframe load timed out.")), 60_000);
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      const target = frame.contentWindow;
      if (!target) return reject(new Error("Preview contentWindow is unavailable."));
      // Opaque-origin iframe: post with "*" and transfer the protocol + bridge
      // ports. issue021Proof authorises the bridge proof surface; the per-issue
      // flags enable the relevant probes in preview.js; runGamePipeline runs the
      // user's Game (not a proof shell).
      target.postMessage(
        {
          type: "protocol.bootstrap",
          contextGeneration,
          previewId,
          issue021Proof: opts.proofFlags?.issue021Proof ?? false,
          issue023Proof: opts.proofFlags?.issue023Proof ?? false,
          issue024Proof: opts.proofFlags?.issue024Proof ?? false,
          issue028Proof: opts.proofFlags?.issue028Proof ?? false,
          issue030Proof: opts.proofFlags?.issue030Proof ?? false,
          issue033Proof: opts.proofFlags?.issue033Proof ?? false,
          issue034Proof: opts.proofFlags?.issue034Proof ?? false,
          issue035Proof: opts.proofFlags?.issue035Proof ?? false,
          issue036Proof: opts.proofFlags?.issue036Proof ?? false,
          issue039Proof: opts.proofFlags?.issue039Proof ?? false,
          issue040Proof: opts.proofFlags?.issue040Proof ?? false,
          runGamePipeline: true,
          issue023Case: opts.runtimeCase ?? "normal",
        },
        "*",
        [channel.port2, bridge.childPort],
      );
      resolve();
    }, { once: true });
  });

  if (manageLiveFrame) setLivePreviewFrame(frame);
  // Set srcdoc BEFORE appending (about:blank load-race: appending first fires a
  // load event for the initial document that the { once:true } listener would
  // consume). This is the order the proven in-page paths use.
  loadPreviewIframe(frame);
  canvasFrame.appendChild(frame);
  // Issue 041: "window invoked" == the embedded iframe was created and its
  // srcdoc set (the in-page analogue of the isolated OS-window create call).
  mark("preview.window.invoked");
  mark("preview.window.created");

  await loaded;
  // Issue 041: "window settled" == the iframe document finished loading
  // (in-page analogue of the isolated window's fixed settle wait).
  mark("preview.window.settled");
  mark("preview.runtime.bootstrapped");

  // Retirement lifecycle is defined BEFORE issue-040 input registration so a
  // failed registration can retire the already-mounted iframe (and clear the
  // shared live-frame state) through the exact same teardown path instead of
  // leaking the frame. `inputRegistered` gates the host-side retire call so a
  // never-registered generation is never sent an unmatched `retire` op.
  let retired = false;
  let inputRegistered = false;
  let retiredResolve!: (value: { reason: string }) => void;
  const onRetired = new Promise<{ reason: string }>(resolve => { retiredResolve = resolve; });
  const doRetire = async (reason: string): Promise<boolean> => {
    if (retired) return false;
    retired = true;
    const existed = frame.isConnected;
    // Issue 040 only: retire this exact embedded generation's input
    // authorization on every cleanup/error path, before dropping the frame, so
    // no stale generation can ever remain an authorized input target. Only sent
    // when registration actually succeeded (never an unregistered retire).
    // Scoped to the exact generation and non-throwing so retirement never
    // breaks on it.
    if (opts.issue040EmbeddedInput && inputRegistered) {
      try {
        await window.__TAURI_INTERNALS__?.invoke(
          "issue040_dispatch_preview_input", { op: "retire", generation });
      } catch { /* best-effort; retirement must not fail on host cleanup races */ }
    }
    protocolClient.close(new Error(reason));
    bridge.close();
    if (frame.isConnected) frame.remove();
    if (manageLiveFrame) {
      if (getLivePreviewFrame() === frame) setLivePreviewFrame(null);
      const statusEl = document.getElementById("preview-context-status");
      if (statusEl) statusEl.hidden = false;
    }
    retiredResolve({ reason });
    return existed;
  };

  // Issue 040 only: register this exact embedded generation with the Rust host
  // as the single authorized embedded input target BEFORE any Space/Escape/
  // click gesture can be dispatched. No other scenario registers an input
  // target, so this is not a generic injection primitive. If registration
  // fails, retire the already-mounted iframe (clearing live-frame state) before
  // rethrowing so no orphaned preview or dangling registration survives.
  if (opts.issue040EmbeddedInput) {
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (!invoke) {
      await doRetire("issue040 input registration unavailable");
      throw new Error("Tauri proof runtime is unavailable for issue 040 input registration.");
    }
    try {
      await invoke("issue040_dispatch_preview_input", { op: "register", generation });
      inputRegistered = true;
    } catch (error) {
      await doRetire("issue040 input registration failed");
      throw error;
    }
  }
  opts.onBootstrapDetail?.({
    transport: "embedded-in-page",
    generation,
    previewId,
    readyPromiseResolved: bridgeReadyObservedAt !== null,
    readyPromiseResolvedAtMs: bridgeReadyObservedAt,
  });

  return {
    generation,
    contextGeneration,
    label,
    previewId,
    protocolClient,
    bridge,
    get retired() { return retired; },
    waitForReady() { return bridge.ready; },
    focusPreviewFrame() {
      // Cross-origin-safe: focusing an <iframe> element (and its opaque-origin
      // contentWindow via window.focus()) is permitted across origins and does
      // NOT pierce the sandbox. This shifts the active element to the sandboxed
      // preview so WebKit routes the host's trusted key event to the focused
      // embedded preview document instead of Monaco/host.
      try {
        frame.focus();
        frame.contentWindow?.focus();
      } catch {
        /* focus is best-effort; never break the proof on a focus race */
      }
    },
    async forceDestroyAndRetire(reason: unknown) {
      return doRetire(reason instanceof Error ? reason.message : String(reason));
    },
    async exists() { return frame.isConnected && !retired; },
    onRetired,
  };
}

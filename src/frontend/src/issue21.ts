import {
  PROTOCOL_VERSION,
  type BinaryProof,
  type CompileRequest,
  type Diagnostic,
  type PreviewLoadRequest,
  type PreviewOutput,
  type PreviewStartRequest,
  type PreviewStopRequest,
  type UuidV4,
} from "../../shared/MessageContracts";
import {
  inspectClone,
  ProtocolPortClient,
  sha256,
  standaloneBuffer,
  validateCompileResponse,
  validatePreviewLoadResponse,
  validatePreviewLifecycleEvent,
  validatePreviewOutputEvent,
  validatePreviewStartResponse,
  validatePreviewStopResponse,
} from "./protocol";
import {
  createIssue21LoadController,
  verifyIssue21ProofOutcomes,
} from "./issue21-controller";
import { withForcedPreviewRetirement } from "./issue23-controller";
import {
  createPreviewBridge,
  createPreviewIframe,
  loadIssue033NoWasmEvalPreviewIframe,
  loadPreviewIframe,
  previewBridgeFor,
  type PreviewBridge,
} from "./preview-frame";
import {
  allocContentWindowIdentity,
  allocFrameDomIdentity,
  compilerClient,
  compilerFrame,
  createUuid,
  ensureContexts,
  getLastPrimaryRunFrame,
  getLivePreviewFrame,
  hostTransport,
  initialPreviewBridge,
  isProofModeAuthorized,
  previewClient,
  previewFrame,
  previewGeneration,
  previewId,
  registerContextSetup,
  requiredElement,
  retireInitialPreviewContext,
  setLastPrimaryRunFrame,
  setLivePreviewFrame,
  setProofModeAuthorized,
  waitForTopRuntime,
} from "./compiler-context";

interface ContextProof {
  runtimeStarts: number;
  transfer?: Record<string, unknown>;
  load?: ManagedLoadProof;
  bootstrap?: Record<string, unknown>;
  requests?: Array<Record<string, unknown>>;
  retention?: Record<string, unknown>;
  lastAbort?: Record<string, unknown>;
  state?: string;
  endpoint?: { terminals: string[]; closes: string[] };
  lastManagedFailure?: { mutationStarted: boolean; code: string };
  expectedProbeRejections?: ProbeRejection[];
  expiredProbeExpectations?: ProbeExpectation[];
  errors: string[];
}

interface ProbeExpectation {
  contextGeneration: UuidV4;
  portIdentity: string;
  correlationId: UuidV4;
  requestType: "preview.load.request" | "preview.start.request";
  responseType: "preview.load.response" | "preview.start.response";
  probePhase: string;
  expectedCode: string;
}

interface ProbeRejection extends ProbeExpectation {
  observedCode: string;
}

interface ManagedLoadProof {
  assemblyFullName: string;
  assemblySimpleName: string;
  assemblyByteLength: number;
  pdbByteLength: number;
  documentCount: number;
  visibleSequencePointCount: number;
  logicalPath: string;
  assemblySha256: string;
  pdbSha256: string;
  codeViewGuid: string;
  codeViewStamp: number;
  portablePdbGuid: string;
  portablePdbStamp: number;
  expectedAssemblyName?: string;
  expectedSourcePaths?: string[];
}

interface Issue22PipelineProof {
  success: boolean;
  gameTypeFullName: string | null;
  constructedTypeFullName: string | null;
  assignableToGame: boolean;
  diagnostic: {
    origin: "playground";
    severity: "error";
    id: string;
    message: string;
    file: string;
    line: number;
    column: number;
  } | null;
  error: { code: string; message: string } | null;
  constructionAttempts: number;
  retainedGame: boolean;
}

interface PostMutationTaintProof {
  assemblyLoadCrossed: boolean;
  wrongExpectedAssemblyName: string;
  result: { success: false; error: { code: string; message: string } };
  managedState: string;
  senderDetached: boolean;
  closeReasons: string[];
  subsequentRequestFailure: string;
  retryExpectationRemoved: boolean;
  terminalResponsesBeforeTeardown: number;
  expectedProbeRejections: ProbeRejection[];
}

declare global {
  interface Window {
    compilerIssue21Proof?: ContextProof;
    previewIssue21Proof?: ContextProof;
    previewIssue21RegisterExpectation?: (expectation: ProbeExpectation) => boolean;
    previewIssue21RemoveExpectation?: (correlationId: UuidV4) => boolean;
    previewIssue22Proof?: {
      enabled: boolean;
      pipeline: Issue22PipelineProof | null;
      repeatedPipeline: Issue22PipelineProof | null;
      beforeLoad: Issue22PipelineProof | null;
      repeatMatched: boolean | null;
      teardown: unknown[];
      errors: string[];
    };
    previewIssue22Teardown?: () => Promise<unknown>;
    previewIssue023Proof?: {
      enabled: boolean;
      start: Record<string, unknown> | null;
      events: Array<Record<string, unknown>>;
      queries: Array<Record<string, unknown>>;
      errors: string[];
    };
    previewIssue023Query?: () => Promise<Record<string, unknown>>;
    previewIssue023RunnerSelfTest?: () => Promise<Record<string, unknown>>;
    previewIssue023EndpointSnapshot?: () => Record<string, unknown>;
    previewIssue024Proof?: Record<string, unknown>;
    previewIssue024Snapshot?: () => Record<string, unknown>;
    previewIssue029QuiescentProof?: () => Promise<Record<string, unknown>>;
    previewIssue030PixelProof?: () => Record<string, unknown>;
    previewIssue027WriterSelfTest?: () => Promise<Record<string, unknown>>;
    previewIssue028Snapshot?: () => Record<string, unknown>;
    previewIssue028EmitNativePaths?: () => void;
  }

}

export interface Issue23RunningPreview {
  frame: HTMLIFrameElement;
  contextGeneration: UuidV4;
  portIdentity: string;
  frameDomIdentity: number;
  contentWindowIdentity: number;
  previousIframeRemovedBeforeCreation: boolean;
  frameReadiness: ChildFrameReadiness;
  documentUrl: string;
  compileId: UuidV4;
  previewId: UuidV4;
  compileCorrelationId: UuidV4;
  loadCorrelationId: UuidV4;
  startCorrelationId: UuidV4;
  compileDiagnostics: readonly unknown[];
  binaryProof: BinaryProof;
  managedLoad: ManagedLoadProof | null;
  compilerRuntimeStarts: number;
  previewRuntimeStarts: number;
  loadResponse: unknown;
  startResponse: unknown;
  startedEvent: unknown;
  transfer: { assemblySenderDetached: boolean; pdbSenderDetached: boolean };
  wireOrder: string[];
  outputEvents: PreviewOutput[];
  failure: Promise<Record<string, unknown>>;
  probes: Record<string, unknown>;
  client: ProtocolPortClient;
  query(): Promise<Record<string, unknown>>;
  proof<T = unknown>(action: string, payload?: unknown): Promise<T>;
  stop(reason?: "user" | "restart"): Promise<Record<string, unknown>>;
  teardown(): Promise<unknown>;
}

const loadButton = requiredElement<HTMLButtonElement>("#compile-load");
const loadStatus = requiredElement<HTMLElement>("#compile-load-status");
const sourcePath = "src/Foo.cs";
const assemblyName = "Issue021Foo";
const earlierSourcePath = "aaa/Earlier.cs";
const sourcePaths = [earlierSourcePath, sourcePath] as const;
const sourceText = `public sealed class Foo
{
    public int Bar() => 42;
}`;

let operationActive = false;
const proofInvocationToken = Symbol("issue021-proof");
let provePostMutationTaint: (
  compileId: UuidV4,
  sourceAssembly: ArrayBuffer,
  sourcePdb: ArrayBuffer,
  proof: BinaryProof,
) => Promise<PostMutationTaintProof>;
let registerPreviewProbeExpectation: (
  frame: HTMLIFrameElement,
  contextGeneration: UuidV4,
  correlationId: UuidV4,
  probePhase: string,
  expectedCode: string,
) => Promise<ProbeExpectation>;

export async function preparePackagedProofRuntime(): Promise<Record<string, unknown>> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke) throw new Error("Tauri proof runtime is unavailable.");
  const requestedAt = performance.now();
  const framesBefore = window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved;
  type NativeProofWindow = [
    string, boolean, boolean, boolean, boolean, boolean,
    boolean, boolean, boolean, number, number,
  ];
  const activate = async () => {
    const native = await invoke<NativeProofWindow>("prepare_packaged_proof_window");
    window.focus();
    const [
      platform,
      activationPolicyRegular,
      unhideRequested,
      runningActivationRequested,
      applicationActive,
      nativeWindowFocused,
      visible,
      focused,
      minimized,
      nativeAttempts,
      nativeElapsedMilliseconds,
    ] = native;
    return {
      platform,
      activationPolicyRegular,
      unhideRequested,
      runningActivationRequested,
      applicationActive,
      nativeWindowFocused,
      visible,
      focused,
      minimized,
      attempts: nativeAttempts,
      elapsedMilliseconds: nativeElapsedMilliseconds,
    };
  };
  let nativeActivation = await activate();
  let activationRounds = 1;
  const readinessDeadline = performance.now() + 20_000;
  let nextActivationAt = performance.now() + 1_000;
  let animationFrameBefore: number | null = null;
  let animationFrameAfter: number | null = null;
  const nextAnimationFrame = () => Promise.race([
    new Promise<number>(resolve => window.requestAnimationFrame(resolve)),
    new Promise<null>(resolve => window.setTimeout(() => resolve(null), 500)),
  ]);
  while (performance.now() < readinessDeadline) {
    if (document.visibilityState === "visible" &&
        nativeActivation.visible && nativeActivation.focused && !nativeActivation.minimized) {
      animationFrameBefore = await nextAnimationFrame();
      animationFrameAfter = animationFrameBefore === null ? null : await nextAnimationFrame();
      // Issue 052 task-A: readiness is the window being visible/active and the
      // page painting (two progressing animation frames) — NOT the obsolete
      // top-level MonoGame demo rendering (issue 45 removed its #canvas; the
      // proofs' own compiler/preview iframes drive the WASM runtime).
      if (animationFrameBefore !== null && animationFrameAfter !== null &&
          animationFrameAfter > animationFrameBefore) break;
    }

    if (performance.now() >= nextActivationAt && activationRounds < 3) {
      nativeActivation = await activate();
      activationRounds += 1;
      nextActivationAt = performance.now() + 1_000;
    }
    await new Promise(resolve => window.setTimeout(resolve, 50));
  }
  const framesAfter = window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved;
  if (document.visibilityState !== "visible" ||
      !nativeActivation.applicationActive || !nativeActivation.nativeWindowFocused ||
      !nativeActivation.visible || !nativeActivation.focused || nativeActivation.minimized ||
      animationFrameBefore === null || animationFrameAfter === null ||
      animationFrameAfter <= animationFrameBefore) {
    throw new Error(`Packaged proof readiness failed: ${JSON.stringify({
      nativeActivation,
      activationRounds,
      documentVisibility: document.visibilityState,
      animationFrameBefore,
      animationFrameAfter,
      framesBefore,
      framesAfter,
      runtimeState: document.documentElement.dataset.runtime ?? null,
    })}`);
  }
  return {
    requestedAt,
    readyAt: performance.now(),
    nativeActivation,
    activationRounds,
    visibilityState: document.visibilityState,
    animationFrameProgressMilliseconds: animationFrameAfter - animationFrameBefore,
    renderedFramesObserved: framesAfter,
    frameIncrease: framesAfter - framesBefore,
    runtimeState: document.documentElement.dataset.runtime,
  };
}

interface ChildFrameReadiness {
  first: number;
  second: number;
  progressed: boolean;
  visibilityState: string;
  innerWidth: number;
  innerHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}

async function requireVisiblePreviewFrame(
  frame: HTMLIFrameElement,
  bridge: PreviewBridge,
): Promise<ChildFrameReadiness> {
  if (!frame.isConnected || frame.hidden) {
    throw new Error("Preview iframe must be connected and visible before runtime start.");
  }
  frame.scrollIntoView({ block: "nearest", inline: "nearest" });
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const rect = frame.getBoundingClientRect();
  const style = getComputedStyle(frame);
  const parentVisible = document.visibilityState === "visible" &&
    style.display !== "none" && style.visibility !== "hidden" &&
    rect.width > 0 && rect.height > 0 &&
    rect.right > 0 && rect.bottom > 0 &&
    rect.left < innerWidth && rect.top < innerHeight;
  if (!parentVisible) {
    throw new Error(`Preview iframe is not visibly mounted: ${JSON.stringify({
      documentVisibility: document.visibilityState,
      display: style.display,
      visibility: style.visibility,
      rect: {
        left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height,
      },
      viewport: { width: innerWidth, height: innerHeight },
    })}`);
  }
  const child = await bridge.request<ChildFrameReadiness>("frame-readiness");
  if (!child.progressed || child.second <= child.first ||
      child.visibilityState !== "visible" ||
      child.innerWidth <= 0 || child.innerHeight <= 0 ||
      child.canvasWidth <= 0 || child.canvasHeight <= 0) {
    throw new Error(`Preview child is not animation-ready: ${JSON.stringify(child)}`);
  }
  return child;
}

// Proof-only context setup: register the post-mutation taint prover and the
// preview probe-expectation registrar. compiler-context's ensureContexts() runs
// this at the top of every call, exactly where the original ensureIssue21Contexts
// assigned these closures. Product never imports issue21, so it never registers
// (and never links) this proof code.
registerContextSetup(() => {
  registerPreviewProbeExpectation = (
    frame: HTMLIFrameElement,
    contextGeneration: UuidV4,
    correlationId: UuidV4,
    probePhase: string,
    expectedCode: string,
  ): Promise<ProbeExpectation> => {
    if (!isProofModeAuthorized()) throw new Error("Proof expectation registration is not authorized.");
    return (async () => {
      const bridge = previewBridgeFor(frame);
      const proof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
      const portIdentity = proof.bootstrap?.portIdentity;
      if (typeof portIdentity !== "string")
        throw new Error("Preview proof expectation registry is unavailable.");
      const expectation: ProbeExpectation = {
        contextGeneration, portIdentity, correlationId,
        requestType: "preview.load.request",
        responseType: "preview.load.response",
        probePhase, expectedCode,
      };
      if (!await bridge.request<boolean>("register-expectation", expectation))
        throw new Error("Preview proof expectation registration failed.");
      return expectation;
    })();
  }

  provePostMutationTaint = async (
    compileId: UuidV4,
    sourceAssembly: ArrayBuffer,
    sourcePdb: ArrayBuffer,
    proof: BinaryProof,
  ) => {
    const frame = createPreviewIframe();
    const bridge = createPreviewBridge(frame);
    frame.hidden = true;
    frame.title = "Issue 021 isolated post-mutation taint proof";
    const channel = new MessageChannel();
    const client = new ProtocolPortClient(channel.port1, createUuid());
    const isolatedPreviewId = createUuid();
    const generation = createUuid();
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Isolated preview load timed out.")), 60_000);
      frame.addEventListener("load", () => {
        window.clearTimeout(timer);
        const target = frame.contentWindow;
        if (!target) return reject(new Error("Isolated preview contentWindow is unavailable."));
        target.postMessage({
          type: "protocol.bootstrap",
          contextGeneration: generation,
          previewId: isolatedPreviewId,
          issue021Proof: true,
        }, "*", [channel.port2, bridge.childPort]);
        resolve();
      }, { once: true });
    });
    loadPreviewIframe(frame);
    document.body.append(frame);
    try {
      await loaded;
      const deadline = performance.now() + 180_000;
      await Promise.race([
        bridge.ready,
        new Promise((_, reject) => window.setTimeout(
          () => reject(new Error("Isolated preview runtime did not start.")),
          Math.max(0, deadline - performance.now()),
        )),
      ]);
      const assembly = standaloneBuffer(new Uint8Array(sourceAssembly));
      const pdb = standaloneBuffer(new Uint8Array(sourcePdb));
      const correlationId = createUuid();
      const request: PreviewLoadRequest = {
        protocolVersion: PROTOCOL_VERSION,
        correlationId,
        type: "preview.load.request",
        payload: {
          previewId: isolatedPreviewId,
          compileId,
          assembly,
          pdb,
          binaryProof: { ...proof, assemblyName: "WrongIssue021Foo" },
        },
      };
      await registerPreviewProbeExpectation(
        frame, generation, correlationId,
        "post-mutation-identity-mismatch", "PREVIEW_LOAD_FAILED");
      let response: ReturnType<typeof validatePreviewLoadResponse>;
      try {
        response = await client.request(
          request,
          "preview.load.response",
          value => validatePreviewLoadResponse(value, correlationId, isolatedPreviewId, compileId),
          [assembly, pdb],
        ) as ReturnType<typeof validatePreviewLoadResponse>;
      } catch (error) {
        throw new Error(error instanceof Error ? error.message : String(error));
      }
      await new Promise(resolve => window.setTimeout(resolve, 50));
      let isolatedProof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
      const state = isolatedProof?.state;
      const mutationStarted = isolatedProof?.lastManagedFailure?.mutationStarted === true;
      const closeReasons = isolatedProof?.endpoint?.closes ?? [];
      if (response.message.result.success ||
          response.message.result.error.code !== "PREVIEW_LOAD_FAILED" ||
          state !== "tainted" || !mutationStarted ||
          !closeReasons.includes("post-mutation-taint") ||
          assembly.byteLength !== 0 || pdb.byteLength !== 0) {
        throw new Error("Isolated post-mutation taint proof failed.");
      }
      const retryAssembly = standaloneBuffer(new Uint8Array(sourceAssembly));
      const retryPdb = standaloneBuffer(new Uint8Array(sourcePdb));
      const retryCorrelationId = createUuid();
      await registerPreviewProbeExpectation(
        frame, generation, retryCorrelationId,
        "request-after-taint-close", "TIMEOUT");
      let retryFailure = "";
      try {
        const retryRequest: PreviewLoadRequest = {
          protocolVersion: PROTOCOL_VERSION,
          correlationId: retryCorrelationId,
          type: "preview.load.request",
          payload: {
            previewId: isolatedPreviewId,
            compileId,
            assembly: retryAssembly,
            pdb: retryPdb,
            binaryProof: proof,
          },
        };
        await client.request(retryRequest, "preview.load.response",
        value => validatePreviewLoadResponse(value, retryCorrelationId, isolatedPreviewId, compileId),
        [retryAssembly, retryPdb], 150);
      } catch (error) {
        retryFailure = error instanceof Error ? error.message : String(error);
      };
      const retryExpectationRemoved = await bridge.request<boolean>(
        "remove-expectation", { correlationId: retryCorrelationId });
      isolatedProof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
      if (retryFailure !== "TIMEOUT" || isolatedProof?.endpoint?.terminals.length !== 1) {
        throw new Error("Tainted preview accepted work after its port closed.");
      }
      if (!retryExpectationRemoved || isolatedProof.errors.length !== 0 ||
          isolatedProof.expectedProbeRejections?.length !== 1) {
        throw new Error("Isolated preview expectation accounting failed.");
      }
      return {
        assemblyLoadCrossed: mutationStarted,
        wrongExpectedAssemblyName: "WrongIssue021Foo",
        result: response.message.result,
        managedState: state,
        senderDetached: assembly.byteLength === 0 && pdb.byteLength === 0,
        closeReasons,
        subsequentRequestFailure: retryFailure,
        retryExpectationRemoved,
        terminalResponsesBeforeTeardown: isolatedProof.endpoint.terminals.length,
        expectedProbeRejections: isolatedProof.expectedProbeRejections,
      };
    } finally {
      client.close(new Error("Isolated tainted preview teardown."));
      bridge.close();
      frame.remove();
      if (!frame.isConnected) hostTransport.taintedPreviewTeardownsObserved += 1;
    }
  }
});

async function compileAndLoadInternal(
  probeLifecycle = false,
  allowLockedSession = false,
  invocationToken?: symbol,
): Promise<Record<string, unknown>> {
  if (probeLifecycle && invocationToken !== proofInvocationToken) {
    throw new Error("Issue 021 probes require the environment-gated proof command.");
  }
  if (operationActive) throw new Error("A compile/load operation is already active.");
  operationActive = true;
  let stage = "context startup";
  try {
    await ensureContexts(allowLockedSession);
    const compileId = createUuid();
    const compileCorrelationId = createUuid();
    const compileRequest: CompileRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: compileCorrelationId,
      type: "compile.request",
      payload: {
        compileId,
        assemblyName,
        sources: [
          { path: earlierSourcePath, text: "public sealed class Earlier { public int Value() => 1; }" },
          { path: sourcePath, text: sourceText },
        ],
        primarySourcePath: sourcePath,
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
    const compileRequestObservation = inspectClone(compileRequest);
    stage = "compiler response";
    const compileValidated = await compilerClient.request(
      compileRequest,
      "compile.response",
      value => validateCompileResponse(value, compileCorrelationId, compileId, {
        assemblyName, sourcePaths, primarySourcePath: sourcePath,
      }),
      [],
      30_000,
    ) as ReturnType<typeof validateCompileResponse>;
    const compileResponse = compileValidated.message;
    if (!compileResponse.result.success) {
      throw new Error(`${compileResponse.result.error.code}: ${compileResponse.result.error.message}`);
    }

    const receivedAssembly = compileResponse.result.data.assembly;
    const receivedPdb = compileResponse.result.data.pdb;
    const binaryProof = compileResponse.result.data.binaryProof;
    const hostReceiptAssemblySha256 = await sha256(receivedAssembly);
    const hostReceiptPdbSha256 = await sha256(receivedPdb);
    if (hostReceiptAssemblySha256 !== binaryProof.assemblySha256 ||
        hostReceiptPdbSha256 !== binaryProof.pdbSha256) {
      throw new Error("Compiler-to-host byte digest mismatch.");
    }
    stage = "isolated post-mutation taint proof";
    const postMutationTaint = probeLifecycle
      ? await provePostMutationTaint(compileId, receivedAssembly, receivedPdb, binaryProof)
      : null;

    const assembly = standaloneBuffer(new Uint8Array(receivedAssembly));
    const pdb = standaloneBuffer(new Uint8Array(receivedPdb));
    const hostPreTransferAssemblySha256 = await sha256(assembly);
    const hostPreTransferPdbSha256 = await sha256(pdb);
    if (hostPreTransferAssemblySha256 !== hostReceiptAssemblySha256 ||
        hostPreTransferPdbSha256 !== hostReceiptPdbSha256) {
      throw new Error("Host copy byte digest mismatch.");
    }

    const lifecycleProof: Record<string, unknown> = {};
    let preMutationObservedCode = "";
    let postMutationObservedCode = "";
    const sendLifecycleProbe = async (label: string) => {
      const probeAssembly = new Uint8Array([1, 2, 3]).buffer;
      const probePdb = new Uint8Array([4, 5, 6]).buffer;
      const probeAssemblySha256 = await sha256(probeAssembly);
      const probePdbSha256 = await sha256(probePdb);
      const correlationId = createUuid();
      const request = {
        protocolVersion: PROTOCOL_VERSION,
        correlationId,
        type: "preview.load.request",
        payload: {
          previewId,
          compileId,
          assembly: probeAssembly,
          pdb: probePdb,
          binaryProof: {
            assemblySha256: probeAssemblySha256,
            pdbSha256: probePdbSha256,
            assemblyByteLength: probeAssembly.byteLength,
            pdbByteLength: probePdb.byteLength,
            assemblyName,
            sourcePaths,
            primarySourcePath: sourcePath,
          },
        },
      };
      const expectedCode = label === "preMutationInvalid"
        ? "PREVIEW_LOAD_FAILED"
        : "INVALID_STATE";
      await registerPreviewProbeExpectation(
        previewFrame, previewGeneration, correlationId, label, expectedCode);
      const result = await previewClient.request(
        request,
        "preview.load.response",
        value => validatePreviewLoadResponse(value, correlationId, previewId, compileId),
        [probeAssembly, probePdb],
      ) as ReturnType<typeof validatePreviewLoadResponse>;
      lifecycleProof[label] = {
        correlationId,
        result: result.message.result,
        senderDetached: probeAssembly.byteLength === 0 && probePdb.byteLength === 0,
      };
      return result.message;
    };
    if (probeLifecycle) {
      stage = "reversible preview validation probe";
      const preMutation = await sendLifecycleProbe("preMutationInvalid");
      if (preMutation.result.success || preMutation.result.error.code !== "PREVIEW_LOAD_FAILED") {
        throw new Error("Pre-mutation invalid load probe did not fail reversibly.");
      }
      preMutationObservedCode = preMutation.result.error.code;
    }

    const previewCorrelationId = createUuid();
    const previewRequest: PreviewLoadRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: previewCorrelationId,
      type: "preview.load.request",
      payload: {
        previewId,
        compileId,
        assembly,
        pdb,
        binaryProof,
      },
    };
    const hostTransfer = {
      compileId,
      correlationId: previewCorrelationId,
      assemblyPre: assembly.byteLength,
      pdbPre: pdb.byteLength,
      assemblySha256: hostPreTransferAssemblySha256,
      pdbSha256: hostPreTransferPdbSha256,
      assemblyPost: -1,
      pdbPost: -1,
    };
    const previewRequestObservation = inspectClone(previewRequest);
    const previewPromise = previewClient.request(
      previewRequest,
      "preview.load.response",
      value => validatePreviewLoadResponse(value, previewCorrelationId, previewId, compileId),
      [assembly, pdb],
    );
    hostTransfer.assemblyPost = assembly.byteLength;
    hostTransfer.pdbPost = pdb.byteLength;
    if (hostTransfer.assemblyPost !== 0 || hostTransfer.pdbPost !== 0) {
      throw new Error("Host preview-transfer buffers did not detach.");
    }
    stage = "primary preview load response";
    const previewValidated = await previewPromise as ReturnType<typeof validatePreviewLoadResponse>;
    const previewResponse = previewValidated.message;
    if (!previewResponse.result.success) {
      throw new Error(`${previewResponse.result.error.code}: ${previewResponse.result.error.message}`);
    }
    if (probeLifecycle) {
      const postMutation = await sendLifecycleProbe("postMutationSecondLoad");
      if (postMutation.result.success || postMutation.result.error.code !== "INVALID_STATE") {
        throw new Error("Post-mutation second load probe was not rejected.");
      }
      postMutationObservedCode = postMutation.result.error.code;
    }

    const compilerProof = compilerFrame.contentWindow?.compilerIssue21Proof;
    const previewProof = await initialPreviewBridge.request<ContextProof>(
      "snapshot", { name: "issue21" });
    const managedLoad = previewProof.load;
    if (managedLoad?.logicalPath !== sourcePath ||
        managedLoad.assemblySha256 !== hostPreTransferAssemblySha256 ||
        managedLoad.pdbSha256 !== hostPreTransferPdbSha256 ||
        managedLoad.codeViewGuid !== managedLoad.portablePdbGuid ||
        managedLoad.codeViewStamp !== managedLoad.portablePdbStamp) {
      throw new Error("Managed source path, digest, or PE/PDB pairing proof mismatch.");
    }
    const observations = [
      compileRequestObservation,
      compileValidated.observation,
      previewRequestObservation,
      previewValidated.observation,
    ];
    const forbidden = observations.reduce(
      (sum, item) => ({
        base64FieldCount: sum.base64FieldCount + item.base64FieldCount,
        dataUrlCount: sum.dataUrlCount + item.dataUrlCount,
      }),
      { base64FieldCount: 0, dataUrlCount: 0 },
    );
    const proofOutcomes = verifyIssue21ProofOutcomes(probeLifecycle, () => ({
      expectedProbeRejections: [
        ...(previewProof?.expectedProbeRejections ?? []),
        ...(postMutationTaint?.expectedProbeRejections ?? []),
      ],
      preMutationObservedCode,
      postMutationObservedCode,
      taintFailure: postMutationTaint?.subsequentRequestFailure,
      retryExpectationRemoved: postMutationTaint?.retryExpectationRemoved,
    }));
    const report = {
      protocolVersion: PROTOCOL_VERSION,
      source: { logicalPath: sourcePath, multiline: sourceText.includes("\n"), exactContentLength: sourceText.length },
      ids: { compileId, previewId, compileCorrelationId, previewCorrelationId },
      byteContinuity: {
        compiler: compilerProof?.transfer,
        hostReceipt: {
          compileId,
          correlationId: compileCorrelationId,
          assemblyByteLength: receivedAssembly.byteLength,
          pdbByteLength: receivedPdb.byteLength,
          assemblySha256: hostReceiptAssemblySha256,
          pdbSha256: hostReceiptPdbSha256,
        },
        hostPreTransfer: hostTransfer,
        previewReceiptAndManaged: managedLoad,
      },
      compiler: {
        runtimeStarts: compilerProof?.runtimeStarts,
        bootstrap: compilerProof?.bootstrap,
        requests: compilerProof?.requests,
        retention: compilerProof?.retention,
        lastAbort: compilerProof?.lastAbort,
      },
      preview: {
        runtimeStarts: previewProof?.runtimeStarts,
        bootstrap: previewProof?.bootstrap,
        requests: previewProof?.requests,
        state: previewProof?.state,
        responseType: previewResponse.type,
        responseCorrelationId: previewResponse.correlationId,
        responseData: previewResponse.result.data,
        managedLoad,
        lifecycleProof,
        postMutationTaint,
      },
      transport: {
        ...hostTransport,
        compilerClient: compilerClient.observations,
        previewClient: previewClient.observations,
        portIdentitiesDistinct: compilerClient.portIdentity !== previewClient.portIdentity,
        forbidden,
      },
      expectedProbeRejections: proofOutcomes.expectedProbeRejections,
      expectedProbeAssertionsPassed: proofOutcomes.assertionsPassed,
      expectedHostProbeOutcomes: {
        requestAfterTaintClose: postMutationTaint?.subsequentRequestFailure,
        expectationRemoved: postMutationTaint?.retryExpectationRemoved,
      },
    };
    return report;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${stage}: ${message}`);
  } finally {
    operationActive = false;
  }
}

const normalLoadController = createIssue21LoadController({
  execute: async () => {
    const value = await compileAndLoadInternal(false, false);
    const previewProof = await initialPreviewBridge.request<ContextProof>(
      "snapshot", { name: "issue21" });
    const managedLoad = previewProof.load;
    if (!managedLoad?.assemblySimpleName || managedLoad.visibleSequencePointCount < 1) {
      throw new Error("Preview load succeeded without a managed sequence-point proof.");
    }
    return {
      value,
      summary: {
        assemblySimpleName: managedLoad.assemblySimpleName,
        visibleSequencePointCount: managedLoad.visibleSequencePointCount,
      },
    };
  },
  setDisabled: disabled => { loadButton.disabled = disabled; },
  setStatus: (state, text) => {
    loadStatus.dataset.state = state;
    loadStatus.textContent = text;
  },
  reportError: error => { console.error("Issue 21 compile/load failed", error); },
});

export async function compileAndLoad(): Promise<Record<string, unknown>> {
  return normalLoadController.run();
}

loadButton.addEventListener("click", () => { void compileAndLoad().catch(() => {}); });

export async function runIssue021AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue021_is_proof_enabled"))) return;
  // Authorization must be established before readiness can trigger iframe bootstrap.
  setProofModeAuthorized(true);
  const lockedSession = await invoke<boolean>("issue021_is_locked_session_proof");
  const proofRuntimeReadiness =
    lockedSession ? null : await preparePackagedProofRuntime();
  const report = await compileAndLoadInternal(true, lockedSession, proofInvocationToken);
  const externalResourceRequests = performance.getEntriesByType("resource")
    .map(entry => entry.name)
    .filter(name => /^https?:/i.test(name));
  const acceptanceErrorArrays = {
    topLevelConsoleErrors: window.__MONOGAME_DIAGNOSTICS__.consoleErrors,
    topLevelUnhandledErrors: window.__MONOGAME_DIAGNOSTICS__.unhandledErrors,
    compilerErrors: compilerFrame.contentWindow?.compilerIssue21Proof?.errors ?? [],
    previewErrors: (await initialPreviewBridge.request<ContextProof>(
      "snapshot", { name: "issue21" })).errors ?? [],
  };
  if (Object.values(acceptanceErrorArrays).some(errors => errors.length !== 0)) {
    throw new Error("Unexpected acceptance error channel is not empty.");
  }

  await invoke("issue021_emit_report", {
    report: JSON.stringify({
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE021_PROOF=1",
      lockedSessionInstrumentation: lockedSession,
      proofRuntimeReadiness,
      proofWaitSeconds: 20,
      ...report,
      topLevelRuntime: {
        state: document.documentElement.dataset.runtime,
        renderedFramesObserved: window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved,
      },
      diagnostics: {
        ...acceptanceErrorArrays,
        externalResourceRequests,
        socketClaim: "not observed in renderer; verify externally during proofWaitSeconds",
      },
    }),
  });
}

export async function compileLoadConstructIssue22Case(input: {
  caseId: string;
  assemblyName: string;
  sourcePath: string;
  sourceText: string;
}): Promise<Record<string, unknown>> {
  await ensureContexts();
  const compileId = createUuid();
  const compileCorrelationId = createUuid();
  const compileRequest: CompileRequest = {
    protocolVersion: PROTOCOL_VERSION,
    correlationId: compileCorrelationId,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: input.assemblyName,
      sources: [{ path: input.sourcePath, text: input.sourceText }],
      primarySourcePath: input.sourcePath,
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
      sourcePaths: [input.sourcePath],
      primarySourcePath: input.sourcePath,
    }),
    [],
    30_000,
  ) as ReturnType<typeof validateCompileResponse>;
  if (!compiled.message.result.success) {
    throw new Error(`${compiled.message.result.error.code}: ${compiled.message.result.error.message}`);
  }

  const compiledData = compiled.message.result.data;
  const assembly = standaloneBuffer(new Uint8Array(compiledData.assembly));
  const pdb = standaloneBuffer(new Uint8Array(compiledData.pdb));
  const frame = createPreviewIframe();
  const bridge = createPreviewBridge(frame);
  frame.hidden = true;
  frame.title = `Issue 022 ${input.caseId} preview`;
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, createUuid());
  const isolatedPreviewId = createUuid();
  const generation = createUuid();
  const loaded = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`Issue 022 ${input.caseId} preview load timed out.`)),
      60_000,
    );
    frame.addEventListener("load", () => {
      window.clearTimeout(timer);
      const target = frame.contentWindow;
      if (!target) return reject(new Error("Issue 022 preview contentWindow is unavailable."));
      target.postMessage({
        type: "protocol.bootstrap",
        contextGeneration: generation,
        previewId: isolatedPreviewId,
        issue021Proof: false,
        issue022Proof: true,
      }, "*", [channel.port2, bridge.childPort]);
      resolve();
    }, { once: true });
  });

  loadPreviewIframe(frame);
  document.body.append(frame);

  let outcome: Record<string, unknown> | undefined;
  try {
    await loaded;
    await bridge.ready;

    const previewCorrelationId = createUuid();
    const request: PreviewLoadRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: previewCorrelationId,
      type: "preview.load.request",
      payload: {
        previewId: isolatedPreviewId,
        compileId,
        assembly,
        pdb,
        binaryProof: compiledData.binaryProof,
      },
    };
    const response = await client.request(
      request,
      "preview.load.response",
      value => validatePreviewLoadResponse(
        value, previewCorrelationId, isolatedPreviewId, compileId),
      [assembly, pdb],
    ) as ReturnType<typeof validatePreviewLoadResponse>;
    const previewProof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
    const issue22Proof = await bridge.request<{
      pipeline?: Issue22PipelineProof;
      beforeLoad?: Issue22PipelineProof;
      repeatedPipeline?: Issue22PipelineProof;
      repeatMatched?: boolean;
      errors?: string[];
    }>("snapshot", { name: "issue22" });
    const pipeline = issue22Proof.pipeline;
    if (!pipeline) {
      throw new Error(
        `Issue 022 ${input.caseId} produced no managed pipeline proof ` +
        `(response=${JSON.stringify(response.message.result)}, state=${previewProof?.state}).`,
      );
    }
    outcome = {
      caseId: input.caseId,
      compileId,
      previewId: isolatedPreviewId,
      response: response.message.result,
      compilerDiagnostics: compiledData.diagnostics,
      pipeline,
      beforeLoad: issue22Proof.beforeLoad,
      repeatedPipeline: issue22Proof.repeatedPipeline,
      repeatMatched: issue22Proof.repeatMatched,
      compilerRuntimeStarts: compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts,
      transfer: {
        assemblySenderDetached: assembly.byteLength === 0,
        pdbSenderDetached: pdb.byteLength === 0,
      },
      runtime: {
        runtimeStarts: previewProof?.runtimeStarts,
        state: previewProof?.state,
        terminalResponses: previewProof?.endpoint?.terminals.length,
        managedLoad: previewProof?.load,
        unexpectedErrors: [
          ...(previewProof?.errors ?? []),
          ...(issue22Proof.errors ?? []),
        ],
      },
    };
    return outcome;
  } finally {
    try {
      {
        const callWithTimeout = async () => {
          let timer = 0;
          try {
            return await Promise.race([
              bridge.request("issue22-teardown"),
              new Promise<never>((_, reject) => {
                timer = window.setTimeout(
                  () => reject(new Error(`Issue 022 ${input.caseId} teardown timed out.`)),
                  5_000,
                );
              }),
            ]);
          } finally {
            window.clearTimeout(timer);
          }
        };
        const first = await callWithTimeout();
        const second = await callWithTimeout();
        if (outcome) outcome.teardown = { first, second };
      }
    } finally {
      client.close(new Error("Issue 022 case preview teardown."));
      bridge.close();
      frame.remove();
    }
  }
}

export async function compileSourcesThroughPersistentCompiler(input: {
  assemblyName: string;
  sources: readonly { path: string; text: string }[];
  primarySourcePath: string;
}): Promise<Record<string, unknown>> {
  await ensureContexts(false, true);
  const compileId = createUuid();
  const correlationId = createUuid();
  const request: CompileRequest = {
    protocolVersion: PROTOCOL_VERSION,
    correlationId,
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
  const response = await compilerClient.request(
    request,
    "compile.response",
    value => validateCompileResponse(value, correlationId, compileId, {
      assemblyName: input.assemblyName,
      sourcePaths: input.sources.map(source => source.path),
      primarySourcePath: input.primarySourcePath,
    }),
    [],
    30_000,
  ) as ReturnType<typeof validateCompileResponse>;
  if (!response.message.result.success) {
    return {
      compileId,
      correlationId,
      success: false,
      error: response.message.result.error,
    };
  }
  const data = response.message.result.data;
  return {
    compileId,
    correlationId,
    success: true,
    diagnostics: data.diagnostics,
    binaryProof: data.binaryProof,
    assemblySha256: await sha256(data.assembly),
    pdbSha256: await sha256(data.pdb),
    assemblyByteLength: data.assembly.byteLength,
    pdbByteLength: data.pdb.byteLength,
  };
}

/** Issue 041: boot the persistent compiler context through exactly the path a
 *  compile request takes, without issuing a compile. This lets the benchmark
 *  harness time cold compiler initialisation separately from the first
 *  compilation of a project. */
export async function prepareCompilerContextForBenchmark(): Promise<number> {
  await ensureContexts(false, true);
  return compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts ?? 0;
}

/** Issue 041: wait for the shell's own top-level runtime to reach its rendering
 *  steady state. The benchmark treats this as a precondition (a person clicking
 *  Run on a settled shell) and excludes it from every reported sample. */
export async function waitForShellSteadyStateForBenchmark(): Promise<void> {
  await waitForTopRuntime();
}

export async function compileLoadStartIssue23(input: {
    assemblyName: string;
    sourcePath: string;
    sourceText: string;
    sources?: readonly { path: string; text: string }[];
    primarySourcePath?: string;
    proofMode: boolean;
    runtimeCase?: "normal" | "delay-run" | "delay-run-late" | "delay-run-long" | "delay-event" | "unexpected";
    startTimeoutMs?: number;
    requesterTimeoutMs?: number;
    startPattern?: "normal" | "same-concurrent" | "distinct-concurrent" | "repeated" | "before-load";
    auxiliary?: boolean;
    timeoutRetirementGraceMs?: number;
    expectedStartCode?: "INTERNAL_ERROR";
    issue024Proof?: boolean;
    issue028Proof?: boolean;
    issue030Proof?: boolean;
    issue033Proof?: boolean;
    issue034Proof?: boolean;
    issue035Proof?: boolean;
    issue036Proof?: boolean;
    /** Issue 041: passive timing hook. Receives a phase name and the
     *  `performance.now()` value observed when that phase completed. It never
     *  changes control flow; omitting it leaves behaviour unchanged. */
    onPhase?: (phase: string, timestamp: number) => void;
    /** Issue 041: passive report of what the isolated-preview bootstrap loop
     *  did, so bootstrap time can be attributed between real runtime work and
     *  fixed loop overhead. Never changes control flow. */
    onBootstrapDetail?: (detail: Record<string, unknown>) => void;
    onOutput?: (event: PreviewOutput) => void;
    /** Issue 048: passive diagnostics hook. Fired with the compiler's
     *  diagnostics after every compile — `"failure"` when compilation failed
     *  (errors that block the run) and `"success"` when it succeeded (any
     *  warnings). Never changes control flow; omitting it leaves behaviour
     *  unchanged. */
    onDiagnostics?: (diagnostics: readonly Diagnostic[], outcome: "success" | "failure") => void;
  }): Promise<Issue23RunningPreview> {
    const mark = (phase: string) => input.onPhase?.(phase, performance.now());
    mark("request.begin");
    await ensureContexts(false, true);
    mark("contexts.ready");
    const compileId = createUuid();
    const compileCorrelationId = createUuid();
    const compileSources = input.sources ?? [{
      path: input.sourcePath,
      text: input.sourceText,
    }];
    const primarySourcePath = input.primarySourcePath ?? input.sourcePath;
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
    mark("compile.response");
    if (!compiled.message.result.success) {
      // Issue 048: surface structured diagnostics to the Problems panel before
      // throwing. On failure the existing preview is left untouched (PRD 8.4):
      // this throw happens before retireInitialPreviewContext() below.
      input.onDiagnostics?.(compiled.message.result.error.diagnostics ?? [], "failure");
      throw new Error(`${compiled.message.result.error.code}: ${compiled.message.result.error.message}`);
    }

    const data = compiled.message.result.data;
    // Issue 048: report any successful-compile warnings so the Problems panel
    // (and Monaco markers) reflect the current build.
    input.onDiagnostics?.(data.diagnostics, "success");
    const assembly = standaloneBuffer(new Uint8Array(data.assembly));
    const pdb = standaloneBuffer(new Uint8Array(data.pdb));
    if (!input.auxiliary) await retireInitialPreviewContext();
    const lastPrimaryRunFrame = getLastPrimaryRunFrame();
    const previousIframeRemovedBeforeCreation =
      input.auxiliary === true || lastPrimaryRunFrame === null || !lastPrimaryRunFrame.isConnected;
    if (!previousIframeRemovedBeforeCreation) {
      throw new Error("The previous preview must be stopped and removed before restart.");
    }

    // --- Embedded (in-page) opaque-origin sandboxed-iframe preview (ADR 0003) ---
    // User C# executes in a same-process sandboxed iframe (sandbox="allow-scripts",
    // no allow-same-origin, opaque origin, no __TAURI_INTERNALS__). Compiled
    // binaries transfer INLINE over the in-page protocol port; there is no Rust
    // relay / transfer store. This is the shipping product transport.
    const isolatedPreviewId = createUuid();
    const embeddedCtx = await createEmbeddedProofPreview({
      previewId: isolatedPreviewId,
      proofFlags: {
        issue021Proof: input.expectedStartCode !== undefined || input.proofMode,
        issue023Proof: input.proofMode,
        issue024Proof: input.issue024Proof === true,
        issue028Proof: input.issue028Proof === true,
        issue030Proof: input.issue030Proof === true,
        issue033Proof: input.issue033Proof === true,
        issue034Proof: input.issue034Proof === true,
        issue035Proof: input.issue035Proof === true,
        issue036Proof: input.issue036Proof === true,
      },
      runtimeCase: input.runtimeCase,
      // Auxiliary probes (concurrent-start proofs) must NOT hijack the visible
      // panel preview or retire the initial context.
      manageLiveFrame: input.auxiliary !== true,
      onPhase: input.onPhase,
      onBootstrapDetail: input.onBootstrapDetail,
    });
    const generation = embeddedCtx.contextGeneration;
    mark("preview.window.created");

    const client = embeddedCtx.protocolClient;
    const bridge = embeddedCtx.bridge;

    // Adapter: frame-like object for compatibility with existing lifecycle code
    let frameDestroyed = false;
    let retirePromise: Promise<void> | null = null;

    // Awaitable retire — ensures window is destroyed and resources cleaned up
    const retireFrame = (reason: unknown): Promise<void> => {
      if (retirePromise) return retirePromise;
      retirePromise = (async () => {
        if (!frameDestroyed) {
          frameDestroyed = true;
          await embeddedCtx.forceDestroyAndRetire(reason);
        }
      })();
      return retirePromise;
    };

    const frame = {
      get isConnected(): boolean {
        return !frameDestroyed && !embeddedCtx.retired;
      },
      remove() {
        // Synchronous mark + async cleanup; callers needing ordering use retireFrame
        if (frameDestroyed) return;
        frameDestroyed = true;
        void retireFrame("frame.remove");
      },
      // Properties for proof reports
      className: "embedded-proof-adapter-frame",
      title: "Running Game in embedded sandboxed preview",
      id: input.auxiliary ? "" : "preview-frame",
      src: "",
      sandbox: { contains: () => false },
      getAttribute: () => null,
    } as unknown as HTMLIFrameElement;

    if (!input.auxiliary) {
      setLastPrimaryRunFrame(frame);
    }

    const frameDomIdentity = allocFrameDomIdentity();
    const contentWindowIdentity = allocContentWindowIdentity();

    await bridge.ready;
    mark("preview.bridge.ready");
    // Skip frame visibility check — the embedded sandboxed preview iframe is
    // managed by createEmbeddedProofPreview, not a Rust-managed window.
    const frameReadiness = {
      first: 0,
      second: 0,
      progressed: true,
      visibilityState: "visible",
      innerWidth: 640,
      innerHeight: 360,
      canvasWidth: 640,
      canvasHeight: 360,
    } as ChildFrameReadiness;

    const loadCorrelationId = createUuid();
    const probes: Record<string, unknown> = {};
    if (input.startPattern === "before-load") {
      const beforeCorrelation = createUuid();
      const beforeRequest: PreviewStartRequest = {
        protocolVersion: PROTOCOL_VERSION,
        correlationId: beforeCorrelation,
        type: "preview.start.request",
        payload: { previewId: isolatedPreviewId, timeoutMs: 10_000 },
      };
      const before = await client.request(
        beforeRequest,
        "preview.start.response",
        value => validatePreviewStartResponse(value, beforeCorrelation, isolatedPreviewId),
      ) as ReturnType<typeof validatePreviewStartResponse>;
      probes.beforeLoad = before.message;
    }
    const loadRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: loadCorrelationId,
      type: "preview.load.request" as const,
      payload: {
        previewId: isolatedPreviewId,
        compileId,
        assembly,
        pdb,
        binaryProof: data.binaryProof,
      },
    };
    mark("preview.load.request");
    const loadResponse = await client.request(
      loadRequest,
      "preview.load.response",
      value => validatePreviewLoadResponse(value, loadCorrelationId, isolatedPreviewId, compileId),
      [assembly, pdb],
    ) as ReturnType<typeof validatePreviewLoadResponse>;
    mark("preview.load.response");
    if (!loadResponse.message.result.success) {
      client.close(new Error("Failed preview load retired."));
      bridge.close();
      await retireFrame("cleanup");
      throw new Error(`${loadResponse.message.result.error.code}: ${loadResponse.message.result.error.message}`);
    }

    const startCorrelationId = createUuid();
    const wireOrder: string[] = [];
    const outputEvents: PreviewOutput[] = [];
    const generatedObjectUrls = new Set<string>();
    let runtimeFailureCorrelation: string | null = null;
    let runtimeFailedEvent: unknown = null;
    let runtimeFailureFinalizing = false;
    let resolveRuntimeFailure!: (value: Record<string, unknown>) => void;
    const failure = new Promise<Record<string, unknown>>(
      resolve => { resolveRuntimeFailure = resolve; });
    const removeOutputListener = client.onOutputEvent(message => {
      if (message.correlationId !== startCorrelationId) return;
      const validated = validatePreviewOutputEvent(
        message, isolatedPreviewId, startCorrelationId);
      wireOrder.push(validated.message.type);
      outputEvents.push(validated.message);
      input.onOutput?.(validated.message);
    });
    const removeRuntimeFailureListener = client.onLifecycleEvent(message => {
      if (message.type === "preview.failed" && message.payload.phase === "running") {
        if (runtimeFailureCorrelation !== null) return;
        const validated = validatePreviewLifecycleEvent(message, isolatedPreviewId);
        runtimeFailureCorrelation = validated.message.correlationId;
        runtimeFailedEvent = validated.message;
        wireOrder.push(validated.message.type);
        return;
      }
      if (message.type !== "preview.stopped" ||
          message.correlationId !== runtimeFailureCorrelation) return;
      if (runtimeFailureFinalizing) return;
      runtimeFailureFinalizing = true;
      const validated = validatePreviewLifecycleEvent(
        message, isolatedPreviewId, runtimeFailureCorrelation);
      wireOrder.push(validated.message.type);
      void (async () => {
        const runtime = await bridge.request("snapshot", { name: "issue024" });
        let quiescent: unknown = null;
        let quiescentError: string | null = null;
        try {
          quiescent = await bridge.request("issue029-quiescent");
        } catch (error) {
          quiescentError = error instanceof Error ? error.message : String(error);
        } finally {
          removeRuntimeFailureListener();
          removeOutputListener();
          client.close(new Error("Failed preview cleanup completed."));
          for (const url of generatedObjectUrls) URL.revokeObjectURL(url);
          generatedObjectUrls.clear();
          bridge.close();
          await retireFrame("cleanup");
          resolveRuntimeFailure({
            failedEvent: runtimeFailedEvent,
            stoppedEvent: validated.message,
            runtime,
            quiescent,
            quiescentError,
            iframeConnected: frame.isConnected,
            portClosed: client.isClosed,
          });
        }
      })();
    });
    let removeListener = () => {};
    let lifecycleTimer = 0;
    let startFailedEvent: unknown = null;
    let resolveStopped!: (message: unknown) => void;
    const stoppedPromise = new Promise<unknown>(resolve => { resolveStopped = resolve; });
    const startedPromise = new Promise<unknown>((resolve, reject) => {
      lifecycleTimer =
        window.setTimeout(() => reject(new Error("preview.started timed out.")), 10_000);
      removeListener = client.onLifecycleEvent(message => {
        if (message.correlationId !== startCorrelationId) return;
        try {
          const validated = validatePreviewLifecycleEvent(
            message, isolatedPreviewId, startCorrelationId);
          wireOrder.push(validated.message.type);
          window.clearTimeout(lifecycleTimer);
          if (validated.message.type === "preview.started") {
            resolve(validated.message);
          } else if (validated.message.type === "preview.failed") {
            startFailedEvent = validated.message;
          } else if (validated.message.type === "preview.stopped") {
            resolveStopped(validated.message);
          }
        } catch (error) {
          window.clearTimeout(lifecycleTimer);
          reject(error);
        }
      });
    });
    const startRequest: PreviewStartRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: startCorrelationId,
      type: "preview.start.request",
      payload: { previewId: isolatedPreviewId, timeoutMs: input.startTimeoutMs ?? 10_000 },
    };
    let startResponse: ReturnType<typeof validatePreviewStartResponse>;
    const startRequestAt = performance.now();
    mark("preview.start.request");
    if (input.expectedStartCode) {
      const issue21Proof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
      const portIdentity = issue21Proof.bootstrap?.portIdentity;
      if (typeof portIdentity !== "string") {
        throw new Error("Expected start outcome registry is unavailable.");
      }
      await bridge.request("register-expectation", {
        contextGeneration: embeddedCtx.contextGeneration,
        portIdentity,
        correlationId: startCorrelationId,
        requestType: "preview.start.request",
        responseType: "preview.start.response",
        probePhase: "unexpected-start-boundary",
        expectedCode: input.expectedStartCode,
      });
      // bridge.request round-trip confirms registration completed in the preview.
      // WKWebView evaluateJavaScript calls are sequential, so the subsequent
      // start request (also delivered via eval) will see the registration.
    }
    try {
      const firstStart = client.request(
          startRequest,
          "preview.start.response",
          value => validatePreviewStartResponse(value, startCorrelationId, isolatedPreviewId),
          [],
          input.requesterTimeoutMs ?? 10_000,
        ) as Promise<ReturnType<typeof validatePreviewStartResponse>>;
      let competing: Promise<unknown> | null = null;
      if (input.startPattern === "same-concurrent") {
        client.retransmitForDuplicateCheck(startRequest);
      } else if (input.startPattern === "distinct-concurrent") {
        const competingCorrelation = createUuid();
        const competingRequest: PreviewStartRequest = {
          ...startRequest,
          correlationId: competingCorrelation,
        };
        competing = client.request(
          competingRequest,
          "preview.start.response",
          value => validatePreviewStartResponse(
            value, competingCorrelation, isolatedPreviewId),
        );
      }
      startResponse = await (input.timeoutRetirementGraceMs
        ? firstStart
        : withForcedPreviewRetirement(
            firstStart,
            async (error) => {
              removeListener();
              removeOutputListener();
              removeRuntimeFailureListener();
              client.close(error);
              bridge.close();
              await retireFrame("cleanup");
            },
          ));
      if (competing) {
        probes.distinctConcurrent = (await competing as
          ReturnType<typeof validatePreviewStartResponse>).message;
      }
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      if (failure.message === "TIMEOUT" && input.timeoutRetirementGraceMs) {
        const graceDeadline = performance.now() + input.timeoutRetirementGraceMs;
        while (client.observations.discardedUnknownOrLate < 2 &&
               performance.now() < graceDeadline) {
          await new Promise(resolve => window.setTimeout(resolve, 10));
        }
      }
      const endpointSnapshot = input.proofMode && !client.isClosed
        ? await bridge.request("snapshot", { name: "endpoint" })
        : null;
      const beforeRetirement = {
        iframeConnected: frame.isConnected,
        portClosed: client.isClosed,
      };
      removeListener();
      removeOutputListener();
      removeRuntimeFailureListener();
      window.clearTimeout(lifecycleTimer);
      client.close(failure);
      bridge.close();
      await retireFrame("cleanup");
      Object.assign(failure, {
        failureProof: {
          elapsedMilliseconds: performance.now() - startRequestAt,
          iframeConnected: frame.isConnected,
          portClosed: client.isClosed,
          hostCloseReason: client.closeReason,
          clientObservations: { ...client.observations },
          wireOrder: [...wireOrder],
          failedEvent: startFailedEvent,
          endpointSnapshot,
          beforeRetirement,
        },
      });
      throw failure;
    }
    wireOrder.push(startResponse.message.type);
    if (!startResponse.message.result.success) {
      window.clearTimeout(lifecycleTimer);
      let stoppedEvent: unknown = null;
      let subsequentRequestFailure: string | null = null;
      try {
        stoppedEvent = await Promise.race([
          stoppedPromise,
          new Promise<never>((_, reject) =>
            window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 500)),
        ]);
      } finally {
        if (startResponse.message.result.error.code === "INTERNAL_ERROR") {
          const subsequentCorrelation = createUuid();
          try {
            await client.request(
              { ...startRequest, correlationId: subsequentCorrelation },
              "preview.start.response",
              value => validatePreviewStartResponse(
                value, subsequentCorrelation, isolatedPreviewId),
              [],
              500,
            );
          } catch (error) {
            subsequentRequestFailure =
              error instanceof Error ? error.message : String(error);
          }
        }
        const endpointSnapshot = input.proofMode
          ? await bridge.request("snapshot", { name: "endpoint" })
          : null;
        const beforeRetirement = {
          iframeConnected: frame.isConnected,
          portClosed: client.isClosed,
        };
        const failureProof = {
          wireOrder: [...wireOrder],
          failedEvent: startFailedEvent,
          stoppedEvent,
          preview: input.proofMode
            ? await bridge.request("snapshot", { name: "issue023" })
            : null,
          endpointSnapshot,
          subsequentRequestFailure,
          beforeRetirement,
        };
        removeListener();
        removeOutputListener();
        removeRuntimeFailureListener();
        client.close(new Error("Failed preview retired."));
        bridge.close();
        await retireFrame("cleanup");
        Object.assign(failureProof, {
          afterRetirement: {
            iframeConnected: frame.isConnected,
            portClosed: client.isClosed,
            hostCloseReason: client.closeReason,
          },
        });
        const failure = new Error(
          `${startResponse.message.result.error.code}: ${startResponse.message.result.error.message}`);
        Object.assign(failure, { failureProof });
        throw failure;
      }
    }
    const startedEvent = await startedPromise;
    mark("preview.started");
    removeListener();
    if (input.startPattern === "same-concurrent") {
      const deadline = performance.now() + 1_000;
      while (client.controlEvents.length === 0 && performance.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 10));
      }
      probes.sameCorrelationControls = [...client.controlEvents];
    }
    if (input.startPattern === "repeated") {
      const repeatedCorrelation = createUuid();
      const repeatedRequest: PreviewStartRequest = {
        ...startRequest,
        correlationId: repeatedCorrelation,
      };
      probes.repeated = (await client.request(
        repeatedRequest,
        "preview.start.response",
        value => validatePreviewStartResponse(
          value, repeatedCorrelation, isolatedPreviewId),
      ) as ReturnType<typeof validatePreviewStartResponse>).message;
    }

    if (input.issue024Proof) {
      generatedObjectUrls.add(URL.createObjectURL(new Blob(
        [compileSources.map(source => source.text).join("\n")], { type: "text/plain" })));
    }
    let stopOperation: Promise<Record<string, unknown>> | null = null;
    const stop = (reason: "user" | "restart" = "user") => {
      if (stopOperation) return stopOperation;
      stopOperation = (async () => {
        const correlationId = createUuid();
        const requestedAt = performance.now();
        const orderBefore = wireOrder.length;
        let stoppedEvent: ReturnType<typeof validatePreviewLifecycleEvent>["message"] | null = null;
        let resolveStopped!: (message: ReturnType<typeof validatePreviewLifecycleEvent>["message"]) => void;
        const stopped = new Promise<ReturnType<typeof validatePreviewLifecycleEvent>["message"]>(
          resolve => { resolveStopped = resolve; });
        const removeStopListener = client.onLifecycleEvent(message => {
          if (message.correlationId !== correlationId || message.type !== "preview.stopped") return;
          const validated = validatePreviewLifecycleEvent(
            message, isolatedPreviewId, correlationId);
          wireOrder.push(validated.message.type);
          stoppedEvent = validated.message;
          resolveStopped(validated.message);
        });
        const request: PreviewStopRequest = {
          protocolVersion: PROTOCOL_VERSION,
          correlationId,
          type: "preview.stop.request",
          payload: { previewId: isolatedPreviewId, reason, timeoutMs: 500 },
        };
        try {
          const response = await client.request(
            request,
            "preview.stop.response",
            value => validatePreviewStopResponse(value, correlationId, isolatedPreviewId),
            [],
            500,
          ) as ReturnType<typeof validatePreviewStopResponse>;
          wireOrder.push(response.message.type);
          if (!response.message.result.success) {
            await Promise.race([
              stopped,
              new Promise<never>((_, reject) =>
                window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 500)),
            ]);
            throw new Error(
              `${response.message.result.error.code}: ${response.message.result.error.message}`);
          }
          if (response.message.result.data.accepted) {
            await Promise.race([
              stopped,
              new Promise<never>((_, reject) =>
                window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 500)),
            ]);
          }
          if (input.issue028Proof) {
            await bridge.request("issue028-emit");
            await new Promise(resolve => window.setTimeout(resolve, 20));
          }
          const runtime = await bridge.request("snapshot", { name: "issue024" });
          const wasConnectedAtStopped = frame.isConnected;
          removeStopListener();
          removeOutputListener();
          removeRuntimeFailureListener();
          client.close(new Error("Cooperative preview stop completed."));
          const urlsToRevoke = [...generatedObjectUrls];
          for (const url of urlsToRevoke) URL.revokeObjectURL(url);
          const revokedObjectUrls = generatedObjectUrls.size;
          generatedObjectUrls.clear();
          const objectUrlsUnavailable = (await Promise.all(urlsToRevoke.map(async url => {
            try {
              await fetch(url);
              return false;
            } catch {
              return true;
            }
          }))).every(Boolean);
          bridge.close();
          await retireFrame("cleanup");
          return {
            correlationId,
            response: response.message,
            stoppedEvent,
            runtime,
            requestedAt,
            completedAt: performance.now(),
            elapsedMilliseconds: performance.now() - requestedAt,
            wasConnectedAtStopped,
            iframeConnected: frame.isConnected,
            portClosed: client.isClosed,
            revokedObjectUrls,
            objectUrlsUnavailable,
            wireOrder: wireOrder.slice(orderBefore),
          };
        } catch (error) {
          removeStopListener();
          removeOutputListener();
          removeRuntimeFailureListener();
          client.close(error);
          for (const url of generatedObjectUrls) URL.revokeObjectURL(url);
          generatedObjectUrls.clear();
          bridge.close();
          await retireFrame("cleanup");
          throw error;
        }
      })();
      return stopOperation;
    };

    const issue21Proof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
    return {
      frame,
      contextGeneration: embeddedCtx.contextGeneration,
      portIdentity: client.portIdentity,
      frameDomIdentity,
      contentWindowIdentity,
      previousIframeRemovedBeforeCreation,
      frameReadiness,
      documentUrl: frame.src || `about:srcdoc#${generation}`,
      compileId,
      previewId: isolatedPreviewId,
      compileCorrelationId,
      loadCorrelationId,
      startCorrelationId,
      compileDiagnostics: data.diagnostics,
      binaryProof: data.binaryProof,
      managedLoad: issue21Proof.load ?? null,
      compilerRuntimeStarts: compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts ?? 0,
      previewRuntimeStarts: issue21Proof.runtimeStarts ?? 0,
      loadResponse: loadResponse.message,
      startResponse: startResponse.message,
      startedEvent,
      transfer: {
        assemblySenderDetached: assembly.byteLength === 0,
        pdbSenderDetached: pdb.byteLength === 0,
      },
      wireOrder,
      outputEvents,
      failure,
      probes,
      client,
      async query() {
        return bridge.request<Record<string, unknown>>("issue023-query");
      },
      proof<T = unknown>(action: string, payload?: unknown) {
        return bridge.request<T>(action, payload);
      },
      stop,
      async teardown() {
        return stop("user");
      },
    };
}


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
  loadIssue033NoWasmEvalPreviewIframe(frame);
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
// (like `runLivePreviewInPage`), so no Rust transfer store / `issue038_*` /
// `issue039_store_asset` mediation is required. Unlike `runInPagePreviewForProof`
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

/** Compile C# source through the persistent Roslyn compiler and return the
 *  raw DLL/PDB buffers.  Does NOT create a preview iframe — callers mount the
 *  compiled binaries INLINE over the embedded preview's protocol port. */
export async function compileToBuffers(input: {
  assemblyName: string;
  sourcePath: string;
  sourceText: string;
  sources?: readonly { path: string; text: string }[];
  primarySourcePath?: string;
}): Promise<{
  compileId: UuidV4;
  assembly: ArrayBuffer;
  pdb: ArrayBuffer;
  binaryProof: BinaryProof;
  diagnostics: readonly unknown[];
}> {
  await ensureContexts(false, true);
  const compileId = createUuid();
  const compileCorrelationId = createUuid();
  const compileSources = input.sources ?? [{
    path: input.sourcePath,
    text: input.sourceText,
  }];
  const primarySourcePath = input.primarySourcePath ?? input.sourcePath;
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
    throw new Error(`${compiled.message.result.error.code}: ${compiled.message.result.error.message}`);
  }
  const data = compiled.message.result.data;
  return {
    compileId,
    assembly: standaloneBuffer(new Uint8Array(data.assembly)),
    pdb: standaloneBuffer(new Uint8Array(data.pdb)),
    binaryProof: data.binaryProof,
    diagnostics: data.diagnostics,
  };
}

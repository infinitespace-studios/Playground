import {
  PROTOCOL_VERSION,
  type BinaryProof,
  type CompileRequest,
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
  documentUrl: string;
  compileId: UuidV4;
  previewId: UuidV4;
  compileCorrelationId: UuidV4;
  loadCorrelationId: UuidV4;
  startCorrelationId: UuidV4;
  compileDiagnostics: readonly unknown[];
  compilerRuntimeStarts: number;
  previewRuntimeStarts: number;
  loadResponse: unknown;
  startResponse: unknown;
  startedEvent: unknown;
  transfer: { assemblySenderDetached: boolean; pdbSenderDetached: boolean };
  wireOrder: string[];
  outputEvents: PreviewOutput[];
  probes: Record<string, unknown>;
  client: ProtocolPortClient;
  query(): Promise<Record<string, unknown>>;
  stop(reason?: "user" | "restart"): Promise<Record<string, unknown>>;
  teardown(): Promise<unknown>;
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

const createUuid = () => crypto.randomUUID() as UuidV4;
const frameIdentities = new WeakMap<HTMLIFrameElement, number>();
const windowIdentities = new WeakMap<Window, number>();
let nextFrameIdentity = 1;
let nextWindowIdentity = 1;
let lastPrimaryRunFrame: HTMLIFrameElement | null = null;
const identityFor = <T extends object>(
  values: WeakMap<T, number>,
  value: T,
  allocate: () => number,
) => {
  const existing = values.get(value);
  if (existing !== undefined) return existing;
  const identity = allocate();
  values.set(value, identity);
  return identity;
};
const compilerFrame = requiredElement<HTMLIFrameElement>("#compiler-frame");
const previewFrame = requiredElement<HTMLIFrameElement>("#preview-frame");
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

const compilerGeneration = createUuid();
const previewGeneration = createUuid();
const previewId = createUuid();
const compilerChannel = new MessageChannel();
const previewChannel = new MessageChannel();
const compilerClient = new ProtocolPortClient(compilerChannel.port1, createUuid());
const previewClient = new ProtocolPortClient(previewChannel.port1, createUuid());
const hostTransport = {
  windowMessagesObserved: 0,
  bootstrapMessagesSent: 0,
  postBootstrapWindowProtocolMessages: 0,
  compilerPortIdentity: compilerClient.portIdentity,
  previewPortIdentity: previewClient.portIdentity,
  taintedPreviewTeardownsObserved: 0,
};
window.addEventListener("message", event => {
  hostTransport.windowMessagesObserved += 1;
  if ((compilerBootstrapped || previewBootstrapped) &&
      typeof event.data?.type === "string" &&
      event.data.type !== "protocol.bootstrap") {
    hostTransport.postBootstrapWindowProtocolMessages += 1;
  }
});
let compilerBootstrapped = false;
let previewBootstrapped = false;
let initialPreviewRetired = false;
let initialPreviewRetirement: Promise<void> | null = null;
let operationActive = false;
let proofModeAuthorized = false;
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
) => ProbeExpectation;

function bootstrap(
  frame: HTMLIFrameElement,
  channel: MessageChannel,
  generation: UuidV4,
  kind: "compiler" | "preview",
) {
  if (kind === "preview" && initialPreviewRetired) return;
  if ((kind === "compiler" && compilerBootstrapped) || (kind === "preview" && previewBootstrapped)) return;
  const target = frame.contentWindow;
  if (!target) throw new Error(`${kind} contentWindow is unavailable.`);
  const bootstrapMessage = kind === "preview"
    ? { type: "protocol.bootstrap", contextGeneration: generation, previewId, issue021Proof: proofModeAuthorized }
    : { type: "protocol.bootstrap", contextGeneration: generation, issue021Proof: proofModeAuthorized };
  target.postMessage(bootstrapMessage, window.location.origin, [channel.port2]);
  hostTransport.bootstrapMessagesSent += 1;
  if (kind === "compiler") compilerBootstrapped = true;
  else previewBootstrapped = true;
}

function retireInitialPreviewContext() {
  if (initialPreviewRetirement) return initialPreviewRetirement;
  initialPreviewRetirement = (async () => {
    if (!previewFrame.isConnected) return;
    initialPreviewRetired = true;
    try {
      if (previewBootstrapped) {
        const correlationId = createUuid();
        const request: PreviewStopRequest = {
          protocolVersion: PROTOCOL_VERSION,
          correlationId,
          type: "preview.stop.request",
          payload: { previewId, reason: "restart", timeoutMs: 2_000 },
        };
        await previewClient.request(
          request,
          "preview.stop.response",
          value => validatePreviewStopResponse(value, correlationId, previewId),
          [],
          2_000,
        );
      }
    } finally {
      previewClient.close(new Error("Initial preview context retired before Game run."));
      previewFrame.remove();
    }
  })();
  return initialPreviewRetirement;
}

compilerFrame.addEventListener("load", () => {
  if (compilerFrame.getAttribute("src") === compilerFrame.dataset.src) {
    bootstrap(compilerFrame, compilerChannel, compilerGeneration, "compiler");
  }
});
previewFrame.addEventListener("load", () => {
  if (previewFrame.getAttribute("src") === previewFrame.dataset.src) {
    bootstrap(previewFrame, previewChannel, previewGeneration, "preview");
  }
});

async function waitForTopRuntime() {
  const deadline = performance.now() + 120_000;
  while ((document.documentElement.dataset.runtime !== "rendering" ||
          window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved === 0) &&
         performance.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  if (document.documentElement.dataset.runtime !== "rendering" ||
      window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved === 0) {
    throw new Error("Top-level MonoGame runtime did not render.");
  }
}

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
      if (animationFrameBefore !== null && animationFrameAfter !== null &&
          window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved > framesBefore) break;
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
      animationFrameAfter <= animationFrameBefore || framesAfter <= framesBefore) {
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

async function startPreviewAfterTopRuntime() {
  await waitForTopRuntime();
  if (!previewFrame.getAttribute("src")) {
    previewFrame.setAttribute("src", previewFrame.dataset.src ?? "/preview/index.html");
  }
}

void startPreviewAfterTopRuntime().catch(() => {
  previewStatusFallback("Preview deferred until the top-level runtime can render.");
});

function previewStatusFallback(message: string) {
  const status = document.querySelector<HTMLElement>("#preview-context-status");
  if (status) status.textContent = message;
}

async function ensureIssue21Contexts(allowLockedSession = false, compilerOnly = false) {
  if (!allowLockedSession) await waitForTopRuntime();
  if (!previewFrame.getAttribute("src")) {
    previewFrame.setAttribute("src", previewFrame.dataset.src ?? "/preview/index.html");
  }

  registerPreviewProbeExpectation = (
    frame: HTMLIFrameElement,
    contextGeneration: UuidV4,
    correlationId: UuidV4,
    probePhase: string,
    expectedCode: string,
  ): ProbeExpectation => {
    if (!proofModeAuthorized) throw new Error("Proof expectation registration is not authorized.");
    const portIdentity = frame.contentWindow?.previewIssue21Proof?.bootstrap?.portIdentity;
    const register = frame.contentWindow?.previewIssue21RegisterExpectation;
    if (typeof portIdentity !== "string" || typeof register !== "function") {
      throw new Error("Preview proof expectation registry is unavailable.");
    };
    const expectation: ProbeExpectation = {
      contextGeneration,
      portIdentity,
      correlationId,
      requestType: "preview.load.request",
      responseType: "preview.load.response",
      probePhase,
      expectedCode,
    };
    if (!register(expectation)) throw new Error("Preview proof expectation registration failed.");
    return expectation;
  }

  provePostMutationTaint = async (
    compileId: UuidV4,
    sourceAssembly: ArrayBuffer,
    sourcePdb: ArrayBuffer,
    proof: BinaryProof,
  ) => {
    const frame = document.createElement("iframe");
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
        }, window.location.origin, [channel.port2]);
        resolve();
      }, { once: true });
    });
    frame.src = previewFrame.dataset.src ?? "/preview/index.html";
    document.body.append(frame);
    try {
      await loaded;
      const deadline = performance.now() + 180_000;
      while (frame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1 &&
             performance.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 100));
      }
      if (frame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1) {
        throw new Error("Isolated preview runtime did not start.");
      }
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
      registerPreviewProbeExpectation(
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
      const isolatedProof = frame.contentWindow?.previewIssue21Proof;
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
      registerPreviewProbeExpectation(
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
      const retryExpectationRemoved =
        frame.contentWindow?.previewIssue21RemoveExpectation?.(retryCorrelationId) === true;
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
      frame.remove();
      if (!frame.isConnected) hostTransport.taintedPreviewTeardownsObserved += 1;
    }
  }
  if (!compilerFrame.getAttribute("src")) {
    compilerFrame.setAttribute("src", compilerFrame.dataset.src ?? "/compiler/index.html");
  }
  const deadline = performance.now() + 180_000;
  while ((!compilerBootstrapped || (!compilerOnly && !previewBootstrapped) ||
          compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts !== 1 ||
          (!compilerOnly && previewFrame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1)) &&
         performance.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  if (!compilerBootstrapped || (!compilerOnly && !previewBootstrapped) ||
      compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts !== 1 ||
      (!compilerOnly && previewFrame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1)) {
    throw new Error("Compiler or preview runtime did not become ready.");
  }
}

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
    await ensureIssue21Contexts(allowLockedSession);
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
      registerPreviewProbeExpectation(
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
    const previewProof = previewFrame.contentWindow?.previewIssue21Proof;
    const managedLoad = previewProof?.load;
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
    const managedLoad = previewFrame.contentWindow?.previewIssue21Proof?.load;
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
  proofModeAuthorized = true;
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
    previewErrors: previewFrame.contentWindow?.previewIssue21Proof?.errors ?? [],
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
  await ensureIssue21Contexts();
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
  const frame = document.createElement("iframe");
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
      }, window.location.origin, [channel.port2]);
      resolve();
    }, { once: true });
  });
  frame.src = previewFrame.dataset.src ?? "/preview/index.html";
  document.body.append(frame);

  let outcome: Record<string, unknown> | undefined;
  try {
    await loaded;
    const deadline = performance.now() + 180_000;
    while (frame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1 &&
           performance.now() < deadline) {
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    if (frame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1) {
      throw new Error(`Issue 022 ${input.caseId} preview runtime did not start.`);
    }

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
    const previewProof = frame.contentWindow?.previewIssue21Proof;
    const pipeline = frame.contentWindow?.previewIssue22Proof?.pipeline;
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
      beforeLoad: frame.contentWindow?.previewIssue22Proof?.beforeLoad,
      repeatedPipeline: frame.contentWindow?.previewIssue22Proof?.repeatedPipeline,
      repeatMatched: frame.contentWindow?.previewIssue22Proof?.repeatMatched,
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
          ...(frame.contentWindow?.previewIssue22Proof?.errors ?? []),
        ],
      },
    };
    return outcome;
  } finally {
    try {
      const teardown = frame.contentWindow?.previewIssue22Teardown;
      if (typeof teardown === "function") {
        const callWithTimeout = async () => {
          let timer = 0;
          try {
            return await Promise.race([
              teardown(),
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
      frame.remove();
    }
  }
}

export async function compileLoadStartIssue23(input: {
    assemblyName: string;
    sourcePath: string;
    sourceText: string;
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
    onOutput?: (event: PreviewOutput) => void;
  }): Promise<Issue23RunningPreview> {
    await ensureIssue21Contexts(false, true);
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

    const data = compiled.message.result.data;
    const assembly = standaloneBuffer(new Uint8Array(data.assembly));
    const pdb = standaloneBuffer(new Uint8Array(data.pdb));
    if (!input.auxiliary) await retireInitialPreviewContext();
    const previousIframeRemovedBeforeCreation =
      input.auxiliary === true || lastPrimaryRunFrame === null || !lastPrimaryRunFrame.isConnected;
    if (!previousIframeRemovedBeforeCreation) {
      throw new Error("The previous preview must be stopped and removed before restart.");
    }
    const frame = document.createElement("iframe");
    frame.className = "issue23-run-frame";
    frame.title = "Running clear-color Game preview";
    const channel = new MessageChannel();
    const client = new ProtocolPortClient(channel.port1, createUuid());
    const isolatedPreviewId = createUuid();
    const generation = createUuid();
    const loaded = new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("Issue 023 preview document load timed out.")),
        60_000,
      );
      frame.addEventListener("load", () => {
        window.clearTimeout(timer);
        const target = frame.contentWindow;
        if (!target) return reject(new Error("Issue 023 preview contentWindow is unavailable."));
        target.postMessage({
          type: "protocol.bootstrap",
          contextGeneration: generation,
          previewId: isolatedPreviewId,
          issue021Proof: input.expectedStartCode !== undefined,
          issue022Proof: false,
          issue023Proof: input.proofMode,
          issue024Proof: input.issue024Proof === true,
          issue028Proof: input.issue028Proof === true,
          runGamePipeline: true,
          issue023Case: input.runtimeCase ?? "normal",
        }, window.location.origin, [channel.port2]);
        resolve();
      }, { once: true });
    });
    const previewUrl = new URL(previewFrame.dataset.src ?? "/preview/index.html", window.location.href);
    previewUrl.searchParams.set("previewGeneration", generation);
    frame.src = previewUrl.href;
    const existingPreview = document.querySelector<HTMLIFrameElement>("#preview-frame");
    if (input.auxiliary) {
      frame.classList.add("issue23-runtime-test-frame");
      frame.style.cssText = "position:fixed;left:-2000px;top:0;width:640px;height:360px";
      document.body.append(frame);
    } else if (existingPreview) {
      existingPreview.replaceWith(frame);
    } else {
      const status = document.querySelector("#preview-context-status");
      status?.parentElement?.insertBefore(frame, status);
    }
    if (!input.auxiliary) {
      frame.id = "preview-frame";
      lastPrimaryRunFrame = frame;
    }
    await loaded;
    const contentWindow = frame.contentWindow;
    if (!contentWindow) throw new Error("Issue 023 preview contentWindow is unavailable after load.");
    const frameDomIdentity = identityFor(
      frameIdentities, frame, () => nextFrameIdentity++);
    const contentWindowIdentity = identityFor(
      windowIdentities, contentWindow, () => nextWindowIdentity++);

    const runtimeDeadline = performance.now() + 180_000;
    while (frame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1 &&
           performance.now() < runtimeDeadline) {
      await new Promise(resolve => window.setTimeout(resolve, 100));
    }
    if (frame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1) {
      throw new Error("Issue 023 preview runtime did not start.");
    }

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
    const loadRequest: PreviewLoadRequest = {
      protocolVersion: PROTOCOL_VERSION,
      correlationId: loadCorrelationId,
      type: "preview.load.request",
      payload: {
        previewId: isolatedPreviewId,
        compileId,
        assembly,
        pdb,
        binaryProof: data.binaryProof,
      },
    };
    const loadResponse = await client.request(
      loadRequest,
      "preview.load.response",
      value => validatePreviewLoadResponse(value, loadCorrelationId, isolatedPreviewId, compileId),
      [assembly, pdb],
    ) as ReturnType<typeof validatePreviewLoadResponse>;
    if (!loadResponse.message.result.success) {
      client.close(new Error("Failed preview load retired."));
      frame.remove();
      throw new Error(`${loadResponse.message.result.error.code}: ${loadResponse.message.result.error.message}`);
    }

    const startCorrelationId = createUuid();
    const wireOrder: string[] = [];
    const outputEvents: PreviewOutput[] = [];
    const removeOutputListener = client.onOutputEvent(message => {
      if (message.correlationId !== startCorrelationId) return;
      const validated = validatePreviewOutputEvent(
        message, isolatedPreviewId, startCorrelationId);
      wireOrder.push(validated.message.type);
      outputEvents.push(validated.message);
      input.onOutput?.(validated.message);
    });
    let removeListener = () => {};
    let lifecycleTimer = 0;
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
    if (input.expectedStartCode) {
      const register = frame.contentWindow?.previewIssue21RegisterExpectation;
      const portIdentity = frame.contentWindow?.previewIssue21Proof?.bootstrap?.portIdentity;
      if (typeof register !== "function" || typeof portIdentity !== "string") {
        throw new Error("Expected start outcome registry is unavailable.");
      }
      register({
        contextGeneration: generation,
        portIdentity,
        correlationId: startCorrelationId,
        requestType: "preview.start.request",
        responseType: "preview.start.response",
        probePhase: "unexpected-start-boundary",
        expectedCode: input.expectedStartCode,
      });
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
            error => {
              removeListener();
              removeOutputListener();
              client.close(error);
              frame.remove();
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
      const endpointSnapshot = input.proofMode
        ? frame.contentWindow?.previewIssue023EndpointSnapshot?.() ?? null
        : null;
      const beforeRetirement = {
        iframeConnected: frame.isConnected,
        portClosed: client.isClosed,
      };
      removeListener();
      removeOutputListener();
      window.clearTimeout(lifecycleTimer);
      client.close(failure);
      frame.remove();
      Object.assign(failure, {
        failureProof: {
          elapsedMilliseconds: performance.now() - startRequestAt,
          iframeConnected: frame.isConnected,
          portClosed: client.isClosed,
          hostCloseReason: client.closeReason,
          clientObservations: { ...client.observations },
          wireOrder: [...wireOrder],
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
            window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 2_000)),
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
              150,
            );
          } catch (error) {
            subsequentRequestFailure =
              error instanceof Error ? error.message : String(error);
          }
        }
        const endpointSnapshot = input.proofMode
          ? frame.contentWindow?.previewIssue023EndpointSnapshot?.() ?? null
          : null;
        const beforeRetirement = {
          iframeConnected: frame.isConnected,
          portClosed: client.isClosed,
        };
        const failureProof = {
          wireOrder: [...wireOrder],
          stoppedEvent,
          preview: frame.contentWindow?.previewIssue023Proof,
          endpointSnapshot,
          subsequentRequestFailure,
          beforeRetirement,
        };
        removeListener();
        removeOutputListener();
        client.close(new Error("Failed preview retired."));
        frame.remove();
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

    const generatedObjectUrls = new Set<string>();
    if (input.issue024Proof) {
      generatedObjectUrls.add(URL.createObjectURL(new Blob(
        [input.sourceText], { type: "text/plain" })));
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
          payload: { previewId: isolatedPreviewId, reason, timeoutMs: 2_000 },
        };
        try {
          const response = await client.request(
            request,
            "preview.stop.response",
            value => validatePreviewStopResponse(value, correlationId, isolatedPreviewId),
            [],
            2_000,
          ) as ReturnType<typeof validatePreviewStopResponse>;
          wireOrder.push(response.message.type);
          if (!response.message.result.success) {
            await Promise.race([
              stopped,
              new Promise<never>((_, reject) =>
                window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 2_000)),
            ]);
            throw new Error(
              `${response.message.result.error.code}: ${response.message.result.error.message}`);
          }
          if (response.message.result.data.accepted) {
            await Promise.race([
              stopped,
              new Promise<never>((_, reject) =>
                window.setTimeout(() => reject(new Error("preview.stopped timed out.")), 2_000)),
            ]);
          }
          if (input.issue028Proof) {
            frame.contentWindow?.previewIssue028EmitNativePaths?.();
            await new Promise(resolve => window.setTimeout(resolve, 20));
          }
          const runtime = frame.contentWindow?.previewIssue024Snapshot?.() ?? null;
          const wasConnectedAtStopped = frame.isConnected;
          removeStopListener();
          removeOutputListener();
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
          frame.remove();
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
          client.close(error);
          for (const url of generatedObjectUrls) URL.revokeObjectURL(url);
          generatedObjectUrls.clear();
          frame.remove();
          throw error;
        }
      })();
      return stopOperation;
    };

    return {
      frame,
      contextGeneration: generation,
      portIdentity: client.portIdentity,
      frameDomIdentity,
      contentWindowIdentity,
      previousIframeRemovedBeforeCreation,
      documentUrl: frame.src,
      compileId,
      previewId: isolatedPreviewId,
      compileCorrelationId,
      loadCorrelationId,
      startCorrelationId,
      compileDiagnostics: data.diagnostics,
      compilerRuntimeStarts: compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts ?? 0,
      previewRuntimeStarts: frame.contentWindow?.previewIssue21Proof?.runtimeStarts ?? 0,
      loadResponse: loadResponse.message,
      startResponse: startResponse.message,
      startedEvent,
      transfer: {
        assemblySenderDetached: assembly.byteLength === 0,
        pdbSenderDetached: pdb.byteLength === 0,
      },
      wireOrder,
      outputEvents,
      probes,
      client,
      async query() {
        const query = frame.contentWindow?.previewIssue023Query;
        if (typeof query !== "function") throw new Error("Issue 023 managed query is unavailable.");
        return query();
      },
      stop,
      async teardown() {
        return stop("user");
      },
    };
}

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
import {
  assertPreviewSandbox,
  createPreviewBridge,
  createPreviewIframe,
  loadPreviewIframe,
  previewBridgeFor,
  type PreviewBridge,
} from "./preview-frame";

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
assertPreviewSandbox(previewFrame);
const initialPreviewBridge = createPreviewBridge(previewFrame);
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
) => Promise<ProbeExpectation>;

function bootstrap(
  frame: HTMLIFrameElement,
  channel: MessageChannel,
  generation: UuidV4,
  kind: "compiler" | "preview",
  bridge?: PreviewBridge,
) {
  if (kind === "preview" && initialPreviewRetired) return;
  if ((kind === "compiler" && compilerBootstrapped) || (kind === "preview" && previewBootstrapped)) return;
  const target = frame.contentWindow;
  if (!target) throw new Error(`${kind} contentWindow is unavailable.`);
  const bootstrapMessage = kind === "preview"
    ? { type: "protocol.bootstrap", contextGeneration: generation, previewId, issue021Proof: proofModeAuthorized }
    : { type: "protocol.bootstrap", contextGeneration: generation, issue021Proof: proofModeAuthorized };
  const transfer = bridge ? [channel.port2, bridge.childPort] : [channel.port2];
  target.postMessage(
    bootstrapMessage,
    kind === "preview" ? "*" : window.location.origin,
    transfer,
  );
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
      initialPreviewBridge.close();
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
  if (previewFrame.srcdoc) {
    bootstrap(previewFrame, previewChannel, previewGeneration, "preview", initialPreviewBridge);
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

async function startPreviewAfterTopRuntime() {
  await waitForTopRuntime();
  if (!previewFrame.srcdoc) loadPreviewIframe(previewFrame);
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
  if (!previewFrame.srcdoc) loadPreviewIframe(previewFrame);

  registerPreviewProbeExpectation = (
    frame: HTMLIFrameElement,
    contextGeneration: UuidV4,
    correlationId: UuidV4,
    probePhase: string,
    expectedCode: string,
  ): Promise<ProbeExpectation> => {
    if (!proofModeAuthorized) throw new Error("Proof expectation registration is not authorized.");
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
  if (!compilerFrame.getAttribute("src")) {
    compilerFrame.setAttribute("src", compilerFrame.dataset.src ?? "/compiler/index.html");
  }
  let previewReady = compilerOnly;
  if (!compilerOnly) void initialPreviewBridge.ready.then(() => { previewReady = true; });
  const deadline = performance.now() + 180_000;
  while ((!compilerBootstrapped || (!compilerOnly && !previewBootstrapped) ||
          compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts !== 1 ||
          !previewReady) &&
         performance.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  if (!compilerBootstrapped || (!compilerOnly && !previewBootstrapped) ||
      compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts !== 1 ||
      !previewReady) {
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
  await ensureIssue21Contexts(false, true);
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
    onOutput?: (event: PreviewOutput) => void;
  }): Promise<Issue23RunningPreview> {
    await ensureIssue21Contexts(false, true);
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
    const assembly = standaloneBuffer(new Uint8Array(data.assembly));
    const pdb = standaloneBuffer(new Uint8Array(data.pdb));
    if (!input.auxiliary) await retireInitialPreviewContext();
    const previousIframeRemovedBeforeCreation =
      input.auxiliary === true || lastPrimaryRunFrame === null || !lastPrimaryRunFrame.isConnected;
    if (!previousIframeRemovedBeforeCreation) {
      throw new Error("The previous preview must be stopped and removed before restart.");
    }
    const frame = createPreviewIframe();
    const bridge = createPreviewBridge(frame);
    frame.className = "issue23-run-frame";
    frame.title = "Running clear-color Game preview";
    if (!input.auxiliary) frame.id = "preview-frame";
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
          issue030Proof: input.issue030Proof === true,
          issue033Proof: input.issue033Proof === true,
          runGamePipeline: true,
          issue023Case: input.runtimeCase ?? "normal",
        }, "*", [channel.port2, bridge.childPort]);
        resolve();
      }, { once: true });
    });
    loadPreviewIframe(frame);
    const existingPreview = document.querySelector<HTMLIFrameElement>("#preview-frame");
    if (input.auxiliary) {
      frame.classList.add("issue23-runtime-test-frame");
      frame.style.cssText =
        "position:fixed;left:0;bottom:0;width:640px;height:360px;z-index:2147483646";
      document.body.append(frame);
    } else if (existingPreview) {
      existingPreview.replaceWith(frame);
    } else {
      const status = document.querySelector("#preview-context-status");
      status?.parentElement?.insertBefore(frame, status);
    }
    if (!input.auxiliary) {
      lastPrimaryRunFrame = frame;
    }
    await loaded;
    const contentWindow = frame.contentWindow;
    if (!contentWindow) throw new Error("Issue 023 preview contentWindow is unavailable after load.");
    const frameDomIdentity = identityFor(
      frameIdentities, frame, () => nextFrameIdentity++);
    const contentWindowIdentity = identityFor(
      windowIdentities, contentWindow, () => nextWindowIdentity++);

    await bridge.ready;
    const frameReadiness = await requireVisiblePreviewFrame(frame, bridge);

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
      bridge.close();
      frame.remove();
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
          frame.remove();
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
    if (input.expectedStartCode) {
      const issue21Proof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
      const portIdentity = issue21Proof.bootstrap?.portIdentity;
      if (typeof portIdentity !== "string") {
        throw new Error("Expected start outcome registry is unavailable.");
      }
      await bridge.request("register-expectation", {
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
              removeRuntimeFailureListener();
              client.close(error);
              bridge.close();
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
      frame.remove();
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
          removeRuntimeFailureListener();
          client.close(error);
          for (const url of generatedObjectUrls) URL.revokeObjectURL(url);
          generatedObjectUrls.clear();
          bridge.close();
          frame.remove();
          throw error;
        }
      })();
      return stopOperation;
    };

    const issue21Proof = await bridge.request<ContextProof>("snapshot", { name: "issue21" });
    return {
      frame,
      contextGeneration: generation,
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

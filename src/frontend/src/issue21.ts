import {
  PROTOCOL_VERSION,
  type BinaryProof,
  type CompileRequest,
  type PreviewLoadRequest,
  type UuidV4,
} from "../../shared/MessageContracts";
import {
  inspectClone,
  ProtocolPortClient,
  sha256,
  standaloneBuffer,
  validateCompileResponse,
  validatePreviewLoadResponse,
} from "./protocol";
import {
  createIssue21LoadController,
  verifyIssue21ProofOutcomes,
} from "./issue21-controller";

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
  requestType: "preview.load.request";
  responseType: "preview.load.response";
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
  }
}

function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

const createUuid = () => crypto.randomUUID() as UuidV4;
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

async function ensureIssue21Contexts(allowLockedSession = false) {
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
  while ((!compilerBootstrapped || !previewBootstrapped ||
          compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts !== 1 ||
          previewFrame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1) &&
         performance.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  if (!compilerBootstrapped || !previewBootstrapped ||
      compilerFrame.contentWindow?.compilerIssue21Proof?.runtimeStarts !== 1 ||
      previewFrame.contentWindow?.previewIssue21Proof?.runtimeStarts !== 1) {
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
  const lockedSession = await invoke<boolean>("issue021_is_locked_session_proof");
  if (!lockedSession) await waitForTopRuntime();
  proofModeAuthorized = true;
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

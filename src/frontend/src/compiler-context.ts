// Shared compiler/preview runtime context (Stage-2 production/proof extraction).
//
// This module owns the SINGLE, process-wide compiler + preview iframe context
// that both the shipping product live-preview flow (`live-preview.ts`, wired by
// `run-stop.ts` → `app.ts`) and the historical per-issue proofs (`scenario-toolkit.ts`
// and the `issueXX` proof modules) drive. It was extracted out of the former
// mixed `scenario-toolkit.ts` so the product graph can reach the real compiler context
// WITHOUT importing any issue-numbered/auto-proof module.
//
// It is production-neutral: it defines no proof markers and no auto-proof entry
// functions. Proof-only behaviour (the post-mutation taint prover and the
// preview probe-expectation registrar) is injected by `scenario-toolkit.ts` at module
// load through `registerContextSetup(...)`, so the product build never links
// that code.
//
// Ownership / cleanup invariants preserved from the original module:
//   * exactly one persistent compiler iframe + client and one initial preview
//     iframe + client, bootstrapped once via `bootstrap(...)`;
//   * `retireInitialPreviewContext()` cooperatively stops and removes the
//     initial preview context before the first in-page Game run, idempotently;
//   * MessagePort ownership and transferable buffers flow through
//     `ProtocolPortClient` (see protocol.ts / ProtocolRuntime); this module does
//     not fork protocol validation.

import {
  PROTOCOL_VERSION,
  type PreviewStopRequest,
  type UuidV4,
} from "../../shared/MessageContracts";
import {
  ProtocolPortClient,
  validatePreviewStopResponse,
} from "./protocol";
import {
  assertPreviewSandbox,
  createPreviewBridge,
  loadPreviewIframe,
  type PreviewBridge,
} from "./preview-frame";

// Product-neutral compiler runtime readiness signal. The product compiler
// harness (compiler-harness.js) increments this exactly once after its single
// runtime start; the shell reads it to confirm the persistent compiler context
// is up WITHOUT depending on any proof global. The proof extension maintains its
// own `compilerIssue21Proof.runtimeStarts` separately (for proof reporting).
declare global {
  interface Window {
    __playgroundCompilerRuntimeStarts?: number;
  }
}

export function requiredElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required element is missing: ${selector}`);
  return element;
}

export const createUuid = () => crypto.randomUUID() as UuidV4;

// ── Persistent context iframes / clients / channels ─────────────────────────
export const compilerFrame = requiredElement<HTMLIFrameElement>("#compiler-frame");
export const previewFrame = requiredElement<HTMLIFrameElement>("#preview-frame");
assertPreviewSandbox(previewFrame);
export const initialPreviewBridge = createPreviewBridge(previewFrame);

const compilerGeneration = createUuid();
export const previewGeneration = createUuid();
export const previewId = createUuid();
const compilerChannel = new MessageChannel();
const previewChannel = new MessageChannel();
export const compilerClient = new ProtocolPortClient(compilerChannel.port1, createUuid());
export const previewClient = new ProtocolPortClient(previewChannel.port1, createUuid());

export const hostTransport = {
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

// Neutral bootstrap augmentation seam. Optional, separately-loaded extensions
// (proof only) may register a contributor that adds fields to the child
// bootstrap message. The PRODUCT build registers nothing, so the product
// bootstrap carries only the neutral protocol fields (`type`,
// `contextGeneration`, and `previewId` for the preview child) and no proof
// authorization variable.
type BootstrapAugmentation = (kind: "compiler" | "preview") => Record<string, unknown>;
const bootstrapAugmentations: BootstrapAugmentation[] = [];
export function registerBootstrapAugmentation(augment: BootstrapAugmentation): void {
  bootstrapAugmentations.push(augment);
}
// Applies every registered augmentation for a bootstrap `kind`, returning the
// merged extra fields. Product registers no augmentation, so this returns `{}`
// and product bootstrap messages carry only neutral protocol fields. Used by
// both the compiler-context `bootstrap()` and the product live-preview Run path.
export function bootstrapAugmentationFields(kind: "compiler" | "preview"): Record<string, unknown> {
  return bootstrapAugmentations.reduce(
    (acc, augment) => ({ ...acc, ...augment(kind) }), {} as Record<string, unknown>);
}

// The current live in-page preview iframe (product Run + in-page proof runners
// share this so a restart retires the previous one).
let livePreviewFrame: HTMLIFrameElement | null = null;
export const getLivePreviewFrame = () => livePreviewFrame;
export const setLivePreviewFrame = (frame: HTMLIFrameElement | null) => { livePreviewFrame = frame; };

// The last primary (non-auxiliary) run frame (former issue 038 proof naming).
let lastPrimaryRunFrame: HTMLIFrameElement | null = null;
export const getLastPrimaryRunFrame = () => lastPrimaryRunFrame;
export const setLastPrimaryRunFrame = (frame: HTMLIFrameElement | null) => { lastPrimaryRunFrame = frame; };

let nextFrameIdentity = 1;
let nextWindowIdentity = 1;
export const allocFrameDomIdentity = () => nextFrameIdentity++;
export const allocContentWindowIdentity = () => nextWindowIdentity++;

// Proof-only context extensions injected by scenario-toolkit.ts. Each registered setup
// runs at the top of every `ensureContexts()` call, exactly where the original
// module assigned its proof closures. Product registers nothing.
const contextSetups: Array<() => void> = [];
export function registerContextSetup(setup: () => void): void {
  contextSetups.push(setup);
}

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
  const bootstrapMessage = {
    type: "protocol.bootstrap",
    contextGeneration: generation,
    ...(kind === "preview" ? { previewId } : {}),
    ...bootstrapAugmentationFields(kind),
  };
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

export function retireInitialPreviewContext() {
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

export async function waitForTopRuntime() {
  // Shell readiness means that the Workbench document is visible and has
  // painted at least one animation frame. The compiler and preview iframes load
  // their WASM runtimes independently and report readiness through their own
  // authenticated bridges.
  const deadline = performance.now() + 120_000;
  const paintedFrame = () => new Promise<boolean>(resolve => {
    const timer = window.setTimeout(() => resolve(false), 500);
    requestAnimationFrame(() => { window.clearTimeout(timer); resolve(true); });
  });
  while (performance.now() < deadline) {
    if (document.visibilityState === "visible" && await paintedFrame()) return;
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  throw new Error("Top-level shell did not reach a painting steady state.");
}

function previewStatusFallback(message: string) {
  const status = document.querySelector<HTMLElement>("#preview-context-status");
  if (status) status.textContent = message;
}

async function startPreviewAfterTopRuntime() {
  await waitForTopRuntime();
  if (!previewFrame.srcdoc) loadPreviewIframe(previewFrame);
}

void startPreviewAfterTopRuntime().catch(() => {
  previewStatusFallback("Preview deferred until the top-level runtime can render.");
});

// Ensure the persistent compiler (and, unless `compilerOnly`, the initial
// preview) contexts are bootstrapped and their runtimes have started. Runs any
// registered proof context-setup hooks first (product registers none).
export async function ensureContexts(allowLockedSession = false, compilerOnly = false) {
  if (!allowLockedSession && !compilerOnly) await waitForTopRuntime();
  if (!previewFrame.srcdoc) loadPreviewIframe(previewFrame);

  for (const setup of contextSetups) setup();

  if (!compilerFrame.getAttribute("src")) {
    compilerFrame.setAttribute("src", compilerFrame.dataset.src ?? "/compiler/index.html");
  }
  let previewReady = compilerOnly;
  if (!compilerOnly) void initialPreviewBridge.ready.then(() => { previewReady = true; });
  const deadline = performance.now() + 180_000;
  while ((!compilerBootstrapped || (!compilerOnly && !previewBootstrapped) ||
          compilerFrame.contentWindow?.__playgroundCompilerRuntimeStarts !== 1 ||
          !previewReady) &&
         performance.now() < deadline) {
    await new Promise(resolve => window.setTimeout(resolve, 100));
  }
  if (!compilerBootstrapped || (!compilerOnly && !previewBootstrapped) ||
      compilerFrame.contentWindow?.__playgroundCompilerRuntimeStarts !== 1 ||
      !previewReady) {
    throw new Error("Compiler or preview runtime did not become ready.");
  }
}

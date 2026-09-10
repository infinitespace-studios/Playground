// PROOF-only preview state & expectation bootstrap module.
//
// Deployed ONLY by the PROOF staging profile (see Playground.Preview.csproj /
// stage-preview.mjs). Owns the proof state object, the full family of
// `previewIssueNNProof` proof globals, the `#proof-state` render, and the
// bootstrap surface (data validation, per-issue enable gating, proof endpoint
// expectation registry wiring, and the issue-023 start configuration). The
// PRODUCT preview never loads this module, so the shipped preview carries none
// of these proof globals or the expectation registry.
//
// Loaded by preview-proof-extension.js (the one proof entry module) BEFORE the
// audio/bridge/lifecycle modules so the proof globals exist before any observer
// or bridge action reads them. Behavior is preserved byte-for-byte from the
// former monolithic preview-proof-extension.js.

import { createProofExpectationRegistry } from "./ProtocolEndpointsProof.js";

export function createPreviewProofState(ctx) {
  const { controls } = ctx;
  const realmToken = ctx.realmToken;
  const output = ctx.output;

  const proofState = {
    protocolVersion: 1,
    ready: false,
    startupAttempts: 0,
    successfulRuntimeStarts: 0,
    trustedClickCount: 0,
    realmToken,
    parentWindowDistinct: window !== parent,
    runtimeAsset: null,
    autoReadyPing: null,
    ping: null,
    errors: [],
  };

  globalThis.previewProof = proofState;
  globalThis.previewIssue21Proof = {
    runtimeStarts: 0,
    load: null,
    bootstrap: null,
    requests: [],
    state: "stopped",
    rejections: [],
    errors: [],
    expectedProbeRejections: [],
    expiredProbeExpectations: [],
    endpoint: { terminals: [], closes: [] },
    lastManagedFailure: null,
  };
  globalThis.previewIssue22Proof = {
    enabled: false,
    pipeline: null,
    repeatedPipeline: null,
    beforeLoad: null,
    repeatMatched: null,
    teardown: [],
    errors: [],
  };
  globalThis.previewIssue023Proof = {
    enabled: false,
    start: null,
    events: [],
    queries: [],
    errors: [],
  };
  globalThis.previewIssue024Proof = {
    enabled: false,
    stop: null,
    animationFrameCancellations: 0,
    webglDeleteCalls: 0,
    audioCloseCalls: 0,
    errors: [],
  };
  globalThis.previewIssue028Proof = { enabled: false };
  globalThis.previewIssue030Proof = { enabled: false, samples: [], errors: [] };
  globalThis.previewIssue033Proof = { enabled: false };
  globalThis.previewIssue034Proof = { enabled: false };
  globalThis.previewIssue035Proof = { enabled: false };
  globalThis.previewIssue036Proof = { enabled: false };
  globalThis.previewIssue039Proof = {
    enabled: false,
    mounts: [],
    mountFailures: [],
    errors: [],
  };
  globalThis.previewIssue040Proof = {
    enabled: false,
    installed: false,
    contexts: [],
    inputEvents: [],
    resumeAttempts: [],
    analyserInstalled: false,
    destinationConnections: 0,
    errors: [],
  };

  function render() {
    if (output) output.textContent = JSON.stringify(proofState, null, 2);
  }

  ctx.proofState = proofState;
  ctx.render = render;

  return {
    proofState,
    render,
    bootstrap: {
      validateData(data) {
        return Object.hasOwn(data, "issue021Proof") && typeof data.issue021Proof === "boolean" &&
          (!Object.hasOwn(data, "issue022Proof") || typeof data.issue022Proof === "boolean") &&
          (!Object.hasOwn(data, "issue023Proof") || typeof data.issue023Proof === "boolean") &&
          (!Object.hasOwn(data, "issue024Proof") || typeof data.issue024Proof === "boolean") &&
          (!Object.hasOwn(data, "issue028Proof") || typeof data.issue028Proof === "boolean") &&
          (!Object.hasOwn(data, "issue030Proof") || typeof data.issue030Proof === "boolean") &&
          (!Object.hasOwn(data, "issue033Proof") || typeof data.issue033Proof === "boolean") &&
          (!Object.hasOwn(data, "issue034Proof") || typeof data.issue034Proof === "boolean") &&
          (!Object.hasOwn(data, "issue035Proof") || typeof data.issue035Proof === "boolean") &&
          (!Object.hasOwn(data, "issue036Proof") || typeof data.issue036Proof === "boolean") &&
          (!Object.hasOwn(data, "issue039Proof") || typeof data.issue039Proof === "boolean") &&
          (!Object.hasOwn(data, "issue040Proof") || typeof data.issue040Proof === "boolean") &&
          (!Object.hasOwn(data, "issue023Case") ||
            typeof data.issue023Case === "string" &&
            ["normal", "delay-run", "delay-run-late", "delay-run-long", "delay-event", "unexpected"]
              .includes(data.issue023Case));
      },
      onBootstrap(data, installIssue040AudioProbe) {
        ctx.issue023ProofEnabled = data.issue023Proof === true;
        ctx.issue023Case = ctx.issue023ProofEnabled ? data.issue023Case ?? "normal" : "normal";
        globalThis.previewIssue22Proof.enabled = data.issue022Proof === true;
        globalThis.previewIssue023Proof.enabled = ctx.issue023ProofEnabled;
        globalThis.previewIssue024Proof.enabled = data.issue024Proof === true;
        globalThis.previewIssue028Proof.enabled = data.issue028Proof === true;
        globalThis.previewIssue030Proof.enabled = data.issue030Proof === true;
        globalThis.previewIssue033Proof.enabled = data.issue033Proof === true;
        globalThis.previewIssue034Proof.enabled = data.issue034Proof === true;
        globalThis.previewIssue035Proof.enabled = data.issue035Proof === true;
        globalThis.previewIssue036Proof.enabled = data.issue036Proof === true;
        globalThis.previewIssue039Proof.enabled = data.issue039Proof === true;
        globalThis.previewIssue040Proof.enabled = data.issue040Proof === true;
        if (globalThis.previewIssue040Proof.enabled) installIssue040AudioProbe();
        return { constructAfterLoad: data.issue022Proof === true };
      },
      endpointParams({ contextGeneration, portIdentity, data }) {
        globalThis.previewIssue21Proof.bootstrap = controls.bootstrapObservations;
        const expectationRegistry = createProofExpectationRegistry({
          authorized: data.issue021Proof,
          contextGeneration,
          portIdentity,
          expectedRejections: globalThis.previewIssue21Proof.expectedProbeRejections,
          unexpectedErrors: globalThis.previewIssue21Proof.errors,
          expiredExpectations: globalThis.previewIssue21Proof.expiredProbeExpectations,
        });
        globalThis.previewIssue21RegisterExpectation = data.issue021Proof
          ? expectation => expectationRegistry.register(expectation)
          : undefined;
        globalThis.previewIssue21RemoveExpectation = data.issue021Proof
          ? correlationId => expectationRegistry.remove(correlationId)
          : undefined;
        const endpointProof = {
          errors: globalThis.previewIssue21Proof.errors,
          terminals: globalThis.previewIssue21Proof.endpoint.terminals,
          closes: globalThis.previewIssue21Proof.endpoint.closes,
          events: globalThis.previewIssue023Proof.events,
          duplicateControls: [],
        };
        return {
          expectations: data.issue021Proof ? expectationRegistry : undefined,
          observer: endpointProof,
        };
      },
      startConfig() {
        return {
          beforeRunDelayMs: ctx.issue023Case === "delay-run"
            ? 150
            : ctx.issue023Case === "delay-run-late"
              ? 800
              : ctx.issue023Case === "delay-run-long" ? 2_500 : 0,
          startedEventDelayMs: ctx.issue023Case === "delay-event" ? 150 : 0,
          throwUnexpectedBeforeExport: ctx.issue023Case === "unexpected",
        };
      },
    },
  };
}

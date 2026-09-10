// PROOF-only preview runtime extension — entry module.
//
// Deployed ONLY by the PROOF staging profile (see Playground.Preview.csproj /
// stage-preview.mjs). The PRODUCT preview document never loads this module, so
// the shipped preview.js carries no proof globals, audio probe, issueNN action
// dispatch, expectation registry, proof DOM/state, self-test exports, or
// fixtures/observer.
//
// This module assigns `globalThis.__playgroundPreviewExtension` BEFORE preview.js
// evaluates (the proof srcdoc lists it first). preview.js invokes the factory
// with a neutral `controls` surface and consults the returned `observe` /
// `bootstrap` hooks at its lifecycle sites, so every proof behavior that used to
// live inline in preview.js is preserved here byte-for-byte.
//
// Stage 7: the former ~1187-line monolith was split by proof domain into four
// responsibility modules — this entry retains the exact initialization order:
//   1. preview-proof-state.js    — proof state object, the previewIssueNNProof
//                                   global family, `#proof-state` render, and the
//                                   bootstrap validate/enable/endpoint/start
//                                   surface (proof expectation registry).
//   2. preview-proof-audio.js    — the issue-040 Web Audio probe / snapshot /
//                                   analyser-tap sampler.
//   3. preview-proof-bridge.js   — the `bridgeAction` dispatcher (snapshots,
//                                   audio arm/lock/sample, content/security
//                                   self-tests, WebGL/animation-frame sampling).
//   4. preview-proof-lifecycle.js — deferred self-test globals, pagehide teardown,
//                                    stop-phase instrumentation, the ping handler,
//                                    and the `observe` lifecycle hooks.
// The entry constructs the shared context, invokes each module in the original
// order, and returns the same `{ observe, bootstrap }` surface preview.js expects.

import { createPreviewProofState } from "./preview-proof-state.js";
import { createPreviewProofAudio } from "./preview-proof-audio.js";
import { createPreviewProofBridge } from "./preview-proof-bridge.js";
import { createPreviewProofLifecycle } from "./preview-proof-lifecycle.js";

globalThis.__playgroundPreviewExtension = controls => {
  const ctx = {
    controls,
    realmToken: controls.realmToken,
    output: document.querySelector("#proof-state"),
    pingButton: document.querySelector("#ping"),
    status: document.querySelector("#status"),
    issue023ProofEnabled: false,
    issue023Case: "normal",
  };

  // 1. Proof state + globals + render + bootstrap surface (must run first so the
  //    previewIssueNNProof globals and `ctx.render` exist for the later modules).
  const state = createPreviewProofState(ctx);
  // 2. Audio instrumentation (no side effects until install() is invoked from
  //    bootstrap's onBootstrap, preserving the original ordering).
  const audio = createPreviewProofAudio();
  // 3. Bridge action dispatcher (function definitions only, no side effects).
  const bridge = createPreviewProofBridge(ctx, audio);
  // 4. Deferred self-test globals + instrumentation + ping handler + observers.
  const lifecycle = createPreviewProofLifecycle(ctx);

  state.render();

  return {
    observe: lifecycle.observe,
    bootstrap: {
      validateData: state.bootstrap.validateData,
      onBootstrap: data => state.bootstrap.onBootstrap(data, audio.install),
      endpointParams: state.bootstrap.endpointParams,
      startConfig: state.bootstrap.startConfig,
      bridgeAction: bridge.bridgeAction,
    },
  };
};

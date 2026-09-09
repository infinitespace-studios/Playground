// PROOF-only shared protocol instrumentation.
//
// This module holds the proof-scenario expectation registry and the compiler
// proof-mode handshake that used to live in the shared `Issue21Endpoints.js`.
// It is staged ONLY into the PROOF profile (see Playground.Compiler.csproj /
// Playground.Preview.csproj proof conditions and the proof staging scripts), so
// the product-staged shared JS carries only the protocol endpoint plumbing and
// the binary-integrity envelope, never a proof marker/registry/handshake.
//
// `Issue21Endpoints.js` (product) still owns `createEndpoint` and the compiler/
// preview endpoint factories; those accept an optional `expectations` registry
// (produced here) as a plain parameter, so the split is a clean lift with no
// product coupling. `ProtocolRuntime.js::validateBinaryProof` remains PRODUCT.

import { isUuidV4 } from "./ProtocolRuntime.js";

export function createProofExpectationRegistry({
  authorized,
  contextGeneration,
  portIdentity,
  expectedRejections = [],
  unexpectedErrors = [],
  expiredExpectations = [],
}) {
  const entries = new Map();
  const register = (expectation, timeoutMs = 10000) => {
    if (authorized !== true ||
        expectation?.contextGeneration !== contextGeneration ||
        expectation?.portIdentity !== portIdentity ||
        !isUuidV4(expectation?.correlationId) ||
        typeof expectation?.requestType !== "string" ||
        typeof expectation?.responseType !== "string" ||
        typeof expectation?.probePhase !== "string" ||
        typeof expectation?.expectedCode !== "string" ||
        !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 10000 ||
        entries.has(expectation.correlationId)) {
      return false;
    }
    const entry = Object.freeze({ ...expectation });
    const timer = setTimeout(() => {
      if (entries.get(entry.correlationId)?.entry === entry) {
        entries.delete(entry.correlationId);
        expiredExpectations.push(entry);
      }
    }, timeoutMs);
    entries.set(entry.correlationId, { entry, timer });
    return true;
  };
  const consume = observed => {
    const retained = entries.get(observed.correlationId);
    if (!retained ||
        retained.entry.contextGeneration !== observed.contextGeneration ||
        retained.entry.portIdentity !== observed.portIdentity ||
        retained.entry.requestType !== observed.requestType ||
        retained.entry.responseType !== observed.responseType ||
        retained.entry.probePhase !== observed.probePhase ||
        retained.entry.expectedCode !== observed.code) {
      unexpectedErrors.push(observed.code);
      return false;
    }
    clearTimeout(retained.timer);
    entries.delete(observed.correlationId);
    expectedRejections.push(Object.freeze({
      ...retained.entry,
      observedCode: observed.code,
    }));
    return true;
  };
  const phaseFor = correlationId => entries.get(correlationId)?.entry.probePhase;
  const remove = correlationId => {
    const retained = entries.get(correlationId);
    if (!retained) return false;
    clearTimeout(retained.timer);
    entries.delete(correlationId);
    return true;
  };
  return Object.freeze({
    register,
    consume,
    phaseFor,
    remove,
    get size() { return entries.size; },
  });
}

export async function initializeCompilerProofMode(proofAuthorized, runProof) {
  if (proofAuthorized !== true) return Object.freeze({ enabled: false });
  return Object.freeze({ enabled: true, ...(await runProof()) });
}

# Validate forged/malformed/oversized protocol messages

**Type:** AFK
**Status:** Done
**Blocked by:** [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md), [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md)
**PRD references:** 9.7, 16, 22.6
**User stories:** US9
**Triage:** needs-triage

## Context

PRD section 9.7 requires every protocol message to include a validated payload schema and requires the protocol to define maximum request/asset sizes. Section 16 requires validating protocol version, message source, message type, and payload schema, and preventing forged protocol messages from succeeding. Section 22.6 explicitly requires tests for forged, unknown-version, oversized, and malformed protocol messages. This issue implements the actual validation logic (referencing the envelope/limits defined in `src/shared/Protocol.md` from issue 15) at both the top-level frontend's message receiver (validating messages claiming to come from the preview) and the preview's message receiver (validating messages claiming to come from the top-level frontend), and proves each of the four forged/malformed/oversized/unknown-version cases is rejected with a structured error rather than being processed or crashing anything.

## What to build

Implement a shared `validateEnvelope(message, expectedOrigin)` function (duplicated identically, or shared via a common module, on both the top-level frontend side and the preview side) that checks `protocolVersion` matches the supported version from `src/shared/Protocol.md`, `event.origin`/`event.source` matches the expected sender window, `type` is a recognized message type, and the payload matches its expected schema shape and declared size limits, rejecting anything that fails any check with a logged, structured error and no further processing.

## Scope

### In scope

- `validateEnvelope` implemented at both message-receiving boundaries (top-level ↔ preview)
- Four explicit test cases: (1) a forged message with a fabricated/incorrect `event.origin`, (2) a message with an unsupported/missing `protocolVersion`, (3) an oversized payload exceeding the documented size limit from issue 15's `Protocol.md`, (4) a structurally malformed message (missing required envelope fields, or a payload that does not match its type's expected schema)
- Confirming each of the four cases is rejected without throwing an unhandled exception and without triggering any unintended side effect (e.g. a forged `preview.load` message must not actually load an assembly)

### Out of scope

- General navigation/network denial (issue 35, already covered)
- Shell IPC denial (issue 34, already covered)
- Building a full JSON-schema validation library dependency if a small hand-written validator suffices for the message shapes defined in issue 15 (prefer a lightweight, dependency-free check unless the project already needs a schema library for another reason)

## Implementation guidance

1. Implement `validateEnvelope` (e.g. in a new shared frontend module `src/frontend/src/protocol/validate.ts`, and an equivalent check inside the preview's own boot JS):
```typescript
const SUPPORTED_PROTOCOL_VERSION = 1;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024; // must match src/shared/Protocol.md's documented limit

export function validateEnvelope(event: MessageEvent, expectedOriginPredicate: (origin: string) => boolean):
  { ok: true; envelope: Envelope } | { ok: false; reason: string } {
  if (!expectedOriginPredicate(event.origin)) return { ok: false, reason: "origin mismatch" };
  const msg = event.data;
  if (typeof msg !== "object" || msg === null) return { ok: false, reason: "malformed: not an object" };
  if (msg.protocolVersion !== SUPPORTED_PROTOCOL_VERSION) return { ok: false, reason: "unsupported protocol version" };
  if (typeof msg.correlationId !== "string" || typeof msg.type !== "string") return { ok: false, reason: "malformed: missing required fields" };
  if (!KNOWN_MESSAGE_TYPES.has(msg.type)) return { ok: false, reason: "unknown message type" };
  const approxSize = JSON.stringify(msg).length; // for structural checks; binary transfers are size-checked separately via their ArrayBuffer.byteLength
  if (approxSize > MAX_MESSAGE_BYTES) return { ok: false, reason: "oversized message" };
  // Add per-type payload shape checks here for every type in KNOWN_MESSAGE_TYPES.
  return { ok: true, envelope: msg as Envelope };
}
```
2. Wire this into every `window.addEventListener("message", ...)` handler on both the top-level frontend and the preview boot script, rejecting (logging and returning early) on any `{ ok: false }` result before any existing message-type handling logic runs.
3. Write four test scripts (temporary devtools console snippets or a small test harness page) that construct and `postMessage` each of the four bad cases directly at the preview iframe's `contentWindow` (bypassing the normal frontend code path, to simulate a forged message from an untrusted source): wrong origin (post from a different simulated origin if feasible, or directly call the validator function with a mismatched origin string as a unit-level test since actually spoofing `event.origin` from application code is not possible — note this distinction in the test), wrong protocol version, an oversized string payload, and a payload missing `correlationId`.
4. Confirm each of the four is rejected (no assembly loaded, no game run, no crash) and a rejection reason is logged.

## Acceptance criteria

- [x] A message with a mismatched/unexpected origin is rejected before any handler logic runs
- [x] A message with an unsupported or missing `protocolVersion` is rejected
- [x] A message exceeding the documented maximum size is rejected
- [x] A structurally malformed message (missing required envelope fields, e.g. `correlationId`) is rejected
- [x] None of the four rejected cases triggers any unintended side effect (e.g. a forged oversized `preview.load` payload does not partially load or crash the preview)

## Verification

Run each of the four test cases described in Implementation guidance against the live preview's message handler and confirm each is rejected with a logged reason and no side effect (e.g. confirm no new assembly load occurred and the preview's running state is unchanged after each forged attempt). The verifier must run all four cases and check both the rejection log and the absence of any unintended effect (e.g. by checking the currently active game/static state before and after each forged attempt).

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue036-final-verifier agent, after two failed verification/remediation rounds
- **Date:** 2026-08-28
- **Evidence:** Protocol tests passed 101/101, frontend type-check passed, Rust tests passed 12/12, and the packaged Tauri build succeeded with the exact 49-command ACL inventory. The live packaged proof sent four post-bootstrap window attacks to a running preview; receiver-side instrumentation measured four rejections, synchronously closed the accepted protocol port under the confused-deputy defense, preserved CornflowerBlue rendering through the independent proof bridge, and observed no runtime-start/state mutation. A fresh second preview then compiled, loaded, rendered `[100,149,237,255]`, emitted managed output, and stopped with one disposal. Bootstrap source/origin spoofing and private-port structural cases are explicitly recorded as unit-only because browsers cannot synthesize arbitrary `event.source`/`event.origin` and unauthenticated contexts cannot access the private port. Issue 034 and 035 packaged regressions passed.

### Re-pointed to the in-page sandboxed-iframe boundary (issue 052 task 3, 2026-09-06)

- **Verdict:** PASS (packaged, `scripts/prove-issue038-macos.sh` all-green)
- **Change:** The valid compile/run phases (3 and 4) of `runIssue036AutoProof`
  were re-pointed from `compileLoadStartIssue23` (isolated WebviewWindow) to
  `runInPagePreviewForProof` (in-page opaque-origin sandboxed iframe, issue 052
  Option B), proving the forged-message attacks did not corrupt the transport the
  live path now uses. Report `architecture` → `"in-page-sandboxed-iframe"`.
- **Unchanged:** Phase 1 (structural protocol validation) is transport-agnostic.
  Phase 2 (the `issue038_*` bridge-command attacks) is retained as-is: those
  commands still exist and remain ACL-registered until issue 052 task 4's
  deliberate retirement, so the proof continues to certify they reject
  forged/malformed input (stale/invalid generations, path-escape tokens,
  oversized/empty transfers).
- **Machine checks (done):** tsc no new errors; 101/101 protocol tests; vite
  build clean.
- **Packaged (done):** `scripts/prove-issue038-macos.sh` all-green — 036 PASS.
  Report shows `architecture: "in-page-sandboxed-iframe"`, all structural checks
  true, all `bridgeAttacks` rejected, both generations `pixelsOk` with managed
  output and dispose count 1.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `security: validate forged, malformed, and oversized protocol messages`

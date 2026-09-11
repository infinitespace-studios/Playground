# Define the language-service protocol and document synchronization

**Type:** AFK
**Status:** Blocked
**Blocked by:** [070-spike-roslyn-language-services-in-browser-wasm.md](070-spike-roslyn-language-services-in-browser-wasm.md), [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md), [036-validate-forged-malformed-oversized-messages.md](036-validate-forged-malformed-oversized-messages.md)
**Feature area:** IntelliSense
**Triage:** feature-backlog

## Context

The language service must run in the trusted persistent compiler context, never in the game preview. Monaco and Roslyn need a bounded, versioned way to open/replace/close project documents and request results while discarding stale responses after newer edits.

## Scope

### In scope

- Extend shared contracts and protocol documentation with project/document synchronization and completion request/response envelopes.
- Use project session id, stable relative document URI/path, monotonically increasing document version, cursor offset/line-column, and bounded source text.
- Define idempotent open/replace/close behavior, stale-version errors, cancellation/supersession semantics, deterministic completion ordering, and bounded item fields/counts.
- Implement validators and endpoint/client contract tests, including malformed, oversized, duplicate, forged, out-of-order, and stale traffic.
- Keep compiler and preview routes distinct; preview bootstrap/ports must reject language-service messages.

### Out of scope

- Roslyn workspace implementation or Monaco UI.
- Absolute filesystem paths, arbitrary metadata references, or new Tauri authority.

## Acceptance criteria

- [ ] Normative contracts cover session lifecycle, document versions, completion requests/results, errors, limits, and ordering.
- [ ] Validators reject every adversarial case without closing a port for a recoverable stale request.
- [ ] No language-service route is accepted by the preview endpoint.
- [ ] Existing compile/run protocol behavior is unchanged.

## Verification

Run typecheck and all protocol tests. The reviewer constructs valid and invalid multi-document traces, verifies exact error codes and stale suppression, checks normative docs against runtime validators, and re-runs packaged protocol/security proof where affected.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after protocol-focused independent PASS.

Suggested commit subject: `protocol: define language service document sync`

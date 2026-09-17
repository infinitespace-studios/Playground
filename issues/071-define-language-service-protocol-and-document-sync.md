# Define the language-service protocol and document synchronization

**Type:** AFK
**Status:** Done
**Blocked by:** [070a-prove-one-working-browser-completion-backend.md](070a-prove-one-working-browser-completion-backend.md), [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md), [036-validate-forged-malformed-oversized-messages.md](036-validate-forged-malformed-oversized-messages.md)
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

- **Verdict:** PASS
- **Verifier:** Independent issue-071 protocol verifier
- **Date:** 2026-09-16
- **Evidence:** All five required checks passed against the uncommitted diff. Frontend `tsc --noEmit` typecheck: clean. `npm run test:protocol`: 104/104 pass (existing compile/preview behavior unchanged; the only assertion delta is `PROTOCOL_ERROR_CODES.length` 32 -> 42 for the ten additive language codes). New `src/frontend/src/language-service-protocol.test.ts`: 4/4 pass, covering an idempotent session/document trace with deterministic completion ordering (`["Score","ToString"]`), stale/conflicting version rejection (`STALE_DOCUMENT_VERSION`, `DOCUMENT_VERSION_CONFLICT`), malformed/oversized/duplicate/preview-route traffic (`MISSING_PROTOCOL_VERSION`, `DOCUMENT_TEXT_TOO_LARGE`, `DUPLICATE_CORRELATION_ID`, and `validateCompileRequest` rejecting `language.completion.request` as `UNKNOWN_MESSAGE_TYPE`), and client-side late-completion supersession. Strict `tsc --noEmit --strict src/shared/MessageContracts.ts`: clean. `npm run build` (Vite): built in ~0.9s, exit 0.

  Manual review confirmed the normative docs match the runtime validators: Protocol.md section 4A documents the six request/response pairs, the `playground-model://` URI rule, monotonically increasing positive-integer versions, idempotent open/replace/close, `STALE_DOCUMENT_VERSION`/`DOCUMENT_VERSION_CONFLICT`/`DOCUMENT_NOT_FOUND` semantics, the supersession-generation defense with `LANGUAGE_REQUEST_SUPERSEDED`, deterministic ordering by sortText -> label -> kind, duplicate-label rejection, and the bounded limits (256 documents/session, 8 MiB aggregate, 1 MiB/document, 512-byte URI/path, 100 items, 256/512-byte item fields, 100-2000 ms timeout). `LANGUAGE_LIMITS` in `LanguageServiceProtocol.js` and the new `PROTOCOL_LIMITS`/`ProtocolRuntime.js` `PROTOCOL_ERROR_CODES` entries match those documented values 1:1. Preview-route rejection verified structurally: the ten `language.*` types are absent from `ProtocolRuntime.js` `messageTypes` and from `MessageType`/`MessageByType`, so every existing compiler/preview endpoint rejects them before any handler runs.

  Scope: the diff is confined to issue 071 (`src/shared/Protocol.md`, `src/shared/MessageContracts.ts`, `src/shared/ProtocolRuntime.js` error-code array only, new `src/shared/LanguageServiceProtocol.js`/`.d.ts`, new `src/frontend/src/language-service-protocol.test.ts`, and the `protocol.test.ts` count assertion). No Roslyn workspace, Monaco UI, or new Tauri authority was added. The `external/MonoGame` submodule shows pre-existing dirty build artifacts (compiled `.mgfxo` effect resources, `.vscode/launch.json`, generated content) unrelated to and untouched by this issue's protocol work.

## Commit gate

Commit only after protocol-focused independent PASS.

Suggested commit subject: `protocol: define language service document sync`

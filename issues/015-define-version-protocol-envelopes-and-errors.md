# Define and version protocol envelopes and errors

**Type:** AFK
**Status:** Done
**Blocked by:** [014-approve-shell-adr.md](014-approve-shell-adr.md)
**PRD references:** 9.7
**User stories:** US9
**Triage:** needs-triage

## Context

PRD section 9.7 requires `src/shared/Protocol.md` to define the only allowed communication between the top-level application, compiler context, and preview context. Every message must include a protocol version, message type, correlation ID, a validated payload schema, and a success/structured-error result. The protocol must define binary transfer representation for assemblies/PDBs/assets, maximum request/asset sizes, timeouts/cancellation, compiler diagnostics and playground-owned diagnostics, preview lifecycle events (started/stopped/exited/failed/output), asset path normalization rules, and backward-compatibility rules. This is the foundational contract every later compiler (16+) and preview (20+) issue depends on; nothing in `src/shared/` exists yet.

## What to build

Author `src/shared/Protocol.md` defining every message envelope, message type, error shape, size/timeout limits, and versioning rule required by PRD section 9.7, plus a matching TypeScript type-definition file `src/shared/MessageContracts.ts` that encodes the same envelope and message types so the frontend and any generated C# contracts can be kept in sync.

## Scope

### In scope

- `src/shared/Protocol.md`: the full protocol specification document
- `src/shared/MessageContracts.ts`: TypeScript interfaces/types mirroring the spec (envelope, every message type, error codes)
- Defining protocol version `1` as the initial version and the compatibility rule for future versions (e.g. additive-only fields within a major version, explicit version bump for breaking changes)

### Out of scope

- Implementing the compiler or preview runtimes that use this protocol (issues 16+, 20+)
- Any actual IPC transport code
- C# contract types (later issues generate these from the same spec when they implement the compiler/preview exports)

## Implementation guidance

1. Create `src/shared/Protocol.md` with these required sections:
   - **Envelope**: every message is `{ protocolVersion: number, correlationId: string, type: string, payload: <type-specific schema> }`; responses are `{ protocolVersion, correlationId, type, result: { success: true, data } | { success: false, error: { code: string, message: string, details?: object } } }`.
   - **Message types**: enumerate at least `compile.request`/`compile.response`, `preview.load`/`preview.started`/`preview.stopped`/`preview.exited`/`preview.failed`, `preview.output` (tagged `source: "managed"|"native"`), `preview.stop.request`, `asset.mount.request`.
   - **Binary transfer**: specify that assembly/PDB/asset bytes are transferred as `ArrayBuffer`/`Transferable` objects via `postMessage` with a `[buffer]` transfer list, not Base64, except where an issue explicitly falls back to Base64 for an initial spike.
   - **Limits**: define concrete numeric limits, e.g. max single message size (name a specific number such as 25 MB for assets, 5 MB for assembly+PDB combined — pick and document reasonable values since the PRD does not fix exact numbers, and note they are provisional pending Phase 1 measurement in issues 41-43).
   - **Timeouts/cancellation**: every request carries an optional `timeoutMs`; every response can be a `preview.failed`/`compile.response` error with code `TIMEOUT` or `CANCELLED`.
   - **Diagnostics shape**: `CompilerDiagnostic { severity: "error"|"warning"|"info", id: string, message: string, file: string, line: number, column: number }` matching PRD section 12.1/14.2, plus a distinct `PlaygroundDiagnostic` shape for playground-owned diagnostics (no Game subclass, multiple Game subclasses, missing constructor, unsupported API) per section 12.3.
   - **Asset path rules**: paths are normalized to forward-slash-relative, no `..` traversal, directories are created recursively before mounting.
   - **Versioning**: messages with an unknown/incompatible `protocolVersion` must be rejected with error code `UNSUPPORTED_PROTOCOL_VERSION` (this directly feeds issue 36's forged/malformed message tests).
2. Create `src/shared/MessageContracts.ts` with matching TypeScript `interface`/`type` declarations, one per message type, plus the shared `Envelope<T>`/`Response<T>` generic wrapper and the `CompilerDiagnostic`/`PlaygroundDiagnostic` types.
3. Cross-check every message type mentioned in PRD sections 9.7, 12.1, 13.3, and 14.3 is represented (compile request/response, preview lifecycle events including exited, output with managed/native tagging, diagnostics).

## Acceptance criteria

- [x] `src/shared/Protocol.md` defines the envelope shape, every message type listed in Implementation guidance, binary transfer rules, concrete size/timeout limits, diagnostics shapes, asset path normalization rules, and a versioning/compatibility rule
- [x] `src/shared/MessageContracts.ts` compiles as valid TypeScript (`npx tsc --noEmit src/shared/MessageContracts.ts` or equivalent) and defines a type or interface for every message type named in `Protocol.md`
- [x] Every message type includes fields for protocol version, correlation ID, and type, matching the documented envelope
- [x] The document defines an explicit error code for an unsupported/missing protocol version

## Verification

```bash
npx tsc --noEmit --strict src/shared/MessageContracts.ts
```
Expect zero type errors. Then the verifier must manually cross-reference `src/shared/Protocol.md`'s list of message types against `src/shared/MessageContracts.ts`'s exported types and confirm a 1:1 mapping exists (every documented message type has a corresponding TS type, and vice versa), recording any mismatches found as FAIL.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

### Attempt 1

- **Verdict:** FAIL
- **Verifier:** Issue 015 Verifier (`1d3bd289-7199-42ea-b95e-3c1218556472`)
- **Date:** 2026-08-25
- **Evidence:** Found contradictory `protocol.error` terminal correlation, impossible receiver-side transfer-list validation, contradictory exit/stopped ordering, and incomplete mount replay/collision semantics.

### Attempt 2

- **Verdict:** FAIL
- **Verifier:** Issue 015 Verifier (`1d3bd289-7199-42ea-b95e-3c1218556472`)
- **Date:** 2026-08-25
- **Evidence:** The first four defects were fixed, but concurrent mount transactions could validate the same mount ID or path before either committed.

### Attempt 3

- **Verdict:** FAIL
- **Verifier:** Issue 015 Verifier (`1d3bd289-7199-42ea-b95e-3c1218556472`)
- **Date:** 2026-08-25
- **Evidence:** Mount transactions were serialized and committed atomically, but preview start could overlap queued or staged mounts and allow publication during startup.

### Attempt 4

- **Verdict:** FAIL
- **Verifier:** Issue 015 Verifier (`1d3bd289-7199-42ea-b95e-3c1218556472`)
- **Date:** 2026-08-25
- **Evidence:** Mount/start synchronization was fixed, but concurrent preview loads and start-during-load remained possible because loading was outside the shared lifecycle critical section.

### Attempt 5

- **Verdict:** PASS
- **Verifier:** Issue 015 Verifier (`1d3bd289-7199-42ea-b95e-3c1218556472`)
- **Date:** 2026-08-25
- **Evidence:** Strict ES2022/DOM TypeScript compilation passed. Mechanical audit found exactly 18 documented message literals, 18 map keys, and 18 correctly enveloped aliases; 29 limits, six timeout mappings, 32 error codes, ten diagnostic IDs, and all compilation/lifecycle/output literals matched. Conservative maximum messages remained below the 32 MiB outer limit: assets 25,311,248 bytes, compile response 22,280,448 bytes, and protocol error 9,715,072 bytes. Adversarial review confirmed coherent single-terminal behavior for compile cancellation and preview load/mount/start/stop/exit/failure/timeout races. The final shared pre-start queue serializes load and mount work, start requires a committed load and no queued work, irreversible load failures force teardown, and stop/teardown prevents late commits. PRD sections 9.7, 12.1, 12.3, 13.3, 14.3, 16, and 17 were covered, and `git diff --check` passed.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `shared: define versioned compiler/preview protocol contract`

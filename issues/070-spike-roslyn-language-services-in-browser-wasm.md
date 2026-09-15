# Spike Roslyn language services in browser WebAssembly

**Type:** AFK
**Status:** Done
**Blocked by:** [016-boot-persistent-roslyn-wasm-compiler-context.md](016-boot-persistent-roslyn-wasm-compiler-context.md), [019-build-runtime-reference-assembly-allowlist.md](019-build-runtime-reference-assembly-allowlist.md), [031-publish-supported-api-policy-and-analyzers.md](031-publish-supported-api-policy-and-analyzers.md)
**Feature area:** IntelliSense feasibility
**Triage:** feature-backlog spike

## Context

Monaco currently provides C# tokenization but no semantic language service, so Ctrl+Space cannot offer context-valid members. Correct completion likely requires Roslyn Workspaces/Features in the persistent browser-WASM compiler. Those packages may increase startup time, memory, and package size, and synchronous work can jank the Workbench's single WebContent thread.

## Scope

### In scope

- Build an isolated PROOF-only language-service experiment using the current pinned SDK, Roslyn version, reference allowlist, and a two-file MonoGame sample.
- Prove or disprove `AdhocWorkspace`/Project/Document creation and context-sensitive completion in browser WASM.
- Measure compiler bundle compressed/uncompressed delta, cold initialization, document update, first completion, warm completion p50/p95 over at least 30 representative requests, and RSS impact where measurable.
- Test completion after `.`, statement context, generic type context, incomplete syntax, and a cross-file symbol.
- Record whether cancellation/stale-result suppression can keep typing responsive.
- Produce `docs/intellisense-feasibility.md` with evidence and a recommended architecture/go-no-go decision.

### Out of scope

- PRODUCT protocol/UI, shipping package changes, arbitrary dependencies, hover/signature help, or weakening API policy.

## Acceptance criteria

- [ ] The report contains reproducible code/commands, raw measurements, package delta, correctness fixtures, risks, and a clear recommendation.
- [ ] Any spike code is PROOF-only or removed before commit; PRODUCT graph remains unchanged.
- [ ] Unsupported APIs being suggested are explicitly assessed.

## Verification

The reviewer reproduces the WASM experiment and a representative subset of at least ten completion requests, verifies the measurements from raw output, and runs PRODUCT/PROOF profile separation checks. A report-only PASS is valid even if the technical conclusion is no-go.

## Verification record

- **Verdict:** PASS (no-go conclusion)
- **Verifier:** Human project owner/user, with automated verification by the implementation session
- **Date:** 2026-09-15
- **Evidence:** The human verifier ran the staged PROOF compiler page and confirmed the runtime started successfully (`ready=true`, `successfulRuntimeStarts=1`), the Roslyn context proof reported version 4.12.0, trivial and MonoGame.Game reference compilation passed, and all five structured diagnostic cases passed. The IntelliSense spike then returned `success=false`, `recommendation=no-go`, `completionRequests=0`, with `CompositionFailedException: TypeInspector_ContractNotAssignable, IAsynchronousOperationListenerProvider, AsynchronousOperationListenerProvider` during MEF host creation. This directly satisfies the report-only PASS allowance for a technically valid no-go result. Automated evidence: PRODUCT and PROOF compiler staging checks passed; proof Release build passed; desktop fallback exercised all five completion contexts with 30 requests, cancellation, and p50/p95 measurements; `git diff --check` passed.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `docs: prove Roslyn IntelliSense feasibility`

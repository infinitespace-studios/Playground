# Implement a persistent SemanticModel completion backend

**Type:** AFK
**Status:** Done
**Blocked by:** [070a-prove-one-working-browser-completion-backend.md](070a-prove-one-working-browser-completion-backend.md), [071-define-language-service-protocol-and-document-sync.md](071-define-language-service-protocol-and-document-sync.md)
**Feature area:** IntelliSense compiler backend
**Triage:** feature-backlog

## Context

Issue 070 proved that the full Roslyn Workspaces/Features MEF composition fails
in browser WebAssembly before the first completion request. Issue 070A proved a
smaller direct `CSharpCompilation`/`SemanticModel` backend can resolve a
cross-file `Player.Score` completion in the browser. Issue 071 defines the
backend-neutral transport. This issue implements the compiler-side persistent
session and completion endpoint on the proven direct backend; it must not add
`AdhocWorkspace`, Workspaces, Features, or MEF dependencies to PRODUCT.

## Scope

### In scope

- Maintain one bounded active language session containing document snapshots,
  parsed syntax trees, and the current reference-backed compilation state in the
  compiler WASM context.
- Apply open/replace/close updates by document version, reusing unchanged
  syntax trees and rejecting stale/conflicting versions.
- Rebuild only the immutable compilation/semantic-model layer required by a
  changed document; do not introduce Roslyn Workspaces/Features/MEF.
- Return deterministic, bounded completion items with the protocol's label and
  kind fields plus optional detail/sort text where safely available.
- Prove BCL and MonoGame-relevant member completion, cross-file symbols, and
  incomplete member-access contexts using the direct SemanticModel backend.
- Filter or annotate APIs prohibited by the Playground policy so suggestions do
  not knowingly present unsupported PG010x paths.
- Suppress stale/cancelled work, discard late generations, and release session
  state when a project session closes.
- Add C# unit tests and browser-WASM endpoint tests for single-file, cross-file,
  incomplete, stale, bounded, and policy-filtered cases.

### Out of scope

- `AdhocWorkspace`, Roslyn Workspaces/Features, MEF composition, or arbitrary
  managed dependency packs
- Monaco registration, hover, signature help, go-to-definition, or preview
  changes

## Acceptance criteria

- [ ] The compiler-side session returns correct members for representative BCL
      and MonoGame contexts through `CSharpCompilation`/`SemanticModel`.
- [ ] Cross-file types and members appear after versioned document sync.
- [ ] Invalid or unsupported context does not return a misleading global list.
- [ ] Stale versions and late generations never become visible results.
- [ ] Completion items obey the protocol's deterministic ordering and bounds.
- [ ] Policy-prohibited suggestions are filtered/annotated according to a
      documented rule without weakening compile-time policy enforcement.
- [ ] Repeated updates stay within the approved latency/memory bounds from
      070A, or the report documents an updated bound and decision.
- [ ] The PRODUCT compiler graph remains unchanged and contains no backend
      implementation or Workspaces/MEF dependency.

## Verification

Run .NET tests, browser-WASM integration tests, typecheck/protocol tests, and
an updated completion benchmark based on the 070A direct-backend fixture.
Independently inspect at least five positive and five negative context fixtures,
a cross-file document-sync trace, stale/late-result suppression, and a
100-update memory/latency run. Confirm no Workspaces/Features/MEF dependency or
PRODUCT graph change was introduced.

## Verification record

- **Verdict:** PASS
- **Verifier:** Human project owner/user, with automated verification by the implementation session
- **Date:** 2026-09-17
- **Evidence:** The human verifier ran the staged browser PROOF persistent-session control and confirmed the complete session workflow passed: session/document open, cross-file `Player.Score` completion, document replacement, stale-version rejection, five positive fixtures, five negative fixtures, 100 document updates, and session close/cleanup. The proof reported `Persistent session success=true`, `Score=true`, `positives=5`, `negatives=5`, `updates=100`, and `staleRejected=true`. Automated evidence: proof Release build/staging passed, direct compiler endpoint sequence passed, frontend typecheck/protocol tests remained green, and the proof script passed syntax validation.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `compiler: add persistent Roslyn completions`

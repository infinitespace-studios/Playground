# Implement a persistent Roslyn completion workspace

**Type:** AFK
**Status:** Blocked
**Blocked by:** [070-spike-roslyn-language-services-in-browser-wasm.md](070-spike-roslyn-language-services-in-browser-wasm.md), [071-define-language-service-protocol-and-document-sync.md](071-define-language-service-protocol-and-document-sync.md)
**Feature area:** IntelliSense compiler backend
**Triage:** feature-backlog

## Context

Issue 071 defines bounded transport and issue 070 selects the feasible Roslyn architecture. This slice implements only the compiler-side workspace and completion endpoint using the same pinned references and supported-API policy as normal compilation.

## Scope

### In scope

- Maintain one bounded active project session with persistent Roslyn Project/Documents in the compiler WASM context.
- Apply document updates by version without rebuilding unchanged documents.
- Return context-sensitive completion items with label, kind, insertion text/range, sort/filter text, and concise detail/documentation where safely available.
- Bound item count/string sizes and make output deterministic.
- Filter or annotate APIs prohibited by Playground policy so suggestions do not knowingly lead to PG010x failures.
- Suppress stale/cancelled work and release the old workspace when a project session closes.
- Add C# unit tests and browser-WASM endpoint tests for single-file, cross-file, incomplete, stale, and policy-filtered cases.

### Out of scope

- Monaco registration, hover, signature help, go-to-definition, arbitrary assemblies, or preview changes.

## Acceptance criteria

- [ ] Correct members are returned for representative MonoGame and BCL contexts.
- [ ] Cross-file types and members appear after document sync.
- [ ] Invalid context does not return a misleading global list.
- [ ] Stale versions never become visible results.
- [ ] Repeated updates stay within feasibility-report latency/memory expectations or documented approved bounds.

## Verification

Run .NET tests, browser-WASM integration tests, typecheck/protocol tests, and the completion benchmark from issue 070. Independently inspect at least five positive and five negative context fixtures and a 100-update memory/latency run.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `compiler: add persistent Roslyn completions`

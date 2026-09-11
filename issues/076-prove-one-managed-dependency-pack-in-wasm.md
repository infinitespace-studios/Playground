# Prove one managed dependency pack in browser WebAssembly

**Type:** AFK
**Status:** Blocked
**Blocked by:** [075-define-curated-managed-dependency-policy.md](075-define-curated-managed-dependency-policy.md)
**Feature area:** Dependencies feasibility
**Triage:** feature-backlog spike

## Context

Before building a general pack system, the compiler and preview must prove the reference/runtime split with a real public package. The policy selects `Newtonsoft.Json 13.0.3` as a representative pure-managed candidate. This is a feasibility fixture, not automatic approval to ship it.

## Scope

### In scope

- Acquire the exact package through a reproducible build-time process, record source URL/version/SHA-256/license, and flatten/pin the selected target framework's transitive closure.
- Stage its compile reference(s) in an isolated PROOF allowlist and its implementation assembly/closure into a PROOF preview runtime.
- Compile a user fixture that serializes/deserializes a deterministic object and run it in packaged browser WASM.
- Verify no runtime network access, arbitrary assembly probing, P/Invoke/JS interop, or unrecorded dependency is introduced.
- Measure size, compiler initialization, compile latency, preview startup, and memory deltas.
- Record whether managed IL staging or another strategy is required and produce a go/no-go report.

### Out of scope

- PRODUCT inclusion, project manifest/UI, multiple packs, runtime downloads, or modifying MonoGame.

## Acceptance criteria

- [ ] Every package byte and transitive dependency is pinned and licensed.
- [ ] The packaged PROOF compiles and runs the deterministic fixture, or the report provides reproducible failure evidence and a no-go conclusion.
- [ ] PRODUCT artifacts remain byte/surface unaffected.
- [ ] Security and performance/size deltas are recorded.

## Verification

The reviewer independently verifies hashes and closure, runs the packaged fixture offline, inspects the PRODUCT graph/binary for package leakage, repeats size/timing measurements, and checks source/assembly IL for prohibited interop. A well-evidenced no-go is a valid PASS for this spike.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after security-focused independent PASS.

Suggested commit subject: `test: prove a managed dependency pack in wasm`

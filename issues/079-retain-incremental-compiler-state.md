# Retain incremental compiler state between edits

**Type:** AFK
**Status:** Ready
**Blocked by:** [016-boot-persistent-roslyn-wasm-compiler-context.md](016-boot-persistent-roslyn-wasm-compiler-context.md), [041-measure-startup-compile-preview-stop-timings.md](041-measure-startup-compile-preview-stop-timings.md)
**Feature area:** Compiler performance
**Triage:** feature-backlog

## Context

The compiler context and metadata references are persistent, but each request parses every file and creates a fresh `CSharpCompilation`. Live Preview needs cheaper repeated compilation while preserving deterministic diagnostics, API policy, PDB mapping, and the rule that compile failure leaves a running preview untouched.

## Scope

### In scope

- Maintain a bounded per-project compilation session keyed by stable document path/version and reference-pack digest.
- Reuse unchanged syntax trees and replace only changed/added/removed trees.
- Invalidate safely on project switch, dependency-pack change, compiler profile change, or protocol mismatch.
- Preserve deterministic assembly/PDB output semantics, diagnostics ordering, checksum mapping, and policy analyzer behavior.
- Add benchmark fixtures for one-file and 20-file projects: initial build, single-file edit, syntax-error edit, recovery, add/remove file, and full invalidation.
- Record cold/warm p50/p95, memory over at least 200 edits, and output equivalence against clean compilation.

### Out of scope

- Automatic compile triggers, preview restart, state-preserving hot reload, parallel Roslyn builds, or IntelliSense services.

## Acceptance criteria

- [ ] Incremental and clean compilation produce equivalent success/diagnostic behavior for every fixture.
- [ ] Unchanged trees are demonstrably reused and invalidation cases rebuild correctly.
- [ ] Single-file edit latency improves measurably on the multi-file fixture without violating memory thresholds.
- [ ] Compile failure/recovery and PDB mapping remain correct.

## Verification

Run compiler/unit/protocol tests and the new benchmark from a clean process. The reviewer inspects reuse counters/logs, compares binary/diagnostic proofs where deterministic, repeats the 200-edit memory run, and runs packaged compile/runtime-exception proofs.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after performance-focused independent PASS.

Suggested commit subject: `compiler: reuse incremental compilation state`

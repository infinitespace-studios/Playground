# Investigate state-preserving .NET Hot Reload in browser WASM

**Type:** AFK
**Status:** Blocked
**Blocked by:** [081-restart-live-preview-after-successful-edits.md](081-restart-live-preview-after-successful-edits.md)
**Feature area:** Hot Reload feasibility
**Triage:** feature-backlog spike

## Context

Issue 081 delivers useful automatic restart without preserving state. True state-preserving updates would require Roslyn Edit-and-Continue deltas (`EmitDifference`) and runtime support such as `MetadataUpdater.ApplyUpdate`; normal user assemblies cannot simply be unloaded/reloaded in the existing browser-WASM runtime. Many edits are unsupported rude edits and must fall back to restart.

## Scope

### In scope

- Build a PROOF-only experiment retaining an emit baseline and applying method-body deltas to a running MonoGame Web game.
- Test supported method-body/constant changes and unsupported signature, field, type, generic, async/state-machine, and resource-shape edits.
- Determine required runtime flags, security implications, payload protocol, PDB behavior, memory growth, failure recovery, and restart fallback.
- Prove whether Update/Draw behavior can change while a simple game object field retains its value.
- Produce `docs/hot-reload-feasibility.md` with evidence and a recommendation: ship bounded delta reload, keep restart-only, or reject.

### Out of scope

- PRODUCT integration, promising arbitrary edit-and-continue, modifying MonoGame, or weakening restart cleanup.

## Acceptance criteria

- [ ] The report includes reproducible fixtures for successful and rude edits, runtime requirements, latency/memory data, and fallback behavior.
- [ ] PRODUCT remains unchanged and contains no hot-reload runtime flags/exports.
- [ ] A no-go result is acceptable when backed by reproduced evidence.

## Verification

The reviewer independently runs at least one accepted and three rude-edit fixtures in packaged PROOF, confirms state retention or documented failure, checks PRODUCT for leakage, and validates memory/cleanup over repeated deltas and restart fallback.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `docs: assess browser wasm hot reload`

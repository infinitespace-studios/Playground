# Investigate in-app Effect compilation and caching

**Type:** AFK
**Status:** Blocked
**Blocked by:** [087-validate-mount-and-render-custom-effects.md](087-validate-mount-and-render-custom-effects.md), [066-add-asset-picker-and-drag-drop-import.md](066-add-asset-picker-and-drag-drop-import.md)
**Feature area:** Custom effects, asset pipeline
**Triage:** feature-backlog spike

## Context

PRODUCT can consume validated precompiled Effect XNB files after issue 087. A user-friendly workflow would accept `.fx`, compile it offline for the Web profile, cache the result, and report shader diagnostics. MGFXC may require platform-specific native tooling/Wine and can materially change package size and threat surface, so this issue is an evidence-driven architecture decision rather than an assumed implementation.

## Scope

### In scope

- Evaluate at least: bundled per-platform native MGFXC, a managed/WASM compilation path if genuinely available, and an external prebuild-only workflow.
- For viable options, prototype `.fx` import → Web Effect XNB → issue 087 validator → render on one host platform.
- Define cache key from source/includes/options/compiler/toolchain digest and prove tamper detection/invalidation.
- Define include-path confinement, source/diagnostic limits, process isolation, timeout/cancellation, no-network behavior, and cleanup.
- Measure binary/package delta, first/warm compilation latency, memory, and cross-platform CI complexity.
- Produce an ADR with a clear decision: bundle compiler, support external precompile only, or defer source effects.

### Out of scope

- Shipping the selected PRODUCT implementation, arbitrary compiler plugins, network includes, changing MonoGame, or claiming cross-platform support without evidence.

## Acceptance criteria

- [ ] ADR compares options with reproducible prototype evidence, security model, cache design, size/performance data, and cross-platform implications.
- [ ] Any prototype is non-shipping/PROOF-only and PRODUCT remains unchanged.
- [ ] The decision identifies exact follow-up slices if implementation is approved.

## Verification

The reviewer reproduces the selected prototype and at least one rejected/tampered/include-escape case, validates measurements, inspects PRODUCT for tooling leakage, and checks the ADR against Windows/macOS/Linux release constraints. A decision to remain precompiled-only is a valid PASS.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS and product-owner acknowledgement of the ADR decision.

Suggested commit subject: `docs: decide custom effect compilation workflow`

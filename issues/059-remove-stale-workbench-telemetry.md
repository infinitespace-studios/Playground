# Remove stale Workbench telemetry and proof-era visible placeholders

**Type:** AFK
**Status:** Done
**Blocked by:** [045-build-responsive-workbench-app-frame.md](045-build-responsive-workbench-app-frame.md), [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md)
**Feature area:** UI cleanup, assets, preview
**Triage:** feature-backlog

## Context

The shipping Workbench still shows design/proof placeholders as if they were live data: a fixed `WASM HEAP / 128 MB` meter, a hard-coded `PINNED RUNTIME` hash, `PREVIEW / 800 × 480`, `WEBGL2 · 60HZ`, a static Assets row, and footer text about WASM URL/content type. These values are not updated and make the product look like a diagnostic harness. The Output and Problems drawers, preview lifecycle status, and real compiler/runtime error reporting are useful product features and must remain.

This slice creates honest, empty UI surfaces for later issues. The vacated file-rail space will become the project asset browser in issue 064.

## Scope

### In scope

- Remove the fixed heap meter and pinned-runtime block from the left rail.
- Add a neutral, empty asset-browser host in that space with an accessible heading and empty-state text; do not render real assets yet.
- Remove the hard-coded preview dimensions/backend/rate while retaining the real lifecycle indicator installed by `preview-panel.ts`.
- Remove the placeholder Assets drawer tab/view; real assets will live in the rail.
- Remove static footer diagnostics that have no live source, including the fake `main*` branch indicator, while preserving a status-bar container for issue 060.
- Remove visible CSS used only by those deleted placeholders.

### Out of scope

- Real asset discovery/rendering or file import.
- Removing Output, Problems, runtime failures, lifecycle status, or diagnostics.
- Adding telemetry to replace deleted fake telemetry.
- Removing hidden elements still required by PRODUCT startup or the PROOF profile without first proving they are unused.

## Implementation guidance

Start with `src/frontend/index.html` and `src/frontend/src/style.css`. Search every removed id/class across PRODUCT and PROOF before deleting it. Preserve the PRODUCT/PROOF profile checks and do not add issue-numbered product modules or markers.

## Acceptance criteria

- [x] No fabricated heap percentage, pinned hash, fixed preview dimensions, fixed refresh rate, or pending WASM diagnostic appears in PRODUCT.
- [x] The left rail contains an accessible asset-browser host and honest empty state.
- [x] Output, Problems, and preview lifecycle state still work.
- [x] PRODUCT and PROOF artifact/profile checks still pass.

## Verification

1. Run frontend typecheck and focused frontend tests.
2. Build both frontend profiles and run the profile artifact checker.
3. Launch PRODUCT, inspect idle/running/stopped states, and confirm every removed value is absent while Output, Problems, and preview status remain functional.
4. Search `index.html`, PRODUCT TypeScript, and CSS for the removed literal values; any remaining occurrence must be justified as historical documentation or test evidence, not visible product UI.

Record commands, search results, and precise visual observations in the verification record.

## Verification record

- **Verdict:** PASS
- **Verifier:** Independent `reviewer` subagent
- **Date:** 2026-09-11
- **Evidence:**
  - Inspected the complete `6d605e3`-to-worktree diff and confirmed that only
    `src/frontend/index.html`, `src/frontend/src/style.css`, and the stale
    placement comment in `src/frontend/src/preview-panel.ts` changed outside
    issue bookkeeping; every change was in scope.
  - `npm --prefix src/frontend run typecheck` passed with zero errors.
  - `npm --prefix src/frontend run test:protocol` passed 104/104 tests.
  - PRODUCT and PROOF frontend builds passed; `check:profiles` accepted the
    clean PRODUCT graph with zero proof markers and the PROOF graph with all
    13 expected markers.
  - Source and built-PRODUCT literal scans found none of the removed heap,
    pinned-runtime, fixed dimensions/rate, branch, WASM-pending, or offline
    runtime placeholders. Remaining `player.xnb` references were confined to
    tests/PROOF content evidence.
  - Direct PRODUCT GUI inspection covered idle, running, Problems, and stopped
    states. The rail showed the accessible Assets empty state; the preview
    lifecycle indicator changed `Idle` -> `Running` -> `Stopped`; live Output
    and Problems remained functional; the Assets drawer tab and all fabricated
    telemetry were absent.

## Commit gate

Commit only after an independent reviewer records PASS.

Suggested commit subject: `frontend: remove stale Workbench telemetry`

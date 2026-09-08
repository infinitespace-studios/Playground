# Session handoff: production/proof architecture cleanup

**Last updated:** 2026-09-08
**Next stage:** Stage 4 — consolidate historical issue proofs
**Working-tree expectation:** clean

## Read first

1. [`production-proof-cleanup-plan.md`](production-proof-cleanup-plan.md)
2. [`adr/0003-embedded-preview-and-non-yielding-code.md`](adr/0003-embedded-preview-and-non-yielding-code.md)
3. The last completed stage commits listed below

## Completed work

### Stage 1 — compile-time PRODUCT/PROOF split

Commit: `6675761 build: separate product and proof frontend profiles`

- Product entry: `src/frontend/src/entry.product.ts`
- Proof entry: `src/frontend/src/entry.proof.ts`
- Product output: `src/frontend/dist/`
- Proof output: `src/frontend/dist-proof/`
- Product/proof Tauri configurations have different names and identifiers.
- `profile-manifest.json` records the actual Rollup module graph.
- `check-profile-artifacts.mjs` rejects proof modules or markers in PRODUCT.
- Release CI runs the product-profile artifact check.

Accepted evidence:

- PRODUCT graph had 23 modules and zero proof markers after Stage 1.
- PROOF graph had 49 modules and all 18 expected proof markers.
- Native product and proof packages both built successfully.

### Stage 2 — extract the mixed production core

Commit: `f2f4013 refactor: extract product preview lifecycle`

New production/domain modules:

- `src/frontend/src/compiler-context.ts`
- `src/frontend/src/live-preview.ts`
- `src/frontend/src/lifecycle-controller.ts`
- `src/frontend/src/run-stop.ts`
- `src/frontend/src/first-run-warning.ts`

`issue21.ts`, `issue24.ts`, and `issue37.ts` are proof-facing compatibility
modules and are absent from the PRODUCT graph.

Accepted evidence:

- PRODUCT graph: 21 modules, zero proof markers.
- PRODUCT excludes `issue21.ts`, `issue24.ts`, `issue37.ts`,
  `issue24-controller.ts`, `issue23-controller.ts`, and `issue38-bridge.ts`.
- PROOF graph: 53 modules with all 18 expected markers.
- Full packaged proof suite passed:
  038, 024, 025, 023, 033, 033-no-wasm-eval, 034, 035, 036, and 037 phases 1–2.
- Zero orphan processes and clean invoke-key scan.
- A full native PRODUCT package built successfully after the proof package.

### Stage 3 — rename/extract product UI modules

Commit: `0a45457 refactor: name product UI modules by responsibility`

New responsibility-named modules:

- `src/frontend/src/theme-controller.ts`
- `src/frontend/src/monaco-editor.ts`
- `src/frontend/src/problems-panel.ts`
- `src/frontend/src/output-panel.ts`
- `src/frontend/src/dirty-state.ts`
- `src/frontend/src/project-manager.ts`
- `src/frontend/src/preview-panel.ts`
- `src/frontend/src/project-content.ts`

`issue049.ts` and `issue051.ts` are thin proof/test compatibility façades. All
other Stage-3 issue-numbered implementation modules were removed. The artifact
checker generically rejects any issue-numbered source module in the PRODUCT
Rollup graph and requires all eight new domain modules.

Accepted evidence:

- PRODUCT graph: 21 modules, all eight Stage-3 domain modules present, zero
  issue-numbered modules, and zero proof markers.
- PROOF graph: 53 modules with all 18 expected markers.
- TypeScript, 102 protocol tests, 45 focused content/project tests, 56 Rust
  tests, the full frontend build, and profile verification passed.
- Full packaged proof suite passed issues
  038/024/025/023/033/033-no-wasm-eval/034/035/036/037 phases 1–2.
- Zero orphan processes and clean invoke-key scan.
- A full native PRODUCT package built successfully after the proof package.
- Independent review reported no blocking findings.

### Orchestration record

Each completed stage used:

1. Fresh `worker` subagent.
2. Independent read-only `reviewer` subagent.
3. Orchestrator remediation and source/artifact inspection.
4. Full required verification before commit.

The user-level worker/reviewer definitions are expected to select
`github-copilot/claude-opus-4.8` explicitly.

## Current architecture invariants

- ADR 0003 is authoritative: the production preview is the embedded,
  opaque-origin sandboxed iframe. Do not restore the separate visible preview
  window as product UX.
- PRODUCT is the default for normal npm, Tauri, and release builds.
- PROOF must be requested explicitly.
- PRODUCT must contain zero `MONOGAME_ISSUE*_PROOF` frontend markers.
- Compile failure must leave an already-running preview untouched.
- Content assets mount before game start.
- Each successful Run gets a fresh preview runtime.
- Protocol validation, CSP, sandboxing, IPC denial, and lifecycle cleanup must
  not be weakened.

## Next task: Stage 4

Replace the permanent per-issue proof drivers with a smaller durable scenario
suite covering:

1. Compile → Run → Stop → rerun.
2. Compiler diagnostics and policy rejection.
3. Runtime exception and portable-PDB mapping.
4. Managed/native output.
5. Texture/audio content workflow.
6. Embedded preview security boundary.
7. Project open/save/dirty-state/identity behavior.
8. Performance and memory.

Requirements:

- Preserve historical evidence in `issues/` and ignored artifacts.
- Keep PRODUCT free of proof entries, proof-only modules, issue-numbered
  modules, and `MONOGAME_ISSUE*_PROOF` frontend markers.
- Preserve the explicit PRODUCT/PROOF split while scenarios are consolidated.
- Do not retire the issue038 isolated-window harness yet; that is Stage 5.
- Do not rename Tauri commands or alter Rust proof compilation boundaries; that
  is Stage 6.
- Preserve all architecture, lifecycle, protocol, CSP, sandbox, IPC, content,
  and cleanup invariants.

Before implementation, inventory every existing proof driver and map its unique
claims to the durable scenarios. Define the exact Stage-4 verification matrix
from that inventory, including fresh product/proof profile checks and the
relevant packaged scenario suite.

## Resume procedure

1. Run `git status --short --branch`. If the tree is not clean, stop and classify
   the changes before delegating.
2. Confirm commits `6675761` and `f2f4013` are reachable.
3. Invoke a fresh `worker` agent with the Stage-4 scope above and instruct it not
   to commit.
4. Invoke a separate `reviewer` agent after implementation.
5. Resolve every critical finding and rerun review if necessary.
6. Perform independent source, module-graph, test, and package checks.
7. Update both this handoff and `production-proof-cleanup-plan.md` with the
   accepted stage commit/evidence.
8. Commit only the accepted Stage-4 scope, then leave a clean tree for Stage 5.

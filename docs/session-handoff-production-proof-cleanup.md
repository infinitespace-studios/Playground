# Session handoff: production/proof architecture cleanup

**Last updated:** 2026-09-08
**Next stage:** Stage 3 — rename/extract product UI modules
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

## Next task: Stage 3

Rename/extract the remaining issue-numbered modules in the PRODUCT graph by
responsibility:

| Current module | Target responsibility |
| --- | --- |
| `issue46.ts` | theme controller |
| `issue047.ts` | Monaco editor adapter |
| `issue048.ts` | Problems/diagnostics panel |
| `issue049.ts` | Output panel |
| `issue050.ts` | workspace dirty-state protection |
| `issue051.ts` | folder project manager and project identity |
| `issue052.ts` | embedded preview panel/focus/status |
| `issue052-content.ts` | project content preparation |

Requirements:

1. `entry.product.ts` and `app.ts` import only responsibility-named modules.
2. No issue-numbered module remains in PRODUCT's Rollup module graph.
3. Avoid implementation copies. Move implementations and use thin compatibility
   façades only where PROOF/tests still require historical imports.
4. Preserve DOM IDs/classes and Tauri command names in this stage unless a
   coordinated change is required; renaming Tauri commands belongs to Stage 6.
5. Update `check-profile-artifacts.mjs` so any issue-numbered PRODUCT module is a
   hard failure and all expected domain modules are required.
6. Preserve all product behavior and the explicit PRODUCT/PROOF split.
7. Do not remove issue038 or change Rust/ACL inventories in Stage 3.

Required verification:

```bash
npm --prefix src/frontend run typecheck
npm --prefix src/frontend run test:protocol
node --experimental-strip-types --test \
  src/frontend/src/project-identity.test.ts \
  src/frontend/src/issue051.test.ts \
  src/frontend/src/issue039.test.ts \
  src/frontend/src/issue040.test.ts
npm --prefix src/frontend run verify:profiles -- --skip-stage
npm --prefix src/frontend run build
cargo test --manifest-path src/desktop/src-tauri/Cargo.toml
git diff --check
```

Also inspect both profile manifests explicitly and run the relevant packaged
product/proof checks when shared behavior or proof compatibility changes.

## Resume procedure

1. Run `git status --short --branch`. If the tree is not clean, stop and classify
   the changes before delegating.
2. Confirm commits `6675761` and `f2f4013` are reachable.
3. Invoke a fresh `worker` agent with the Stage-3 scope above and instruct it not
   to commit.
4. Invoke a separate `reviewer` agent after implementation.
5. Resolve every critical finding and rerun review if necessary.
6. Perform independent source, module-graph, test, and package checks.
7. Update both this handoff and `production-proof-cleanup-plan.md` with the
   accepted stage commit/evidence.
8. Commit only the accepted Stage-3 scope, then leave a clean tree for Stage 4.

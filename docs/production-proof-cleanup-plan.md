# Production/proof architecture cleanup plan

**Status:** In progress
**Started:** 2026-09-08
**Decision basis:** ADR 0003 (embedded production preview)
**Session handoff:** [`session-handoff-production-proof-cleanup.md`](session-handoff-production-proof-cleanup.md)
**Resume command:** `/continue-production-proof-cleanup`

## Objective

Remove issue-numbered implementation architecture and proof instrumentation from
shipping product artifacts without losing the durable behavior those issue
slices established. Issue numbers remain in historical issue records and proof
evidence, not in production module, function, command, or type names.

## Execution protocol

Each stage is performed sequentially because later stages depend on the module
and build boundaries created by earlier stages.

1. A fresh `worker` subagent using `github-copilot/claude-opus-4.8` implements
   only the stage and does not commit.
2. A separate `reviewer` subagent using the same model performs a read-only
   source/diff review.
3. The orchestrating agent resolves findings, runs the required tests and
   packaged checks, and inspects artifacts.
4. Only an accepted stage is committed. The working tree must be clean before
   the next worker starts.

## Non-negotiable invariants

- The production preview remains the embedded opaque-origin iframe from ADR
  0003; the separate visible preview window must not return as product UX.
- Product builds contain no proof entry, proof-only module, or
  `MONOGAME_ISSUE*_PROOF` frontend marker.
- Proof builds remain separate and explicit until their scenarios are replaced
  by durable feature-level tests.
- Protocol validation, CSP, sandboxing, Tauri capability boundaries, binary
  transfer ownership, content validation, and lifecycle cleanup may not be
  weakened.
- A compile failure must not replace an already-running preview.
- Each successful Run receives a fresh preview runtime.
- Normal Tauri/release builds select PRODUCT by default.

## Stage status

### Stage 1 — Compile-time PRODUCT/PROOF build split — COMPLETE

**Commit:** `6675761 build: separate product and proof frontend profiles`

Delivered:

- Separate `entry.product.ts` and `entry.proof.ts` entry graphs.
- Separate `dist/` and `dist-proof/` outputs and distinct Tauri product/proof
  app identifiers.
- Rollup-derived `profile-manifest.json` files.
- Artifact checker proving module-graph and marker separation.
- Fresh product → proof → product verification workflow.
- Release CI product-profile check.
- Explicit proof configuration for packaged proof scripts and performance
  tooling.

Accepted evidence:

- Product graph: 23 modules, zero proof markers.
- Proof graph: 49 modules, all 18 expected markers.
- Full native product and proof packages built successfully.
- TypeScript, protocol, Rust, Clippy, shell syntax, and workflow checks passed.

### Stage 2 — Extract mixed production core — COMPLETE

**Commit:** `f2f4013 refactor: extract product preview lifecycle`

Delivered domain modules:

- `compiler-context.ts`
- `live-preview.ts`
- `lifecycle-controller.ts`
- `run-stop.ts`
- `first-run-warning.ts`

`issue21.ts`, `issue24.ts`, and `issue37.ts` are now proof-facing compatibility
modules and are absent from the product graph.

Accepted evidence:

- Product graph: 21 modules; issue21/24/37 and proof bridge modules absent;
  zero proof markers.
- Proof graph: 53 modules; all 18 expected markers.
- Full macOS packaged proof suite passed issues
  038/024/025/023/033/033-no-wasm-eval/034/035/036/037 phases 1–2, with zero
  orphans and a clean invoke-key scan.
- Full native PRODUCT package built after the proof package and passed the
  product artifact check.

### Stage 3 — Rename/extract product UI modules — COMPLETE

**Commit:** `0a45457 refactor: name product UI modules by responsibility`

Delivered responsibility-named modules:

| Domain module | Responsibility |
| --- | --- |
| `theme-controller.ts` | persistent theme controller |
| `monaco-editor.ts` | Monaco editor adapter |
| `problems-panel.ts` | Problems/diagnostics panel |
| `output-panel.ts` | Output panel |
| `dirty-state.ts` | workspace dirty-state protection |
| `project-manager.ts` | folder project manager and project identity |
| `preview-panel.ts` | embedded preview panel/focus/status |
| `project-content.ts` | project content preparation |

`issue049.ts` and `issue051.ts` remain as thin proof/test compatibility façades.
All other Stage-3 issue-numbered implementation modules were removed. The
artifact checker now rejects every issue-numbered module in the PRODUCT Rollup
graph and requires all eight responsibility-named modules.

Accepted evidence:

- Product graph: 21 modules; all eight Stage-3 domain modules present; zero
  issue-numbered modules and zero proof markers.
- Proof graph: 53 modules with all 18 expected proof markers.
- TypeScript, 102 protocol tests, 45 focused content/project tests, 56 Rust
  tests, the full frontend build, and profile verification passed.
- The complete packaged proof suite passed issues
  038/024/025/023/033/033-no-wasm-eval/034/035/036/037 phases 1–2, with zero
  orphans and a clean invoke-key scan.
- A full native PRODUCT package built successfully after the proof package.
- Independent review reported no blocking findings.

### Stage 4 — Consolidate historical issue proofs — COMPLETE

**Commit:** `ad8b0a8 test: consolidate proof drivers into scenarios`

Delivered eight durable scenario suites:

1. `proof-compile-run-stop.ts`
2. `proof-compiler-diagnostics.ts`
3. `proof-runtime-exception.ts`
4. `proof-output.ts`
5. `proof-content.ts`
6. `proof-preview-security.ts`
7. `proof-project-lifecycle.ts` plus `project-lifecycle.test.ts`
8. `proof-performance.ts`

`entry.proof.ts` now dispatches one entrypoint per scenario through the shared
`scenario-runner.ts`. The canonical packaged path is
`scripts/prove-scenarios-macos.sh`; historical issue-named scripts remain only
as compatibility runners. Content and shared proof flows now use the embedded
opaque-origin preview. `issue38.ts` is the sole remaining importer of
`issue38-bridge.ts`, unblocking Stage 5.

The artifact checker structurally rejects every `proof-*` module in PRODUCT,
requires exactly the eight scenario modules in PROOF, and retains explicit
issue21/issue38 checks. Project lifecycle tests consolidate historical identity
coverage and add open/save/dirty-state/atomic-failure coverage. The existing
issue040 input command now uses exact, bounded, main-caller-only embedded
preview registration for trusted packaged audio activation; command and ACL
inventories are unchanged.

Accepted evidence:

- PRODUCT graph: 21 modules, zero issue-numbered modules, zero `proof-*`
  modules, and zero proof markers.
- PROOF graph: 44 modules, exactly eight scenario modules, and all 18 expected
  proof markers.
- TypeScript, 102 protocol tests, 51 focused content/project tests, 32
  performance tests, Cargo format/check/Clippy, and 58 Rust tests passed.
- The canonical packaged suite passed all eight scenarios and every mapped
  sub-proof, including embedded texture/audio and performance.
- The retained issue038 packaged regression suite passed with zero orphans and
  a clean invoke-key scan.
- Full native PROOF and PRODUCT packages built successfully, with PRODUCT built
  last and passing its artifact check.
- Independent strict review accepted the final implementation with no blocking
  findings.

### Stage 5 — Retire isolated-window/issue-038 harness — PENDING

After remaining valuable proofs no longer depend on it:

- Remove `issue38.ts`, `issue38-bridge.ts`, isolated-window documents/assets,
  Rust bridge state, custom transfer/bridge handlers, and isolated window
  commands.
- Remove the fifteen `issue038_*` ACL/handler/build inventory entries.
- Preserve issue 038 and ADR 0002 as historical technical evidence.
- Do not run the hostile non-yielding test inside the product WebView; ADR 0003
  classifies that behavior as unsupported.
- Re-measure startup on the embedded product path.

### Stage 6 — Compile all remaining proof surfaces out of release binaries — PENDING

- Put Rust proof commands behind a non-default `proof-harness` Cargo feature or
  a separate proof crate/binary.
- Split proof exports/actions from `PreviewExports.cs`, `preview.js`, and the
  compiler harness.
- Rename the remaining product Tauri commands by responsibility.
- Target approximately eight domain-named product commands instead of the
  current 82-command combined inventory.

### Stage 7 — Final architecture enforcement and cleanup — PENDING

- CI fails if product JS imports proof or issue modules, emits proof markers, or
  if the production binary exposes proof commands.
- Production source paths contain no issue-numbered implementation files.
- Split oversized Rust/TypeScript/C# runtime files by responsibility.
- Run final product smoke, security, offline, package-size, startup, memory,
  protocol, formatting, and lint gates.
- Update architecture/build/security documentation to describe only the final
  product and separate test architecture.

## Resume instructions

At the start of a later session:

1. Read this file, ADR 0003, and the last completed stage commit.
2. Confirm `git status --short --branch` is clean.
3. Run the next PENDING stage with a fresh worker and reviewer according to the
   execution protocol above.
4. Update this file's status/evidence in the accepted stage commit.

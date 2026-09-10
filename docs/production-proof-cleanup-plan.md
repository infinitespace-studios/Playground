# Production/proof architecture cleanup plan

**Status:** Stage 7 implementation committed and locally accepted; clean-clone CI pending
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

### Stage 5 — Retire isolated-window/issue-038 harness — COMPLETE

**Commit:** `681be79 refactor: retire isolated preview harness`

Delivered:

- Removed `issue38.ts`, `issue38-bridge.ts`, the isolated packaged runner,
  isolated documents/assets/routes, Rust bridge/transfer/relay state, and the
  isolated issue040 dispatch branch.
- Removed all fifteen `issue038_*` commands from handlers, build inventories,
  permissions, and proof command inventories. Application commands dropped
  from 97 to 82; the effective ACL count dropped from 99 to 84.
- Preserved durable security coverage on the embedded opaque-origin iframe and
  kept exactly eight proof scenarios.
- Re-pointed performance measurement to the embedded product path and replaced
  the isolated-window baseline with a fresh embedded memory/timing baseline.
- Re-pointed the process-sandboxed offline proof to the current embedded
  texture/audio/input scenario with bounded owned-process cleanup and strict
  report grading.
- Preserved issue 038 and ADR 0002 as unmodified historical evidence. The
  hostile synchronous non-yielding test was not moved into the product WebView.

Accepted evidence:

- PRODUCT graph: 21 modules, zero issue-numbered/scenario modules, and zero
  proof markers.
- PROOF graph: 42 modules, exactly eight scenarios, issue38 absent, and all 17
  expected proof markers.
- TypeScript, 102 protocol tests, 51 focused content/project tests, 32
  performance tests, Cargo format/check/Clippy, and 38 Rust tests passed.
- The canonical packaged suite passed all eight embedded scenarios with zero
  orphans and a clean invoke-key scan.
- The corrected offline packaged proof passed under process-scoped network
  denial with trusted input, exactly one clean report, and no orphan process.
- The embedded memory baseline passed; an independent 10-run timing
  corroboration reached at least 10 samples per phase with zero failures,
  censoring, or threshold violations. Embedded preview-start p95 was 239 ms
  cold and 229 ms warm.
- Native PROOF and PRODUCT packages built successfully, with PRODUCT built last
  and passing the artifact check.
- Independent strict review accepted the final implementation with no blocking
  findings.

Detailed inventory and evidence:
[`stage5-issue038-retirement.md`](stage5-issue038-retirement.md).

### Stage 6 — Compile all remaining proof surfaces out of release binaries — COMPLETE

**Commit:** `19ecadb build: compile proof harness out of product releases`

Delivered:

- Added a non-default `proof-harness` Cargo feature. PRODUCT compiles only eight
  responsibility-named commands; PROOF adds 70 feature-gated commands.
- Removed four dead issue039 transfer commands and their inert Rust/protocol
  state, reducing the proof command surface from 82 to 78.
- Split PRODUCT/PROOF capabilities and permissions. Effective ACL counts are 10
  for PRODUCT and 82 for PROOF.
- Renamed the product command API to workspace, project, and first-run
  responsibilities, with no product aliases for the old issue-numbered names.
- Split preview and compiler C#/JS proof exports, actions, globals, observers,
  and DOM/assets into proof-only compilation/staging units.
- Made compiler/preview staging profile-aware and changed profile verification
  to stage PRODUCT → PROOF → PRODUCT independently.
- Added a compiled binary/runtime checker with negative self-tests and release
  CI enforcement. PRODUCT checks require product floors while rejecting proof
  commands, gates, relay state, exports, globals, and assets; PROOF checks
  require the full harness and exactly eight scenarios.

Accepted evidence:

- PRODUCT frontend graph: 21 modules and zero proof markers/scenarios. The
  identity-verified native package exposes exactly eight product commands and
  no proof runtime surface.
- PROOF frontend graph: 42 modules, exactly eight scenarios, and all 17 proof
  markers. The identity-verified package exposes all 78 commands and required
  proof assets.
- TypeScript, 104 protocol tests, 51 focused tests, 32 performance tests, Rust
  format/Clippy, and 23 PRODUCT plus 37 PROOF Rust tests passed.
- All compiler/preview staging-clean tests and the honest profile-specific
  PRODUCT → PROOF → PRODUCT contamination sequence passed.
- The binary checker passed 11 negative self-tests and both native package
  profiles.
- All eight packaged scenarios, the process-sandboxed offline embedded proof,
  and the fresh startup/memory baseline passed with zero orphans.
- Independent strict review accepted the final implementation with no blocking
  findings.

Detailed design and evidence:
[`stage6-proof-binary-separation.md`](stage6-proof-binary-separation.md).

### Stage 7 — Final architecture enforcement and cleanup — LOCAL ACCEPTANCE COMPLETE; CI PENDING

**Implementation commit:** `bebcadc refactor: enforce final product proof architecture`

**Status:** implementation complete and independently reviewed with no blocking
findings. Local native acceptance passed; push and clean-clone quality plus
six-platform release CI remain. Detailed inventory, final architecture, and
verification matrix: [`stage7-final-architecture.md`](stage7-final-architecture.md).

Delivered in this working tree:

- Created `docs/stage7-final-architecture.md` (mandatory inventory/design).
- Removed the four obsolete top-level-canvas inline proofs (009/010/011/020)
  from `entry.proof.ts`, their eleven Rust commands/helpers from `lib.rs`, the
  `build.rs` `PROOF_COMMANDS`/`HANDLER_ORDER` entries, `permissions/proof.toml`,
  and the frontend `ISSUE034_APPROVED_COMMANDS` inventory. Proof commands
  70→59; handler surface 78→67; effective proof ACL 82→71. Updated every
  hard-coded count in `build.rs`, `lib.rs` tests, `protocol.test.ts`, the binary
  checker, and the marker floors.
- Frontend issue-numbered filenames removed: deleted unused `issue051.ts`;
  bypassed and removed `issue049.ts` and `issue24-controller.ts` (consumers now
  import the responsibility modules directly); renamed `issue21.ts` →
  `scenario-toolkit.ts`, `issue21-controller.ts` → `scenario-load-controller.ts`,
  `issue23-controller.ts` → `scenario-run-controller.ts`, the issue039/040 tests
  → `content-validation.test.ts` / `audio-content.test.ts`, and the audio
  contract/fixture → `audio-content-contract.ts` / `audio-content-fixture.ts`.
  Fixture-builder and static-test scripts renamed by responsibility.
- Shared/preview responsibility renames completed and fully re-pointed:
  `src/shared/Issue21Endpoints.js` → `ProtocolEndpoints.js`,
  `src/shared/Issue21EndpointsProof.js` → `ProtocolEndpointsProof.js`, and
  `src/preview/wwwroot/issue033-negative-observer.js` →
  `preview-no-wasm-eval-observer.js`, with every consumer updated (both csproj
  deploy/remove entries, `stage-compiler.mjs`/`stage-preview.mjs`, `preview.js`,
  `compiler-harness.js`, the proof extensions, `preview-frame.ts`, `build.rs`,
  `protocol.test.ts`, `verify-profiles.sh`, the static/clean staging tests, and
  the binary checker asset list).
- Added a generic fail-closed staged-asset guard
  (`src/frontend/scripts/staged-asset-guard.mjs`, `--self-test`) wired into both
  `stage-compiler.mjs` and `stage-preview.mjs`: any issue-numbered implementation
  *filename* re-entering the staged compiler/preview asset tree (product OR
  proof) is a hard failure.
- Rebuilt `scripts/measure-release-size.mjs` into a cross-platform,
  PRODUCT-profile, fail-closed package-size gate: accepts explicit
  `--binary/--package/--package-dir/--dist/--target`; resolves any of the six
  release package formats; verifies required artifacts and the <=100 MiB target;
  validates the staged-dist profile (and `.app` identity) without expecting proof
  commands; recognises the implemented content fixtures; writes a report only
  with `--report`; deterministic self-test 28/28 (also run against the real DMG).
- Added a bounded PRODUCT smoke gate (`scripts/smoke-product.mjs`,
  `--self-test`): refuses proof env/profile, verifies product identity, launches
  the product, requires survival past a bounded readiness/no-immediate-crash
  window, terminates only the owned PID/process tree, captures logs, and fails on
  crash/proof markers or orphans. Honest release matrix (full launch on
  host-native macOS arm64; identity-only for cross-compiled macOS x64 and where
  no reliable display exists); 25/25 self-test incl. real process-tree reap.
- Added `.github/workflows/quality.yml` (pull_request + push): clean-clone-only
  fast gate (npm ci/typecheck/focused+perf tests/four tool self-tests, shell
  `bash -n` + static runner tests, `cargo fmt --check`). It intentionally does
  NOT check out the MonoGame submodule, stage assets, or build the Tauri crate,
  so it cannot fail merely because ignored artifacts are absent.
- Extended `.github/workflows/release.yml`: post-staging `cargo clippy` (all
  legs) + `cargo test` (host-native legs); post-package binary-inventory,
  package-size, and bounded-smoke gates per freshly built artifact (full launch
  on host-native macOS arm64, identity-only elsewhere); six-platform packaging
  + x64 fix preserved. Workflow-artifact upload follows the gates; tag builds
  attach to a draft Release during the build step, and that draft must not be
  published unless every leg is green. An opt-in `run_proof_acceptance` dispatch
  job runs PROOF clippy/test + packaged scenarios + PROOF binary inventory.
- Documentation: rewrote/updated `README.md`, `CONTRIBUTING.md`, `docs/build.md`
  (CI gates section), `docs/security-model.md`, `docs/content-workflow.md`,
  `docs/release-support-matrix.md`, `docs/stage7-final-architecture.md`, and this
  plan/handoff to describe the final architecture and exact implemented/deferred
  gates. Removed the superseded
  `docs/issue052-task3-proof-repointing-plan.md`.

Completed responsibility splits include `PreviewExports.cs` partial-class
mount/lifecycle/runtime files, the proof preview runtime's entry/state/audio/
bridge/lifecycle modules, `scenario-toolkit.ts` support modules, and the
feature-gated Rust `proof_harness.rs`. Superseded issue-numbered packaged wrappers
were removed in favor of the canonical scenario runner.

Accepted local evidence:

- TypeScript plus 155 focused frontend tests and 32 performance-tool tests
  passed; PRODUCT remained 21 modules with zero proof markers, while PROOF had
  45 modules, exactly eight scenarios, three required support modules, and all
  13 current proof markers.
- Rust format/Clippy and 23 PRODUCT plus 37 PROOF tests passed. Inventories are
  exactly 8 PRODUCT commands, 59 feature-gated proof commands, 67 total, with
  effective ACL counts of 10 and 71.
- Native macOS arm64 PRODUCT and PROOF packages and macOS x64 PRODUCT package
  built successfully. PRODUCT/PROOF binary checks passed, PRODUCT was built
  last, and arm64/x64 DMGs passed at 93.36 MiB and 92.57 MiB.
- All eight packaged scenarios and every mapped sub-proof passed with zero
  orphans and a clean invoke-key scan. The process-sandboxed offline content/
  audio proof passed under network denial.
- Bounded PRODUCT launch smoke passed with clean owned-process teardown. A fresh
  startup/memory baseline passed every threshold with zero failed, censored, or
  missing samples.
- Independent strict review found no blocking issues. Remaining gate: push, then
  require `quality.yml` and all six PRODUCT release matrix legs to
  pass; run opt-in remote proof acceptance before publishing a release.

### Stage 7 — original scope (reference)

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

# Stage 7 — final architecture enforcement and cleanup (inventory & design)

**Implementation commits:** `bebcadc`, `842162a`, `992d9f0`, `f36133b`,
`9029845`, `b0a5584`, and `dfca462`; acceptance record: `fa598b9`.

**Status:** COMPLETE. Implementation, local acceptance, independent review,
clean-clone quality CI, all six PRODUCT package legs, and remote packaged PROOF
acceptance passed. Final acceptance runs:

- https://github.com/infinitespace-studios/Playground/actions/runs/34532612728
- https://github.com/infinitespace-studios/Playground/actions/runs/34532693231

The final source architecture, enforcement, and evidence are recorded below.
**Decision basis:** ADR 0003 (embedded opaque-origin product preview);
`production-proof-cleanup-plan.md` Stage 7; `session-handoff-production-proof-cleanup.md`.
**Predecessor evidence:** Stages 1–6 (`6675761`, `f2f4013`, `0a45457`,
`ad8b0a8`, `681be79`, `19ecadb`, `274bff9`).

This document is the mandatory pre-implementation inventory required by the Stage
7 scope. It enumerates every remaining issue-numbered implementation/proof/test
file, compatibility façade, oversized module, transitional current-doc
section/comment, and CI/acceptance gap; classifies each **retain / rename /
remove / split**; defines the final architecture; and defines a verification
matrix. Historical evidence (`issues/*`, ADR 0001/0002, `docs/stage4-*`,
`docs/stage5-*`, `docs/stage6-*`) is preserved unchanged. Issue 057 (manifest
preview dimensions) is **out of scope** for Stage 7 — it has a separate commit
gate — and is not implemented here.

---

## 0. Invariants preserved (ADR 0003 + Stage 1–6 build/security boundaries)

- Production preview is the embedded, opaque-origin `sandbox="allow-scripts"`
  iframe with the exact CSP of the security model. No separate visible preview
  window returns as product UX.
- PRODUCT is the default for npm/Tauri/release builds; PROOF requires both the
  explicit `MONOGAME_FRONTEND_PROFILE=proof` frontend profile **and** the
  non-default `proof-harness` Cargo feature.
- PRODUCT frontend graph carries zero `MONOGAME_ISSUE*_PROOF` markers, zero
  `proof-*` scenario modules, zero issue-numbered modules.
- A compile failure never replaces an already-running preview; each successful
  Run gets a fresh runtime; content mounts before game start.
- Protocol validation, CSP, opaque-origin sandbox, Tauri IPC/capability denial,
  binary-transfer integrity, and lifecycle cleanup are not weakened.
- The architecture-portable product binary check from `274bff9` is preserved.

---

## 1. Remaining issue-numbered files — inventory & classification

### 1.1 Frontend TypeScript (`src/frontend/src/`)

| File | Consumers (proven by grep) | Role today | Stage 7 classification |
| --- | --- | --- | --- |
| `issue21.ts` (2505 L) | 8 `proof-*` scenarios; imports `issue21-controller`, `issue23-controller` | Shared PROOF runtime toolkit (packaged runtime, persistent compiler, embedded-preview support) | **RENAMED** → `scenario-toolkit.ts` (responsibility name). The domain **SPLIT** into smaller modules is now **DONE** (Stage 7 continuation — see §3.2) |
| `issue21-controller.ts` | `issue21.ts` only | Load-controller + proof-outcome verifier used by the toolkit | **RENAMED** → `scenario-load-controller.ts` |
| `issue23-controller.ts` | `issue21.ts` only | Clear-color run controller + forced-retirement helper | **RENAMED** → `scenario-run-controller.ts` |
| `issue24-controller.ts` | `proof-runtime-exception`, `proof-performance`, `proof-compile-run-stop` | Compat façade re-exporting `createRunStopController`/`PreviewLifecycleState` from `lifecycle-controller.ts` | **REMOVED** (bypass): consumers import `lifecycle-controller.ts` directly |
| `issue049.ts` | `proof-output.ts` only | Compat façade re-exporting `output-panel.ts` (`getIssue049OutputPanel`/`formatOutputLine`) | **REMOVED** (bypass): `proof-output.ts` imports `output-panel.ts` directly |
| `issue051.ts` | **none** (0 importers) | Dead compat façade over `project-manager.ts` | **REMOVED** (unused) |
| `issue039.test.ts` | run by `node --test` | Content-validation feature tests (31 tests) | **RENAMED** → `content-validation.test.ts` |
| `issue040.test.ts` | run by `node --test` | Audio content feature tests (10 tests) | **RENAMED** → `audio-content.test.ts` |
| `issue040-contract.ts` | `proof-content.ts` | Audio proof contract types/helpers | **RENAMED** → `audio-content-contract.ts` |
| `issue040-fixture.ts` | `proof-content.ts` | Audio proof WAV/XNB fixture | **RENAMED** → `audio-content-fixture.ts` |

`entry.proof.ts` inline proofs `009/010/011/020` — see §2 (dead inline proofs).

### 1.2 Rust (`src/desktop/src-tauri/`)

| Symbol | Location | Role | Classification |
| --- | --- | --- | --- |
| `issue009_*`, `issue010_*`, `issue011_*`, `issue020_*` commands (11) | `lib.rs`, `build.rs` (`PROOF_COMMANDS`, `HANDLER_ORDER`), `permissions/proof.toml` | Inline top-level-canvas proofs (input/audio/resize/realm) rendering into `#canvas` | **REMOVE** — dead (see §2) |
| all other `issueNNN_*` proof commands | `proof_harness.rs` (whole module feature-gated) | Live PROOF scenario protocol (report/checkpoint/enable) invoked by the 8 canonical scenarios | **RETAIN + SPLIT DONE** — moved verbatim from `lib.rs` into a `#[cfg(feature = "proof-harness")] mod proof_harness;` boundary (renaming the active proof protocol names stays out of scope) |
| 8 product commands (`workspace_*`, `project_*`, `first_run_*`) | `lib.rs`, `build.rs` `PRODUCT_COMMANDS` | Product API (already responsibility-named in Stage 6) | **RETAIN** in `lib.rs` |

### 1.3 Shared / compiler / preview (C# + JS)

| File | Consumers | Role | Classification |
| --- | --- | --- | --- |
| `src/shared/Issue21Endpoints.js` (285 L) | staging scripts, csproj (compiler+preview), `preview.js`, `compiler-harness.js`, `protocol.test.ts`, binary checker | Shared product protocol endpoint plumbing (binary envelope validation, dispatch) | **RENAMED** → `ProtocolEndpoints.js`; all consumers re-pointed (csproj deploy entries, both staging scripts, `preview.js`, `compiler-harness.js`, `protocol.test.ts`, binary checker) |
| `src/shared/Issue21EndpointsProof.js` (89 L) | proof extensions, csproj | Proof-only expectation registry + proof handshake | **RENAMED** → `ProtocolEndpointsProof.js`; consumers re-pointed (proof extensions, both csproj proof deploy entries, `build.rs` staged-asset check, `protocol.test.ts`, staging scripts, `verify-profiles.sh`, binary checker) |
| `src/preview/wwwroot/issue033-negative-observer.js` | proof `index.html` staging | Proof-only no-wasm-eval observer document | **RENAMED** → `preview-no-wasm-eval-observer.js`; consumers re-pointed (`Playground.Preview.csproj` Content Remove, `preview-frame.ts` script src, `stage-preview.mjs`, `verify-profiles.sh`, `test-stage-preview-proof-clean.sh`, `test-verify-profiles-static.sh`, binary checker) |
| `src/preview/PreviewExports.cs` (1239 L) | preview build | Product JSExports (mount/lifecycle/runtime-failure) | **SPLIT DONE** — split into responsibility-based partial-class files (`PreviewExports.cs` bootstrap/runtime-failure/output, `PreviewExports.Mount.cs`, `PreviewExports.Lifecycle.cs`) by exact source movement; PRODUCT+PROOF build/publish verified with the pinned SDK |
| `src/preview/wwwroot/preview-proof-extension.js` (1187 L) | proof staging | Proof-only preview instrumentation | **SPLIT DONE** — split by proof domain into an entry (`preview-proof-extension.js`) plus four proof-only sibling modules (`preview-proof-state.js`, `preview-proof-audio.js`, `preview-proof-bridge.js`, `preview-proof-lifecycle.js`) by exact source movement; entry retains initialization order; PRODUCT absent / PROOF present verified (see §7.2) |

### 1.4 Scripts

| Script | Role | Classification |
| --- | --- | --- |
| `scripts/prove-issue037-macos.sh` | Compat wrapper superseded by canonical scenario 7 | **REMOVED**; `prove-scenarios-macos.sh` owns the two-phase packaged proof |
| `scripts/prove-issue039-macos.sh` | Compat wrapper superseded by canonical scenario 5 | **REMOVED** |
| `scripts/prove-issue040-macos.sh` | Compat wrapper superseded by canonical scenario 5 | **REMOVED** |
| `scripts/build-issue040-sound-fixture.mjs` | Builds the deterministic audio proof fixture | **RENAMED** → `build-audio-content-fixture.mjs` |
| `scripts/build-issue052-content-fixtures.mjs` | Builds content fixtures | **RENAME** → `build-content-fixtures.mjs` |
| `src/frontend/scripts/test-stage-issue21-clean.sh` | Static test that proof toolkit staging is clean | **RENAME** → `test-stage-proof-toolkit-clean.sh` |

### 1.5 Retained issue-numbered names (documented necessity)

- All **live proof command / env / report protocol** names
  (`MONOGAME_ISSUE0xx_PROOF`, `issueNNN_emit_report`, `ISSUE0xx_REPORT=`) used by
  the eight canonical scenarios and `prove-scenarios-macos.sh`. Renaming these is
  explicitly out of Stage 7 scope (aesthetic-only churn on a security-critical
  protocol). They live only in the PROOF build (feature-gated) and never appear
  in PRODUCT artifacts.
- Historical `issues/*` records, ADR 0002, and `docs/stage4/5/6-*` evidence.

---

## 2. Dead inline proofs (`009/010/011/020`) — removal analysis

`entry.proof.ts` runs four inline top-level-shell proofs that render into a
`#canvas` element. The current workbench `index.html` has **no `#canvas`** (only
`#canvas-frame` and `#runtime-status`), and the in-file comment (≈L340) states
the demo "is obsolete there … Gated off, not removed". Findings:

- `startMonoGame()` is gated on `document.querySelector("#canvas")` → never runs.
- `runIssue009Proof`/`runIssue011Proof` throw immediately if reached (require
  `#canvas`); they are unreachable because their env gates are never set by any
  live runner.
- The canonical `prove-scenarios-macos.sh` runner executes scenarios **1–8** and
  does **not** invoke `MONOGAME_ISSUE009/010/011/020_PROOF`.
- `test-prove-packaged-offline-static.sh` asserts the offline runner **no longer**
  uses `MONOGAME_ISSUE011_PROOF`/`ISSUE011_REPORT` (already retired there).
- No `.github/` workflow, no packaged runner, and no other script sets these
  gates. Historical evidence is preserved in `issues/009|010|011|020-*.md`.

**Decision: REMOVE.** Remove the four inline proof blocks and their helper
types/state from `entry.proof.ts`, the 11 Rust commands + helpers from `lib.rs`,
the 11 entries from `build.rs` `PROOF_COMMANDS`/`HANDLER_ORDER`, and the 11 lines
from `permissions/proof.toml`. Adjust marker floors in
`check-profile-artifacts.mjs` (source markers drop from 18→14). Command counts:
PROOF 78→67, proof commands 70→59; effective proof ACL 82→71. The four
`#canvas` demo loaders (`startMonoGame` and its native-runtime bootstrap) are
removed with them because they only existed to feed the obsolete demo.

---

## 3. Oversized modules — split plan

All planned responsibility splits are complete and verified locally; the table
below records the resulting boundaries.

| File | Lines | Planned split (by domain) | Status |
| --- | --- | --- | --- |
| `scenario-toolkit.ts` (was `issue21.ts`) | 2505 | `packaged-proof-readiness.ts`, `persistent-compile-support.ts`, `embedded-preview-support.ts` with the toolkit as the core/barrel | **DONE** — see §3.2 |
| `lib.rs` | was 3557 | extract feature-gated proof commands/state into `proof_harness.rs` | **DONE** — see §3.1; `lib.rs` now 1979 L, `proof_harness.rs` 1626 L |
| `PreviewExports.cs` | 1239 | partial-class files: `.Mount.cs`, `.Lifecycle.cs`, bootstrap/runtime-failure retained in `PreviewExports.cs` | **DONE** — exact source movement; no behavior change; PRODUCT+PROOF verified |
| `preview-proof-extension.js` | 1187 | by proof domain (state/audio/bridge/lifecycle + entry) | **DONE** — see §7.2 |

Avoid arbitrary splits of `protocol.test.ts` and the eight scenario files. Keep
exactly eight proof scenario modules.

### 3.1 Rust proof-harness split (this pass)

`src/desktop/src-tauri/src/lib.rs` (3557 L) was split by **exact source
movement** into a feature-gated `proof_harness` module. `lib.rs` now holds the
eight PRODUCT commands and the PRODUCT workspace/project/first-run/preview
protocol responsibilities (1979 L); `src/desktop/src-tauri/src/proof_harness.rs`
(1626 L) holds the fifty-nine packaged-proof commands, their env gates,
report/checkpoint protocol, macOS trusted-input dispatch (`issue040_*`,
`issue034_trusted_marker*`), and the packaged activation/report relay
(`relay_packaged_proof_through_launch_services`, `emit_packaged_proof_report`,
`activate_packaged_proof_window`, `prepare_packaged_proof_window`).

Boundary and invariants:

- Gating: `#[cfg(feature = "proof-harness")] mod proof_harness;` plus
  `#[cfg(feature = "proof-harness")] pub(crate) use proof_harness::*;`. The
  default PRODUCT compilation never links the module (verified: a clean default
  `.dylib`/`.a` build contains zero `issue040_dispatch_preview_input`,
  `issue041_rss_bytes`, `prepare_packaged_proof_window`,
  `MONOGAME_ISSUE041_BENCHMARK`, or `ISSUE037_CHECKPOINT` strings).
- The glob re-export keeps every `tauri::generate_handler!` command identifier
  **bare**, so `build.rs`'s per-line gate parser, `HANDLER_ORDER`,
  `PRODUCT_COMMANDS`/`PROOF_COMMANDS` (8/59/67), the effective-ACL counts
  (product 10, proof 71), and the crate-root test module's `super::` references
  are all unchanged. `run()`, the single `generate_handler!`/`invoke_handler`,
  and the `.invoke_handler(` forbidden-surface floor stay in `lib.rs`.
- Cross-boundary seams: `proof_harness` calls the PRODUCT-owned
  `crate::first_run_store_path` / `first_run_read_store` /
  `first_run_write_store_atomic` / `FIRST_RUN_SCHEMA_VERSION` (issue037 proof
  store overlay). `lib.rs`'s proof-variant `first_run_store_filename`,
  `ISSUE037_PROOF_STORE_FILENAME`, and the first-run acknowledgement store stay
  in `lib.rs` as PRODUCT first-run responsibilities.
- Moved items are `pub(crate)` (the `pub(super)` boundary the scope suggested,
  realised as `pub(crate)` since the module's parent is the crate root) so the
  glob re-export surfaces them; no proof symbol is `pub`.
- Tests: the default 23 / proof 37 test counts and behavior are preserved. All
  proof-only unit tests stay in the crate-root `tests` module gated by
  `#[cfg(feature = "proof-harness")]`, binding to the moved symbols via the
  glob. The one ungated meta-test that scanned `lib.rs` for the issue041 gate
  strings (`issue041_benchmark_instrumentation_is_environment_gated`) was
  repointed to `include_str!("proof_harness.rs")` — `include_str!` reads from
  disk at compile time regardless of the active feature, so the default build
  still validates the seven gated command bodies without linking the proof
  surface. No proof was resurrected (009/010/011/020 remain removed).

### 3.2 Frontend `scenario-toolkit.ts` split (this pass)

`src/frontend/src/scenario-toolkit.ts` (2505 L) was split by **exact source
movement** into three coherent proof-only SUPPORT modules by actual proof
responsibility, leaving the toolkit as the core transfer-integrity /
compile-and-load / issue22 / issue23-run orchestrator plus a small re-export
barrel. No behavioral change: every moved function/type is byte-identical to its
pre-split body, and the toolkit re-exports each moved public surface so the eight
proof scenarios keep the exact same import site (`./scenario-toolkit`).

- `src/frontend/src/packaged-proof-readiness.ts` (114 L) — packaged (Tauri) proof
  runtime readiness / native window activation: `preparePackagedProofRuntime`.
  Depends only on browser + ambient host globals (`__TAURI_INTERNALS__`,
  `__MONOGAME_DIAGNOSTICS__`), so it has zero toolkit import edges.
- `src/frontend/src/persistent-compile-support.ts` (177 L) — persistent Roslyn
  compiler + compile-buffer support and benchmark preconditions:
  `compileSourcesThroughPersistentCompiler`, `prepareCompilerContextForBenchmark`,
  `waitForShellSteadyStateForBenchmark`, `compileToBuffers`. Drives the shared
  compiler context (`ensureContexts`/`compilerClient`) + protocol validators.
- `src/frontend/src/embedded-preview-support.ts` (652 L) — embedded (in-page)
  opaque-origin sandboxed-iframe preview lifecycle (ADR 0003): the rich in-page
  runner `runInPagePreviewForProof` (+ `InPageProofPreview`), the issue-033
  negative probe `probeInPageNoWasmEvalBoot`, and the embedded proof-preview
  context `createEmbeddedProofPreview` (+ `EmbeddedProofPreviewContext`). Reuses
  the neutral `preview-frame` primitives + shared compiler context.

Boundary and invariants:

- Import edges flow **one way** (`scenario-toolkit` → the three support modules;
  and each support module → `protocol`/`preview-frame`/`compiler-context`), so
  there is **no cycle**. `scenario-toolkit` imports `preparePackagedProofRuntime`
  (for `runIssue021AutoProof`) and `createEmbeddedProofPreview` (for
  `compileLoadStartIssue23`) and re-exports the rest as a barrel.
- The toolkit RETAINS the shared proof types (`ContextProof`, `ProbeExpectation`,
  `ManagedLoadProof`, `Issue22PipelineProof`, `PostMutationTaintProof`,
  `Issue23RunningPreview`, `ChildFrameReadiness`), the `Window` global
  augmentation, the bootstrap-augmentation + context-setup side effects
  (`registerBootstrapAugmentation`/`registerContextSetup`), `compileAndLoad`,
  `runIssue021AutoProof`, `compileLoadConstructIssue22Case`,
  `compileLoadStartIssue23`, and the `requireVisiblePreviewFrame` visibility
  helper (the read-source proof still asserts it lives here).
- Every preserved export name is unchanged: `preparePackagedProofRuntime`,
  `compileAndLoad`, `runIssue021AutoProof`, `compileLoadConstructIssue22Case`,
  `compileSourcesThroughPersistentCompiler`, `prepareCompilerContextForBenchmark`,
  `waitForShellSteadyStateForBenchmark`, `compileLoadStartIssue23`,
  `runInPagePreviewForProof`, `probeInPageNoWasmEvalBoot`, `compileToBuffers`,
  `createEmbeddedProofPreview`, and the `Issue23RunningPreview`/
  `InPageProofPreview`/`EmbeddedProofPreviewContext` types. All exact proof
  command/env/report names, transfer-detach integrity, compile-failure behavior,
  content-before-start ordering, fresh embedded runtime, the no-wasm-eval probe,
  and cleanup ordering are carried verbatim.
- The three modules are neither `proof-*` scenario suites nor issue-numbered, so
  the structural PRODUCT guards still hold, and they are enumerated in
  `check-profile-artifacts.mjs` `PROOF_SUPPORT_MODULES` (added to
  `PROOF_ONLY_MODULES`) with an explicit PROOF-present assertion so the split is
  **non-vacuously enforced**: PROOF must contain all three, PRODUCT must contain
  none. `protocol.test.ts` reads all three source files and asserts each
  responsibility's entrypoint moved to its own module (and is NOT re-declared in
  the toolkit) while the barrel re-exports remain.

Actual commands run this pass:

- `npx tsc --noEmit` (frontend) — PASS (0 errors).
- `node --test src/protocol.test.ts` — 104 PASS (incl. the new split
  read-source assertions).
- `node --test src/content-validation.test.ts` / `project-lifecycle.test.ts` —
  31 + 10 PASS. (`audio-content.test.ts` has 1 pre-existing failure unrelated to
  this split — a Rust `lib.rs` issue040 env-gate assertion in the dirty tree.)
- `npm run stage:proof && npm run build:vite:proof && node
  scripts/check-profile-artifacts.mjs proof` — PROOF PASS: **45** modules, 88
  chunks, 13/13 markers; all three support modules present in the proof graph.
- `npm run stage && npm run build:vite && node
  scripts/check-profile-artifacts.mjs product` — PRODUCT PASS (restored):
  **21** modules, 14 markers, 0 proof markers; all three support modules absent
  from the product graph.
- `npm run test:verify-profiles-static` — PASS. `npm run
  test:staged-asset-guard` — 12/12 PASS. PRODUCT is the final staged/built
  profile (working tree restored to product).


---

## 4. Transitional current-doc sections / comments — cleanup

| Location | Item | Action |
| --- | --- | --- |
| `README.md` | Placeholder "Playground" only | **REWRITE** to final architecture overview |
| `docs/build.md` | "Stage-2 boundary", "Stage-4 boundary", "Stage 6 slice 6" narrative | **REWRITE** to describe final PRODUCT/PROOF architecture, keeping links to stage evidence as history |
| `docs/security-model.md` | "Stage 6 split", "removed in Stage 5" live narration | **KEEP** the historical §038 record (explicitly required), **trim** transitional Stage phrasing from the live sections |
| `docs/content-workflow.md` | verify current | **UPDATE** to final content pipeline |
| `docs/release-support-matrix.md` | verify current | **UPDATE** to final release scope |
| `docs/issue052-task3-proof-repointing-plan.md` | Superseded plan | **REMOVE** |
| `docs/performance-baseline.md` | current | **UPDATE** package-size section as needed |
| live source / checkers | "Stage N" comments no longer aiding current behavior | **TRIM** where they don't describe current behavior |
| new `CONTRIBUTING.md` | absent | **CREATE** contributor guidance |

Preserve `production-proof-cleanup-plan.md` and
`session-handoff-production-proof-cleanup.md`, updating only to a **draft** Stage
7 implementation state (no acceptance/evidence claims before review).

---

## 5. Script compatibility decision

The issue-numbered `prove-issue037/039/040-macos.sh` compatibility wrappers were
removed. The canonical `prove-scenarios-macos.sh` already owns their complete
behavior: scenario 5 runs both content sub-proofs and scenario 7 runs the
first-run warning's two packaged phases. The offline runner invokes the same
bounded content-workflow protocol directly and does not depend on a wrapper.
Historical stage evidence continues to name the scripts that existed at the time.

---

## 6. CI / acceptance gaps

| Gap | Stage 7 action | Verifiable here? |
| --- | --- | --- |
| `measure-release-size.mjs` expected proof commands in PRODUCT, marked implemented content fixtures "not yet implemented", hardcoded `aarch64` DMG, and always wrote a report | **REPAIRED** (this pass): cross-platform PRODUCT-profile fail-closed gate accepting explicit `--binary/--package/--package-dir/--dist`; resolves any of the six package formats; verifies required artifacts + <=100 MiB target; validates staged-dist profile (+ `.app` identity) without proof-command expectation; recognises the implemented content fixtures; only writes a report with `--report`; 28/28 self-test | **Yes** (node) |
| No consolidated CI quality workflow | **ADDED** `.github/workflows/quality.yml`: clean-clone-only checks — `npm ci`, typecheck, focused tests, perf tests, the four tool self-tests, shell `bash -n` + static runner tests, and `cargo fmt --check`. Asset-dependent checks remain in release CI after staging. | **Verified** — run 34532612728 passed |
| Product smoke gate (launch/no-immediate-crash) | **ADDED** (this pass) `scripts/smoke-product.mjs`: bounded, refuses proof env/profile, verifies product identity, launches, requires survival past a bounded readiness window, terminates only the owned PID/tree, scans logs for crash/proof markers, fails on orphans; honest release matrix (full launch on host-native macOS arm64, identity-only for cross-compiled macOS x64 and where no reliable display exists); 25/25 self-test incl. real process-tree termination | **Yes** (node self-test; identity-only run verified) |
| Asset-dependent Rust + package-size + smoke against freshly built bundles | **WIRED** into `release.yml`: post-staging `cargo clippy` (all legs) + `cargo test` (host-native legs); post-package binary-inventory + package-size + smoke per leg; opt-in `proof-acceptance` runs PROOF clippy/test + packaged scenarios. | **Verified** — all six PRODUCT legs and proof acceptance passed in run 34532693231 |

---

## 7. Implementation status this session & remaining work

Executed and verified across the Stage 7 working tree (see verification matrix
§8). Items marked *(earlier pass)* were completed before this narrow
continuation pass; items marked *(this pass)* were completed now.

- This inventory document.
- Removal of dead inline `009/010/011/020` proofs (frontend + Rust + ACL +
  checker floors) *(earlier pass)*.
- Frontend cleanup: removed `issue051.ts` (unused) and bypassed
  `issue049.ts`/`issue24-controller.ts`; **renamed** `issue21.ts` →
  `scenario-toolkit.ts`, `issue21-controller.ts` → `scenario-load-controller.ts`,
  `issue23-controller.ts` → `scenario-run-controller.ts`, the `issue039/040`
  tests, and the audio contract/fixture by responsibility *(earlier pass)*.
  **The `issue21.ts` domain SPLIT is now DONE** (this continuation pass) —
  scenario-toolkit was split into `packaged-proof-readiness.ts`,
  `persistent-compile-support.ts`, and `embedded-preview-support.ts` with the
  toolkit as the core/barrel (see §3.2).
- Fixture-builder + static-test script renames *(earlier pass)*.
- `measure-release-size.mjs` repair *(earlier pass; self-test 9/9 re-run this
  pass)*.
- Stale file-path reference sweep across live source/config/scripts/current docs
  for every renamed/removed file *(this pass)*.
- Documentation: README, `build.md`, `security-model.md` trim,
  `content-workflow.md`, `release-support-matrix.md`, and new `CONTRIBUTING.md`;
  removal of the superseded `issue052-task3-proof-repointing-plan.md`
  *(earlier pass; not further rewritten this pass per scope item D)*.
Completed and verified in this working tree:

- `Issue21Endpoints.js` → `ProtocolEndpoints.js` and
  `Issue21EndpointsProof.js` → `ProtocolEndpointsProof.js` responsibility
  renames, and the `issue033-negative-observer.js` →
  `preview-no-wasm-eval-observer.js` rename, with **all** consumers re-pointed
  (csproj deploy/remove entries, both staging scripts, `preview.js`,
  `compiler-harness.js`, proof extensions, `preview-frame.ts`, `build.rs`,
  `protocol.test.ts`, `verify-profiles.sh`, static/clean staging tests, binary
  checker). Verified by tsc, protocol tests, staging profile builds, and the
  staging clean/verify checks in §8.
- Generic staged-asset filename guard (`staged-asset-guard.mjs`, `--self-test`,
  wired into both staging scripts) — §C.
- **Package-size gate rebuild** (`scripts/measure-release-size.mjs`): a
  cross-platform, PRODUCT-profile, fail-closed gate. Accepts explicit
  `--binary/--package/--package-dir/--dist/--target`; resolves any of the six
  release package formats; measures file OR bundle-directory size; verifies
  required binary+package exist and are <=100 MiB; validates the staged dist is
  the requested profile via `profile-manifest.json` (and the `.app`
  `CFBundleIdentifier` when supplied) with **no** proof-command expectation;
  recognises the implemented issue 039/040 content fixtures; strips-check is
  best-effort (only a positive "not stripped" determination fails); writes a JSON
  report only with `--report`. Deterministic self-test 28/28; also run against
  the real product DMG in the tree (93.36 MiB → PASS).
- **Bounded PRODUCT smoke gate** (`scripts/smoke-product.mjs`): refuses any
  proof env/profile; verifies product identity (bundle `CFBundleIdentifier` /
  binary path); launches the product executable; requires it to survive a
  bounded readiness/no-immediate-crash window; terminates only the owned PID /
  process group (POSIX detached group / Windows `taskkill /T`); captures logs;
  fails on early crash, crash/proof/secret log markers, or an orphaned owned
  process. Honest matrix: full launch where a display exists (macOS in CI),
  `--identity-only` otherwise, no faked Run/Stop automation. Static + real
  process-safety self-test 25/25; identity-only and a real bounded launch
  against the built `.app` both verified with zero orphans.
- **`.github/workflows/quality.yml`** (new): clean-clone-only fast gate on
  pull_request + push (frontend `npm ci`/typecheck/focused+perf tests/four tool
  self-tests; shell `bash -n` + static runner tests; `cargo fmt --check`). No
  submodule checkout, no asset staging, no Rust build — so it cannot fail merely
  because ignored artifacts/monogame are absent.
- **`.github/workflows/release.yml`** (extended): after `dist/` staging each
  package leg runs `cargo clippy --all-targets` (PRODUCT) and, on host-native
  legs, `cargo test`; after packaging each leg runs the binary-inventory,
  package-size, and bounded-smoke gates against its freshly built artifact
  (smoke = full launch on host-native macOS arm64, identity-only on the
  cross-compiled macOS x64, Windows, and Linux legs). Six-platform packaging and
  the architecture-portable x64 fix are preserved. Workflow artifacts upload
  after the required checks; tag builds attach bundles to a draft Release during
  the build step, and that draft must not be published unless all legs are green.
  A `workflow_dispatch` input `run_proof_acceptance`
  gates an opt-in `proof-acceptance` job (PROOF clippy/test + packaged scenario
  suite + PROOF binary inventory), so normal pushes/tags do not run the long
  packaged scenarios.
- Documentation refreshed to final architecture and exact implemented/deferred
  gates: `docs/build.md` (CI gates section), `README.md`, `CONTRIBUTING.md`,
  `docs/security-model.md`, `docs/content-workflow.md`,
  `docs/release-support-matrix.md`, this document, and the cleanup plan/handoff.

Remaining acceptance step:

- No acceptance work remains. The clean-clone quality workflow, all six PRODUCT
  release matrix legs, and opt-in packaged PROOF acceptance passed remotely.

### 7.1 C# preview split (this pass)

`src/preview/PreviewExports.cs` (1239 L) was split into responsibility-based
partial-class files by **exact source movement** (no rewrites, no behavioral
change). Same `PreviewExports` partial class in every file, so public `[JSExport]`
names, `[JSImport]` seams, `PreviewJsonContext` JSON source-generation, static
state semantics, `LifecycleGate`/`AssetMountGate` locking, teardown/cleanup
ordering, the proof `static partial` seams, and ADR 0003 behavior are unchanged.

- `src/preview/PreviewExports.cs` (200 L) — bootstrap + runtime-failure/output:
  core static state, the three `[JSImport]`s, `InitializeRuntimeFailureBoundary`,
  `Ping`, the proof `static partial` seam declarations,
  `OnUnhandledException`, `InstallConsoleCapture`/`RestoreConsoleCapture`, the
  `PreviewContextInfo` record, and the `PreviewJsonContext` source-gen context.
- `src/preview/PreviewExports.Mount.cs` (537 L) — content mount
  transaction/state/helpers/records: mount fields,
  `MountContentAssets`/`MountSingleAsset`/`CommitMount`/`ConfigureContentRoot`/
  `QueryMountState`/`CleanupMountedAssets`, the mount serialization/abort/reset
  helpers, `GetAssetExtension`, the `ContentKind` enum + `DetectContentKind`,
  and the mount records.
- `src/preview/PreviewExports.Lifecycle.cs` (529 L) — assembly load + game
  lifecycle: `LoadUserAssembly`, `DiscoverAndConstructGame`, `RunLoadedGame`,
  `QueryRunState`, `TeardownGame`/`StopGame`/`StopGameCore`, `ValidateLoad`,
  the load/path/failure helpers, and the load/game result records
  (`LoadError` lives here, shared by both partials).

`Playground.Preview.csproj` was **not** modified: the WebAssembly SDK default
Compile glob auto-includes the new partials, and the existing
`Compile Remove="PreviewExports.Proof.cs"` product gate is unaffected.
`PreviewExports.Proof.cs` behavior is unchanged (it binds to the same seams).

Actual commands run (pinned SDK `9.0.315`, existing native artifacts):

- Byte-identical movement verified: `diff` of each moved line range vs the
  original single file — MOUNT OK / LIFECYCLE OK / MAIN OK.
- `dotnet format Playground.Preview.csproj --verify-no-changes --include
  PreviewExports.cs PreviewExports.Mount.cs PreviewExports.Lifecycle.cs` — 35
  pre-existing `WHITESPACE` notes on the braced-`switch` block (identical count
  to the pre-split original; **zero** new formatting deltas from the split), no
  other categories.
- `dotnet build Playground.Preview.csproj -c Release
  -p:MonoGamePreviewProfile=product` — **0 Warning / 0 Error**.
- `dotnet build … -p:MonoGamePreviewProfile=proof` — **0 Warning / 0 Error**.
- `node src/frontend/scripts/stage-preview.mjs` (PRODUCT publish+stage) — PASS.
- `MONOGAME_FRONTEND_PROFILE=proof node src/frontend/scripts/stage-preview.mjs`
  (PROOF publish+stage) — PASS.
- `npm --prefix src/frontend run test:stage-preview-proof-clean` — PASS
  (proof-only runtime surface present; product `preview.js` proof-clean).
- PRODUCT staging re-run at the end so the working tree is left with the PRODUCT
  preview staged and `obj/` rebuilt for PRODUCT.

### 7.2 Proof preview extension split (this pass)

`src/preview/wwwroot/preview-proof-extension.js` (1187 L) was split by **proof
domain** via exact source movement (no rewrites, no behavioral change) into one
explicit proof **entry** module plus four proof-only sibling responsibility
modules the entry imports and wires together in the original initialization
order. All five are PROOF-only staged assets; the PRODUCT preview stages none of
them. Preserved byte-for-byte: the `globalThis.__playgroundPreviewExtension`
factory identity, every `previewIssueNNProof` global name/shape, the `observe`
hook set and ordering, all `JSExport`/`exports.*` calls, the issue command /
report / expectation-registry protocol, the issue-040 input/audio semantics, the
pagehide/stop lifecycle instrumentation, the no-wasm-eval observer document, and
the exact eight-scenario behavior. The entry constructs a shared `ctx` and
invokes the modules in the exact side-effect order of the former monolith
(state globals + render → audio/bridge function definitions → lifecycle deferred
globals + instrumentation + ping handler → `render()`), then returns the same
`{ observe, bootstrap }` surface preview.js consults.

- `preview-proof-extension.js` (entry) — imports the four modules, builds the
  shared `ctx`, assigns `globalThis.__playgroundPreviewExtension`, and returns
  the `{ observe, bootstrap }` surface. `bootstrap.onBootstrap` wires the state
  bootstrap to the audio `install` so the gated probe still installs in order.
- `preview-proof-state.js` — proof state object, the full `previewIssueNNProof`
  global family, the `#proof-state` `render`, and the bootstrap surface
  (`validateData`, per-issue enable gating, `endpointParams` proof expectation
  registry wiring via `createProofExpectationRegistry`, and the issue-023
  `startConfig`).
- `preview-proof-audio.js` — the issue-040 Web Audio probe
  (`installIssue040AudioProbe`), the AudioContext/AudioNode.connect analyser
  interposition, trusted-input resume instrumentation, the audio snapshot, and
  the analyser-tap output sampler.
- `preview-proof-bridge.js` — the `bridgeAction` dispatcher: snapshot reads, the
  issue-040 audio arm/lock/sample actions, the issue-023/027/028/029 proof
  self-tests, the issue-033/034/035 security self-tests
  (`Issue034FileSystemProbe`), and the bounded animation-frame / WebGL sampling
  (`ANIMATION_FRAME_TIMEOUT`).
- `preview-proof-lifecycle.js` — deferred self-test/snapshot globals, the
  pagehide teardown, the stop-phase instrumentation (cancelAnimationFrame /
  WebGL delete / WebGL clear pixel proof / AudioContext.close counters), the
  trusted-click ping handler, and the `observe` lifecycle hooks (including the
  neutral `onStopObservation` that reads `QueryStoppedGameProof`).

Infrastructure re-pointed so all four new modules are PROOF-only staged with
non-vacuous PRODUCT-absent / PROOF-present per-module checks:
`Playground.Preview.csproj` (product-profile `Content Remove` for all four new
modules), `stage-preview.mjs` (`PROOF_ONLY_ASSETS` + per-module required-symbol
floor), `build.rs` (per-module existence + required-symbol content guard under
proof; per-module absence under product), `verify-profiles.sh`
(`proof_assets`), `check-binary-command-inventory.mjs` (`PROOF_ASSET_FILES`),
`staged-asset-guard.mjs` (clean-tree self-test list),
`test-stage-preview-proof-clean.sh` (per-module presence/symbol greps),
`protocol.test.ts` (per-module presence + entry-does-not-retain assertions), and
`audio-content.test.ts` (issue-040 gating repointed to the bridge/audio/state
modules). No issue-numbered filenames were introduced.

Actual commands run (pinned SDK `9.0.315`, existing native artifacts):

- `node --check` on all five modules — PASS.
- `node src/frontend/scripts/stage-preview.mjs` (PRODUCT publish+stage) — PASS
  (product `preview.js` proof-clean; no proof-only module staged).
- `MONOGAME_FRONTEND_PROFILE=proof node src/frontend/scripts/stage-preview.mjs`
  (PROOF publish+stage) — PASS (all five proof modules staged; per-module
  required-symbol floor satisfied).
- `npm --prefix src/frontend run test:stage-preview-proof-clean` — PASS.
- `npm --prefix src/frontend run test:stage-preview-clean` — PASS.
- `npm --prefix src/frontend run typecheck` — PASS (0 err).
- `node --test src/protocol.test.ts` — 104 PASS.
- `node --test src/audio-content.test.ts` — 9 PASS; the one failure
  (`issue040 proof commands … gated`) is the **pre-existing** Rust-split gap
  (env gate moved to `proof_harness.rs`), unrelated to this JS split and left
  untouched.
- `node src/frontend/scripts/staged-asset-guard.mjs --self-test` — 12/12 PASS.
- `node scripts/check-binary-command-inventory.mjs --self-test` — 11/11 PASS.
- `rustc` parse of `build.rs` — no errors in the edited region (only the
  expected unresolved external-crate errors from standalone compilation).
- PRODUCT staging re-run at the end so the working tree is left with the PRODUCT
  preview staged and no proof-only module present.

---

## 8. Verification matrix

| Check | Command | Result | This session |
| --- | --- | --- | --- |
| Frontend typecheck | `npm --prefix src/frontend run typecheck` | PASS | ✅ run |
| Frontend `scenario-toolkit.ts` split typecheck | `npx tsc --noEmit` after split | PASS (0 err) | ✅ run (§3.2) |
| Protocol tests | `node --test src/protocol.test.ts` | 104 PASS | ✅ run |
| Content-validation tests | `node --test src/content-validation.test.ts` | 31 PASS | ✅ run |
| Audio-content tests | `node --test src/audio-content.test.ts` | 10 PASS | ✅ run |
| Project-lifecycle tests | `node --test src/project-lifecycle.test.ts` | 10 PASS | ✅ run |
| Perf report/measure tests | `node --test scripts/performance-report.test.mjs` / `measure-performance.test.mjs` | 26 + 6 PASS | ✅ run |
| Release-size gate self-test | `node scripts/measure-release-size.mjs --self-test` | 28/28 PASS | ✅ run (rebuilt) |
| Release-size gate vs real DMG | `node scripts/measure-release-size.mjs --profile product --package-dir …/bundle --binary … --dist src/frontend/dist` | PASS (93.36 MiB / 100 MiB) | ✅ run |
| Staged-asset guard self-test | `node src/frontend/scripts/staged-asset-guard.mjs --self-test` | 12/12 PASS | ✅ run |
| Proof preview extension split (§7.2) | `node --check` ×5; PRODUCT+PROOF `stage-preview.mjs`; `test:stage-preview-proof-clean`; `test:stage-preview-clean` | PASS (per-module PRODUCT-absent/PROOF-present) | ✅ run |
| Product smoke gate self-test | `node scripts/smoke-product.mjs --self-test` | 25/25 PASS (incl. real process-tree reap) | ✅ run (new) |
| Product smoke identity-only | `node scripts/smoke-product.mjs --identity-only` | PASS (product identity verified) | ✅ run (new) |
| Product smoke bounded launch | `node scripts/smoke-product.mjs --bundle … --ready-seconds 8 --timeout 40 --logs …` | PASS; 0 orphans | ✅ arm64 PRODUCT `.app` |
| Smoke refuses proof env/profile | `MONOGAME_ISSUE040_PROOF=1 / MONOGAME_FRONTEND_PROFILE=proof node scripts/smoke-product.mjs` | exit 1 (refused) | ✅ run (new) |
| Workflow YAML structure | `ruby -ryaml` load of both workflows | PASS (jobs/on/matrix parsed) | ✅ run (new) |
| PRODUCT build (stage product + vite) | `npm --prefix src/frontend run build` | PASS | ✅ run |
| PROOF build (stage proof + vite) | `npm --prefix src/frontend run build:proof` | PASS | ✅ run |
| Profile check (product) | `npm --prefix src/frontend run check:profile-product` | 21 mods / 14 markers / 0 proof markers | ✅ run |
| Profile check (proof) | `npm --prefix src/frontend run check:profile-proof` | 45 mods / 13 markers / 8 scenarios / 3 support mods | ✅ run |
| Split: support mods present in PROOF graph | `profile-manifest.json` (dist-proof) | packaged-proof-readiness / persistent-compile-support / embedded-preview-support present | ✅ run (§3.2) |
| Split: support mods absent from PRODUCT graph | `profile-manifest.json` (dist) | all three absent | ✅ run (§3.2) |
| Profile round-trip (product→proof→product) | `npm --prefix src/frontend run verify:profiles` | PASS; separate manifests; product restored | ✅ run |
| Verify-profiles static regression | `npm --prefix src/frontend run test:verify-profiles-static` | PASS (incl. renamed observer ref) | ✅ run |
| Proof-toolkit clean staging | `npm --prefix src/frontend run test:stage-proof-toolkit-clean` | PASS (exit 0; product restored) | ✅ run |
| Rust fmt | `cargo fmt --check` | PASS | ✅ run |
| Rust clippy (default) | `cargo clippy --all-targets` | PASS (0 warn) | ✅ run |
| Rust clippy (proof) | `cargo clippy --all-targets --features proof-harness` | PASS (0 warn) | ✅ run |
| Rust tests (default) | `cargo test` | 23 PASS | ✅ run |
| Rust tests (proof) | `cargo test --features proof-harness` | 37 PASS (build.rs 67/8/59/71 + lib.rs 59/67 assertions) | ✅ run |
| Rust split: default build proof-clean | `strings libmonogame_playground_lib.{dylib,a}` after clean default build | 0 proof symbols/markers | ✅ run |
| Rust split: product `cargo check` (both arches) | `cargo check --target aarch64/x86_64-apple-darwin` | PASS (build.rs ACL 10 asserted) | ✅ run |
| Rust split: proof `cargo check` (both arches) | `cargo check --target aarch64/x86_64-apple-darwin --features proof-harness` | PASS (build.rs ACL 71 asserted) | ✅ run |
| Binary checker self-test | `node scripts/check-binary-command-inventory.mjs --self-test` | 11/11; product=8 proof=59 handler=67 | ✅ run |
| Shell syntax | `bash -n scripts/*.sh src/frontend/scripts/*.sh` | PASS | ✅ run |
| External/MonoGame clean | `git submodule status external/MonoGame` | clean (no working changes) | ✅ run |
| C# split byte-identity | `diff` moved ranges vs pre-split original | MOUNT/LIFECYCLE/MAIN OK | ✅ run |
| C# split format | `dotnet format … --verify-no-changes --include PreviewExports*.cs` | 35 pre-existing WHITESPACE notices, 0 new | ✅ run |
| Preview PRODUCT build | `dotnet build Playground.Preview.csproj -c Release -p:MonoGamePreviewProfile=product` | 0 Warn / 0 Err | ✅ run |
| Preview PROOF build | `dotnet build … -p:MonoGamePreviewProfile=proof` | 0 Warn / 0 Err | ✅ run |
| Preview PRODUCT publish+stage | `node src/frontend/scripts/stage-preview.mjs` | PASS (product profile) | ✅ run |
| Preview PROOF publish+stage | `MONOGAME_FRONTEND_PROFILE=proof node …/stage-preview.mjs` | PASS (proof profile) | ✅ run |
| Preview proof-clean staging | `npm --prefix src/frontend run test:stage-preview-proof-clean` | PASS (product preview.js proof-clean) | ✅ run |
| Native PRODUCT package | `npm --prefix src/desktop run package:product`; x64 `tauri build --target x86_64-apple-darwin` | arm64 + x64 PASS; PRODUCT built last | ✅ run |
| Native PROOF package | `npm --prefix src/desktop run package:proof` | arm64 PASS; 67-command binary accepted | ✅ run |
| Packaged scenario suite | `prove-scenarios-macos.sh` | all 8 scenarios and mapped sub-proofs PASS; 0 orphans; clean key scan | ✅ run |
| Offline packaged proof | `prove-packaged-offline-macos.sh --skip-build` | clean content/audio report under process network denial; 0 orphans | ✅ run |
| Product/proof binary checks | `check:binary:product/proof` | arm64 PRODUCT+PROOF and x64 PRODUCT PASS | ✅ run |
| Package-size gates | `measure-release-size.mjs` on every emitted package | all formats under 100 MiB; largest: Linux x64 AppImage 98.58 MiB, Linux arm64 AppImage 96.85 MiB | ✅ local + six-platform CI |
| Startup/memory baseline | `measure-performance.mjs --runs 1 --memory-baseline …` | overall PASS; 0 failed/censored/missing samples | ✅ run; docs regenerated |
| Independent strict review | read-only reviewer over complete diff and acceptance evidence | no blocking findings | ✅ accepted |
| Clean-clone quality gate | `.github/workflows/quality.yml` | all jobs green | ✅ run 34532612728 |
| Six-platform PRODUCT + remote PROOF acceptance | `.github/workflows/release.yml` with `run_proof_acceptance=true` | all 8 jobs green; all scenarios/sub-proofs pass; 0 orphans; clean key scan | ✅ run 34532693231 |

Legend: ✅ accepted and passing. No Stage 7 gate remains pending.

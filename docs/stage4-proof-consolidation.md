# Stage 4 — durable scenario suite (inventory & verification matrix)

**Status:** accepted after strict review, remediation, and packaged verification;
pending commit
**Decision basis:** ADR 0003; `production-proof-cleanup-plan.md` Stage 4
**Scope:** frontend proof-driver consolidation into genuine scenario
orchestration + packaged-scenario/artifact-check enforcement + scenario-7
feature tests. No Tauri command renames, no Rust proof-compilation
boundary/feature changes (Stage 6), no issue-038 isolated-window retirement
(Stage 5).

## What the strict review rejected, and what changed

The earlier Stage-4 attempt was rejected as **mechanical namespace
concatenation**: each `proof-*` module merely wrapped the verbatim per-issue
driver bodies in a `namespace` and re-exported the fifteen-plus per-issue
`runIssueNN` runners, which `entry.proof.ts` still imported and invoked
individually. This rework delivers real scenario orchestration:

1. **Single scenario entrypoint per module.** Each of the eight `proof-*`
   modules now exposes exactly one responsibility-named entrypoint
   (`runCompileRunStopScenario`, `runCompilerDiagnosticsScenario`,
   `runRuntimeExceptionScenario`, `runOutputCaptureScenario`,
   `runContentWorkflowScenario`, `runPreviewSecurityScenario`,
   `runProjectLifecycleScenario`, `runPerformanceScenario`). Each entrypoint
   drives its sub-proofs through the shared `scenario-runner.ts` driver and owns
   their failure reporting. The per-sub-proof env gate
   (`issueNN_is_proof_enabled`) and success report command
   (`issueNN_emit_report`) are preserved verbatim inside the drivers for Stage-6
   compatibility.
2. **`entry.proof.ts` dispatches eight scenarios**, not fifteen-plus per-issue
   runners. The former per-issue `void run().catch(emitReport)` blocks moved
   into the scenario drivers. The top-level-shell inline proofs (009/010/011/020)
   and the retained issue038 force-stop harness remain (they are not per-issue
   driver modules).
3. **Namespaces removed; helpers deduplicated.** All eight modules are flattened
   to module scope. Genuinely shared helpers were hoisted once:
   `proof-compiler-diagnostics.ts` now has a single `Diagnostic`/`Compilation`
   type and one persistent-compiler `compile` helper (issue31 and issue32 each
   previously declared identical copies); `wait`/`assert`/`createUuid`/
   `PROTOCOL_VERSION` were deduplicated in the output, compile-run-stop,
   preview-security, and content modules. Per-sub-proof fixtures were renamed to
   distinct, descriptive names.
4. **Dead proof paths removed.** `installIssue023RunControl` (a proof-only Run
   wiring duplicating the production control in `app.ts` via `run-stop.ts`, with
   no caller) was deleted, and the unused `installIssue024RunStopControl`
   re-export was dropped.

Every unique still-valid claim is preserved: no proof assertion, marker, report
command, ACL inventory entry, or fixture was dropped.

## Driver inventory → scenario mapping

| # | Durable scenario | Entrypoint / module | Absorbed sub-proofs (unique claims) | Preserved markers |
| --- | --- | --- | --- | --- |
| 1 | Compile → Run → Stop → rerun | `runCompileRunStopScenario` / `proof-compile-run-stop.ts` | issue021 (DLL+portable-PDB transfer, managed/native load), issue023 (async Game + render clear color), issue024 (cooperative stop + resource release), issue025 (restart with clean static state), issue030 (two-file cross-file compile+run) | `MONOGAME_ISSUE023/024/025/030_PROOF` |
| 2 | Compiler diagnostics & policy rejection | `runCompilerDiagnosticsScenario` / `proof-compiler-diagnostics.ts` | issue022 (single Game subclass + `PGxxxx`), issue031 (supported-API policy + analyzers), issue032 (reject native/JS interop) | `MONOGAME_ISSUE022/031/032_PROOF` |
| 3 | Runtime exception + portable-PDB mapping | `runRuntimeExceptionScenario` / `proof-runtime-exception.ts` | issue029 (map runtime exception through portable PDB; partial-evidence channel) | `MONOGAME_ISSUE029_PROOF` |
| 4 | Managed / native output | `runOutputCaptureScenario` / `proof-output.ts` | issue027 (managed console output), issue028 (native Emscripten output) into the real Output panel | `MONOGAME_ISSUE027/028_PROOF` |
| 5 | Texture / audio content workflow | `runContentWorkflowScenario` / `proof-content.ts` | issue039 (validate + mount Web-profile Texture2D, wrong-platform rejection), issue040 (activate/play/stop Web-profile SoundEffect across fresh previews) | `MONOGAME_ISSUE040_PROOF` (039 emits via commands, no source marker) |
| 6 | Embedded preview security boundary | `runPreviewSecurityScenario` / `proof-preview-security.ts` | issue034 (deny shell IPC + filesystem; ACL inventory `ISSUE034_APPROVED_COMMANDS`), issue033 (opaque-origin sandbox + CSP incl. no-wasm-eval boot), issue035 (deny host navigation + network), issue036 (validate forged/malformed/oversized messages) | markers emitted via commands; source-scanned ACL inventory retained |
| 7 | Project open/save/dirty-state/identity | `runProjectLifecycleScenario` / `proof-project-lifecycle.ts` **+** `project-lifecycle.test.ts` | feature tests (open/save/dirty-state/identity, mocked) **plus** issue037 (first-run warning; two-phase persisted acknowledgement) | `MONOGAME_ISSUE037_PROOF`, `MONOGAME_ISSUE037_PROOF_PHASE` (comment-only) |
| 8 | Performance & memory | `runPerformanceScenario` / `proof-performance.ts` | issue041 (startup/compiler-init/compile/preview-startup/stop timing + memory baseline; shell-ready reported first) | benchmark gated by `MONOGAME_ISSUE041_BENCHMARK` (no source marker) |

### Scenario 7 is explicitly two layers

`proof-project-lifecycle.ts` alone does **not** test project open/save/dirty
behavior; it owns only the packaged two-phase first-run warning proof (former
issue037). The open/save/dirty-state/identity behavior is covered by the durable
feature tests in **`project-lifecycle.test.ts`** (`node --test`, mocked Tauri
shell), which:

- consolidate and **replace** the historical `issue051.test.ts` and
  `project-identity.test.ts` (both removed);
- exercise the production `project-manager.ts` directly (open, identity
  stability/redaction, dirty-state publication, cancelled-reopen preservation,
  close);
- **add** the previously-missing open→edit→**Save-All** coverage: only dirty
  `.cs` files are written, dirty flags clear on success, a second no-edit Save is
  a no-op, and a mid-Save write failure is **atomic** (no dirty flag cleared,
  PRD 8.6);
- cover manifest round-trip + newer-schema rejection and the empty-folder
  rejection.

The Stage-4 scenario matrix therefore states scenario 7 = **feature tests +
first-run packaged phase**.

### Kept unchanged (compatibility genuinely required)

- `issue21.ts` + `issue21-controller.ts` — the shared proof runtime toolkit
  imported by every scenario; `runIssue021AutoProof` is now run as the first
  sub-proof of the compile-run-stop scenario.
- `issue23-controller.ts`, `issue24-controller.ts` — neutral lifecycle façades
  imported by the scenario suites and `protocol.test.ts`.
- `issue38.ts`, `issue38-bridge.ts` — Stage-5 isolated-window force-stop harness
  and its bridge; **explicitly retained** (retirement is Stage 5).
- `issue040-fixture.ts`, `issue040-contract.ts` — committed content fixtures /
  validator contract.
- `issue049.ts`, `issue051.ts` — Stage-3 thin output/project façades.
- Inline `entry.proof.ts` proofs (009 input, 010 audio activation, 011 resize,
  020 realm isolation) — top-level-shell / preview-realm proofs, not per-issue
  driver modules; left in place unchanged.

### New shared infrastructure

- `scenario-runner.ts` — the `runScenario`/`SubProof` orchestration driver used
  by all eight scenario modules. Named without the `proof-` prefix so the
  checker's structural `proof-*` rule stays reserved for the eight scenario
  suites; enumerated separately in `PROOF_ONLY_MODULES`.

### Net effect

- PROOF frontend module graph: 44 first-party modules (was 43 in the rejected
  attempt; +1 for `scenario-runner.ts`).
- Eight scenario/responsibility-named proof modules each expose ONE scenario
  entrypoint carrying the durable claims; `entry.proof.ts` dispatches eight
  scenarios instead of fifteen-plus per-issue runners.
- PRODUCT graph unchanged at 21 modules, zero proof markers, zero
  issue-numbered modules, zero `proof-*` modules.

## Stage-5 readiness (issue38-bridge migration)

After Stage 4, the intended end state is that **only `issue38.ts`** imports
`issue38-bridge.ts`, so Stage 5 can delete the isolated-window harness cleanly.
**This end state is now reached** — `rg issue38-bridge src/frontend/src --glob
'*.ts' --glob '!issue38.ts' --glob '!issue38-bridge.ts'` finds only descriptive
comments (no imports/usages).

- **Done:** the embedded preview security scenario (`proof-preview-security.ts`,
  issues 33–36) runs entirely in the EMBEDDED opaque-origin sandboxed iframe
  (`runInPagePreviewForProof`) required by ADR 0003 and does **not** import
  `issue38-bridge`. Its issue036 bridge-attack phase invokes the `issue038_*`
  Rust commands only to prove they reject forged input (it does not import the TS
  bridge module).
- **Done (this remediation):** `proof-content.ts` (issues 039/040) and the
  shared toolkit's `compileLoadStartIssue23` (`issue21.ts`) were migrated off
  `issue38-bridge` onto the EMBEDDED in-page opaque-origin sandboxed iframe via
  the new shared `createEmbeddedProofPreview` helper in `issue21.ts`. Compiled
  binaries and content assets now transfer **INLINE** over the in-page protocol
  port (the shipping `runLivePreviewInPage` shape) — no Rust transfer store,
  `issue038_*`, or `issue039_store_asset` mediation. `issue038_destroy_all_previews`
  is no longer invoked; per-preview lifecycle is iframe retirement.
- **Packaged-runtime transport adaptation (this remediation):** the audio
  content proof (issue040) dispatches trusted activation via
  `issue040_dispatch_preview_input`. That EXISTING command was narrowly adapted
  so the trusted Space/Escape gesture can reach the Stage-4 embedded
  opaque-origin preview iframe in the main Workbench, while retaining
  isolated-window (issue038) compatibility until Stage 5. The command now
  resolves an explicit, fail-closed `Issue040DispatchTarget`
  (`src/desktop/src-tauri/src/lib.rs`):
  - proof gate off, or a malformed/empty/oversized generation → rejected before
    any window is addressed (no native event created);
  - a generation that owns an **active issue 038 generation** → delivered to its
    isolated preview `WebviewWindow` by the fixed preview-label prefix (the
    unchanged legacy path);
  - a well-formed generation with **no live isolated window** → delivered to the
    exact `main` window (pinned `ISSUE040_MAIN_WINDOW_LABEL`) that hosts the
    embedded preview iframe.
  The input-kind allowlist is unchanged (`click`/`space-down`/`space-up`/
  `escape-down`/`escape-up` → left click, Space 49, Escape 53); nothing else is
  dispatchable, so this is not a generic input-injection primitive. The gesture
  is always delivered to one exact, known window (an active isolated preview, or
  `main`), never an arbitrary caller-named window. The native send path
  (`issue040_send_native_input`, AppKit `sendEvent`) is unchanged — WebKit still
  marks the resulting DOM event trusted and user-activating.

  On the frontend, `createEmbeddedProofPreview` (`issue21.ts`) gained a
  cross-origin-safe `focusPreviewFrame()` (only `iframe.focus()` /
  `contentWindow.focus()`, never same-origin DOM access), and
  `proof-content.ts` calls it immediately before each Space/Escape dispatch so
  WebKit routes the trusted event to the **focused embedded preview document**
  rather than the Monaco editor or the host shell. The opaque-origin sandbox
  (`sandbox="allow-scripts"`, no `allow-same-origin`) and preview CSP are
  preserved — no preview-frame attribute or document changed.

  **No command renamed/added/removed; no ACL/permission/build inventory,
  Cargo proof feature boundary, or issue038 asset/window/command touched.**
  Security rests on: (1) the env proof gate (`MONOGAME_ISSUE040_PROOF=1`);
  (2) the untrusted embedded preview having NO IPC bridge at all (opaque origin,
  `__TAURI_INTERNALS__` never injected — issue034), so only the trusted host
  frontend can ever call the command; (3) the fixed input-kind allowlist;
  (4) the exact pinned target windows; and (5) the trusted host focusing the
  specific embedded preview iframe before dispatch. The issue040
  trusted-activation sub-claim now migrates to the embedded transport; issue039
  and all load/mount/render/stop/fresh-runtime claims were already fully
  migrated.
- **Remaining importer of `issue38-bridge`:** only `issue38.ts` (the Stage-5
  isolated-window force-stop harness), as intended.
- **Stage-4 outcome:** `issue038` stays runnable for regression; the
  `issue38-bridge` TS migration of `issue21.ts`/`proof-content.ts` is complete,
  verified by typecheck / protocol tests / issue039+040 unit tests / proof build
  / profile check.

## Anti-drift enforcement changes

`src/frontend/scripts/check-profile-artifacts.mjs`:

- `SCENARIO_MODULES` is the canonical EXACT set of eight scenario suites;
  `EXPECTED_SCENARIO_COUNT = 8`.
- New structural rule `PROOF_MODULE_PREFIX_REGEX` (`/(^|\/)proof-[a-z0-9-]*\.ts$/i`)
  makes ANY `src/proof-*.ts` module in the PRODUCT Rollup graph a HARD FAILURE,
  independent of the enumerated list.
- PROOF now requires **all eight** scenario modules present AND **no** unexpected
  `proof-*` module, and asserts the count is exactly eight.
- Explicit `issue21`/`issue38` PROOF-presence checks retained (issue38 proven
  present, not merely tolerated).
- Marker anti-drift floors (`MIN_SOURCE_MARKERS=15`,
  `MIN_EXPECTED_PROOF_MARKERS=15`, `MIN_MODULES=10`) unchanged and still
  satisfied (19 source markers, 18 expected proof markers).
- `PROOF_ONLY_MODULES` = entry.proof + issue21 + issue38 + `scenario-runner.ts`
  + the eight scenario modules.

`src/desktop/src-tauri/build.rs` and `src/desktop/src-tauri/src/lib.rs`: the
frontend command-inventory source path (`ISSUE034_APPROVED_COMMANDS`, now a
module-scope export in `proof-preview-security.ts`) is scanned there. The marker
strings and array shape are unchanged, so the split/regex parse and the Rust
ACL-drift assertions bind identically. **No Tauri command renamed, no proof
Cargo feature/compilation boundary changed.**

## Canonical packaged scenario runner

`scripts/prove-scenarios-macos.sh` is the canonical Stage-4 packaged
verification path. It orchestrates the eight durable scenarios BY NAME
(`--scenario N` selects a subset) while internally TRANSLATING each scenario to
the existing per-issue env gates (`MONOGAME_ISSUE0xx_PROOF…`) and report keys
(`ISSUE0xx_REPORT=`), which are unchanged in Stage 4. Scenario 7 runs the
`project-lifecycle.test.ts` feature tests first, then the issue037 two-phase
packaged phase. The existing `prove-issue03x/04x-macos.sh` and
`prove-packaged-offline-macos.sh` remain as compatibility wrappers. Operators no
longer need to think in per-issue ordering.

## Stage-4 verification matrix

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npm --prefix src/frontend run typecheck` | PASS (exit 0) |
| Protocol tests | `node --experimental-strip-types --test src/protocol.test.ts` | PASS 102/102 |
| Focused content/project tests | `--test issue039.test.ts issue040.test.ts project-lifecycle.test.ts` | PASS 31 + 10 + 10 |
| Performance harness tests | `run test:performance-report` / `run test:measure-performance` | PASS 26 / 6 |
| Full PRODUCT build | `npm --prefix src/frontend run build` | PASS |
| Full PROOF build | `npm --prefix src/frontend run build:proof` | PASS |
| Profile artifact check (both) | `npm --prefix src/frontend run check:profiles` | PASS — PRODUCT 21 mods / 0 markers / 0 proof-* ; PROOF 44 mods / 18 markers / exactly 8 scenario modules |
| Fresh product→proof→product profiles | `npm --prefix src/frontend run verify:profiles -- --skip-stage` | PASS |
| Cargo format/check/Clippy/tests | `cargo fmt --check`; `cargo check`; `cargo clippy -- -D warnings`; `cargo test` | PASS; 58/58 tests |
| Shell syntax/static guards | `bash -n scripts/prove-scenarios-macos.sh scripts/test-prove-scenarios-static.sh`; `bash scripts/test-prove-scenarios-static.sh` | PASS |
| Dependency evidence | `grep -rn 'from "./issue38-bridge"' src/frontend/src` | `issue38.ts` only (see Stage-5 readiness) |
| Packaged scenario suite | `scripts/prove-scenarios-macos.sh` | PASS — all eight scenarios and every mapped sub-proof, including embedded texture/audio and performance |
| Retained issue038 regression | `scripts/prove-issue038-macos.sh --skip-build` | PASS — 038 plus historical lifecycle/security regressions; zero orphans; clean invoke-key scan |
| Native PRODUCT package after PROOF | `npm --prefix src/desktop run tauri -- build` | PASS; product artifact check PASS |

## Preserved invariants (ADR 0003 + cleanup plan)

- Embedded opaque-origin sandboxed-iframe product preview UX — unchanged (no
  product module touched).
- Compile-failure-leaves-running-preview, fresh runtime per Run, and
  content-before-start remain carried by unchanged production domain modules
  and the consolidated durable scenarios.
- Protocol validation, CSP, sandboxing, IPC denial, binary transfer ownership,
  content validation, and lifecycle cleanup remain enforced (`protocol.ts` was
  not forked; the ACL inventory stayed at module scope with identical strings).
- Explicit PRODUCT/PROOF profiles and distinct product/proof Tauri identity —
  unchanged.

## Deferred to later stages (not done here)

- **Stage 5:** retire `issue38.ts` / `issue38-bridge.ts`, isolated-window
  documents/assets, Rust bridge state, isolated-window commands, and the
  fifteen `issue038_*` ACL/handler/build entries. Stage 4 already migrated all
  valuable non-force-stop scenarios to the embedded path, so `issue38.ts` is
  now the sole bridge importer. Stage 5 may also drop the retained isolated
  dispatch branch (`Issue040DispatchTarget::IsolatedPreview`) once issue038 is
  removed.
- **Stage 6:** put Rust proof commands behind a non-default feature/crate, split
  proof exports out of `PreviewExports.cs` / `preview.js` / the compiler harness,
  and rename the remaining product Tauri commands by responsibility. No command
  renamed in Stage 4.

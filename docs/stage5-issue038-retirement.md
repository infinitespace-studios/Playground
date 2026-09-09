# Stage 5 — isolated-window issue038 harness retirement (inventory & verification)

**Status:** complete — `681be79 refactor: retire isolated preview harness`
**Decision basis:** ADR 0003 (embedded preview and non-yielding user code);
`production-proof-cleanup-plan.md` Stage 5
**Scope:** remove the isolated-window issue038 force-stop harness (frontend
modules, Rust bridge/transfer/relay/window command surface, custom protocol
routes, embedded isolated documents/assets, packaged runner) now that Stage 4
migrated every valuable non-force-stop scenario to the embedded opaque-origin
sandboxed iframe. Re-point the performance measurement at the embedded product
path. **No** broad Tauri command renaming and **no** Cargo proof-feature/
separate-crate boundary change (those remain Stage 6).

Historical evidence is preserved unaltered in `issues/038-*` and
`docs/adr/0002-isolated-preview-webview-window.md`. ADR 0002 was already
superseded by ADR 0003; this stage removes the code that ADR 0002 described but
leaves the ADR and issue records intact.

## Why this is safe (ADR 0003)

The production preview is the embedded, replaceable, opaque-origin sandboxed
iframe in the Workbench preview panel. Synchronous user code that never yields
is **outside** the supported execution contract: it can freeze the shared
WebView and may require terminating and relaunching the app. The isolated
second window existed only to force-stop such hostile code; ADR 0003 classifies
that behaviour as unsupported, so the isolated harness is dead weight in the
product and is not run inside the product WebView.

## Inventory classification

Every issue038 reference was classified as either **REMOVED** (isolated-window
harness code with no durable product role) or **RETAINED ELSEWHERE** (a durable
embedded behaviour that moved to, or already lived on, the embedded path).

### REMOVED — frontend modules

| File | Lines | Role |
| --- | --- | --- |
| `src/frontend/src/issue38.ts` | 520 | isolated-window force-stop proof harness (sole importer of the bridge) |
| `src/frontend/src/issue38-bridge.ts` | 336 | `createIsolatedPreview` + Rust-mediated MessagePort/transfer bridge to the isolated `WebviewWindow` |

### REMOVED — packaged runner

| File | Lines | Role |
| --- | --- | --- |
| `scripts/prove-issue038-macos.sh` | 94 | standalone packaged issue038 regression runner |

The canonical packaged path is `scripts/prove-scenarios-macos.sh` (eight durable
scenarios). The regression references to issue 038 in
`scripts/prove-issue039-macos.sh` and `scripts/prove-issue040-macos.sh` were also
removed (`run 038 …` lines).

### REMOVED — the fifteen `issue038_*` Tauri commands

Removed from `generate_handler!` (`src/desktop/src-tauri/src/lib.rs`),
`APP_COMMANDS` (`build.rs`), `permissions/main.toml`, and
`ISSUE034_APPROVED_COMMANDS` (`src/frontend/src/proof-preview-security.ts`):

1. `issue038_is_proof_enabled`
2. `issue038_store_transfer`
3. `issue038_clear_transfer`
4. `issue038_create_preview_window`
5. `issue038_destroy_preview_window`
6. `issue038_preview_window_exists`
7. `issue038_relay_to_preview`
8. `issue038_collect_bridge_messages`
9. `issue038_monotonic_nanos`
10. `issue038_destroy_all_previews`
11. `issue038_bootstrap_preview`
12. `issue038_inject_script`
13. `issue038_emit_checkpoint`
14. `issue038_create_no_wasm_eval_window`
15. `issue038_emit_report`

The effective ACL count drops from **99 to 84** (one capability, one composite
permission, and 82 generated permissions). `build.rs`'s
`validate_generated_acl` assertion was updated from 99 to 84 accordingly, so a
drifted inventory still fails the build.

### REMOVED — Rust bridge/transfer/relay state and helpers (lib.rs)

| Item | Kind | Role |
| --- | --- | --- |
| `Issue038TransferEntry` | struct | one stored DLL/PDB transfer entry |
| `Issue038BridgeState` | struct | isolated-window bridge message queue + transfer store |
| `ISSUE038_BRIDGE` | static `LazyLock<Mutex<…>>` | global isolated-bridge state |
| `ISSUE038_PREVIEW_LABEL_PREFIX` (`"preview-isolated-"`) | const | isolated window label prefix |
| `issue038_preview_label` | fn | build isolated window label from generation |
| `issue038_proof_enabled` | fn | env gate for the harness |
| `issue038_handle_bridge_request` | fn | POST `/_bridge/send` handler |
| `issue038_handle_transfer_store` | fn | POST `/_transfer/store` handler |
| `issue038_handle_transfer_get` | fn | GET `/_transfer/{token}/{file}` handler |
| `ISSUE038_ISOLATED_CSP` | const | isolated document CSP string |
| `ISSUE038_ISOLATED_HTML` | const | `_isolated.html` document |
| `ISSUE038_ISOLATED_NO_WASM_EVAL_HTML` | const | `_isolated-no-wasm-eval.html` document |
| `ISSUE038_BRIDGE_SETUP_JS` | const | `_bridge-setup.js` (the `__bridge038Receive`/`__bridge038Bootstrap` shim) |
| `clear_asset_transfers_for_generation` | fn | **RETAINED** — retyped to `Issue039AssetState` (see below) |

### REMOVED — custom `playground-preview://localhost` protocol routes and assets

| Route / asset | Role |
| --- | --- |
| `/_isolated.html` | isolated preview document |
| `/_isolated-no-wasm-eval.html` | isolated preview document without `'wasm-unsafe-eval'` |
| `/_bridge-setup.js` | bridge shim served to the isolated window |
| `POST /_bridge/send?generation=…` | preview → Rust protocol message intake |
| `POST /_transfer/store?token=…&file=…` | editor → Rust raw DLL/PDB upload |
| `GET /_transfer/{token}/assembly.dll` | isolated preview → DLL fetch |
| `GET /_transfer/{token}/symbols.pdb` | isolated preview → PDB fetch |

The durable `playground-preview://localhost` static asset protocol (preview
runtime, `preview.js`, `preview.css`, `_framework/*`, content/asset routes used
by the embedded iframe) is **RETAINED**. Only the isolated bridge/transfer
routes were removed.

### REMOVED — isolated dispatch branch

`Issue040DispatchTarget::IsolatedPreview` and the isolated-preview branch of
`issue040_dispatch_target` were removed. `Issue040DispatchTarget::EmbeddedMain`
(the pinned `main` window hosting the embedded opaque-origin iframe) is the sole
remaining dispatch target.

### REMOVED — profile/artifact-check enforcement of the harness

`src/frontend/scripts/check-profile-artifacts.mjs` no longer enumerates
`src/issue38.ts` in `PROOF_ONLY_MODULES` and no longer asserts it PRESENT in the
PROOF graph. PRODUCT enforcement and the exact eight Stage-4 scenario modules
remain strictly enforced. The expected proof-marker set dropped from 18 to 17
(the `MONOGAME_ISSUE038_PROOF` marker left with the harness), and the PROOF
module graph dropped from 44 to 42 modules (issue38.ts + issue38-bridge.ts).

## Durable replacements (RETAINED ELSEWHERE)

| Behaviour the harness carried | Durable home after Stage 5 |
| --- | --- |
| Compile → load → start a real preview | `compileLoadStartIssue23` → `createEmbeddedProofPreview` (`issue21.ts`), embedded opaque-origin iframe, binaries transferred **inline** over the in-page protocol port |
| Texture/audio content workflow (issues 039/040) | `proof-content.ts` on the embedded iframe (migrated in Stage 4) |
| Opaque-origin sandbox + CSP separation evidence (issue 033) | `proof-preview-security.ts` `runIssue033AutoProof`, embedded iframe (opaque origin, `sandbox="allow-scripts"` without `allow-same-origin`, preview CSP) |
| Shell/IPC/filesystem denial (issue 034) | `proof-preview-security.ts` — the embedded iframe has **no** `__TAURI_INTERNALS__`/IPC at all |
| Navigation/network denial (issue 035) | `on_navigation` filter (retained) + embedded CSP |
| Forged/malformed/oversized message rejection (issue 036) | `testStructuralValidation` (protocol envelope validation) in `proof-preview-security.ts`; the embedded transport has no Rust bridge command to attack |
| Trusted Space/Escape audio-activation input (issue 040) | `issue040_dispatch_preview_input` register/retire/dispatch to `EmbeddedMain` only (retained, isolated branch removed) |
| Startup/compile/preview/Stop performance measurement | `proof-performance.ts` + `scripts/measure-performance.mjs` on the embedded path (see below) |
| Force-stop of hostile non-yielding code | **Not replaced by design.** ADR 0003 classifies it unsupported; the first-run warning discloses the limitation. |
| Generation-scoped asset-transfer cleanup helper | `clear_asset_transfers_for_generation` retyped to the retained `Issue039AssetState` |

> **Note — the retained `issue039_*` asset-store commands are now inert (dead)
> code, deferred for Stage 6 removal.** Stage 5 removed the isolated-window
> lifecycle that was the only production code path inserting into
> `Issue039AssetState.active_generations`. `store_issue039_asset_validated`
> rejects any store whose generation is not active, and nothing outside tests
> now marks a generation active, so `issue039_store_asset` (and, transitively,
> the `issue039_asset_manifest` / `issue039_clear_assets` surface it feeds)
> cannot store anything in the shipped/proof binary — they always fail closed
> with "generation is not active or already retired." The commands are retained
> only for ACL/inventory stability this stage; this is **not** a claim of
> meaningful runtime behaviour. Proof-command retirement (removing these inert
> commands and their asset-store state) is explicitly deferred to Stage 6.

## Performance measurement re-point (embedded product path)

The issue041 harness already drives its preview cycles through
`compileLoadStartIssue23` → `createEmbeddedProofPreview`, i.e. the embedded
opaque-origin sandboxed iframe (ADR 0003), not the isolated window. Stage 5
removed the last isolated-window semantics from the measurement tooling:

- **`src/frontend/src/proof-performance.ts`** — the per-cycle preview-start
  `breakdown` was reshaped for the embedded path. Removed the isolated-window
  fields `fixedSettleDelayMs` (the retired path's unconditional 1500 ms sleep),
  `previewRuntimeBootstrapMs`, and `bootstrapLoopOverheadMs` (the retired path's
  10 000 ms Rust bootstrap-loop deadline race). The breakdown is now
  `frameCreateInvokeMs` (compile response → embedded iframe created + srcdoc
  set), `documentLoadMs` (real sandboxed-document load time), `previewRuntimeReadyMs`
  (document load → in-page bridge readiness, measured passively), and
  `loadAndStartMs`.
- **`scripts/measure-performance.mjs`** — the supplementary breakdown keys,
  table descriptions, and methodology caveats were rewritten to describe the
  embedded path. It no longer references `issue038_create_preview_window`,
  `createIsolatedPreview`, `issue38-bridge.ts`, the 1500 ms settle sleep, or the
  10 000 ms bootstrap-loop race, and no longer reports the
  `bootstrapLoopExitedOnDeadline`/`bootstrapLoopExitedOnReadyMessage` evidence.
  `previewEvidence.previewTransport` now records
  `"embedded-in-page-opaque-origin-iframe"`.
- **`scripts/performance-report.mjs`** — the warm preview definition now reads
  "embedded preview runtime assets"; the cold definition reads "no embedded
  preview iframe … instantiated".
- **`scripts/measure-performance.test.mjs`** — the cycle fixture's `breakdown`
  and `bootstrapDetail` were updated to the embedded shape.

**Preserved unchanged:** raw per-attempt/per-sample provenance and the attempt
inventory; nearest-rank p50/p95 with censoring and INDETERMINATE/`>=` handling;
PRD-17 thresholds and their exact strict/inclusive inclusivity; the
publish-gate that refuses to overwrite the accepted baseline unless every
phase/kind reached its required sample count and the report validates; the
memory-baseline RSS-growth and cleanup-verification checks; and the
offline/local-only, spawn-only-own-PID, unlocked-console-session guarantees.

### Historical isolated-window numbers, and the fresh embedded baseline

The previously accepted committed baseline in `docs/performance-baseline.{md,json}`
(generated 2026-09-04, schema 2) was produced on the **retired isolated-window
path** and its preview-startup breakdown reflected the 1500 ms settle sleep and
10 000 ms bootstrap-loop deadline that no longer exist. Per ADR 0003 those
numbers were historical and could not be presented as measurements of the
embedded product path.

Stage 5 then produced a **fresh embedded-path baseline**: after building the
proof-profile package with the current embedded code, the exact committed
reproduction methodology was re-run (`--runs 1 --memory-baseline
--warm-compiles-baseline 99 --preview-cycles-baseline 20 --cooling-seconds 5
--max-attempts 3`) against the fresh binary. The driver validated the report and
overwrote `docs/performance-baseline.{md,json}` with genuine embedded samples
(`previewEvidence.previewTransport = "embedded-in-page-opaque-origin-iframe"`).
The historical isolated-window numbers are therefore no longer the committed
baseline; they remain retrievable from git history at the 2026-09-04 revision.

Key embedded result: preview-start now **PASSES** (p95 cold ≈ 237 ms, warm
≈ 221 ms, threshold 3000 ms), whereas the isolated-window baseline **FAILED** the
same threshold because of the 1500 ms settle sleep plus the 10 000 ms
bootstrap-loop race. The embedded preview-start breakdown confirms the
difference: iframe create p95 ≈ 2 ms, sandboxed-document load p95 ≈ 17 ms, real
runtime readiness p95 ≈ 154 ms, load+start p95 ≈ 214 ms — no settle sleep, no
bootstrap-loop deadline. Overall verdict **PASS**; issue-042 memory baseline
retained (compiler RSS growth -0.24%, preview RSS growth -5.97%, cleanup
verification all-cleared).

## Stage-5 verification matrix

| Check | Command | Result |
| --- | --- | --- |
| Performance tooling unit tests | `node --test scripts/performance-report.test.mjs scripts/measure-performance.test.mjs` | PASS — 32 tests (26 + 6) |
| Frontend typecheck | `npm --prefix src/frontend run typecheck` (`tsc --noEmit`) | PASS |
| PRODUCT vite build | `npm --prefix src/frontend run build:vite` | PASS |
| PROOF vite build | `npm --prefix src/frontend run build:vite:proof` | PASS |
| Profile/artifact separation | `npm --prefix src/frontend run check:profiles` | PASS — PRODUCT 21 modules/0 markers; PROOF 42 modules/17 markers; issue38 absent, 8 scenarios present |
| Protocol tests | `npm --prefix src/frontend run test:protocol` | PASS — 102 tests |
| Rust format | `cargo fmt --check` | PASS |
| Rust check (with tests) | `cargo check --tests` | PASS |
| Rust unit tests | `cargo test` | PASS — 38 tests; issue038 tests removed, embedded/issue040 fail-closed tests retained |
| Rust lint | `cargo clippy --all-targets` | PASS — no warnings |
| ACL inventory assertion | build-time `validate_generated_acl` | PASS — 84 (was 99) |
| Canonical scenario runner static test | `bash scripts/test-prove-scenarios-static.sh` | PASS |
| Offline runner static test | `bash scripts/test-prove-packaged-offline-static.sh` | PASS |
| Shell syntax (modified scripts) | `bash -n` on prove-issue039/040, prove-scenarios, prove-packaged-offline, test-prove-packaged-offline-static | PASS |
| Whitespace/diff hygiene | `git diff --check` | PASS |
| Fresh embedded packaged scenarios | `scripts/prove-scenarios-macos.sh` | PASS — all eight scenarios and every mapped sub-proof; zero orphans; clean invoke-key scan |
| Packaged offline runner (embedded issue040) | `scripts/prove-packaged-offline-macos.sh --skip-build` | PASS — bounded run finished in ~13 s (300 s cap); exactly one `ISSUE040_REPORT` with no truthy `failure`; sandbox `(deny network*)` confirmed active by the pre-launch bind probe; no orphan `monogame-playground` process; `git diff --check` clean; system networking never altered |
| Fresh embedded startup measurement | proof build (`--config src-tauri/tauri.proof.conf.json`) + `caffeinate -di node scripts/measure-performance.mjs --runs 1 --memory-baseline --warm-compiles-baseline 99 --preview-cycles-baseline 20 --cooling-seconds 5 --max-attempts 3` | PASS — fresh embedded baseline published; overall verdict PASS; all phases PASS; `previewTransport=embedded-in-page-opaque-origin-iframe`; 0 censored samples; memory baseline PASS |
| Native PRODUCT package build | `npm --prefix src/desktop run tauri -- build` | PASS — built after PROOF; product artifact check passed |

## Measurement execution record

- The measurement driver requires the macOS **proof-profile release binary**
  built immediately before measuring (the raw Cargo target path is shared by
  product and proof builds). The binary present in `target/release` at the start
  of this session predated the Stage-5 code removal, so it was **not** used for
  measurement (it would have measured the retired isolated path).
- A fresh proof-profile package was built with the current embedded code
  (`npm --prefix src/desktop run tauri -- build --config
  src-tauri/tauri.proof.conf.json --no-bundle`; the proof identifier
  `com.monogame.playground.proof` and the `dist-proof` frontend were confirmed
  embedded in the resulting binary).
- With the console session verified unlocked/on-console and under
  `caffeinate -di`, the exact committed reproduction methodology
  (`--runs 1 --memory-baseline --warm-compiles-baseline 99
  --preview-cycles-baseline 20 --cooling-seconds 5 --max-attempts 3`) was run
  against the fresh binary. It completed in one attempt with **0 launch
  failures, 0 censored samples, 0 impossible samples**, validated the report,
  and published `docs/performance-baseline.{md,json}` (overall verdict **PASS**).
- Because this run met every phase/kind sample requirement and passed schema
  validation, the driver overwrote the committed baseline with genuine embedded
  numbers. This is not a false overwrite: the previous isolated-window baseline
  was measured on a retired path, and the driver's publish-gate would have
  refused (writing `artifacts/issue041/rejected-report.json` and leaving the
  documents untouched) had the run been incomplete or invalid.
- Note on sample counts: the committed methodology combines issue 041 (timing)
  and issue 042 (memory) via `--memory-baseline`, which lowers the standard
  timing phases to one sample each while running the 100-compile / 20-preview-
  cycle memory baseline. This matches the previously accepted baseline exactly.
  A higher-sample timing-only baseline (`--runs 10` without `--memory-baseline`,
  ≥ 10 samples per phase) is available with the same tooling but was not
  published here so the memory-baseline data (issue 042) is preserved in the
  single committed report.

### Orchestrator 10-run timing corroboration (evidence only, baseline unchanged)

To corroborate the fresh embedded timing independently of the single-sample
committed baseline, the orchestrator ran a higher-sample timing-only
measurement:

```
caffeinate -di node scripts/measure-performance.mjs --runs 10 --warm-compiles 10 --preview-cycles 2 --cooling-seconds 5 --max-attempts 30
```

Result: **10/10 attempts, zero launch failures, zero censored samples, zero
threshold violations, overall verdict PASS.** Per-phase p95 (cold/warm):

| Phase | Cold p95 | Warm p95 |
| --- | --- | --- |
| Shell startup | 489.4 ms | 443.9 ms |
| Compile | 1090 ms | 232 ms |
| Embedded preview start | 239 ms | 229 ms |
| Stop | 124 ms | 121 ms |

This run **corroborates** the embedded numbers and does not change the committed
baseline. Its evidence is the git-ignored artifacts
`artifacts/stage5-embedded-timing-10runs.{json,md}` (not committed). The
**retained committed baseline remains the one-run memory baseline** in
`docs/performance-baseline.{md,json}` (which preserves the issue 042 memory data);
the 10-run timing report was intentionally not published over it.

### Offline packaged runner remediation and execution

The legacy `scripts/prove-packaged-offline-macos.sh` still launched the obsolete
`MONOGAME_ISSUE011_PROOF` (the retired top-level-canvas render) and graded on the
mere presence of an `ISSUE011_REPORT=` line; against the current embedded
Workbench it emitted an `ISSUE011` failure and hung/failed. Stage 5 re-pointed it
at the durable EMBEDDED **issue040** content/audio sub-proof, which exercises
bundled texture/audio, trusted native Space/Escape input, runtime cleanup, and
emits an exiting report:

- Launches the **raw** `target/release/monogame-playground` binary (not the `.app`
  bundle) under `MONOGAME_ISSUE040_PROOF=1`. Launching the bundle would relaunch
  through LaunchServices (`/usr/bin/open`) and open a 127.0.0.1 report-relay
  socket, escaping the sandbox network denial and leaking an unowned process; the
  raw binary keeps everything inside the single sandboxed process we launched
  (`packaged_app_bundle()` returns `None` → no relaunch; report printed to stdout).
- Expects report key `ISSUE040_REPORT`, requires **exactly one** report line, and
  parses it as JSON failing on any **truthy** `failure` value. Report existence
  alone can never pass.
- Bounded/fail-clean: a hard timeout (default 300 s, `--timeout`/
  `MONOGAME_OFFLINE_TIMEOUT`) means a missing report can never hang; on timeout
  or exit the EXIT trap terminates **only** the PID we launched (no `pgrep`/
  `pkill` name scans).
- Preserves the process-scoped `(deny network*)` sandbox and its pre-launch
  bind-probe; never alters system networking.

Executed against the fresh proof bundle (proof identifier
`com.monogame.playground.proof`, `dist-proof` frontend, `ISSUE040_REPORT`/
`issue040_dispatch_preview_input` symbols confirmed embedded):
`scripts/prove-packaged-offline-macos.sh --skip-build`. Result: **exit 0 in
~13 s** (well inside the 300 s bound); the sandbox bind probe confirmed network
denial active; the run captured **exactly one** `ISSUE040_REPORT` with **no**
truthy `failure` (two full preview instances: mount → `Content.Load<SoundEffect>`
→ trusted Space activation → non-silent playback → Stop → dispose → retirement);
**no orphan** `monogame-playground` process remained; `git diff --check` clean;
system networking never changed. A shell/static guard was added
(`scripts/test-prove-packaged-offline-static.sh`) covering the re-point, the
truthy-failure grader, the raw-binary target, the bounded owned-PID termination,
and the no-network-mutation guarantees.

## Explicit historical records retained (not altered)

- `issues/038-force-stop-infinite-update-in-isolation.md` — the issue 038 record
  and its verification evidence.
- `docs/adr/0002-isolated-preview-webview-window.md` — the accepted (now
  superseded) isolated-window ADR.
- `docs/adr/0003-embedded-preview-and-non-yielding-code.md` — the superseding
  decision that authorises this retirement.
- `docs/stage4-proof-consolidation.md` — the accepted Stage-4 record (annotated
  with a Stage-5 follow-up banner pointing here; body left as the historical
  record).
- `docs/security-model.md` — the "Historical issue 038 isolated-window proof
  harness" section is retained as a design record, explicitly marked
  *removed in Stage 5*.
- `docs/performance-baseline.{md,json}` — **regenerated** on the embedded path
  (overall verdict PASS). The prior isolated-window measurement is not altered in
  place; it remains in git history at the 2026-09-04 revision.

## Out of scope (Stage 6+)

- Renaming the remaining product/proof Tauri commands by responsibility.
- Putting Rust proof commands behind a non-default `proof-harness` Cargo feature
  or a separate proof crate/binary.
- Splitting proof exports/actions from `PreviewExports.cs`, `preview.js`, and the
  compiler harness.

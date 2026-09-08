# Reproducible build toolchain

The versioned toolchain manifest at
[`docs/toolchain-manifest.json`](toolchain-manifest.json) is the source of truth
for the MonoGame revision and tools used to build the playground. It prevents a
build from silently following a branch head or using whatever tool versions
happen to be installed.

## Frontend build profiles (PRODUCT vs PROOF)

The frontend (`src/frontend`) builds under one of two **compile-time** profiles,
selected by the `MONOGAME_FRONTEND_PROFILE` environment variable that
`vite.config.ts` reads at build time. This is a build-time entry split, not a
runtime flag: exactly one entry graph is compiled per build, so proof-only
modules and chunks are physically absent from the product output.

| Profile | Env | Entry module | Output dir | Contents |
| --- | --- | --- | --- | --- |
| PRODUCT (default) | unset or `product` | `src/entry.product.ts` | `dist/` | Workbench product + theme only. No auto-proof entry graph. |
| PROOF | `proof` | `src/entry.proof.ts` (former `main.ts`) | `dist-proof/` | Full per-issue auto-proof instrumentation + Workbench + benchmarks. |

`index.html` references the product entry by default; a build-time Vite HTML
transform (`order: "pre"`) rewrites that single `<script>` to the proof entry
only when the proof profile is active. The two profiles write to separate
directories and each build empties its own output dir (`build.emptyOutDir`), so
stale artifacts are removed per profile and a clean product build after a proof
build never inherits proof-only artifacts.

### Build manifest (`profile-manifest.json`)

Every Vite build stamps a machine-readable manifest into its own output
directory via the `monogame-emit-profile-manifest` plugin
(`vite.config.ts`, `generateBundle` hook). It records:

- `profile` — `"product"` or `"proof"` (which build produced this directory).
- `entrySource` — the selected entry module (`src/entry.product.ts` or
  `src/entry.proof.ts`).
- `modules` — the **actual Rollup module graph**: every first-party source
  module that survived tree-shaking into the emitted chunks. Tree-shaken
  modules never appear here, so module-graph exclusion is proven from Rollup,
  not inferred from minified text.
- `chunks` — every emitted JS chunk, whether it is an entry chunk, its facade
  module id, and its module count.
- `schemaVersion` — manifest format version (checker rejects unknown versions).

### Commands (staging separated from Vite-only profile builds)

The expensive .NET staging (`stage:monogame/compiler/preview`, which populates
`.generated-public/`) is profile-independent and split out from the Vite build,
so profile verification does not repeat it three times:

```bash
# Stage the .NET assets once (profile-independent)
npm --prefix src/frontend run stage

# Vite-only profile builds (reuse staged .generated-public/)
npm --prefix src/frontend run build:vite         # PRODUCT -> dist/
npm --prefix src/frontend run build:vite:proof   # PROOF   -> dist-proof/

# Full builds (stage + vite) — what Tauri's beforeBuildCommand invokes
npm --prefix src/frontend run build              # PRODUCT -> dist/
npm --prefix src/frontend run build:proof        # PROOF   -> dist-proof/

# Dev servers
npm --prefix src/frontend run dev                # product dev server
npm --prefix src/frontend run dev:proof          # proof dev server

# Stage 1 artifact separation checks (validate existing built output; these do
# not rebuild, so use verify:profiles when freshness is part of the check)
npm --prefix src/frontend run check:profiles          # both dirs
npm --prefix src/frontend run check:profile-product   # dist/ only
npm --prefix src/frontend run check:profile-proof     # dist-proof/ only

# Fresh-build verification: product -> proof -> product (proves the product
# build after a proof build stays clean). Stages once, then vite-only builds.
npm --prefix src/frontend run verify:profiles
npm --prefix src/frontend run verify:profiles -- --skip-stage   # reuse staging
```

### Checker (`scripts/check-profile-artifacts.mjs`)

The checker requires and validates each build's `profile-manifest.json`, and
fails on: a missing/malformed manifest, an unknown schema version, a directory
stamped with the wrong profile (product stamped proof or vice versa), an
empty/malformed module inventory, or the wrong entry source.

Beyond the manifest it asserts, per profile:

- **PRODUCT (`dist/`)** — `src/entry.proof.ts` and every proof-only module
  are absent from the emitted module graph, and **zero** auto-proof markers
  (`MONOGAME_ISSUE0xx_PROOF...`) appear in any emitted `.js/.html/.css`
  artifact. **Any** marker is a **hard failure** (no warnings, no downgrades).
  The proof-only set enumerated in the checker's `PROOF_ONLY_MODULES` is the
  shared proof runtime toolkit (`issue21`), the retained isolated-window
  force-stop harness (`issue38`, pending Stage 5), and the eight Stage-4
  scenario suites (`proof-compile-run-stop`, `proof-compiler-diagnostics`,
  `proof-output`, `proof-runtime-exception`, `proof-preview-security`,
  `proof-content`, `proof-project-lifecycle`, `proof-performance`); each is a
  hard failure if it leaks into the product graph. Separately, **any**
  issue-numbered source module (`issueNN*.ts`) in the product graph is a hard
  failure via a generic regex guard, so `issue21`/`issue38` are caught by that
  guard too even though they are also enumerated explicitly. The checker
  additionally asserts that the Stage-2 extracted production domain modules
  (`compiler-context`, `live-preview`, `run-stop`, `lifecycle-controller`,
  `first-run-warning`, plus the Stage-3 responsibility-named UI modules) **are**
  present in the product graph, so the extraction is proven real rather than a
  dead re-export.
- **PROOF (`dist-proof/`)** — `src/entry.proof.ts` and every proof-only module
  are present in the graph, `src/entry.product.ts` is absent, and every
  expected proof marker is present in the emitted output.

Anti-drift guards prevent a check from passing vacuously: the source marker
inventory is scanned from the **whole non-test runtime source** text (no `//`
comment truncation) and must meet a minimum count; the expected proof marker set must be
non-empty and meet a minimum count; and the manifest module inventory must be
non-empty. One marker (`MONOGAME_ISSUE037_PROOF_PHASE`) lives only in a source
comment naming a shell/Rust env var and is never emitted; it is documented in
the checker's `COMMENT_ONLY_MARKERS` (still forbidden in product, not required
in proof output).

The release workflow runs `check:profile-product` immediately after its normal
frontend build, so a release leg fails before Tauri packaging if the product
module graph or emitted assets contain proof instrumentation.

### Tauri integration and native output separation

Tauri's normal `beforeBuildCommand` is the **PRODUCT** build
(`tauri.conf.json`, `productName` "MonoGame Playground", identifier
`com.monogame.playground`). Packaged proof scripts select the proof profile by
merging `src-tauri/tauri.proof.conf.json`, which overrides:

- `build.beforeBuildCommand` -> `npm --prefix ../frontend run build:proof`
- `build.frontendDist` -> `../../frontend/dist-proof`
- `productName` -> `MonoGame Playground Proof`
- `identifier` -> `com.monogame.playground.proof`

```bash
npm --prefix src/desktop run tauri -- build \
  --config src-tauri/tauri.proof.conf.json
```

The distinct `productName`/`identifier` mean the proof package bundles as
`MonoGame Playground Proof.app` with bundle id `com.monogame.playground.proof`,
so a proof build cannot masquerade as or overwrite the normally installed
product, and its persisted app data is namespaced separately. The normal
product identity is unchanged.

**Residual shared behavior (documented):** both profiles compile the same Cargo
crate, so the intermediate raw release binary
`src/desktop/src-tauri/target/release/monogame-playground` and the Rust `target/`
tree are shared and overwritten by whichever profile built last. The macOS
`.app` bundles are separate (distinct `productName`), but the inner Mach-O
executable keeps the Cargo crate name `monogame-playground` in both. The
packaged proof runner scripts (`prove-issue03x/04x`) that exercise the raw
release binary therefore run whichever frontend was embedded by the most recent
build; they build the proof profile immediately beforehand so the binary embeds
the proof frontend.

### Stage-2 boundary (production/proof module extraction, done)

Stage 2 extracted the REAL production compiler / embedded-preview / run-stop /
first-run code out of the former mixed issue-numbered modules `issue21.ts`,
`issue24.ts`, and `issue37.ts`. The product module graph no longer contains any
of those three modules; they remain in the **proof** graph only (imported by
`entry.proof.ts`) for the historical per-issue proofs.

Extracted production domain modules (production-neutral — no proof markers, no
auto-proof entries):

| Domain module | Responsibility | Formerly in |
| --- | --- | --- |
| `src/compiler-context.ts` | The single process-wide compiler + initial-preview iframe context: bootstrap, `ensureContexts`, `retireInitialPreviewContext`, `waitForTopRuntime`, MessagePort/client ownership. Exposes a `registerContextSetup` hook so proof-only closures inject from `issue21.ts` without the product linking them. | `issue21.ts` |
| `src/live-preview.ts` | `runLivePreviewInPage` — the real embedded Run flow (compile → mount sandboxed opaque-origin iframe → load → mount Content before start → start → cooperative stop). | `issue21.ts` |
| `src/lifecycle-controller.ts` | The neutral run/stop/restart lifecycle state machine (`createRunStopController`, `PreviewLifecycleState`): start-throw recovery, stop coalescing, restart queueing, failure observation, preview-panel indicator. | `issue24-controller.ts` |
| `src/run-stop.ts` | `installRunStopControl` — wires the workbench Run/Stop buttons to the lifecycle controller driving the in-page live preview. | `issue24.ts` |
| `src/first-run-warning.ts` | ADR-0003 non-yielding first-run warning modal, per-folder-identity acknowledgement store client, and `gateFirstRun`. | `issue37.ts` |

Compatibility strategy (proof/tests unchanged, product never imports the
façades) — **as of Stage 2**; several of the issue-numbered proof modules named
here were subsequently consolidated or renamed in Stage 4 (see the Stage-4
boundary below for where each moved):

- `issue24-controller.ts` is a **compatibility façade** that re-exports
  `createRunStopController` (as `createIssue024RunStopController`) and the
  `PreviewLifecycleState` / `Issue052PreviewLifecycle` types from
  `lifecycle-controller.ts`. It is **retained** through Stage 4 and still
  resolves for its current importers: `lifecycle-controller.ts`,
  `protocol.test.ts`, and the Stage-4 scenario suites
  (`proof-compile-run-stop.ts`, `proof-runtime-exception.ts`,
  `proof-performance.ts`).
- `issue24.ts` (which kept only the cooperative-stop AUTO-PROOF and re-exported
  `installRunStopControl` as `installIssue024RunStopControl` for
  `entry.proof.ts`) was **removed in Stage 4**: its cooperative-stop proof body
  was folded into `proof-compile-run-stop.ts`. The
  `installIssue024RunStopControl` re-export was **dropped** as dead code —
  `entry.proof.ts` never called it and the production control lives in
  `app.ts` via `run-stop.ts`.
- `issue37.ts` (which kept only the two-phase packaged first-run PROOF and
  re-exported `gateFirstRun` / `SCRATCH_PROJECT_IDENTITY` from
  `first-run-warning.ts`) was **renamed in Stage 4** to
  `proof-project-lifecycle.ts`, which preserves that two-phase proof and the
  same `gateFirstRun` / `SCRATCH_PROJECT_IDENTITY` re-exports.
- `issue21.ts` keeps its proof-only compile/load/preview functions and injects
  its proof context closures via `registerContextSetup`; its shared compiler
  context now comes from `compiler-context.ts`. It remains proof-only through
  Stage 4.

`app.ts` imports `installRunStopControl` from `run-stop.ts` and `gateFirstRun` /
`SCRATCH_PROJECT_IDENTITY` from `first-run-warning.ts` — no issue-numbered
module is on the product Run/first-run path. Shared protocol validation stays in
`protocol.ts` / `ProtocolRuntime`; it is not forked.

Remaining issue-numbered modules still in the **product** graph **at the end of
Stage 2** (Stage-3 UI rename scope, not Stage 2): `issue046` (theme), `issue047`
(editor), `issue048` (problems), `issue049` (output), `issue050` (dirty
tracker), `issue051` (project manager), `issue052` / `issue052-content` (preview
panel + content). Stage 3 subsequently renamed all of these to the
responsibility-named product UI modules listed above, so the current product
graph contains **no** issue-numbered modules (enforced by
`ISSUE_NUMBERED_MODULE_REGEX` in the checker).

## Stage-4 boundary (durable scenario suite, done)

Stage 4 replaced the many permanent per-issue **frontend proof drivers** with a
durable suite of **exactly eight** responsibility/scenario-named proof modules.
Each module exposes a **single scenario entrypoint** that orchestrates its
constituent sub-proofs and owns their failure reporting; `entry.proof.ts`
dispatches those eight entrypoints (plus the retained top-level-shell inline
proofs 009/010/011/020 and the issue038 force-stop harness) instead of the
former fifteen-plus per-issue `runIssueNN` runners. The former per-issue driver
bodies were merged into module scope with shared helpers deduplicated (not left
as verbatim per-issue namespaces), and each module's issue-specific env
selection + report emission is encapsulated inside its scenario driver. Every
packaged proof marker (`MONOGAME_ISSUE0xx_PROOF…`) and Tauri report command name
is unchanged (their renames are Stage 6). PRODUCT is untouched (still 21 modules,
zero markers).

A shared driver, `scenario-runner.ts` (deliberately **not** `proof-*`-named so
the checker's structural `proof-*` rule stays reserved for the eight scenario
suites), provides the `runScenario`/`SubProof` orchestration each scenario uses.

| Scenario entrypoint | Module | Durable scenario | Absorbed sub-proofs |
| --- | --- | --- | --- |
| `runCompileRunStopScenario` | `proof-compile-run-stop.ts` | compile → Run → Stop → rerun | issue021/023/024/025/030 |
| `runCompilerDiagnosticsScenario` | `proof-compiler-diagnostics.ts` | compiler diagnostics + policy rejection | issue022/031/032 |
| `runRuntimeExceptionScenario` | `proof-runtime-exception.ts` | runtime exception + portable-PDB mapping | issue029 |
| `runOutputCaptureScenario` | `proof-output.ts` | managed / native output | issue027/028 |
| `runContentWorkflowScenario` | `proof-content.ts` | texture / audio content workflow | issue039/040 |
| `runPreviewSecurityScenario` | `proof-preview-security.ts` | embedded preview security boundary | issue033/034/035/036 |
| `runProjectLifecycleScenario` | `proof-project-lifecycle.ts` | project open/save/dirty-state/identity | project-lifecycle feature tests + issue037 |
| `runPerformanceScenario` | `proof-performance.ts` | performance + memory | issue041 |

Genuine dedup performed: `proof-compiler-diagnostics.ts` hoisted one shared
`Diagnostic`/`Compilation` type and one persistent-compiler `compile` helper
(issue31 and issue32 previously declared identical copies); `proof-output.ts`,
`proof-compile-run-stop.ts`, `proof-preview-security.ts`, and `proof-content.ts`
hoisted their duplicated `wait`/`assert`/`createUuid`/`PROTOCOL_VERSION` helpers
to module scope. The dead `installIssue023RunControl` proof Run-wiring (a
duplicate of the production control in `app.ts`) was removed, as was the unused
`installIssue024RunStopControl` re-export.

**Scenario 7 (project open/save/dirty-state/identity)** is explicitly two
layers: (1) durable, responsibility-named FEATURE TESTS with mocks
(`project-lifecycle.test.ts`, `node --test`) that consolidate and REPLACE the
historical `issue051.test.ts` + `project-identity.test.ts` coverage AND add the
previously-missing open→edit→**Save-All** (atomic, dirty-clear) behavior against
the production `project-manager.ts`; plus (2) the packaged two-phase FIRST-RUN
warning proof (former issue037, in `proof-project-lifecycle.ts`).
`proof-project-lifecycle.ts` does NOT claim to test save/dirty behavior — the
feature tests do.

Retained by genuine necessity: the shared proof runtime toolkit (`issue21.ts` +
`issue21-controller.ts`), the neutral lifecycle façades (`issue23-controller.ts`,
`issue24-controller.ts`, also imported by `protocol.test.ts`), the content
fixtures/contract (`issue040-fixture.ts`, `issue040-contract.ts`), the Stage-3
output/project façades (`issue049.ts`, `issue051.ts`), and — **intentionally,
pending Stage 5, now the sole `issue38-bridge` importer** — the isolated-window
force-stop harness (`issue38.ts`, `issue38-bridge.ts`).

**Stage-5 readiness (issue38-bridge migration) — complete:** the intended end
state is now reached — **only `issue38.ts`** imports `issue38-bridge`, so Stage 5
can delete the isolated-window harness cleanly. The embedded preview security
scenario (`proof-preview-security.ts`, issues 33–36) already ran entirely in the
EMBEDDED opaque-origin sandboxed iframe (`runInPagePreviewForProof`) required by
ADR 0003 and never imported `issue38-bridge`. In Stage 4 the shared toolkit's
`compileLoadStartIssue23` (`issue21.ts`) and the texture/audio content proofs
(`proof-content.ts`, issues 039/040) were migrated off `issue38-bridge` onto the
same embedded in-page opaque-origin iframe via the shared
`createEmbeddedProofPreview` helper in `issue21.ts`; compiled binaries and
content assets now transfer **INLINE** over the in-page protocol port instead of
the isolated window. The one native-input dependency was resolved by narrowly
adapting the EXISTING `issue040_dispatch_preview_input` command to fail-closed
resolve an explicit target (active isolated preview *or* the pinned `main`
window hosting the embedded iframe) so the trusted Space/Escape gesture that
unlocks AudioContext autoplay reaches the embedded preview — **no Tauri command
renamed/added/removed, no Cargo proof feature/boundary changed, no `issue038_*`
asset/window/command touched**. `issue038` remains runnable for regression
during Stage 4; Stage 5 only deletes the now-sole `issue38.ts` importer and its
bridge.

The checker (`check-profile-artifacts.mjs`) now: structurally rejects **any**
`src/proof-*.ts` module in the PRODUCT graph (prefix regex, independent of the
enumerated list); requires **exactly the eight** scenario modules in PROOF and
rejects any unexpected `proof-*` module; retains explicit `issue21`/`issue38`
presence checks in PROOF; and keeps the marker anti-drift floors unchanged. The
issue034 ACL rejection inventory (`ISSUE034_APPROVED_COMMANDS`) lives at module
scope in `proof-preview-security.ts`; the Rust `build.rs` / `lib.rs` source path
that scans it points there (no command renamed, no Cargo proof feature/boundary
changed).

**Canonical packaged verification path:** `scripts/prove-scenarios-macos.sh`
orchestrates the eight durable scenarios BY NAME while internally translating
each to the existing per-issue env gates and report keys. Operators no longer
think in per-issue ordering; `scripts/prove-issue03x/04x-macos.sh` and
`prove-packaged-offline-macos.sh` remain as compatibility wrappers. See
[`stage4-proof-consolidation.md`](stage4-proof-consolidation.md) for the full
inventory→scenario mapping and verification matrix.

## Manifest schema

`schemaVersion` identifies the manifest format. The remaining top-level objects
have these roles:

| Object | Contents |
| --- | --- |
| `monogame` | Repository, branch, immutable commit SHA, and protected ref that must contain the commit |
| `dotnet` | Required .NET SDK and WebAssembly workload identifier |
| `compiler` | Compiler-only SDK, target, Roslyn, WebAssembly SDK pack, and reference-pack pins |
| `emscripten` | Repository-relative sibling path and expected Emscripten SDK tag |
| `shell` | Desktop-shell selection and its tool versions |
| `frontend` | Node.js, package-manager, and lockfile identity |

The `shell` and `frontend` values explicitly marked `pending-issue-6` are
placeholders. Issue 006 will replace them after selecting the desktop and
frontend toolchains.

## Current local prerequisite

The pinned MonoGame checkout's `Example/global.json` requires .NET SDK
`9.0.112`, so that is the manifest pin. This machine currently resolves
`dotnet --version` to `9.0.315` and does not have `9.0.112` installed. Install
SDK `9.0.112` before building; do not replace the manifest pin with the
incompatible installed SDK. The `wasm-tools` workload is present in the current
SDK installation, but build validation must verify or restore it for the pinned
SDK.

The existing browser compiler is a deliberately scoped exception: its restore,
reference collection, and AppBundle build use `compiler.sdkVersion` `9.0.315`,
`Microsoft.NET.Sdk.WebAssembly.Pack` `9.0.19`, and
`Microsoft.NETCore.App.Ref` `9.0.19`. This does not repin MonoGame or the global
playground toolchain. The collector resolves that exact reference pack from
`src/compiler/obj/project.assets.json` and rejects any SDK or pack drift.
`src/compiler/global.json` pins that SDK with roll-forward disabled. Run compiler
SDK commands with `src/compiler` as the working directory so .NET discovers the
scoped pin:

```bash
cd src/compiler
dotnet build --configuration Release
```

The project also rejects a mismatched `NETCoreSdkVersion`, so a build launched
from another working directory cannot silently use a different installed SDK.

## Committed compiler references

`src/compiler/References/` contains the raw reference DLLs identified by
[`docs/reference-allowlist.json`](reference-allowlist.json). They are committed
build inputs rather than an ignored cache so a clean clone can build the
compiler without rebuilding MonoGame. Run
`scripts/collect-compiler-references.sh` (or its PowerShell counterpart) only
when intentionally refreshing them from the exact restored compiler reference
pack and the pinned existing MonoGame Native Release output. Normal compiler
builds run the collector in verification mode and fail on missing, extra, or
hash-drifted inputs; they never rebuild MonoGame.
Verification independently reads each destination PE identity and compares its
simple name, assembly version, public key token, hash, and MonoGame
informational version where applicable.

The collector's `--manifest` and `--references-dir` overrides are restricted to
non-destructive verification fixtures. On Windows the PowerShell wrapper tries,
in order, Python 3 as `python3`, `py -3`, and `python`, verifies the interpreter
major version, and otherwise reports the Python 3 prerequisite.

`scripts/ReferenceIdentity/bin/` and `scripts/ReferenceIdentity/obj/` are normal
generated .NET build outputs and remain excluded by the repository's existing
case-insensitive `bin`/`obj` ignore rules.

## Emscripten environment

The expected Emscripten checkout is `../emsdk`, relative to the repository root,
at tag `3.1.56`. Before any MonoGame native or WebAssembly build on macOS or
Linux, initialize it in the same shell that will run the build:

```bash
source ../emsdk/emsdk_env.sh
```

This command is mandatory and must be run from the repository root. It must be
sourced rather than executed as a child process, because `emsdk_env.sh` sets
environment variables in the calling shell. Use `scripts/check-emsdk-env.sh`
(or its PowerShell twin, `scripts/check-emsdk-env.ps1`) to confirm that the
environment is active before building.

### MonoGame Web native archives

The preview links `mgruntime.a`, `libSDL2.a`, and `libFAudio.a`. They are
Release/Emscripten outputs of the pinned MonoGame build task, not arbitrary
local libraries. A clean checkout produces and stages them with:

```bash
source ../emsdk/emsdk_env.sh
./scripts/build-monogame.sh
node scripts/verify-preview-native-artifacts.mjs
dotnet build src/preview/Playground.Preview.csproj --configuration Release
node scripts/inspect-preview-wasm.mjs
```

`build-monogame.sh` runs `dotnet run --project build/Build.csproj` inside the
validated submodule, then copies the three archives from
`external/MonoGame/Artifacts/native/mgruntime/wasm/emscripten/Release/` to
ignored product staging under `artifacts/monogame/native/`. The script records
the source SHA, Emscripten version, Release configuration, and pre-build
submodule state in `provenance.json`. The committed manifest binds each staged
file to its exact size and SHA-256; missing, extra, stale, or modified archives
fail before the preview build. Run
`npm --prefix src/frontend run test:preview-native-artifacts` for the
clean-state rejection regression.

`WasmEnableThreads=false` is authoritative: the final runtime has unshared
memory and no worker asset or `Worker` construction. The MonoGame archives do
contain atomic instructions, so `--enable-threads` is passed only to
Binaryen's validator. It does not opt the .NET runtime into pthreads. The
strict native link uses product-owned scheduler shims with the advisory
priority behavior from Emscripten 3.1.56. The final inspection verifies those
two imports are resolved by generated Emscripten JavaScript and rejects shared
memory, workers, missing shims, or an unexpected final module shape.

## Updating the manifest

Update the manifest only as part of an intentional, reviewed toolchain change:

1. Read `external/MonoGame/AGENTS.md`, then record the checkout with
   `git -C external/MonoGame rev-parse HEAD` and
   `git -C external/MonoGame rev-parse --abbrev-ref HEAD`.
2. Confirm the commit is reachable from the recorded protected ref.
3. Read MonoGame's checked-in `global.json` files and record their required SDK;
   inspect `dotnet --version`, `dotnet --list-sdks`, and
   `dotnet workload list` without substituting an incompatible local SDK.
4. Record the expected `../emsdk` tag. Once selected, also record exact shell,
   Rust or Electron, Node.js, package-manager, and lockfile values.
5. Increment `schemaVersion` when changing the manifest structure, keep the file
   valid JSON, and review the diff with the associated lockfiles.

CI and build scripts must verify every non-pending manifest value against the
live environment before building. In particular, they must reject the wrong
MonoGame SHA, SDK, workload, or Emscripten version. Automated verification and
restoration are implemented by later issues; builds must not silently update
the submodule or relax a version pin.

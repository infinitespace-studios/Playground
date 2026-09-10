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
# build after a proof build stays clean). Performs a REAL fresh per-profile
# staging sequence — stage PRODUCT, build; stage PROOF, build; restage PRODUCT,
# build — because the .NET compiler/preview staging is profile-dependent (the
# proof runtime carries a proof extension/observer that the product must not).
# It also asserts the staged .NET runtime copied into each dist tree matches its
# profile. Takes no arguments; the former `--skip-stage` shortcut was removed
# (a single reused .generated-public/ holds only one profile and cannot prove
# both profile-specific staged sets).
npm --prefix src/frontend run verify:profiles
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
  shared proof runtime toolkit (`scenario-toolkit`) and the eight
  scenario suites (`proof-compile-run-stop`, `proof-compiler-diagnostics`,
  `proof-output`, `proof-runtime-exception`, `proof-preview-security`,
  `proof-content`, `proof-project-lifecycle`, `proof-performance`); each is a
  hard failure if it leaks into the product graph. **Stage 5 retired the
  isolated-window force-stop harness (`issue38.ts` / `issue38-bridge.ts`); those
  modules no longer exist and are no longer enumerated or asserted present.**
  Separately, **any**
  issue-numbered source module (`issueNN*.ts`) in the product graph is a hard
  failure via a generic regex guard. The checker
  additionally asserts that the extracted production domain modules
  (`compiler-context`, `live-preview`, `run-stop`, `lifecycle-controller`,
  `first-run-warning`, plus the responsibility-named UI modules) **are**
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
  --config src-tauri/tauri.proof.conf.json \
  --features proof-harness
```

The proof package additionally passes the non-default `proof-harness` Cargo
feature (Stage 6). Without it the crate compiles only the eight product commands;
with it the full 67-command proof surface, the proof-only Rust relay/state, and
the proof capability/permission overlay are compiled in. The release/product
default never passes the feature.

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
executable keeps the Cargo crate name `monogame-playground` in both. The canonical
packaged proof runner (`scripts/prove-scenarios-macos.sh`) exercises that raw
release binary and therefore builds the proof profile immediately beforehand so
the binary embeds the proof frontend.

### Final payload policy (staged frontend size)

The shipping frontend `dist/` (and `dist-proof/`) is staged from three sources —
the MonoGame native archives, the Roslyn compiler runtime, and the MonoGame
preview runtime. Two classes of build output are deliberately **not** shipped:

1. **The obsolete top-level MonoGame browser demo payload.** The MonoGame Web
   build under `artifacts/monogame/` emits a standalone `#canvas` browser demo
   (`_framework/`, `main.js`, `index.html`, `Content/test*`, favicons). Stage 7
   removed the last top-level `#canvas` demo from the live workbench: the served
   `index.html` carries no `#canvas`, and the live module graph imports only
   `compiler/_framework` and `preview/_framework` (each publish stages its own
   `_framework`). No live module, boot manifest, custom protocol, favicon
   `<link>`, or Tauri asset route references the top-level payload, so
   `stage-monogame.mjs` no longer stages it. It still **verifies** the native
   archives (`native/mgruntime.a`, `native/libSDL2.a`, `native/libFAudio.a`)
   and provenance and **fails closed** when those real product build inputs are
   missing — the preview csproj links the native archives via
   `<NativeFileReference>` (`MonoGameNativeArtifactPath`) directly from
   `artifacts/monogame/native/`, never from the served public directory. This
   removes ~54 MiB (a duplicate ~50 MiB `_framework`, a ~3.6 MiB demo
   `testsound.xnb`, and the demo index/`main.js`/favicons) from the final
   PRODUCT and PROOF frontend dist.

2. **Precompressed Brotli/gzip sidecars.** A dotnet browser-wasm publish emits a
   `*.br` and `*.gz` copy beside every canonical raw asset for HTTP
   content-negotiation on a static web server. The shipping product never
   negotiates them: `blazor.boot.json`/`dotnet.js` request only canonical raw
   asset names; the preview is served by the in-process `playground-preview:`
   custom protocol, which resolves an **exact** path and sets no
   `Content-Encoding`/`Accept-Encoding` negotiation; the compiler ships as normal
   Tauri asset-protocol files also requested by canonical name. So the ~32 MiB of
   `.gz`/`.br` sidecars across the compiler + preview trees are dead weight (and,
   for the preview, in the `build.rs`-embedded asset map). `stage-compiler.mjs`
   and `stage-preview.mjs` strip them after staging and **fail closed** if a
   sidecar re-enters the staged tree while the canonical raw boot assets remain
   (`staged-asset-guard.mjs` `removePrecompressedSidecars` /
   `assertNoPrecompressedSidecars`, with a self-test).

3. **Unused Roslyn localization satellites.** The Playground UI and diagnostic
   contract are English-only. `Playground.Compiler.csproj` sets
   `SatelliteResourceLanguages=en`, so localized Roslyn satellite assemblies for
   German, French, Japanese, Russian, Chinese, and other unused locales are not
   published. `stage-compiler.mjs` fails if a non-English locale directory
   reappears.

These policies are additionally enforced on the built dist by
`check-profile-artifacts.mjs` (no top-level `_framework`/`main.js`/`Content`
demo payload and no `.gz`/`.br` sidecars survive in `dist/` or `dist-proof/`),
and the embedded preview inventory test in `lib.rs` asserts no sidecar enters
the binary. The legitimate vite-built `index.html` (the workbench document) and
the `compiler/`/`preview/` runtimes are the only top-level dist entries.

The Rust release profile (`[profile.release]` in `src-tauri/Cargo.toml`) sets
`strip = true` (removes the debug symbol table + DWARF from the shipped binary,
the largest single non-asset size win and what the size gate asserts) and
`lto = "thin"` (a portable cross-crate size/perf win). Both are portable,
first-class Cargo profile settings — no target-specific linker flags — so they
apply uniformly across the six-platform matrix. `build.rs`'s
`validate_cargo_manifest` pins the `[profile.release]` table exactly and a
negative fixture rejects any drift (disabled strip, dropped profile, an added
runtime-behavior knob such as `panic = "abort"`, or an unapproved sibling
profile), so the approved release profile cannot silently change.

### Compiled-artifact command-inventory enforcement

Because the raw release binary path is shared and overwritten per profile (above),
a compiled-artifact checker guards the *packaged* executable and staged assets so
a stale or wrong-profile artifact cannot pass as product:

```bash
# self-test the checker (proves it fails on injected/wrong-path/wrong-profile/empty)
npm --prefix src/desktop run check:binary:self-test

# scan the freshly built PRODUCT bundle (8 commands only, zero proof surface)
npm --prefix src/desktop run check:binary:product

# scan the freshly built PROOF bundle (67 commands, proof symbols, 8 scenarios)
npm --prefix src/desktop run check:binary:proof

# build + check in one step
npm --prefix src/desktop run package:product
npm --prefix src/desktop run package:proof
```

`scripts/check-binary-command-inventory.mjs` derives the canonical command
inventories (8 product / 59 proof / 67 total) by parsing `build.rs` — it holds no
duplicate list — and asserts they are disjoint and their union equals
`HANDLER_ORDER`. It resolves the mode-correct `.app` by `CFBundleIdentifier`
(`com.monogame.playground` vs `…playground.proof`), refusing a wrong-profile
bundle, and cross-checks the staged `dist`/`dist-proof` `profile-manifest.json`.
It is pure-Node (no system `strings`/`nm`/`plutil`) so it runs on every CI leg.
Product mode requires all eight product commands + product runtime floors present
and **zero** old command names, proof commands, `issue0NN` tokens, proof
env/report markers, proof Rust relays, proof C# exports, proof JS globals, or
proof extension assets. Proof mode requires all 67 commands + representative proof
symbols/assets and exactly eight scenarios. The proof packaged runner
(`prove-scenarios-macos.sh`) runs the proof check after building; the release
workflow runs the product check after packaging.

## Continuous integration gates

Two workflows enforce the architecture, split by what is feasible from a clean
clone versus what needs the built MonoGame runtime and staged assets.

### `.github/workflows/quality.yml` (fast gate — PR + push)

Runs only checks that are feasible from a **clean clone with no untracked build
artifacts**. It does not check out the MonoGame submodule, does not build the
.NET compiler/preview, does not stage frontend assets, and does not compile the
Tauri shell — because `src/desktop/src-tauri/build.rs` embeds the staged
`dist/preview`, so a Rust build without staged assets would fail purely because
ignored artifacts are absent. It runs:

- **frontend** — `npm ci`, `tsc --noEmit` typecheck, the focused
  protocol/content-validation/audio-content/project-lifecycle tests, the
  performance-tooling unit tests, and the four fail-closed tool self-tests
  (staged-asset guard, binary command-inventory checker, release package-size
  gate, bounded product smoke gate).
- **shell** — `bash -n` over every script plus the static (no-binary) packaged
  runner tests.
- **rust-fmt** — `cargo fmt --check` only (formatting does not invoke `build.rs`,
  so it needs no staged assets).

### `.github/workflows/release.yml` (asset-dependent gates)

Builds the MonoGame WASM runtime once, then builds the six product bundles
(macOS/Windows/Linux × x64/arm64). After the frontend `dist/` is staged, each
package leg additionally runs the **asset-dependent** Rust gates that
`quality.yml` cannot: `cargo clippy --all-targets` (PRODUCT) on every leg and
`cargo test` on the host-native legs (the cross-compiled macOS x64 leg builds but
does not run its tests). After packaging, each leg runs:

- the **binary command-inventory** check against the freshly built product
  bundle (identity-verified `.app` on macOS; profile-unique release binary on
  Windows/Linux);
- the **package-size gate** (`scripts/measure-release-size.mjs`) against this
  leg's real package(s), resolving the platform package format(s)
  (`.dmg`/`.msi`/`.exe`/`.deb`/`.AppImage`/`.rpm`), verifying the staged dist is
  the PRODUCT profile and the content fixtures are present. The 100 MiB
  acceptance applies to **each** distributed package: when a leg emits several
  formats (e.g. Linux `.deb` + `.AppImage`), every recognised package is measured
  and checked individually and any single one over 100 MiB fails closed — a
  smaller sibling can never mask an oversized supported package;
- the **bounded product smoke** (`scripts/smoke-product.mjs`): the full
  launch/no-immediate-crash phase on the host-native macOS arm64 leg (WKWebView +
  window server present), and identity/profile checks on the cross-compiled
  macOS x64, Windows, and Linux legs where native GUI execution is not guaranteed.
  The smoke refuses any proof env/profile and terminates only the process tree it
  owns.

Workflow-artifact upload happens only after those required checks pass. On a tag,
`tauri-action` attaches bundles to a **draft** GitHub Release during its build
step; that draft must not be published unless every matrix leg is green. A separate,
`workflow_dispatch`-gated `proof-acceptance` job (input `run_proof_acceptance`)
stages the PROOF frontend, runs the PROOF Rust clippy/test, builds the
`--features proof-harness` package, drives the eight packaged scenarios via
`scripts/prove-scenarios-macos.sh`, and runs the PROOF binary inventory — so
normal `main` pushes and tag builds do not pay for the long packaged scenarios.

## Final module architecture

The frontend is split by responsibility, with the proof harness held entirely
outside the product graph. The historical extraction/consolidation is recorded
in the stage evidence docs (linked below) and in `issues/`; this section
describes the **current** architecture.

### Product domain modules (PRODUCT graph)

The Workbench product code is responsibility-named and carries no proof markers
or issue-numbered identifiers. Core domains:

| Module | Responsibility |
| --- | --- |
| `compiler-context.ts` | process-wide compiler + initial-preview iframe context; exposes `registerContextSetup` so proof-only closures can inject without the product linking them |
| `live-preview.ts` | `runLivePreviewInPage` — the embedded Run flow (compile → mount sandboxed opaque-origin iframe → load → mount Content before start → start → cooperative stop) |
| `lifecycle-controller.ts` | neutral run/stop/restart state machine (`createRunStopController`, `PreviewLifecycleState`) |
| `run-stop.ts` | wires the Run/Stop buttons to the lifecycle controller |
| `first-run-warning.ts` | ADR-0003 non-yielding first-run warning modal + per-folder acknowledgement client |
| `theme-controller.ts`, `monaco-editor.ts`, `problems-panel.ts`, `output-panel.ts`, `dirty-state.ts`, `project-manager.ts`, `preview-panel.ts`, `project-content.ts`, `preview-frame.ts` | the responsibility-named Workbench UI/preview modules |

`app.ts` imports only these domain modules. `check-profile-artifacts.mjs`
hard-fails if any issue-numbered or `proof-*` module appears in the PRODUCT
Rollup graph, and asserts the domain modules are present (so the split is proven
real, not a dead re-export).

### Proof harness (PROOF graph only)

The proof profile adds exactly **eight** durable, responsibility-named scenario
suites, each exposing a single entrypoint dispatched by `entry.proof.ts` through
the shared `scenario-runner.ts` driver:

| Scenario module | Durable scenario | Absorbed sub-proofs |
| --- | --- | --- |
| `proof-compile-run-stop.ts` | compile → Run → Stop → rerun | 021/023/024/025/030 |
| `proof-compiler-diagnostics.ts` | compiler diagnostics + policy rejection | 022/031/032 |
| `proof-runtime-exception.ts` | runtime exception + portable-PDB mapping | 029 |
| `proof-output.ts` | managed / native output capture | 027/028 |
| `proof-content.ts` | texture / audio content workflow | 039/040 |
| `proof-preview-security.ts` | embedded preview security boundary | 033/034/035/036 |
| `proof-project-lifecycle.ts` | project open/save/dirty-state/identity + first-run | project-lifecycle feature tests + 037 |
| `proof-performance.ts` | performance + memory | 041 |

Supporting proof-only modules (also PROOF-graph only): `scenario-toolkit.ts`
(the shared packaged-runtime / persistent-compiler / embedded-preview toolkit,
imported by all eight scenarios), `scenario-runner.ts`, and the proof
controllers `scenario-load-controller.ts` / `scenario-run-controller.ts`. None
carries an issue-numbered filename. The checker requires exactly the eight
`proof-*` scenario modules in PROOF and rejects any unexpected `proof-*` module.

Feature tests that consolidate historical identity/open/dirty-state coverage
live in `project-lifecycle.test.ts`; content/audio validation feature tests live
in `content-validation.test.ts` and `audio-content.test.ts` (with the committed
`audio-content-fixture.ts` / `audio-content-contract.ts`). These run under
`node --test` and are not part of either Vite entry graph.

### Canonical packaged verification path

`scripts/prove-scenarios-macos.sh` orchestrates the eight scenarios by name,
internally translating each to the packaged proof Rust env gates
(`MONOGAME_ISSUE0xx_PROOF...`) and report keys (`ISSUE0xx_REPORT=`), which are
retained deliberately as the proof protocol. `prove-packaged-offline-macos.sh`
proves offline rendering + trusted input by running the durable embedded content
sub-proof under a process-scoped `(deny network*)` sandbox; it is bounded and
fail-clean and never alters system networking.

Historical stage detail and verification matrices remain in
[`stage4-proof-consolidation.md`](stage4-proof-consolidation.md),
[`stage5-issue038-retirement.md`](stage5-issue038-retirement.md),
[`stage6-proof-binary-separation.md`](stage6-proof-binary-separation.md), and
[`stage7-final-architecture.md`](stage7-final-architecture.md).

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

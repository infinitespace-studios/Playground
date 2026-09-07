# Produce native desktop packages for macOS, Windows, and Linux via GitHub Actions

**Type:** AFK
**Status:** Ready
**Blocked by:** [048-navigate-problems-rows-to-editor-markers.md](048-navigate-problems-rows-to-editor-markers.md), [049-show-output-and-runtime-failures.md](049-show-output-and-runtime-failures.md), [050-save-scratch-project-with-dirty-state-protection.md](050-save-scratch-project-with-dirty-state-protection.md), [051-open-folder-edit-multiple-files-persist-manifest.md](051-open-folder-edit-multiple-files-persist-manifest.md), [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md)
**PRD references:** 18, 22.5, 24 (Phase 5)
**User stories:** US7, US8
**Triage:** needs-triage

## Context

PRD section 18 requires the installed application to work without an internet connection, bundling all frontend/Monaco/.NET WebAssembly runtime/Roslyn/compiler-reference/MonoGame/native-WASM/example assets, with no runtime dependency loaded from a CDN. Section 22.5 requires packaging to define supported OS versions, CPU architectures, and (on Windows) the minimum WebView2 version. Section 24's Phase 5 ("Product hardening") lists packaging and release automation as deliverables.

This issue is the first packaging-for-release issue. Rather than a single hand-built Windows ZIP (its earlier scope), it establishes **reproducible CI-based release automation**: a GitHub Actions workflow that builds the full Workbench application (issues 45–52, not the early spike) and produces the selected shell's **native package for each of the three desktop platforms** — macOS, Windows, and Linux. The desktop shell is Tauri (ADR [0001](../docs/adr/0001-desktop-shell-selection.md)), whose bundler natively emits `.dmg`/`.app` (macOS), `.msi`/`.exe` NSIS (Windows), and `.deb`/`.AppImage` (Linux). Installer hardening, code-signing, third-party notices and SBOM are issue 54; a pristine clean-machine verification pass is issue 55. This issue delivers the automated multi-platform build and the artifacts it produces.

## What to build

A GitHub Actions workflow (under `.github/workflows/`) that, on demand (`workflow_dispatch`) and on release tags (`push` of `v*` tags), runs the complete Release build pipeline — MonoGame native/WASM artifacts, the compiler and preview WASM projects, the Workbench frontend, and the Tauri shell — on a build matrix covering macOS, Windows, and Linux, **each for both x64 (`x86_64`) and arm64 (`aarch64`) CPU architectures** (six platform/arch bundles total), and uploads each one's native installer/bundle as a workflow artifact (and, on tag builds, attaches them to a GitHub Release). Also document the supported OS versions, CPU architectures, and minimum WebView2 version in `docs/release-support-matrix.md`.

## Scope

### In scope

- One or more workflow files under `.github/workflows/` (e.g. `release.yml`) that:
  - Trigger on `workflow_dispatch` and on `push` of tags matching `v*`.
  - Check out the repository **recursively** (the `external/MonoGame` submodule is required — see issue 2).
  - Provision the pinned toolchain per `docs/toolchain-manifest.json`: .NET SDK (`9.0.315` with the `wasm-tools` workload — used for all builds including MonoGame), Node.js (`v26.x`), the Rust toolchain (`1.98.0` stable) with the per-OS Tauri target, emsdk (`3.1.56`) laid out as the sibling `../emsdk` the build scripts expect (issue 3), and the Linux system libraries Tauri needs (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`, `libayatana-appindicator3-dev`, etc.).
  - Build and hash-verify the MonoGame WASM artifacts once (`scripts/build-monogame.sh` → `scripts/verify-monogame-artifacts.sh`, issues 4–5) and make them available to each platform leg (a shared upstream job that uploads the verified `artifacts/monogame` output, consumed by the three platform legs, is preferred over rebuilding the platform-independent WASM three times).
  - Stage the offline assets and build the frontend (`npm --prefix src/frontend run build`, which runs `stage:monogame`/`stage:compiler`/`stage:preview` then `vite build`), publishing the compiler and preview WASM projects in Release as those staging steps require.
  - Build the Tauri shell for each platform **and each of x64 and arm64** (via `tauri build --target <triple>`, e.g. through `tauri-apps/tauri-action` or a pinned `@tauri-apps/cli`/`cargo tauri build` invocation) on a matrix producing all six bundles: macOS `aarch64-apple-darwin` + `x86_64-apple-darwin`, Windows `x86_64-pc-windows-msvc` + `aarch64-pc-windows-msvc`, and Linux `x86_64-unknown-linux-gnu` + `aarch64-unknown-linux-gnu`. Prefer native arm64/x64 runners where available (e.g. `macos-14`/`macos-15` arm64 + `macos-13` x64; `ubuntu-24.04` + `ubuntu-24.04-arm`; `windows-latest` + `windows-11-arm`) and fall back to cross-compilation (adding the Rust target and, on Linux, a cross toolchain) only for arches without a runner.
  - Upload each platform's produced bundle(s) as named workflow artifacts (`actions/upload-artifact`), and on `v*` tag builds attach them to a GitHub Release (draft is acceptable).
- Setting `bundle.targets` (and required bundle metadata: publisher, category, icons if needed) in `src/desktop/src-tauri/tauri.conf.json` as necessary so the per-OS native bundles are actually emitted by `tauri build`.
- Dependency caching where it materially speeds the build (Cargo registry/git + target, npm, NuGet) without compromising the pinned-version guarantees.
- `docs/release-support-matrix.md` documenting, per platform **and per architecture (x64 + arm64)**: supported OS version(s), CPU architecture, and — for Windows — the minimum WebView2 runtime version; plus a note on which artifact format each platform/arch produces and whether it is built on a native runner or cross-compiled.
- Documentation of how to trigger the workflow and retrieve the artifacts (a short section in `docs/build.md` or `docs/release-support-matrix.md`).

### Out of scope

- Code signing / notarization of any platform's artifact (issue 54 documents the policy; actual signing needs certificates not available here).
- Installer hardening beyond the bundler's default output, third-party notices, and SBOM (issue 54).
- The rigorous pristine clean-machine/VM verification of install/launch/uninstall (issue 55).
- Publishing to any store or auto-update feed.
- Additional architectures beyond x64 and arm64 (e.g. 32-bit x86, armv7); x64 + arm64 on all three platforms is the required baseline.

## Implementation guidance

1. Read `docs/toolchain-manifest.json`, `docs/build.md`, and `docs/submodule-workflow.md` for the exact pinned versions and the sibling-`emsdk` requirement, and issues 2–5 for the MonoGame build/verify contract. Mirror those versions in the workflow rather than using floating `latest` where a version is pinned.
   - **Reference MonoGame's own CI**: before writing the MonoGame WASM build job, look at the upstream MonoGame repository's GitHub Actions workflows (`.github/workflows/` in the pinned submodule `infinitespace-studios/MonoGame`, branch `feature/openglnative` — and the mainline `MonoGame/MonoGame` workflows for comparison) to see exactly which system packages, .NET workloads, emsdk/Emscripten setup, and build steps they use to build the native/WASM runtime. Use that as the authoritative baseline for the dependencies our `build-monogame-wasm` job must install, and note any differences from our pinned toolchain in the workflow comments.
2. Structure the workflow as: (a) a `build-monogame-wasm` job on `ubuntu-latest` that checks out recursively, installs .NET + `wasm-tools` + emsdk `3.1.56` at `../emsdk`, sources `../emsdk/emsdk_env.sh`, runs `scripts/build-monogame.sh` and `scripts/verify-monogame-artifacts.sh`, and uploads `artifacts/monogame` as an artifact (the WASM runtime is CPU-arch-independent, so it is built once and shared by all six legs); (b) a `package` job whose `strategy.matrix` enumerates all six platform/arch combinations (`{ os, target, runner }` triples) that downloads the MonoGame artifact, installs the per-OS toolchain (including Linux WebKitGTK deps on the Ubuntu legs) and the matching Rust target, runs the frontend build (which stages compiler/preview/monogame and runs `vite build`), and then `tauri build --target <triple>`.
3. For the Tauri build step, prefer `tauri-apps/tauri-action` (it wires `tauri build`, artifact collection, and optional release upload) or invoke the pinned Tauri CLI directly; ensure `beforeBuildCommand` in `tauri.conf.json` still stages/builds the frontend, or run staging explicitly before the shell build. Confirm `bundle.active` is true and `bundle.targets` yields the intended per-OS formats.
4. Ensure the compiler/preview WASM publish steps the staging scripts depend on run in the job (inspect `src/frontend/scripts/stage-compiler.mjs` and `stage-preview.mjs` to see exactly what published output they expect, and add the corresponding `dotnet publish -c Release` invocations if the staging scripts do not perform them).
5. Add `docs/release-support-matrix.md`: a row per platform/arch (six total). For macOS state the minimum supported version and that the artifact is `.dmg`/`.app` for both `aarch64` (Apple Silicon) and `x86_64` (Intel); for Windows state Windows 10 21H2+/Windows 11, both x64 and arm64, the minimum WebView2 runtime version (check Tauri's WebView2 requirement), and that the artifact is `.msi` and/or NSIS `.exe`; for Linux state the baseline distro/WebKitGTK expectation for both x64 and arm64 and that the artifact is `.deb`/`.AppImage`. Note per row whether it is built on a native runner or cross-compiled.
6. Validate the workflow without waiting for a real tag: use `workflow_dispatch` to run it, or validate locally with a workflow linter (`actionlint`) and, where feasible, reproduce the per-OS build commands locally on this macOS development machine (at minimum the macOS leg end-to-end) to confirm the sequence of commands is correct before relying on CI.
7. Keep the pinned-toolchain guarantees: do not silently upgrade .NET/Node/Rust/emsdk versions away from the manifest; if a runner forces a newer version, record the deviation in `docs/release-support-matrix.md`.

## Acceptance criteria

- [ ] A GitHub Actions workflow under `.github/workflows/` triggers on `workflow_dispatch` and on `push` of `v*` tags, checks out the MonoGame submodule recursively, and provisions the pinned .NET/Node/Rust/emsdk toolchain.
- [ ] The workflow builds and hash-verifies the MonoGame WASM artifacts (issues 4–5) and builds the full Workbench frontend + compiler + preview WASM in Release.
- [ ] The workflow builds the Tauri shell on a matrix of macOS, Windows, and Linux, **each for x64 and arm64 (six bundles)**, and uploads each platform/arch native bundle as a workflow artifact; on `v*` tags the artifacts are attached to a GitHub Release.
- [ ] `src/desktop/src-tauri/tauri.conf.json` `bundle.targets`/metadata are configured so each OS's native package format is emitted.
- [ ] `docs/release-support-matrix.md` documents each platform/arch combination's supported OS version(s), CPU architecture (x64 + arm64), artifact format, and (Windows) minimum WebView2 version.
- [ ] The workflow file passes `actionlint`, and the build command sequence is confirmed correct on at least the macOS leg (reproduced locally or via a successful `workflow_dispatch` run).

## Verification

The verifier must confirm the workflow is well-formed and that its build sequence actually produces native bundles, not merely that a YAML file exists:

1. Run `actionlint` against the new workflow file(s) and confirm no errors.
2. Inspect the workflow and confirm: recursive submodule checkout; pinned toolchain versions matching `docs/toolchain-manifest.json`; the MonoGame build+verify step; the frontend/compiler/preview Release build; the `tauri build --target <triple>` step for all six platform/arch legs (macOS x64+arm64, Windows x64+arm64, Linux x64+arm64); artifact upload; and tag-triggered release attachment.
3. Confirm the build sequence is correct by either (a) triggering the workflow via `workflow_dispatch` on a branch and observing the matrix legs produce and upload native bundles, recording the run URL and the artifact names/sizes, **or** (b) reproducing the full command sequence locally for at least the macOS arm64 leg (`scripts/build-monogame.sh` → verify → frontend build → `tauri build --target aarch64-apple-darwin`) and confirming a `.dmg`/`.app` is produced, recording the produced bundle path and size, and documenting that the remaining legs share the identical staged inputs and differ only in the `tauri build` target/host.
4. Confirm `docs/release-support-matrix.md` exists and states the per-platform/per-arch OS/arch/format/WebView2 facts for all six combinations.

Record the exact evidence (actionlint output, the CI run URL with per-leg artifact names/sizes or the local macOS bundle path/size, and the support-matrix contents) in the Verification record.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `ci: build native macOS/Windows/Linux desktop packages via GitHub Actions`

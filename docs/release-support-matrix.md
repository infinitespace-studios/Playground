# Release support matrix

This document records the operating systems, CPU architectures, native package
formats, and (on Windows) the minimum WebView2 runtime that the automated
release build (`.github/workflows/release.yml`, issue 053) targets. The desktop
shell is Tauri (ADR [0001](adr/0001-desktop-shell-selection.md)); the values
below follow Tauri v2's own platform requirements. Where a figure must be
confirmed against upstream before a public release it is marked _(confirm)_.

## Supported platforms

The release workflow produces **six** native bundles — each of macOS, Windows,
and Linux for both x64 (`x86_64`) and arm64 (`aarch64`):

| Platform | Arch | Runner (host) | Build | Artifact format | Min OS | Web runtime |
| --- | --- | --- | --- | --- | --- | --- |
| macOS | arm64 (Apple Silicon) | `macos-latest` | native | `.dmg` + `.app` | macOS 10.13+ | WKWebView (OS-provided) |
| macOS | x64 (Intel) | `macos-latest` | cross-compiled (arm64 host → `x86_64-apple-darwin`) | `.dmg` + `.app` | macOS 10.13+ | WKWebView (OS-provided) |
| Windows | x64 | `windows-latest` | native | `.msi` (WiX) + `.exe` (NSIS) | Windows 10 21H2+ / Windows 11 | WebView2 Runtime (Evergreen) |
| Windows | arm64 | `windows-11-arm` | native | `.msi` (WiX) + `.exe` (NSIS) | Windows 11 arm64 | WebView2 Runtime (Evergreen) |
| Linux | x64 | `ubuntu-24.04` | native | `.deb` + `.AppImage` | Ubuntu 22.04+ / equivalent (WebKitGTK 4.1) | WebKitGTK 4.1 |
| Linux | arm64 | `ubuntu-24.04-arm` | native | `.deb` + `.AppImage` | Ubuntu 22.04+ / equivalent (WebKitGTK 4.1) | WebKitGTK 4.1 |

> Sources: Tauri v2 [Webview Versions](https://v2.tauri.app/reference/webview-versions/)
> and [Prerequisites](https://v2.tauri.app/start/prerequisites/). Tauri v2's WebView2
> technically supports Windows 7+, and WKWebView has shipped since macOS 10.10; the
> floors above are this product's chosen support baseline (per PRD §22.5), not the
> absolute technical minimums.

## Platform notes

### macOS

- Both slices are built on `macos-latest` (an Apple-Silicon host). The Intel
  (`x86_64-apple-darwin`) slice is produced by cross-compilation via the Rust
  target, which is installed by the toolchain step; no separate Intel runner is
  used.
- The minimum macOS version is Tauri v2's baseline (macOS 10.13). WKWebView
  itself has been an OS-provided, auto-updated core component since macOS 10.10,
  but unsupported macOS versions do not receive WebKit updates. If a specific
  floor is required, pin it in `tauri.conf.json`
  (`bundle.macOS.minimumSystemVersion`).
- Rendering uses the OS-provided WKWebView; there is no bundled web runtime.
- These bundles are **unsigned and un-notarized** here — signing/notarization is
  issue 054. Unsigned `.app`/`.dmg` bundles trigger Gatekeeper warnings on end-
  user machines until that work lands.

### Windows

- x64 builds natively on `windows-latest`; arm64 builds natively on
  `windows-11-arm`. Confirm `windows-11-arm` runner availability for the
  repository's plan/org before relying on the arm64 leg; if unavailable, fall
  back to cross-compiling `aarch64-pc-windows-msvc` from the x64 runner.
- Supported OS: Windows 10 version 21H2 and later, and Windows 11. arm64
  packages target Windows 11 on Arm. (Tauri's WebView2 technically runs on
  Windows 7+, but 21H2 is this product's chosen baseline.)
- **WebView2 runtime** is required. Windows 11 ships it in-box; on older Windows
  the Tauri-generated installer ensures the Evergreen runtime is present
  (`bundle.windows.webviewInstallMode`); the chosen mode is finalized in issue
  054's installer hardening.
- Both installer formats (`.msi` via WiX and `.exe` via NSIS) are emitted;
  issue 054 decides which is the primary distributed installer.

### Linux

- x64 builds natively on `ubuntu-24.04`; arm64 builds natively on
  `ubuntu-24.04-arm`.
- Runtime dependency is **WebKitGTK 4.1** (`libwebkit2gtk-4.1`), so the baseline
  is distributions providing it — Ubuntu 22.04+/24.04, Debian 12+, and
  equivalents. The `.deb` declares its dependencies; the `.AppImage` bundles
  more of them but still relies on a compatible host GLIBC/WebKitGTK.
- Building the bundles requires the Tauri system dependencies
  (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`, `patchelf`,
  `libayatana-appindicator3-dev`), installed by the workflow on the Ubuntu legs.
- The release binary embedded in both the `.deb` and the `.AppImage` is stripped
  (`[profile.release] strip = true`), and the packaged frontend excludes the
  obsolete top-level browser demo payload, precompressed `.gz`/`.br` sidecars,
  and unused Roslyn localization satellites (see `docs/build.md` “Final payload
  policy”). All emitted formats are
  measured against the 100 MiB target individually; CI evidence (not this local
  macOS run) is the source of truth for the Linux package sizes.

## Architecture policy

x64 and arm64 are the supported baseline on all three platforms. Additional
architectures (32-bit x86, armv7, etc.) are out of scope. The
CPU-architecture-independent MonoGame WebAssembly runtime is built once (on
Linux) and shared by all six legs; only the Tauri shell differs per
platform/arch.

## Pinned toolchain

Per [`docs/toolchain-manifest.json`](toolchain-manifest.json), the release
workflow provisions: .NET SDK 9.0.315 (with the `wasm-tools` workload; used for
all builds including MonoGame), Node.js v26.x, Rust 1.98.0 (plus the per-target
Rust target), and Emscripten 3.1.56 (laid out as the sibling `../emsdk` the
build scripts require). The full MonoGame build additionally provisions Wine and
system fonts via MonoGame's own `install-wine@v1.0.3` / `install-fonts@v1.0.3`
composite actions, because MGFXC (the effect/shader compiler) needs Wine on
non-Windows hosts.

## How to produce a release

The workflow (`.github/workflows/release.yml`) runs on:

- **`workflow_dispatch`** — trigger manually from the Actions tab to build all
  six bundles and upload them as workflow artifacts.
- **Push to `main`** — builds all six bundles and uploads them as workflow
  artifacts (no GitHub Release is created).
- **Push of a `v*` tag** (e.g. `v0.1.0`) — builds all six bundles, uploads them
  as workflow artifacts after their gates pass, and attaches them to a **draft**
  GitHub Release during the build step. The draft must not be published unless
  every matrix leg finishes green.

Each platform/arch bundle is uploaded as a separate artifact named
`monogame-playground-<platform>-<arch>` (e.g. `monogame-playground-linux-arm64`).

### Per-artifact release gates

Each package leg runs, after staging `dist/` and before upload:

- **Rust gates** — `cargo clippy --all-targets` (PRODUCT) on every leg and
  `cargo test` on the host-native legs (the cross-compiled macOS x64 leg builds
  its tests but does not run them).
- **Binary command-inventory** — the freshly built product executable/bundle
  carries exactly the eight product commands and zero proof surface.
- **Package-size gate** (`scripts/measure-release-size.mjs`) — resolves this
  platform's package format(s) (`.dmg`/`.msi`/`.exe`/`.deb`/`.AppImage`/`.rpm`),
  verifies the staged dist is the PRODUCT profile and the content fixtures are
  present. The 100 MiB acceptance applies to **each** distributed package: when a
  leg produces multiple formats (notably Linux `.deb` + `.AppImage`, and `.rpm`
  where Tauri emits it), every recognised package is measured and checked
  individually and any single one over 100 MiB fails closed. The gate never
  selects only the smallest artifact, so a small `.deb` cannot mask an oversized
  supported `.AppImage`/`.rpm`.
- **Bounded product smoke** (`scripts/smoke-product.mjs`) — refuses any proof
  env/profile, verifies product identity, and runs a launch/no-immediate-crash
  check. Because robust GUI readiness needs a real display/window server, the
  full launch runs on the host-native macOS arm64 leg (WKWebView + window
  server). The cross-compiled macOS x64, Windows, and Linux legs run
  identity/profile checks only because native GUI execution is not guaranteed
  there, which is documented honestly rather than faking Run/Stop automation.

A `workflow_dispatch` input `run_proof_acceptance` enables an opt-in
`proof-acceptance` job (macOS): it stages the PROOF frontend, runs the PROOF
`cargo clippy`/`cargo test`, builds the `--features proof-harness` package, drives
the eight packaged scenarios via `scripts/prove-scenarios-macos.sh`, and runs the
PROOF binary inventory. It is off by default so normal pushes/tags do not pay for
the long packaged scenarios.

## Not yet covered (later issues)

- Code signing / notarization (macOS) and Authenticode signing (Windows) —
  **issue 054**. Until then all artifacts are unsigned.
- Installer hardening, third-party notices, and SBOM — **issue 054**.
- Pristine clean-machine install/launch/uninstall verification — **issue 055**.
- Per-platform offline-launch verification in CI — deferred (see issue 053
  discussion).

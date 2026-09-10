# MonoGame Desktop Playground

An interactive desktop learning workbench for MonoGame. Edit C# on the left,
Run, and watch your game render in an embedded preview on the right — no project
files, no build pipeline, no second window.

## What it is

MonoGame Playground is a Tauri desktop application that pairs a Monaco-based C#
editor with an in-app MonoGame **Web** runtime. You write a `Game` subclass,
press **Run**, and the app compiles your code in-process (Roslyn on WebAssembly),
transfers the compiled assembly over a validated in-page protocol, and starts it
inside an **embedded, opaque-origin sandboxed iframe** in the preview panel.

Content (textures and sounds) placed under a project's `Content/` folder is
discovered, validated, and mounted into the runtime's virtual filesystem before
the game starts. See [`docs/content-workflow.md`](docs/content-workflow.md).

## Architecture at a glance

- **Editor / Workbench** (`src/frontend`) — TypeScript + Monaco UI: editor,
  Problems and Output panels, project management, Run/Stop lifecycle, and the
  embedded preview panel. Built with Vite.
- **Compiler** (`src/compiler`) — a Roslyn-based C# → WebAssembly compiler that
  runs in-app and enforces the supported-API policy
  ([`docs/supported-api-policy.md`](docs/supported-api-policy.md)).
- **Preview** (`src/preview`) — the MonoGame Web runtime that mounts content,
  loads the user assembly, and runs the game inside the sandboxed iframe.
- **Desktop shell** (`src/desktop/src-tauri`) — the Tauri (Rust) host: window,
  custom `playground-preview:` asset protocol, first-run acknowledgement store,
  workspace/project file dialogs, and the least-privilege capability boundary.
- **Shared runtime** (`src/shared`) — protocol validation, message contracts,
  and binary-transfer integrity shared by editor and preview.

The production preview is the embedded opaque-origin iframe defined by
[ADR 0003](docs/adr/0003-embedded-preview-and-non-yielding-code.md). It is a
defence-in-depth boundary (sandbox + CSP + protocol validation + IPC denial),
not a complete sandbox for hostile code; synchronous code that never yields can
freeze the preview and editor. See
[`docs/security-model.md`](docs/security-model.md).

## Build profiles: PRODUCT vs PROOF

The app builds under one of two **compile-time** profiles:

- **PRODUCT** (default) — the shipping Workbench. Normal `npm`, Tauri, and
  release builds select it. It contains no proof instrumentation, no
  issue-numbered implementation modules, and only the eight responsibility-named
  Tauri commands.
- **PROOF** — an explicit test harness that adds per-scenario instrumentation.
  It requires **both** the `MONOGAME_FRONTEND_PROFILE=proof` frontend profile
  **and** the non-default `proof-harness` Cargo feature. PROOF exists only to
  drive the eight durable proof scenarios; it never ships.

Full details: [`docs/build.md`](docs/build.md). Release scope:
[`docs/release-support-matrix.md`](docs/release-support-matrix.md). Contributor
guidance: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Quick start (development)

Prerequisites (see [`docs/build.md`](docs/build.md) for exact pins): .NET SDK,
the WebAssembly workload, an Emscripten checkout at `../emsdk`, Node.js, and a
Rust toolchain for the Tauri shell.

```bash
# Stage the .NET compiler/preview assets and run the product dev server
npm --prefix src/frontend run dev

# Package the desktop app (PRODUCT by default)
npm --prefix src/desktop run tauri -- build
```

## Repository layout

| Path | Contents |
| --- | --- |
| `src/frontend` | Workbench UI, proof scenarios, staging + profile checkers |
| `src/compiler` | Roslyn→WASM compiler and its harness |
| `src/preview` | MonoGame Web preview runtime |
| `src/desktop` | Tauri desktop shell (Rust) |
| `src/shared` | Shared protocol/contract runtime |
| `docs` | Architecture (ADRs), build, security, content, release docs |
| `issues` | Historical issue records (durable requirements + evidence) |
| `scripts` | Build, staging, verification, package-size, and product-smoke scripts |

## Continuous integration

- `.github/workflows/quality.yml` (PR + push) runs the fast, clean-clone gate:
  frontend typecheck + focused tests, performance-tooling tests, the tool
  self-tests (staged-asset guard, binary command-inventory, package-size gate,
  product smoke), shell syntax/static tests, and `cargo fmt --check`.
- `.github/workflows/release.yml` builds the MonoGame runtime once and the six
  product bundles, then runs the asset-dependent Rust gates and, per freshly
  built artifact, the binary-inventory, package-size, and bounded product-smoke
  gates. See [`docs/build.md`](docs/build.md) and
  [`docs/release-support-matrix.md`](docs/release-support-matrix.md).

## License

See [`LICENSE`](LICENSE).

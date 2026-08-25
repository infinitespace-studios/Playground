# Create minimal Tauri desktop shell

**Type:** AFK
**Status:** Done
**Blocked by:** [001-record-pinned-toolchain-manifest.md](001-record-pinned-toolchain-manifest.md)
**PRD references:** 9.2, 20.1
**User stories:** US7
**Triage:** needs-triage

## Context

PRD section 9.2 states the preferred initial desktop shell is Tauri, chosen for its TypeScript frontend, smaller package size than Electron, local filesystem support, use of the platform WebView, and no requirement for an installed .NET SDK. Section 20.1 requires the feasibility spike to package a TypeScript frontend through Tauri. This is the first issue that creates any frontend/desktop-shell code; nothing under `src/` exists yet. This issue only creates the empty shell scaffold (window, blank page, dev/build scripts) — it does not yet render MonoGame content (that is issue 7) or handle protocol/MIME concerns (issue 8).

## What to build

Scaffold a minimal Tauri v2 application at `src/desktop/` with a trivial TypeScript/HTML frontend at `src/frontend/` that displays a static placeholder page ("MonoGame Playground shell OK") inside the Tauri window, builds in Release mode, and launches as a native window with no MonoGame or Roslyn integration yet.

## Scope

### In scope

- `src/desktop/src-tauri/` (Cargo project, `tauri.conf.json`, minimal `main.rs`)
- `src/desktop/package.json` wiring `tauri dev` / `tauri build`
- `src/frontend/` minimal static HTML/TS placeholder page and its own `package.json`/bundler config
- Recording the installed Tauri CLI and Rust toolchain versions back into `docs/toolchain-manifest.json`'s `shell` section

### Out of scope

- Rendering the MonoGame web example (issue 7)
- Custom protocol/MIME handling (issue 8)
- Any Roslyn/compiler integration
- Monaco editor (issue 45)

## Implementation guidance

1. Verify prerequisites: `cargo --version`, `rustc --version`, and either `cargo install tauri-cli` or a project-local `@tauri-apps/cli` via `npm`. Record the exact versions found.
2. Scaffold: `npm create tauri-app@latest` is an acceptable starting point run inside `src/desktop/`, but the output must be relocated/renamed to match the repository layout in PRD section 10: the frontend lives in `src/frontend/`, the Tauri Rust project in `src/desktop/src-tauri/`, with `src/desktop/package.json` as the shell-level npm project referencing `../frontend` as its web assets via `tauri.conf.json`'s `build.frontendDist` (or `distDir` depending on Tauri version).
3. Configure `src-tauri/tauri.conf.json`: window title "MonoGame Playground", fixed reasonable default size (e.g. 1280x800), `app.security.csp` left at a safe default for now (issue 33 will tighten this later — do not disable it).
4. Frontend placeholder: a single `src/frontend/index.html` with a heading and a `<div id="status">MonoGame Playground shell OK</div>`; no framework is required for this issue.
5. Build Release: `cd src/desktop && npm install && npm run tauri build -- --config '{"bundle":{"active":true}}'` or the project's equivalent script; confirm a native bundle is produced (`.app`, `.dmg`, `.exe`, `.msi`, or platform-appropriate output under `src-tauri/target/release/bundle/`).
6. Update `docs/toolchain-manifest.json`'s `shell` object with `{"kind": "tauri", "tauriCli": "<version>", "rustToolchain": "<rustc --version output>"}` and `frontend.nodeVersion`/`frontend.packageManager` with `node --version` and the package manager used.

## Acceptance criteria

- [ ] `src/desktop/src-tauri/tauri.conf.json` and `src/frontend/index.html` exist
- [ ] `npm run tauri dev` (or documented equivalent) launches a native window showing the placeholder text
- [ ] A Release build succeeds and produces a native bundle artifact under `src-tauri/target/release/bundle/`
- [ ] `docs/toolchain-manifest.json`'s `shell` and `frontend` sections are filled with real, non-placeholder version strings

## Verification

```bash
cd src/desktop
npm install
npm run tauri build
ls -la src-tauri/target/release/bundle
```
Expect a successful build and at least one platform bundle file. Manually launch the produced binary (or `npm run tauri dev` if a GUI session is available) and visually confirm the window shows "MonoGame Playground shell OK". Since this may run in a headless CI-like environment, if a GUI cannot be opened, the verifier must at minimum confirm the Release build succeeds and inspect the bundled `index.html` inside the produced artifact to confirm it contains the placeholder text, and note in the verification log that interactive launch was not exercised.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background verifier `e9a73c20-c4ef-4e04-a985-39019057db10`
- **Date:** 2026-08-25
- **Evidence:** Lockfile-respecting `npm ci` completed for frontend and desktop, followed by successful `npm run tauri build`. Release output produced `MonoGame Playground.app` and a 2,610,079-byte arm64 DMG. Independent GUI launch and screenshot showed exact `MonoGame Playground shell OK` text; launched PID was terminated and confirmed gone. Tauri v2 config parsed, CSP remained restrictive, frontendDist resolved to `src/frontend/dist`, and manifest versions matched Node `v26.3.0`, npm `11.16.0`, rustc `1.98.0`, and Tauri CLI `2.11.4`. Scope contained no MonoGame, Roslyn, or issue 007 work.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `desktop: scaffold minimal Tauri shell with placeholder frontend`

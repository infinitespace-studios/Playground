# Render existing MonoGame web example inside Tauri

**Type:** AFK
**Status:** Ready
**Blocked by:** [005-hash-verify-monogame-wasm-artifacts.md](005-hash-verify-monogame-wasm-artifacts.md), [006-create-minimal-tauri-desktop-shell.md](006-create-minimal-tauri-desktop-shell.md)
**PRD references:** 9.4, 20.1, 19
**User stories:** US7
**Triage:** needs-triage

## Context

PRD section 9.4 identifies `external/MonoGame/Example/Example.Web.csproj` as the reference implementation to build the game runtime from. Section 20.1 (feasibility spike) requires the frontend to display the MonoGame web preview, and critical feasibility question 1 (section 19) asks whether the existing MonoGame web example can run inside the packaged candidate desktop shell. This issue is the first real proof point of the entire product: it loads the already-built (issue 4/5) MonoGame WASM example inside the Tauri shell scaffolded in issue 6, replacing the placeholder page with an actual `#canvas` element and the Emscripten-generated JS loader.

## What to build

Copy the verified `artifacts/monogame/` example build output (from issues 4 and 5) into the Tauri frontend's served assets, add an HTML page with exactly one `id="canvas"` element (per PRD 13.4), load the Emscripten glue JS, and confirm the MonoGame `Example.Web` game renders inside the Tauri window without a development server.

## Scope

### In scope

- Serving the built example's `.wasm`/JS/assets from `src/frontend/` (or a subfolder loaded by it)
- One `<canvas id="canvas">` element per PRD 13.4
- Wiring Tauri to load this page as its main window content instead of the issue 6 placeholder
- Confirming rendering with no dev server (static file load through Tauri's asset protocol)

### Out of scope

- Custom protocol/MIME correctness proof (issue 8 — for this issue, using Tauri's default asset serving is acceptable if it happens to work; issue 8 formalizes and hardens it)
- Input/audio/resize proofs (issues 9-11)
- Offline/network-disabled proof (issue 12)

## Implementation guidance

1. Confirm `artifacts/monogame/` (from issue 4) contains a working static web build of `external/MonoGame/Example/Example.Web.csproj` — if the staged artifacts are only raw framework binaries rather than a runnable example page, first build the Example project itself for Web via its own publish path (inspect `external/MonoGame/Example/Example.Web.csproj` for its publish target, likely `dotnet publish -c Release` targeting `browser-wasm`) and stage that output too, e.g. into `artifacts/example-web/`.
2. Copy the example's published `wwwroot`-equivalent output into `src/frontend/public/example/` (create this path) so Tauri's bundler includes it as a static asset.
3. Replace `src/frontend/index.html`'s placeholder body with a page that includes the example's generated `index.html` structure (or embed its `<canvas id="canvas">` and script tags directly), keeping exactly one element with `id="canvas"`.
4. Rebuild via `cd src/desktop && npm run tauri build` and also try `npm run tauri dev` for faster iteration.
5. Launch the built app and visually confirm the MonoGame example renders (e.g. a colored clear screen or the example's default scene) with no `localhost` dev-server URL involved — the window must load via Tauri's `tauri://` or configured asset protocol, not `http://localhost`.

## Acceptance criteria

- [ ] The Tauri window renders the MonoGame `Example.Web` scene (not a blank canvas or JS error) when launched from a Release build
- [ ] The page contains exactly one element with `id="canvas"`
- [ ] No `http://localhost` development server is involved in loading the working build
- [ ] Browser/WebView devtools console (if accessible) shows no unhandled JS exceptions during load

## Verification

Build and launch:
```bash
cd src/desktop
npm run tauri build
```
Then run the produced native binary directly (not via `npm run tauri dev`, to prove no dev server is required) and visually confirm rendering. If devtools are available in the WebView (Tauri allows opening them in debug builds), capture the console output and confirm no errors. The verifier must record a screenshot or explicit visual description of what rendered, plus confirmation that the launched process was the packaged binary path (e.g. `src-tauri/target/release/<app-binary>`), not a dev-server URL.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `desktop: render MonoGame web example inside Tauri shell`

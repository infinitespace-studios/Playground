# Serve packaged WASM with correct MIME/custom protocol

**Type:** AFK
**Status:** Ready
**Blocked by:** [007-render-monogame-web-example-in-tauri.md](007-render-monogame-web-example-in-tauri.md)
**PRD references:** 20.1, 19, 18
**User stories:** US7
**Triage:** needs-triage

## Context

Browsers and WebViews require the `.wasm` MIME type (`application/wasm`) to be served correctly for `WebAssembly.instantiateStreaming` to work, and Tauri's default asset protocol handling may not set this automatically for all file extensions. PRD section 20.1 requires the spike to work offline with no development server; critical feasibility question 2 (section 19) asks explicitly whether this works without a dev server; section 18 requires no runtime dependency to load from a CDN. This issue hardens the loading path proven in issue 7 by explicitly configuring Tauri's asset protocol (or a custom protocol handler) to serve `.wasm` with the correct MIME type and confirming the Emscripten module instantiates via the fast streaming path, not a slow ArrayBuffer fallback.

## What to build

Configure Tauri's asset protocol / custom protocol scheme so that `.wasm` files are served with `Content-Type: application/wasm`, and confirm `WebAssembly.instantiateStreaming` succeeds (not silently falling back to `WebAssembly.instantiate` with a manually fetched buffer, which several Emscripten runtimes do automatically but which the PRD wants proven explicitly for this shell).

## Scope

### In scope

- `src-tauri/tauri.conf.json` asset protocol / custom protocol MIME configuration
- A minimal Rust custom protocol handler in `src-tauri/src/main.rs` if Tauri's built-in asset protocol cannot set the MIME type for `.wasm`
- Confirming via WebView devtools or injected JS logging which instantiation path (`instantiateStreaming` vs buffer fallback) is used

### Out of scope

- Input/audio/resize (issues 9-11)
- Network-disabled proof (issue 12)
- Any compiler/preview protocol work (issues 15+)

## Implementation guidance

1. Inspect Tauri's current version docs for asset protocol MIME configuration (`tauri.conf.json` → `app.security.assetProtocol` or `plugins.fs`/custom scheme registration depending on Tauri v2 APIs) — use `context7`/vendor docs if available, otherwise inspect the `tauri` Rust crate source under `src-tauri/target` build cache or `~/.cargo/registry` for the asset protocol implementation to confirm default MIME mapping for `.wasm`.
2. If the default mapping is incorrect or absent, register a custom protocol (e.g. `app://`) in `src-tauri/src/main.rs` using `tauri::Builder::register_uri_scheme_protocol` (or the v2 equivalent) that reads files from the bundled example directory and explicitly sets `Content-Type: application/wasm` for `.wasm` requests and appropriate types for `.js`/`.html`/`.data`.
3. Add temporary diagnostic logging in the frontend (e.g. wrap the Emscripten module's instantiation call or check `response.headers.get('content-type')` before `WebAssembly.instantiateStreaming`) to prove which path executes; remove or gate this logging behind a debug flag before finishing, but keep at least a one-line `console.log` that reports success so a verifier can check devtools output.
4. Rebuild and relaunch; confirm no `instantiateStreaming` MIME-type warning/error appears (Chromium-based WebViews emit a specific warning like "response has unsupported MIME type" when this is wrong).

## Acceptance criteria

- [ ] A `.wasm` request served through the packaged app returns `Content-Type: application/wasm` (verified via devtools network panel or a logged header check)
- [ ] `WebAssembly.instantiateStreaming` is used successfully (no MIME-type fallback warning in the console)
- [ ] The example still renders correctly after this change (no regression from issue 7)
- [ ] No dev server or CDN URL is involved in loading any asset

## Verification

Launch the packaged Release build with WebView devtools enabled (Tauri supports opening devtools in debug/dev builds; if the Release build disables devtools, temporarily build a debug-config bundle for this verification only, then re-confirm the Release build still renders per issue 7's criteria). In devtools Network panel, inspect the `.wasm` request's response headers and confirm `content-type: application/wasm`. In the Console panel, confirm no MIME-type instantiation warning appears and the injected success log line is printed. The verifier must record the exact header value observed and the console log line.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `desktop: serve WASM assets with correct MIME via Tauri protocol`

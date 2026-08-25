# Run equivalent Electron spike if Tauri fails

**Type:** AFK
**Status:** Skipped
**Blocked by:** [007-render-monogame-web-example-in-tauri.md](007-render-monogame-web-example-in-tauri.md), [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md), [009-prove-input-in-packaged-preview.md](009-prove-input-in-packaged-preview.md), [010-prove-audio-activation-in-packaged-preview.md](010-prove-audio-activation-in-packaged-preview.md), [011-prove-preview-canvas-resize-in-packaged-shell.md](011-prove-preview-canvas-resize-in-packaged-shell.md), [012-prove-packaged-shell-works-offline.md](012-prove-packaged-shell-works-offline.md)
**PRD references:** 9.2, 20.1, 20.3
**User stories:** US7
**Triage:** needs-triage
**Conditional:** Execute this issue only if at least one mandatory Tauri criterion from issues 007-012 fails (per PRD section 20.3: Tauri cannot reliably provide required WebAssembly features, cannot support the required non-threaded runtime, or cannot satisfy required isolation/offline/packaging criteria). If all of issues 007-012 pass their acceptance criteria, mark this issue's status as Skipped (not Ready, not Blocked) in the README table and proceed directly to issue 014 citing only the Tauri results.

## Context

PRD section 9.2 states Electron may be used instead of Tauri if WebView compatibility, WebAssembly threading, WebGL, or custom protocol restrictions make Tauri impractical, and that Electron must be evaluated if Tauri cannot satisfy any mandatory Phase 1 isolation, lifecycle, WebAssembly, or packaging criterion. Section 20.3 requires that if Tauri is the only blocker, the complete spike must be repeated with Electron before abandoning the WebGL design, satisfying the same Release, offline, isolation, lifecycle, memory, and package criteria using Electron-equivalent IPC and privilege controls. This issue exists purely as a conditional fallback; do not begin it unless a specific Tauri failure has been documented from issues 007-012.

## What to build

Repeat the exact same spike performed in issues 006-012 (minimal shell, render MonoGame web example, correct MIME/protocol serving, input, audio, resize, offline) using Electron instead of Tauri, reusing the already-built `artifacts/monogame/` (or `artifacts/example-web/`) outputs, and produce the same category of pass/fail evidence for each criterion so issue 014's ADR can compare both shells directly.

## Scope

### In scope

- A new `src/desktop-electron/` scaffold (kept separate from `src/desktop/` so the Tauri spike remains intact for comparison) using Electron's `BrowserWindow` with a strict `webPreferences` configuration (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`)
- Repeating each of the issue 007-012 proofs under Electron
- A written comparison table (in this issue's own follow-up notes, e.g. `docs/electron-spike-results.md`) covering every criterion from issues 007-012

### Out of scope

- Deleting or replacing the Tauri scaffold
- Making the final shell selection decision (that is issue 014, HITL)
- Any playground-specific product code beyond the spike

## Implementation guidance

1. Confirm which specific Tauri criterion failed by reading the verification evidence/logs from whichever of issues 007-012 failed; document this explicitly at the top of `docs/electron-spike-results.md` before starting Electron work.
2. Scaffold `src/desktop-electron/` with a minimal `main.js` (Electron main process) creating a `BrowserWindow` with `webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }`, loading a local HTML file via `loadFile` (not `loadURL` pointing at a dev server).
3. Reuse the same static example assets already staged in `src/frontend/public/example/` from issue 7 (copy or reference them from the Electron project, do not rebuild MonoGame again).
4. Repeat each proof from issues 007-012 under Electron: correct `.wasm` MIME serving (Electron's `protocol.registerFileProtocol`/`registerBufferProtocol` or its default `file://` handling), input, audio activation, resize, and offline operation with networking disabled.
5. Package Electron in Release mode (e.g. via `electron-builder` or `electron-forge`) and repeat the packaged (non-dev-server) proof.
6. Write `docs/electron-spike-results.md` with one section per criterion (mirroring issues 007-012's acceptance criteria) stating PASS/FAIL and evidence for Electron, plus a final summary comparing Electron's results against the already-recorded Tauri results.

## Acceptance criteria

- [x] This issue is only executed if a documented Tauri failure exists from issues 007-012; if not, its status is recorded as Skipped with a citation of the passing Tauri results
- [ ] If executed, `docs/electron-spike-results.md` records PASS/FAIL evidence for every criterion equivalent to issues 007-012, under Electron
- [ ] The Electron `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`
- [ ] A packaged (non-dev-server) Electron build is produced and tested for at least the same rendering/offline criteria as the Tauri spike

## Verification

If skipped: the verifier confirms issues 007-012 all show PASS in their verification logs and records this issue as Skipped with links to that evidence. If executed: the verifier re-runs the same manual/automated checks described in issues 007-012's Verification sections but against the Electron build (`cd src/desktop-electron && npm run make` or equivalent, then launch the packaged binary), and cross-checks `docs/electron-spike-results.md` against their own observations before recording PASS/FAIL.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS (Skipped)
- **Verifier:** @dellis1972
- **Date:** 2026-08-25
- **Evidence:** Issues 007-012 all have independently verified PASS records. Tauri renders the packaged MonoGame Web example, serves WASM with the correct MIME type through its bundled asset protocol, routes the proven input cases, activates Web Audio after a trusted gesture, resizes without disrupting rendering, and operates under OS-enforced network denial. No mandatory Tauri shell criterion failed, so the conditional Electron spike was not triggered. The human decider approved Tauri on 2026-08-25.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `desktop: add conditional Electron spike results`

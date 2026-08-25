# Prove preview and canvas resize in packaged shell

**Type:** AFK
**Status:** Ready
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 13.4, 22.3, 19
**User stories:** US3
**Triage:** needs-triage

## Context

PRD section 13.4 notes the current WebGL backend assumes a hard-coded `#canvas` selector, and each preview iframe must contain exactly one `id="canvas"` element. Section 22.3 requires a rendering test for canvas resizing. Critical feasibility question 4 (section 19) includes resizing. This issue proves that resizing the packaged Tauri window (or the canvas's containing element) correctly resizes the WebGL back buffer without breaking rendering, using the Example project already proven to render in issues 7-8.

## What to build

Resize the packaged Tauri window at runtime and confirm the MonoGame canvas and its WebGL back buffer resize correctly and continue rendering without visual corruption, a black screen, or a JS exception.

## Scope

### In scope

- Manually or programmatically resizing the native Tauri window while the Example game runs
- Confirming the canvas element's CSS/backing-store size tracks the window size
- Confirming rendering continues correctly at at least two different sizes

### Out of scope

- Any permanent resize-handling product code (that belongs to later Workbench/preview-panel issues, e.g. issue 45/52)
- Changing MonoGame's canvas selector behavior (out of scope per PRD 13.4, deferred indefinitely)

## Implementation guidance

1. Launch the packaged Release build from issue 8.
2. Resize the native window manually (drag its edge/corner) or, if scripted resize is preferred for repeatability, use the Tauri window API (`appWindow.setSize(...)` from the frontend, callable via a temporary debug button or devtools console command) to set at least two distinct sizes, e.g. 800x480 and 1280x720.
3. After each resize, visually confirm the canvas fills its expected area and the rendered scene is not stretched/corrupted/blank.
4. Check the WebView devtools console for JS exceptions during/after resize (e.g. WebGL context errors).
5. If the canvas does not resize correctly (e.g. it stays at a fixed hard-coded resolution because the current MonoGame Web backend does not listen for container resize events), record this as a finding for the shell ADR (issue 14) rather than attempting a permanent fix here — this issue's job is to prove/disprove the behavior, not to implement resize handling.

## Acceptance criteria

- [ ] The packaged window can be resized to at least two distinct sizes while the Example game is running
- [ ] At each size, the canvas renders without corruption, blank frames, or WebGL context loss
- [ ] No JS exception appears in devtools during or after resize
- [ ] If resize does not work correctly, this is explicitly documented as a known limitation for the shell ADR (issue 14) rather than silently ignored

## Verification

Reproduce the resize steps above at two window sizes and capture screenshots or a precise visual description at each size, plus a devtools console transcript showing no errors. If resize behaves incorrectly, the verifier records PASS/FAIL against the more limited claim "resize behavior is correctly documented as a known limitation" rather than against "resize works", and this must be explicitly noted for issue 14's ADR review.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of preview/canvas resize behavior in packaged shell`

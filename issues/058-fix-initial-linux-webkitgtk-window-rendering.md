# Fix initial Linux WebKitGTK window rendering

**Type:** AFK
**Status:** Done
**Blocked by:** None
**PRD references:** 8, 22.5, 23
**User stories:** US1, US10
**Triage:** needs-verification

## Context

On a Raspberry Pi arm64 system, the installed PRODUCT `.deb` launched and could
compile and run the Cornflower Blue example, but the entire Workbench window was
garbled until the native window was resized. Resizing caused the whole window to
render correctly, indicating an initial WebKitGTK/GPU compositor surface problem
rather than a MonoGame preview-canvas or responsive-layout problem.

Launching the same installed package with:

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 monogame-playground
```

made the initial window render correctly. Tauri's Linux graphics guidance
recommends this environment variable for WebKitGTK graphics-driver conflicts.

## What to build

On Linux, set `WEBKIT_DISABLE_DMABUF_RENDERER=1` before Tauri initializes unless
the user has explicitly supplied a value. Do not change macOS or Windows startup,
and preserve an explicit Linux override for diagnostics or future driver fixes.

## Acceptance criteria

- [x] The workaround is Linux-only and executes before `monogame_playground_lib::run()` initializes Tauri/WebKitGTK.
- [x] An explicitly supplied `WEBKIT_DISABLE_DMABUF_RENDERER` value is preserved.
- [x] macOS and Windows startup code is unchanged.
- [x] A fresh Linux arm64 package launches on the affected Raspberry Pi with the complete Workbench correctly rendered before any resize.
- [x] Run renders Cornflower Blue and Stop/fresh Run continue to work after the workaround.

## Verification

1. Build/download a fresh Linux arm64 `.deb` containing this change.
2. Install it on the affected Raspberry Pi.
3. Launch normally from the desktop menu and from a terminal **without** manually setting `WEBKIT_DISABLE_DMABUF_RENDERER`.
4. Confirm the entire Workbench is correct on first paint, before resizing.
5. Run the default example, confirm Cornflower Blue, Stop, and Run again.
6. Optionally launch with `WEBKIT_DISABLE_DMABUF_RENDERER=0` and confirm the explicit override is not overwritten (diagnostic only).

## Verification record

- **Diagnostic verdict:** PASS
- **Verifier:** Product owner (human)
- **Date:** 2026-09-11
- **Evidence:** The previously garbled Raspberry Pi window rendered correctly on
  first launch when the installed PRODUCT application was started with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1`.
- **Packaged-fix verdict:** PASS
- **Verifier:** Product owner (human)
- **Date:** 2026-09-11
- **Evidence:** Installed the fresh Linux arm64 PRODUCT `.deb` on the affected
  Raspberry Pi and completed every verification step. Normal launch without a
  manually supplied environment variable rendered the complete Workbench
  correctly before any resize; Run rendered Cornflower Blue; Stop worked; and a
  subsequent Run started normally. No immediate regression was observed.
- **Clean-clone CI:** The quality and six-platform release workflows for
  `a7ddba2` passed at
  https://github.com/infinitespace-studios/Playground/actions/runs/34595795032
  and https://github.com/infinitespace-studios/Playground/actions/runs/34595795026.

## Commit gate

The implementation may be committed after independent source review and normal
Rust/CI checks. Do not mark this issue Done until the product owner verifies a
fresh Linux arm64 package on the affected Raspberry Pi without manually setting
the environment variable.

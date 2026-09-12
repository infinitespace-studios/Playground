# Add asset picker and drag-and-drop import workflows

**Type:** AFK
**Status:** Done
**Blocked by:** [065-add-secure-binary-asset-import-command.md](065-add-secure-binary-asset-import-command.md)
**Feature area:** Assets
**Triage:** feature-backlog

## Context

Issue 065 provides the bounded native copy primitive and issue 064 provides the asset rail. This slice exposes both an explicit picker and desktop drag/drop while keeping all destination decisions visible and conflict-safe.

## Scope

### In scope

- Add an `Import assets…` action using a native multi-file picker.
- Make the asset rail an accessible drop target for operating-system files.
- Map recognized types to visible default folders (`Textures`, `Audio`, and `Precompiled`); allow the user to confirm/change the Content-relative destination before writing.
- Import multiple files sequentially with per-file success/failure results; one failure must not misreport other files.
- Refresh the asset inventory from disk after completion.
- Surface unsupported type, limits, duplicate name, and native errors without losing editor state.
- On successful PNG/JPEG/BMP/WAV import, verify the existing Run mount path continues to work.

### Out of scope

- Silent overwrite, delete/rename, folders dropped recursively, models/effects, network URLs, or auto-editing C# source.

## Acceptance criteria

- [x] Picker and drag/drop both import supported files to the confirmed destination.
- [x] Imported files appear immediately, survive relaunch, and are byte-identical.
- [x] Mixed success/failure batches report each item accurately.
- [x] Unsupported and duplicate files write nothing.
- [x] A newly imported image and sound can be loaded by a project Run.

## Verification

Use picker and drag/drop with PNG, WAV, duplicate, unsupported, and oversize fixtures. Compare disk hashes, relaunch, and run a game that loads successful imports. Test keyboard-only picker flow and visual drop affordance. Re-run content/project tests and packaged security checks affected by command use.

## Verification record

- **Verdict:** PASS
- **Verifier:** Product owner (manual PRODUCT acceptance) and independent `reviewer` subagent (source/build/tests)
- **Date:** 2026-09-12
- **Evidence:**
  - The product owner imported files by drag-and-drop, confirmed the workflow
    behaved as expected, and approved sign-off. After correcting the test
    project's unrelated two-`Game`-subclass error, Run succeeded.
  - The native picker and OS drag/drop paths both feed one confirmation and
    sequential-import pipeline. Recognized files default to `Textures`, `Audio`,
    or `Precompiled`, and every destination remains editable before writing.
  - The secure issue-065 command revalidates every source/destination, never
    overwrites, and the controller refreshes the asset hierarchy from disk after
    mixed batches without changing editor buffers.
  - Frontend typecheck passed; the focused frontend suite passed 249/249 tests.
    Rust formatting/clippy passed in PRODUCT and PROOF, with 44/44 PRODUCT and
    58/58 PROOF tests. PRODUCT/PROOF Vite builds and profile checks passed.
  - Fresh packaged artifact checks passed with exactly 10 PRODUCT commands and
    all 69 PROOF commands. The canonical packaged preview-security scenario
    passed 033, 033-no-wasm-eval, 034, 035, and 036 with zero orphan processes
    and a clean invoke-key scan.
  - The drag payload is forwarded only from Tauri's native main-window event to
    the trusted top frame with escaped JSON, validated before use, and hit-tested
    against the asset panel. The opaque preview has no IPC or parent access and
    cannot invoke import commands or forge this native event path.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: import assets by picker and drag drop`

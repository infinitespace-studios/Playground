# Add asset picker and drag-and-drop import workflows

**Type:** AFK
**Status:** Blocked
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

- [ ] Picker and drag/drop both import supported files to the confirmed destination.
- [ ] Imported files appear immediately, survive relaunch, and are byte-identical.
- [ ] Mixed success/failure batches report each item accurately.
- [ ] Unsupported and duplicate files write nothing.
- [ ] A newly imported image and sound can be loaded by a project Run.

## Verification

Use picker and drag/drop with PNG, WAV, duplicate, unsupported, and oversize fixtures. Compare disk hashes, relaunch, and run a game that loads successful imports. Test keyboard-only picker flow and visual drop affordance. Re-run content/project tests and packaged security checks affected by command use.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: import assets by picker and drag drop`

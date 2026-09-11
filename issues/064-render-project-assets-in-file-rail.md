# Render project assets in the file rail

**Type:** AFK
**Status:** Blocked
**Blocked by:** [059-remove-stale-workbench-telemetry.md](059-remove-stale-workbench-telemetry.md), [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md)
**Feature area:** Assets
**Triage:** feature-backlog

## Context

Folder projects already return bounded `Content/` files from the native `project_read` command, and `project-content.ts` prepares those files for preview mounting. The UI does not expose that real inventory. The rail host created by issue 059 should become a compact asset tree below the source-file list.

## Scope

### In scope

- Render discovered project content in the rail, grouped by relative folders and sorted deterministically.
- Show path/name, recognized kind (image, sound, precompiled XNB), source byte size, and whether the manifest uses the required Web profile.
- Provide honest empty states for scratch projects, folder projects without `Content/`, and empty `Content/` folders.
- Refresh on folder open/close and expose a project-manager refresh hook for later import issues.
- Use accessible tree/list semantics and non-color cues.

### Out of scope

- Import, rename, delete, thumbnails, model/effect support, or claiming an XNB is valid before preview validation.
- Moving binary file bytes through any new channel.

## Acceptance criteria

- [ ] `examples/ContentExample` shows every discovered content file with correct path, type, and byte size.
- [ ] Scratch and empty projects show accurate empty states.
- [ ] Unsupported/unvalidated content is not labelled valid.
- [ ] Opening/closing projects cannot leave stale assets from the prior project.

## Verification

Run focused project/content tests. Open ContentExample and a temporary nested-content project; compare UI rows and sizes with files on disk. Switch to a second project and scratch mode to prove stale state is cleared. Verify keyboard and screen-reader names.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: show project assets in the file rail`

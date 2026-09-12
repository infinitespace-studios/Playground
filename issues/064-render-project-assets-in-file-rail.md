# Render project assets in the file rail

**Type:** AFK
**Status:** Done
**Blocked by:** [059-remove-stale-workbench-telemetry.md](059-remove-stale-workbench-telemetry.md), [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md)
**Feature area:** Assets
**Triage:** feature-backlog

## Context

Folder projects already return bounded `Content/` files from the native `project_read` command, and `project-content.ts` prepares those files for preview mounting. The UI does not expose that real inventory. The rail host created by issue 059 should become a compact asset tree below the source-file list.

## Scope

### In scope

- Render discovered project content as a conventional recursive file-explorer hierarchy: one `Content` root, nested folders/subfolders, and filenames only.
- Sort folders before files at every level, with deterministic lexical ordering within each category.
- Do not show kind tags, file sizes, asset counts, validation/profile badges, or other per-file metadata in the rail.
- Provide honest empty states for scratch projects, folder projects without `Content/`, and empty `Content/` folders.
- Refresh on folder open/close and expose a project-manager refresh hook for later import issues.
- Use accessible static nested-list semantics; do not claim interactive/collapsible ARIA-tree behavior unless it is fully implemented.

### Out of scope

- Import, rename, delete, thumbnails, model/effect support, metadata badges, sizes, validation/profile status, or claiming an XNB is valid before preview validation.
- Moving binary file bytes through any new channel.

## Acceptance criteria

- [x] `examples/ContentExample` shows one recursive `Content` hierarchy containing every discovered folder/subfolder and filename.
- [x] Folders sort before files at every level and both categories sort deterministically.
- [x] No kind tags, byte sizes, counts, profile/validation badges, or other asset metadata appear in the rail.
- [x] Scratch and empty projects show accurate empty states.
- [x] Opening/closing projects cannot leave stale assets from the prior project.

## Verification

Run focused project/content tests. Open ContentExample and a temporary multi-level nested-content project; compare the visible folder/file hierarchy with disk and verify folder-before-file deterministic ordering. Confirm no tags, sizes, counts, profile, or validation metadata appears. Switch to a second project and scratch mode to prove stale state is cleared. Verify the static nested lists and folder/file names are announced correctly by assistive technology.

## Verification record

- **Verdict:** PASS
- **Verifier:** Product owner (manual PRODUCT acceptance) and independent `reviewer` subagent (source/build/tests)
- **Date:** 2026-09-11
- **Evidence:**
  - The product owner opened the implemented Assets panel, confirmed the revised
    recursive file-explorer hierarchy looks correct, and accepted it for commit.
  - The rail renders one `Content` root with arbitrary nested folders and
    filenames only. It contains no kind tags, byte sizes, counts, profile or
    validation badges, or other per-file metadata.
  - The pure model and DOM-renderer tests prove folders precede files at every
    level, each category sorts deterministically, static nested-list semantics
    are used, all three empty states are distinct, and re-rendering removes stale
    project rows.
  - `refreshContent()` re-reads the open project through the existing
    `project_read` command, updates only the content inventory, preserves source
    buffers/dirty state, rejects stale in-flight results after a project switch,
    and preserves the last-known inventory on failure.
  - TypeScript typecheck passed. The full focused frontend suite passed 228/228,
    Rust formatting passed, and Rust tests passed 24/24.
  - PRODUCT and PROOF Vite builds/profile checks passed with zero proof leakage
    into PRODUCT; the native command inventory remains eight PRODUCT commands.
  - Automated verification used local tools only and launched no browser,
    Tauri, or other GUI process and performed no network access.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: show project assets in the file rail`

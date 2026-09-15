# Rename and delete source files safely

**Type:** AFK
**Status:** Done
**Blocked by:** [067-create-source-files-in-folder-projects.md](067-create-source-files-in-folder-projects.md)
**Feature area:** Multi-file authoring
**Triage:** feature-backlog security-sensitive

## Context

After issue 067, folder projects can create and edit source files but still require external tools to rename or remove them. These operations must preserve dirty buffers, active-file selection, primary-source rules, and filesystem confinement.

## Scope

### In scope

- Add accessible Rename and Delete actions to source-file rows.
- Rename only within the authorized project root; validate canonical `.cs` paths, conflicts, symlinks, and platform-reserved names.
- Require explicit confirmation before deletion and clearly state when unsaved edits will be discarded.
- Keep project state, Monaco content, dirty state, primary source, Save All, diagnostics, and Run source lists consistent.
- Prevent deletion of the last source file unless the UI explains that the project cannot Run and supports recovery.
- Keep native operations main-frame-only and update command/ACL inventories.

### Out of scope

- Refactoring C# type/namespace references after rename.
- Trash/recycle-bin integration, undo after confirmed deletion, or arbitrary non-source files.

## Acceptance criteria

- [ ] Rename and delete are reflected on disk and after reopen.
- [ ] Active/dirty files transition predictably with no data loss before confirmation.
- [ ] Run compiles exactly the remaining/renamed source paths.
- [ ] Escape, conflict, symlink, and unauthorized-frame cases are rejected safely.

## Verification

Create a cross-file project, dirty both files, test cancel and confirm flows, rename a dependency, repair the source reference, Run, delete it, and inspect compile inputs/disk after reopen. Execute path and ACL attacks and all affected project/Rust tests.

## Verification record

- **Verdict:** PASS
- **Verifier:** Human project owner/user, with automated verification by the implementation session
- **Date:** 2026-09-15
- **Evidence:** The human verifier confirmed the complete real-project rename/delete workflow works: dirty multi-file projects can be exercised through cancel and confirm flows, dependencies can be renamed and repaired before Run, source deletion is reflected in the explorer and on disk, and the project can be reopened with the renamed/deleted source set intact. The verifier also confirmed the path, conflict, symlink, and unauthorized-frame rejection behavior. Automated evidence: frontend lifecycle tests 25/25 passed; protocol tests 104/104 passed; frontend typecheck and Vite build passed; PRODUCT Rust tests 48/48 passed; PROOF Rust tests 62/62 passed; Cargo build and format checks passed; command-inventory self-test passed with 13 product, 59 proof, and 72 total commands.

## Commit gate

Commit only after security-focused independent PASS.

Suggested commit subject: `frontend: rename and delete project sources`

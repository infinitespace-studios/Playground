# Create C# source files in folder projects

**Type:** AFK
**Status:** Ready
**Blocked by:** [051-open-folder-edit-multiple-files-persist-manifest.md](051-open-folder-edit-multiple-files-persist-manifest.md)
**Feature area:** Multi-file authoring
**Triage:** feature-backlog

## Context

The application already opens, edits, saves, and compiles multiple existing `.cs` files, but users cannot create another source file from the Workbench. Native writes must remain scoped to the opened project and filenames must be canonical and conflict-safe.

## Scope

### In scope

- Add a `New C# file` action for folder projects.
- Prompt for a project-relative `.cs` path, validate normalization/traversal/reserved names, and reject collisions.
- Create the file atomically through a responsibility-named, main-frame-only native operation or a safely generalized existing workspace operation.
- Add it to project state/explorer, activate it in Monaco, and include it in Save All and Run.
- Give a new file a minimal editable template without silently changing other files.

### Out of scope

- Scratch multi-file projects, arbitrary extensions, folder management, rename/delete (issue 068), or project templates.

## Acceptance criteria

- [ ] A valid nested `.cs` file can be created and immediately edited.
- [ ] It is included in multi-source compile and persists after reopen.
- [ ] Traversal, absolute paths, invalid/reserved names, and collisions are rejected without disk changes.
- [ ] The preview iframe cannot invoke the write operation.

## Verification

Create `Helpers/Player.cs`, reference it from `Game1.cs`, Save All, Run, reopen, and Run again. Execute every rejection case and inspect disk. Run project lifecycle, Rust security/command inventory, and packaged IPC-denial checks affected by the native surface.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: create files in folder projects`

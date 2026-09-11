# Add a secure native command for importing project assets

**Type:** AFK
**Status:** Blocked
**Blocked by:** [064-render-project-assets-in-file-rail.md](064-render-project-assets-in-file-rail.md)
**Feature area:** Assets, native filesystem boundary
**Triage:** feature-backlog security-sensitive

## Context

The shell can read bounded files under an opened project's `Content/` directory and can atomically write C# text, but it has no binary asset import operation. Drag/drop must not become an arbitrary filesystem-write primitive, and the opaque preview must never be able to invoke project mutation commands.

## Scope

### In scope

- Add a responsibility-named PRODUCT command that imports bytes from a user-selected local source into a destination under the currently authorized project `Content/` root.
- Canonicalize source/project/destination paths; reject traversal, symlink escape, absolute destination paths, hidden names, unsupported extensions, and writes outside `Content/`.
- Enforce existing per-type and aggregate content limits before committing.
- Use temporary-file plus rename semantics; a failure leaves no partial destination.
- Define explicit conflict behavior: reject existing destinations and return a structured conflict result.
- Update command/ACL/binary inventories and security tests deliberately.
- Prove nested preview frames cannot invoke the command.

### Out of scope

- Frontend picker/drop UI, overwrite, delete/rename, model/effect formats, network downloads, or content compilation.

## Acceptance criteria

- [ ] A supported file is copied byte-identically under `Content/`.
- [ ] Traversal, symlink escape, oversize, unsupported extension, and duplicate destination are rejected without partial files.
- [ ] Only the trusted main Workbench frame has command authority.
- [ ] PRODUCT/PROOF command inventories and capability checks pass.

## Verification

Run Rust unit tests plus product/proof inventory checks. In a temporary project, verify successful SHA-256 equality and each rejection case, including a symlink escape where supported. Run the packaged IPC-denial proof to confirm the preview cannot call the new command. Record command-count changes and rationale.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after a security-focused independent PASS.

Suggested commit subject: `desktop: add bounded project asset import`

# Add a secure native command for importing project assets

**Type:** AFK
**Status:** Done
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

- [x] A supported file is copied byte-identically under `Content/`.
- [x] Traversal, symlink escape, oversize, unsupported extension, and duplicate destination are rejected without partial files.
- [x] Only the trusted main Workbench frame has command authority.
- [x] PRODUCT/PROOF command inventories and capability checks pass.

## Verification

Run Rust unit tests plus product/proof inventory checks. In a temporary project, verify successful SHA-256 equality and each rejection case, including a symlink escape where supported. Run the packaged IPC-denial proof to confirm the preview cannot call the new command. Record command-count changes and rationale.

## Verification record

- **Verdict:** PASS
- **Verifier:** Independent `reviewer` subagent plus canonical packaged security runner
- **Date:** 2026-09-11
- **Evidence:**
  - Security-focused source review confirmed canonical confinement beneath
    `Content/`, destination/source extension compatibility, traversal and
    symlink-escape rejection, Windows reserved/trailing-dot/space rejection,
    no-overwrite conflict behavior, hidden-temp atomic commit/cleanup, and no
    new dependency.
  - Import unit tests copied a supported file byte-identically, verified the
    returned SHA-256 against known-answer-tested hashing, and covered conflicts,
    missing/unsupported sources, traversal, oversize, aggregate limits, and
    Content-root/subdirectory symlink escapes.
  - Raw WAV imports are limited to 8 MiB; other supported assets are limited to
    16 MiB; aggregate Content is limited to 24 MiB and 256 files. Actual bytes
    are rechecked after reading before commit.
  - Rust formatting and clippy passed in PRODUCT and PROOF profiles. Rust tests
    passed 43/43 PRODUCT and 57/57 PROOF; frontend typecheck and 104/104 protocol
    tests passed; the command-inventory self-test passed 11/11.
  - The canonical packaged PROOF preview-security scenario passed sub-proofs
    033, 033-no-wasm-eval, 034, 035, and 036 with zero orphan processes and a
    clean invoke-key scan, confirming the opaque preview cannot acquire main
    command authority.
  - Fresh packaged binary inventory checks passed for both profiles: PRODUCT
    contains exactly 9 commands and zero proof surface; PROOF contains all 68
    commands and exactly eight proof scenarios. The command is granted only by
    the local trusted `main` capability.
  - No browser was launched and the packaged proof performed no network access.

## Commit gate

Commit only after a security-focused independent PASS.

Suggested commit subject: `desktop: add bounded project asset import`

# Add project dependency-pack selection and IntelliSense integration

**Type:** AFK
**Status:** Blocked
**Blocked by:** [077-build-deterministic-dependency-pack-staging-and-cache.md](077-build-deterministic-dependency-pack-staging-and-cache.md), [073-connect-monaco-to-context-aware-completions.md](073-connect-monaco-to-context-aware-completions.md)
**Feature area:** Dependencies, IntelliSense
**Triage:** feature-backlog

## Context

Approved packs are embedded and manifests can identify them, while Roslyn completions use a synchronized project workspace. Users need an offline catalog UI that explains compatibility and updates compile, preview, and IntelliSense as one atomic project configuration.

## Scope

### In scope

- Add a project Dependencies view listing only embedded approved packs with version, description, license, size, and capability notes.
- Enable/disable packs through `playground.json` with dirty-state/discard protection and deterministic serialization.
- Reconfigure compiler references, language-service workspace, and preview runtime inputs consistently; no partial enablement.
- Explain that arbitrary NuGet URLs/files are unsupported and provide actionable unknown/incompatible-pack errors.
- Preserve the last running preview when dependency reconfiguration or compilation fails.

### Out of scope

- Online search/install/update, arbitrary versions, package authoring, or loading user-selected DLLs.

## Acceptance criteria

- [ ] Enabling a pack makes its API compile, appear in IntelliSense, and run offline.
- [ ] Disabling removes it from all three surfaces after confirmation/reload.
- [ ] Manifest changes persist and unknown packs fail without project mutation.
- [ ] No package or preview can gain host IPC/network authority.

## Verification

Enable/disable the fixture/approved pack in a folder project, test completion/compile/run/reopen, then exercise unknown version, corrupt manifest, offline launch, and compile failure while a preview runs. Inspect manifest and security/profile gates.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add curated dependency pack selection`

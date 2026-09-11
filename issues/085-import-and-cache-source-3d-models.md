# Import and cache source 3D models

**Type:** AFK
**Status:** Blocked
**Blocked by:** [084-validate-mount-and-render-model-content.md](084-validate-mount-and-render-model-content.md), [066-add-asset-picker-and-drag-drop-import.md](066-add-asset-picker-and-drag-drop-import.md)
**Feature area:** 3D models, asset pipeline
**Triage:** feature-backlog spike

## Context

Precompiled Web-profile Model XNB files are useful but not friendly. Users expect to drop a common source model and have the application build/cache the validated Web asset. Importers/processors may be platform-specific and substantially increase package size, so the first slice must choose and prove one narrow format rather than promise all model formats.

## Scope

### In scope

- Select one source format based on the pinned MonoGame content pipeline's proven support (prefer glTF/GLB only if supported; otherwise choose the smallest reliable format such as OBJ or FBX and document why).
- Add an import-time, offline conversion path to the exact Web-profile Model XNB accepted by issue 084.
- Cache by source bytes + importer/processor settings + complete pinned toolchain digest; verify cache bytes before reuse.
- Import referenced textures safely under `Content/`, with conflict/path/size handling and clear build diagnostics.
- Integrate picker/drag-drop and show source/build/cache state in the asset rail.
- Measure platform package delta and conversion time on all supported architectures feasible in CI.

### Out of scope

- Multiple source formats, network assets, arbitrary importer plugins, custom effects, background daemon, or editing model geometry.

## Acceptance criteria

- [ ] The chosen source fixture imports offline, produces a valid model, and renders after restart.
- [ ] A second unchanged import/run uses the verified cache; changed source/settings invalidate it.
- [ ] Malformed, oversized, traversal, missing-texture, and tool failure cases leave no partial output.
- [ ] Toolchain/package impact is documented and remains within accepted release limits.

## Verification

Clear cache, import and render; repeat to prove cache hit; mutate source/settings to prove invalidation. Run malformed/path/size/tool-failure cases. Repeat packaged checks on at least host-native macOS plus CI evidence for Windows/Linux build viability. Inspect hashes and no-network behavior.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS. If implementation requires changing `external/MonoGame`, stop and create a HITL issue for a human-authored submodule change.

Suggested commit subject: `content: import and cache source models`

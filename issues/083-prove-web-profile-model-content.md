# Prove Web-profile Model content with BasicEffect

**Type:** AFK
**Status:** Ready
**Blocked by:** [039-validate-and-mount-web-profile-texture2d.md](039-validate-and-mount-web-profile-texture2d.md), [043-measure-release-package-size-api-survival.md](043-measure-release-package-size-api-survival.md)
**Feature area:** 3D model feasibility
**Triage:** feature-backlog spike

## Context

The current content gate accepts images, sounds, and narrowly validated XNB readers; Model content and multi-reader graphs are rejected. Before changing PRODUCT, the pinned MonoGame Web runtime and content toolchain must prove a deterministic model XNB can load and render using stock `BasicEffect` without a custom shader pipeline.

## Scope

### In scope

- Create a minimal deterministic source model fixture and reproducible Web-profile content-build command using the pinned toolchain.
- In packaged PROOF, mount/load it through `Content.Load<Model>` and render a camera-visible textured or colored mesh with `BasicEffect` and depth buffering.
- Inventory the complete XNB reader graph, shared resources, external references, sizes, and paths required by the fixture.
- Capture framebuffer evidence that distinguishes correct 3D geometry from a clear-color frame.
- Measure package/content-build/runtime startup and memory impact.
- Produce `docs/model-content-feasibility.md` with validator requirements and go/no-go recommendation.

### Out of scope

- PRODUCT validator changes, general FBX/glTF support, animation, custom effects, or MonoGame submodule modifications.

## Acceptance criteria

- [ ] Fixture and build are byte-reproducible, or nondeterminism is precisely documented with a stable semantic verifier.
- [ ] Packaged Web runtime loads/renders the model with objective framebuffer evidence, or a reproducible no-go report explains the blocker.
- [ ] Reader graph and security bounds needed by issue 084 are complete.
- [ ] PRODUCT behavior remains unchanged.

## Verification

The reviewer rebuilds the fixture from clean inputs, verifies hashes/reader inventory, runs packaged PROOF offline, checks framebuffer/depth evidence and metrics, and confirms PRODUCT still rejects Model content. A documented no-go is a valid spike PASS.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS. Do not modify `external/MonoGame`; any required submodule change needs a separate human-authored issue.

Suggested commit subject: `test: prove Web profile model content`

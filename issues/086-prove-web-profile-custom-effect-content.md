# Prove Web-profile custom Effect content

**Type:** AFK
**Status:** Ready
**Blocked by:** [039-validate-and-mount-web-profile-texture2d.md](039-validate-and-mount-web-profile-texture2d.md), [043-measure-release-package-size-api-survival.md](043-measure-release-package-size-api-survival.md)
**Feature area:** Custom effects feasibility
**Triage:** feature-backlog spike

## Context

Custom effects were intentionally excluded from the initial content subset. The pinned MonoGame/MGFXC toolchain must first prove that a minimal effect can be compiled for the Web profile, loaded by the packaged WebGL runtime, applied to geometry, and distinguished objectively from stock rendering.

## Scope

### In scope

- Create a minimal deterministic `.fx` source fixture and pinned command that produces a Web-profile Effect XNB.
- Run the compilation only in build/proof tooling; do not expose an in-product shader compiler yet.
- In packaged PROOF, mount/load via `Content.Load<Effect>`, set a parameter, select a technique/pass, draw known geometry, and capture objective framebuffer evidence.
- Inventory XNB readers, shader/profile metadata, GL requirements, failure modes, size, compilation time, startup, and memory impact.
- Produce `docs/effect-content-feasibility.md` with go/no-go and the exact validator surface for issue 087.

### Out of scope

- PRODUCT support, source-effect import UI, arbitrary shader profiles, model materials, or MonoGame submodule modifications.

## Acceptance criteria

- [ ] Effect build is reproducible or has a stable semantic verifier.
- [ ] Packaged WebGL output proves the custom parameter/pass executed, or a reproducible no-go report identifies the blocker.
- [ ] PRODUCT still rejects Effect content.
- [ ] Toolchain and package implications are documented.

## Verification

The reviewer rebuilds from `.fx`, inspects XNB/profile metadata, runs packaged PROOF offline, compares control/effect framebuffer evidence, repeats failure cases, and confirms no PRODUCT leakage. A documented no-go is a valid spike PASS.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS. Do not modify `external/MonoGame` in this issue.

Suggested commit subject: `test: prove Web profile custom effects`

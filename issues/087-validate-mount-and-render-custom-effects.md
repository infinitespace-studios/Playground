# Validate, mount, and render precompiled custom Effects

**Type:** AFK
**Status:** Blocked
**Blocked by:** [086-prove-web-profile-custom-effect-content.md](086-prove-web-profile-custom-effect-content.md)
**Feature area:** Custom effects
**Triage:** feature-backlog security-sensitive

## Context

Issue 086 establishes one exact Web-profile custom-effect format that works in the pinned runtime. This slice admits only that bounded form into PRODUCT and proves normal project use without adding a shader compiler to the application.

## Scope

### In scope

- Extend content validation for the minimum Effect XNB reader/profile/technique/pass/parameter form proven by issue 086.
- Bound file size, reader/technique/pass/parameter counts, strings, shader bytecode sections, and referenced resources; reject malformed/trailing/unsupported content.
- Mount Effect assets atomically and provide actionable PG02xx diagnostics before game start.
- Add a folder-project example loading and applying the effect.
- Classify precompiled Effect assets in the asset rail.
- Preserve CSP, no-network behavior, content cleanup, and PRODUCT/PROOF separation.

### Out of scope

- Compiling `.fx` in the product (issue 088), arbitrary backend shader profiles, effect editor, live shader reload, or broad XNB reader support.

## Acceptance criteria

- [ ] The approved effect renders in PRODUCT with objective output evidence.
- [ ] Wrong-profile, malformed, oversized, unsupported, and trailing-data fixtures fail with exact diagnostics before construction.
- [ ] Stop/restart cleans all effect/runtime state.
- [ ] Existing content types remain unchanged.

## Verification

Run positive/negative content tests and packaged PRODUCT offline. Compare control/effect pixels, exercise every diagnostic mutation, run repeated Stop/Run, and execute security/profile/package-size gates. Inspect validator bounds independently.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after security-focused independent PASS.

Suggested commit subject: `preview: support validated custom Effects`

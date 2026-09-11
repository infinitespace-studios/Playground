# Validate, mount, and render precompiled Model content

**Type:** AFK
**Status:** Blocked
**Blocked by:** [083-prove-web-profile-model-content.md](083-prove-web-profile-model-content.md)
**Feature area:** 3D models
**Triage:** feature-backlog security-sensitive

## Context

Issue 083 proves the exact pinned Web-profile Model fixture and reader graph. This slice expands the production content gate only to that validated model shape and proves normal project use. XNB input is untrusted project data, so bounds and fail-closed parsing are mandatory.

## Scope

### In scope

- Extend XNB validation for the minimum reader graph/shared-resource/external-reference forms required by the approved fixture.
- Bound reader count, string length, object/shared-resource count, mesh/vertex/index/bone/material counts, nesting, and aggregate referenced bytes.
- Mount model XNB plus required texture assets atomically before game start.
- Return actionable PG02xx errors for wrong platform/version, unsupported readers/processors, malformed graph, missing references, limit violations, and path escape.
- Add a folder-project example that calls `Content.Load<Model>` and renders it with `BasicEffect`.
- Surface model assets accurately in the rail.

### Out of scope

- Source model import/compilation (issue 085), animation beyond fixture needs, arbitrary custom materials/effects, or broad multi-reader acceptance.

## Acceptance criteria

- [ ] Approved Web model renders in PRODUCT from a normal folder project.
- [ ] Adversarial malformed/oversized/path-escaping variants fail before game construction with exact diagnostics.
- [ ] Content mount remains atomic and cleaned on preview retirement.
- [ ] Existing image/audio behavior is unchanged.

## Verification

Run C#/frontend/Rust content tests, including generated negative fixture mutations. In packaged PRODUCT, load/render the example offline, inspect objective pixels/depth, Stop/restart, and test each diagnostic. Confirm no external filesystem/network access and run package-size/security/profile gates.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after security-focused independent PASS.

Suggested commit subject: `preview: support validated Model content`

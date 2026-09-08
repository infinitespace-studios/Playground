# Apply opaque-origin sandbox and CSP

**Type:** AFK
**Status:** Done
**Blocked by:** [020-boot-isolated-release-preview-runtime.md](020-boot-isolated-release-preview-runtime.md)
**PRD references:** 16, 19
**User stories:** US9
**Triage:** needs-triage

## Context

PRD section 16 requires the preview and compiler contexts to use sandboxed opaque origins or distinct origins from the trusted application, omit `allow-same-origin` unless an architectural review proves an equivalent boundary, disable global shell bindings, scope Tauri capabilities/Electron IPC handlers to the trusted top-level WebView only, and apply restrictive `default-src`/`script-src`/`frame-src`/`connect-src`/navigation Content-Security-Policy directives. Critical feasibility question 6 (section 19) asks whether the required iframe sandbox and origin policy can be provided without breaking `.NET`, WebGL, audio, or asset loading. This issue applies the actual `sandbox` attribute and CSP to the preview iframe created in issue 20/23-25, and re-verifies the preview still boots and renders (regression-checking issues 20-30) under the tightened policy — this is the first of several security-hardening issues (33-38) that build on this sandbox boundary.

## What to build

Add an HTML `sandbox` attribute to the preview `<iframe>` (allowing only the minimum flags required for `.NET` WebAssembly + WebGL + audio to function, explicitly never including `allow-same-origin` together with `allow-scripts` unless a documented review proves an equivalent boundary exists) and a restrictive CSP (via a `<meta http-equiv="Content-Security-Policy">` tag in the preview's own HTML, or via the desktop shell's CSP configuration if it applies per-frame) that denies everything except what is required to load the bundled preview assets, then re-run the issue 23 (render) and issue 30 (multi-file run) proofs to confirm no regression.

## Scope

### In scope

- Setting the `sandbox` attribute on the preview iframe element created in the frontend (from issue 20 onward)
- Determining and documenting the minimal required sandbox flag set (likely `allow-scripts` only, since a fully opaque, cross-origin-by-default iframe without `allow-same-origin` already satisfies most of PRD 16's origin requirement)
- Authoring a restrictive CSP for the preview page: `default-src 'none'; script-src 'self'; connect-src 'self'; frame-src 'none'; style-src 'self' 'unsafe-inline'` (adjust `'unsafe-inline'`/`wasm-unsafe-eval` only if proven strictly necessary for this .NET WASM runtime to instantiate — document any such necessary relaxation explicitly)
- Regression-testing rendering (issue 23), input, and multi-file execution (issue 30) under the new sandbox/CSP

### Out of scope

- Denying shell IPC/filesystem access specifically (issue 34, which builds on this sandbox boundary)
- Denying navigation/network (issue 35)
- Message validation (issue 36)

## Implementation guidance

1. Determine the minimal sandbox flags: start with `sandbox="allow-scripts"` only (deliberately omitting `allow-same-origin`, per PRD 16's explicit requirement) on the preview `<iframe>` element in the frontend's Run-handling code (issue 20/25).
2. Attempt to load the preview under this sandbox and observe whether `.NET` WASM boot, WebGL context creation, and audio context creation still succeed (a `sandbox`-restricted iframe without `allow-same-origin` has a unique opaque origin, which some browser features historically restricted — e.g. certain storage APIs — but WebAssembly instantiation, WebGL, and Web Audio are generally still permitted; confirm this empirically in the actual WebView used by the selected shell from issue 14's ADR).
3. If any required capability breaks under strict sandboxing, add the minimum additional sandbox flag necessary (e.g. `allow-popups` only if genuinely needed — unlikely for this use case) and document the justification in `docs/adr/` as a short addendum, per PRD 16's "unless an architectural review proves an equivalent boundary" requirement; do not add `allow-same-origin` under any circumstance without such a documented review.
4. Add the CSP `<meta>` tag (or shell-level equivalent) to the preview's HTML page.
5. Re-run: issue 23's clear-color render proof, issue 25's clean-restart proof, and issue 30's multi-file cross-call proof, all under the new sandbox+CSP, confirming identical successful behavior to before.
6. Document the final sandbox flag set and CSP directives in `docs/security-model.md` (create this file) for reference by issues 34-38.

## Acceptance criteria

- [x] The preview `<iframe>` has a `sandbox` attribute that does not include `allow-same-origin`
- [x] A CSP is applied to the preview page restricting `default-src`, `script-src`, `connect-src`, and `frame-src` to the minimum required to load bundled assets
- [x] Rendering (issue 23), clean restart (issue 25), and multi-file execution (issue 30) all still pass unchanged under the new sandbox/CSP
- [x] `docs/security-model.md` documents the exact sandbox flags and CSP directives applied, with justification for any flag beyond the documented minimum

## Verification

Inspect the preview iframe's `sandbox` attribute value in the rendered DOM (devtools Elements panel) and confirm `allow-same-origin` is absent. Inspect the CSP via the response headers or `<meta>` tag. Then re-run the issue 23 clear-color test, issue 25's three-cycle restart test, and issue 30's multi-file cross-call test, confirming all three still pass exactly as before. The verifier must record the exact `sandbox` attribute value and CSP string observed, plus the outcome of all three regression re-tests.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-033 verifier
- **Date:** 2026-08-28
- **Evidence:** Exact `allow-scripts` opaque sandbox, minimal CSP, embedded
  custom protocol, adversarial URI/header tests, genuine WebAssembly CSP
  negative proof, repeated rendering/multi-file/restart regressions, and
  cleanup passed. Committed as `3b68137`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `security: apply opaque-origin sandbox and CSP to preview iframe`

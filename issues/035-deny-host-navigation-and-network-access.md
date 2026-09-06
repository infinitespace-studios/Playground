# Deny host navigation and arbitrary network access

**Type:** AFK
**Status:** Done
**Blocked by:** None; opaque-origin sandbox and CSP completed in `3b68137`
**PRD references:** 16
**User stories:** US9
**Triage:** needs-triage

## Context

PRD section 16 requires the preview and compiler contexts to prevent preview navigation and arbitrary network access, applying a restrictive `connect-src` CSP directive (already begun in issue 33) and navigation policies. This issue specifically proves two attack scenarios are blocked: the preview attempting to navigate the top-level trusted window to an attacker-controlled URL, and the preview attempting an arbitrary outbound network request (e.g. `fetch` to an external URL) bypassing the CSP `connect-src` restriction from issue 33.

## What to build

Add explicit navigation-denial handling (Tauri's `on-navigation`/webview navigation event hooks, or Electron's `will-navigate`/`setWindowOpenHandler`, depending on issue 14's selected shell) that blocks the preview iframe/webview from navigating the top-level window or opening new windows to arbitrary URLs, and prove via a test script inside the preview that a `fetch()` call to an external domain is blocked by the CSP `connect-src` directive from issue 33.

## Scope

### In scope

- Shell-level navigation event interception preventing the preview from navigating the top-level trusted window
- Preventing the preview from opening new top-level windows/tabs to arbitrary URLs (`window.open` denial)
- A test `fetch("https://example.com")` call from within the preview's JS context, confirmed blocked by CSP (observable as a CSP violation in devtools console, with the request never reaching the network)
- A test `window.top.location = "https://example.com"` (or equivalent) call from within the preview, confirmed to have no effect on the trusted top-level window

### Out of scope

- Message/protocol validation (issue 36)
- Legitimate compiler-context network needs (there are none per the offline requirement in section 18 — the compiler and preview must never need network access at all, which simplifies this issue: the correct behavior is to deny all network access unconditionally, not selectively allow some domains)

## Implementation guidance

1. Confirm `connect-src 'self'` (or stricter) is already applied from issue 33's CSP; if `'self'` still permits same-origin XHR/fetch that could be abused, and the preview has no legitimate need for any network fetch at all, consider tightening to `connect-src 'none'` unless the .NET WASM runtime's own asset-loading mechanism requires `fetch` to same-origin bundled resources (likely true — the runtime fetches its own `.wasm`/`dat` files via `fetch`), in which case keep `'self'` but explicitly test that cross-origin fetch is blocked while same-origin bundled-asset fetch still works (regression-check issue 23's render proof again after any CSP change).
2. Add shell-level navigation blocking: for Tauri, hook the webview's navigation event (Tauric v2 exposes `on-navigation`-style hooks per window/webview configuration; consult the actual Tauri version's docs) to reject any navigation attempt originating from the preview context toward a URL outside the app's own bundled asset scheme. For Electron, use `webContents.on('will-navigate', ...)` and `setWindowOpenHandler(() => ({ action: 'deny' }))` on the window hosting the preview.
3. From within the preview's JS context, run a temporary test script attempting `fetch("https://example.com")` and confirm it fails (network error or CSP violation reported in console), and attempting `window.top.location.href = "https://example.com"` (or `window.open("https://example.com", "_top")`) and confirm the top-level trusted window's URL/content is unchanged afterward.
4. Re-run issue 23's render proof to confirm same-origin bundled-asset loading (which the preview legitimately needs) still works after these restrictions.
5. Document the exact denial mechanism and test results in `docs/security-model.md`.

## Acceptance criteria

- [x] A `fetch()` call to an external domain from within the preview's JS context fails (network error or CSP violation), confirmed via devtools console
- [x] An attempt to navigate the top-level trusted window from within the preview (via `window.top.location` or `window.open(..., "_top")`) has no effect on the trusted window
- [x] The preview still successfully loads its own same-origin bundled assets after these restrictions are applied (regression check against issue 23)
- [x] `docs/security-model.md` documents the navigation-denial mechanism used and the exact test results

## Verification

From the preview iframe's JS context (via devtools context switch as in issue 34), run `fetch("https://example.com").then(r=>console.log("UNEXPECTED SUCCESS",r)).catch(e=>console.log("blocked:",e))` and confirm the "blocked" branch executes. Then attempt `window.top.location.href = "https://example.com"` and confirm, after switching back to the top-level context, that the trusted window's URL/content is unchanged. Re-run issue 23's clear-color render test to confirm no regression. The verifier must perform all three checks personally.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue035-verifier agent
- **Date:** 2026-08-28
- **Evidence:** Release Rust tests passed 12/12 and frontend type-check passed. The packaged proof ran in two fresh opaque preview generations: external `fetch()` failed with an enforced `connect-src` `securitypolicyviolation`; `parent.location` raised `SecurityError`; `_blank` and `_top` `window.open()` calls returned `null`; the trusted URL remained `tauri://localhost`; and both generations rendered CornflowerBlue `[100,149,237,255]` with no GL error or context loss. The issue 034 packaged regression proof also passed. The verifier inspected the Tauri 2.11.5/Wry 0.55.1 hook APIs and confirmed the fail-closed scheme allowlist and unconditional new-window denial.

### Re-pointed to the in-page sandboxed-iframe boundary (issue 052 task 3, 2026-09-06)

- **Verdict:** PASS (packaged, `scripts/prove-issue038-macos.sh` all-green)
- **Change:** `runIssue035AutoProof` re-pointed from `compileLoadStartIssue23`
  (isolated WebviewWindow) to `runInPagePreviewForProof` (in-page opaque-origin
  sandboxed iframe, issue 052 Option B). Network/navigation denial is now
  enforced by the sandbox (`allow-scripts` only — no `allow-popups`,
  `allow-top-navigation`, or `allow-same-origin`) + CSP `connect-src` + the
  same-origin-policy boundary to the trusted parent, rather than the Wry
  `navigation_allowed` / new-window-deny hooks + process isolation.
- **Assertion changes:** `serializedOrigin` expectation `"playground-preview://
  localhost"` → `"null"` (opaque origin). `popupTopDenied` / `topLocationDenied`
  are now reported but NOT hard-asserted: in the isolated top-level window both
  were `false` (`_top`/`parent` = self), and in a sandboxed iframe navigation
  denial can be SILENT (no throw), so the catch-based booleans are
  browser-dependent. The robust top-navigation-denial proof is the trusted-parent
  window staying unchanged (`mainTitle`/`mainUrl`), which remains hard-asserted
  alongside `fetchBlocked`, the `connect-src` violation, opaque origin, and
  `popupDenied`. Report `architecture` → `"in-page-sandboxed-iframe"`.
- **Machine checks (done):** tsc no new errors; 101/101 protocol tests; vite
  build clean; `compileLoadStartIssue23` / `createIsolatedPreview` untouched.
- **Packaged (done):** `scripts/prove-issue038-macos.sh` all-green — 035 PASS.
  Report shows `architecture: "in-page-sandboxed-iframe"`, both generations
  `origin: "null"`, `fetchBlocked` true with the enforced `connect-src`
  violation, `popupDenied`/`popupTopDenied`/`topLocationDenied` all true (they
  flipped to true in the iframe, confirming the conservative demotion was
  harmless), and `mainWindowUnchanged` (title/url stayed `tauri://localhost`).

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `security: deny preview navigation and arbitrary network access`

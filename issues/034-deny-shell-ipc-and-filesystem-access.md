# Deny shell IPC and project filesystem access

**Type:** AFK
**Status:** Done
**Blocked by:** None; opaque-origin sandbox and CSP completed in `3b68137`
**PRD references:** 16
**User stories:** US9
**Triage:** needs-triage

## Context

PRD section 16 requires that the preview must not have direct access to desktop-shell filesystem commands, process execution, shell access, arbitrary native commands, application secrets, or unrestricted desktop APIs, and that desktop-shell commands/IPC must only be exposed to the trusted top-level frontend, with Tauri capabilities scoped to the trusted top-level WebView (or Electron IPC handlers scoped equivalently, depending on which shell issue 14's ADR selected). This issue proves, inside the sandboxed preview iframe from issue 33, that no Tauri (or Electron) IPC bridge and no project-file access is reachable from the preview's JS context.

## What to build

Configure the desktop shell (Tauri capabilities/permissions, or Electron `contextBridge`/IPC handler registration, depending on issue 14's selected shell) so that shell command invocation and any file-system-reading API are registered only for the trusted top-level window, not for the preview iframe's context, and prove this by attempting (from within the sandboxed preview) to call the shell's IPC invoke function and confirming it fails or is entirely absent.

## Scope

### In scope

- If Tauri was selected: scoping `tauri.conf.json` capabilities/permissions so no capability is granted to the preview iframe's window/webview label; confirming `window.__TAURI__`/`invoke` is undefined or throws inside the preview's JS context
- If Electron was selected: ensuring the preview `BrowserWindow`/`<webview>`/iframe never receives a `contextBridge`-exposed API and that `nodeIntegration`/`contextIsolation` settings prevent any IPC surface from reaching it
- A test attempt from within the preview's JS console (or an injected test script) to call the shell's file-read/IPC-invoke API and confirming it fails

### Out of scope

- Navigation/network denial (issue 35)
- Message validation (issue 36)
- Any legitimate top-level-frontend-to-shell IPC used for actual file open/save features (that functionality belongs in later Local Projects issues, e.g. 50-51, and must remain scoped only to the trusted top-level frontend, never the preview)

## Implementation guidance

1. Confirm which shell was selected in issue 14's ADR (`docs/adr/0001-desktop-shell-selection.md`) and follow the matching branch below.
2. **If Tauri:** inspect `src-tauri/tauri.conf.json`'s `app.security.capabilities` (Tauri v2) or `allowlist` (Tauri v1) configuration; ensure any capability/allowlist entry enabling filesystem or shell commands is scoped via a `windows` array that includes only the top-level window's label (e.g. `"main"`), explicitly excluding any label used by the preview iframe's context (note: iframes within the same webview do not get separate Tauri capability scoping the way separate windows do — the real boundary here is that Tauri's `invoke`/`window.__TAURI__` JS bridge must simply never be injected into the preview iframe's origin at all, which the opaque sandboxed origin from issue 33 already achieves since `allow-same-origin` is absent and Tauri's injected API targets the top-level window's context, not an arbitrary nested opaque-origin iframe).
3. **If Electron:** ensure the preview content is loaded via a sandboxed iframe (as configured in issue 33) inside the trusted top-level `BrowserWindow`, which itself has `contextIsolation: true`/`nodeIntegration: false`, and confirm no `contextBridge.exposeInMainWorld` call is made available to nested iframe contexts (verify Electron's `contextBridge` API is main-world-only per top-level window, and a sandboxed nested iframe without `allow-same-origin` cannot reach it).
4. From within the preview iframe's JS context (inject a temporary test script via the preview's own boot code, gated behind a debug flag, or use devtools "switch context to iframe" if available), attempt: `typeof window.__TAURI__` (Tauri) or `typeof window.electronAPI`/`require` (Electron) and confirm each is `"undefined"`.
5. Also attempt calling any known top-level-only command (e.g. a file-read command, even if not yet implemented, mock one temporarily for this test) from the preview context and confirm it throws or is unreachable.
6. Document the confirmed denial in `docs/security-model.md` (extending issue 33's file) with the exact JS expressions tested and their results.

## Acceptance criteria

- [ ] From within the preview iframe's JS context, the shell's IPC bridge global (`window.__TAURI__` or Electron's exposed API) is confirmed `undefined`
- [ ] A test attempt to invoke any shell command or file-system API from the preview context fails or is unreachable
- [ ] The trusted top-level frontend retains normal access to whatever shell IPC it needs (regression check: confirm the top-level frontend's own context can still see the shell bridge, proving the restriction is scoped correctly rather than globally breaking the shell)
- [ ] `docs/security-model.md` documents the exact test expressions used and their pass/fail results

## Verification

Open devtools, switch context to the preview iframe (Chromium devtools support a context-selector dropdown for this), and evaluate `typeof window.__TAURI__` (or the Electron equivalent) confirming `"undefined"`. Switch back to the top-level frontend's context and confirm the same expression is NOT `"undefined"` there (proving the trusted frontend still has access). The verifier must perform both checks personally and record the exact evaluated expressions and their results.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-034 verifier
- **Date:** 2026-08-28
- **Evidence:** Three packaged proofs exercised realistic serialized Tauri IPC
  envelopes against all 45 commands with zero preview callbacks, successes, or
  side effects while trusted invocation succeeded exactly once. Effective ACL,
  exhaustive drift mutations, filesystem canary digest denial, package scans,
  opaque sandbox/CSP, and lifecycle regressions passed. Committed as
  `62e474b`.

### Re-pointed to the in-page sandboxed-iframe boundary (issue 052 task 3, 2026-09-06)

- **Verdict:** PASS (packaged, `scripts/prove-issue038-macos.sh` all-green)
- **Change:** The live Run now renders in the in-page `sandbox="allow-scripts"`
  (no `allow-same-origin`) iframe rather than the isolated WebviewWindow (issue
  052 Option B). `runIssue034AutoProof` was re-pointed from
  `compileLoadStartIssue23` (isolated window) to `runInPagePreviewForProof` (the
  in-page opaque-origin iframe). This **restores the boundary this issue's own
  spec describes** (line 35): "Tauri's `invoke`/`window.__TAURI__` JS bridge must
  simply never be injected into the preview iframe's origin at all, which the
  opaque sandboxed origin from issue 33 already achieves."
- **Assertion inversion:** The isolated window injected `__TAURI_INTERNALS__` and
  the ACL rejected every command because the window label was in no capability
  (measured by the Rust-injected `issue034-acl-invoke-probe`). In the opaque-origin
  iframe the bridge is **never injected at all** — a strictly stronger guarantee
  than "present but rejected." The proof now asserts the bridge is entirely
  absent/unreachable (`directInvoke === "unreachable"`, `globals.internals ===
  "undefined"`, `globals.invoke === "undefined"`) instead of counting ACL
  rejections. The `issue034-acl-invoke-probe` call is dropped;
  `ISSUE034_APPROVED_COMMANDS` is retained (unchanged) as the ACL supply-chain
  inventory guard asserted by `protocol.test.ts` and `issue040.test.ts`. All
  other evidence (canary-fetch/xhr denial, no managed file read, render pixels,
  dispose counts, clean restart, trusted marker called exactly once) is unchanged.
  Report `architecture` → `"in-page-sandboxed-iframe"`.
- **Machine checks (done):** tsc introduces no new errors; 101/101 protocol
  tests pass (ACL inventory guard green); issue040 ACL-inventory test green;
  vite build clean; `compileLoadStartIssue23` / `createIsolatedPreview` left
  untouched.
- **Packaged (done):** `scripts/prove-issue038-macos.sh` all-green (038/024/025/
  023/033/033nwe/034/035/036/037p1/037p2 all PASS, 0 orphans, key-leak scan
  clean). The 034 report shows `architecture: "in-page-sandboxed-iframe"`,
  `aclProof.bridgeReachable: false`, `bridgeInternals/bridgeInvoke: "undefined"`,
  `directInvoke: "unreachable"`, `security.noCanaryInFetch/Xhr` +
  `noManagedFileRead` true, `markerCalls {afterFirst:1, afterRestart:1}`,
  dispose counts 1/1.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `security: deny shell IPC and filesystem access from preview context`

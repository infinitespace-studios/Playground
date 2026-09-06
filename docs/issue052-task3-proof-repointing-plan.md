# Plan — Issue 052 Task 3: Re-point the security proofs to the in-page iframe boundary

Status: PLAN ONLY (no code changes). Grounded in a read of the actual proof
code, preview.js probes, the proof runner, and the issue specs.

## Goal

The live Run now renders in the on-page **sandboxed iframe** (task 1, committed
`4debf8e`). But the security proofs (issues 33/34/35/36) still exercise and
certify the **isolated WebviewWindow** (issue 038) via `compileLoadStartIssue23`
+ `createIsolatedPreview`. That is a real coverage gap: the proofs vouch for a
mechanism users no longer run. This task re-points those proofs to certify the
in-page sandboxed-iframe boundary, **translating** coverage (never deleting it).

## Key finding: this RESTORES the original design

Issue 033's own spec (line 16) was written for a sandboxed iframe:
> "Add an HTML `sandbox` attribute to the preview `<iframe>` (… explicitly never
> including `allow-same-origin` together with `allow-scripts` …) and a
> restrictive CSP …, then re-run the issue 23/30 proofs."

The isolated window arrived later in issue 038 and the proofs were adapted to
it. Re-pointing is therefore a **return to the originally-specified boundary**,
not a new security posture. The guarantee is unchanged; only the enforcement
mechanism differs (opaque-origin sandbox vs separate process + window-label ACL
exclusion).

## The core inversion (what actually changes in the assertions)

The preview.js probes already return **raw, architecture-agnostic evidence**
(`serializedOrigin: location.origin`, `parentDomDenied`, `directInvoke`, CSP
violations, canary fetch results, etc.). Only the **frontend assertions** encode
window-specific expectations. Moving window → iframe inverts three things:

| Evidence | Isolated window (today) | Sandboxed iframe (target) |
|---|---|---|
| `serializedOrigin` | `"playground-preview://localhost"` (real top-level origin) | `"null"` (opaque origin) |
| `parentDomDenied` | `false` (`parent === self` in a top-level window) | `true` (cross-origin parent, blocked by SOP) |
| `directInvoke` (issue 34) | `"rejected"` (Tauri injects `__TAURI_INTERNALS__`; ACL denies because the window label is in no capability) | `"unreachable"` (Tauri never injects into an opaque-origin nested iframe) |

Everything else (evalDenied, inlineScriptDenied, fetchDenied, baseUriDenied,
popupDenied, no-canary-in-fetch/xhr, no managed file read, WebGL render pixels,
managed/native output, PDB path, dispose counts, clean restart) should hold
**identically** — those are enforced by CSP + opaque origin + the compile/run
pipeline, all of which the iframe keeps.

Note issue 34 already half-anticipates this:
`directInvokeOk = directInvoke === "rejected" || directInvoke === "unreachable"`
— so `issue034-security`'s main assertion already accepts the iframe. The
window-specific part is the **separate `issue034-acl-invoke-probe`** (see risks).

## Files in scope

Frontend proof drivers (assertions + report `architecture` string):
- `src/frontend/src/issue33.ts` (opaque-origin sandbox + CSP; has a negative
  no-wasm-eval variant that currently uses `issue038_create_no_wasm_eval_window`)
- `src/frontend/src/issue34.ts` (deny shell IPC / filesystem)
- `src/frontend/src/issue35.ts` (deny navigation / network)
- `src/frontend/src/issue36.ts` (validate forged/malformed messages; also calls
  `issue038_create_preview_window` with a path-escape generation as a negative)

Likely NOT needed (verify): `src/preview/wwwroot/preview.js` probe bodies are
architecture-agnostic and should not need changes. If any do, that's a preview
asset change → rebuild + re-stage (build.rs embeds the inventory).

Explicitly OUT of scope for this task: retiring `issue038_*` Rust commands
(task 4 — ACL-locked), focus/input, status indicator, content workflow.

## Approach: add an in-page proof harness that mirrors `runLivePreviewInPage`

The proofs need a preview handle with the **rich** proof surface (`.proof()`,
`.query()`, `.outputEvents`, `.managedLoad`, `.stop()`), which
`runLivePreviewInPage` (task 1) deliberately does NOT expose (it returns only
`{ failure, stop }`). Two options:

- **Option A (recommended): a proof-capable in-page runner.** Add a sibling to
  `runLivePreviewInPage` — e.g. `runInPagePreviewForProof(...)` — that mounts the
  sandboxed iframe (same bootstrap/mount-order fixes from task 1) but returns the
  full handle shape the proofs consume (`proof`, `query`, `outputEvents`,
  `managedLoad`, `stop`, `previewId`, `contextGeneration`). This reuses the
  proven in-page bridge/port machinery already exercised by the older issue
  21/23 proofs and `provePostMutationTaint`. Then point issues 33/34/35/36 at it
  instead of `compileLoadStartIssue23`.
  - Pro: keeps `compileLoadStartIssue23` and the live path both untouched;
    isolates proof-harness churn.
  - Con: some duplication of lifecycle wiring (mitigated — much can be shared
    with task 1's function via a small internal helper).

- **Option B: branch `compileLoadStartIssue23` on an `inPagePreview` flag.**
  Rejected for the same reason as task 1: it edits the 728-line shared engine
  used by 16 files at ~6 seams — too much blast radius on the security path.

Recommendation: **Option A.** It matches the task-1 philosophy (additive,
zero-blast-radius) and keeps the isolated-window code alive for task 4's
deliberate retirement.

## Step-by-step

1. **Build the proof-capable in-page runner** (`issue21.ts`), returning the rich
   handle. Reuse task 1's mount-order + bootstrap-field fixes. Support the proof
   flags each issue needs (`issue033Proof`, `issue034Proof`, `issue035Proof`,
   `issue036Proof`, `proofMode`) so preview.js enables the right probe actions.

2. **Issue 33** — point `start()` at the in-page runner; invert assertions:
   `serializedOrigin === "null"`, `parentDomDenied === true`; keep all CSP /
   render / output / restart assertions. Update report `architecture` →
   `"in-page-sandboxed-iframe"` and `enforcementLayers` (drop
   "separate WKWebView process" / "window label excluded"; add "opaque origin
   (sandbox allow-scripts, no allow-same-origin)", "__TAURI_INTERNALS__ never
   injected"). For the **no-wasm-eval negative**: replace the
   `issue038_create_no_wasm_eval_window` path with an in-page iframe using
   `loadIssue033NoWasmEvalPreviewIframe` (already exists in `preview-frame.ts`)
   and assert WASM instantiation fails (bridge never ready) under the stricter
   CSP — no Rust command needed.

3. **Issue 34** — point at the in-page runner. `issue034-security`'s
   `directInvokeOk` already accepts `"unreachable"`. The **`issue034-acl-invoke-
   probe`** needs the most care (see risks): re-frame it to assert
   `__TAURI_INTERNALS__` is entirely absent in the iframe (unreachable) rather
   than "N commands all rejected at the ACL". Keep canary-fetch/xhr denial,
   no-managed-file-read, trusted-marker-call accounting, render, dispose, restart.

4. **Issue 35** — point at the in-page runner; adjust the popup/navigation
   assertions whose comments note "_top = self in top-level window" (in an iframe
   the framing differs). Keep network/navigation denial + origin assertions
   (origin now `"null"`).

5. **Issue 36** — the forged/malformed-message validation is transport-level and
   largely architecture-agnostic; point the valid compile/run phases at the
   in-page runner. Decide the fate of the `issue038_create_preview_window`
   path-escape negative (line 116): either keep it (the command still exists
   until task 4) or replace with an equivalent in-page generation-validation
   negative. Update the report `architecture` string.

6. **Update the issue markdown** verification records for 33/34/35/36 to state
   the boundary is now the in-page sandboxed iframe (with the "restores original
   issue-033 design" note), and update `scripts/prove-issue038-macos.sh` only if
   report shape/keys change (env vars + `*_REPORT` keys should stay the same).

7. **Verify** (see below), then commit as a scoped checkpoint updating the
   052 note (mark item 3 `[DONE]`).

## Risks / the hard parts (be honest)

- **`issue034-acl-invoke-probe` is the sharp edge.** Grep shows its *handler*
  does NOT exist in `preview/wwwroot/preview.js` (the action would hit
  `executeBridgeAction`'s "not authorized" throw). It's only referenced from
  issue34.ts's *call site*. This must be reconciled during implementation:
  determine whether the packaged proof currently exercises it at all, and design
  the iframe-appropriate assertion (absence of the IPC bridge) rather than
  "count ACL rejections" — which is meaningless when there's no bridge to reject
  through. **This is the item most likely to expand scope.**

- **`directInvoke` semantics genuinely change** (`rejected` → `unreachable`).
  That's a *stronger* guarantee (no bridge at all vs a bridge that denies), but
  the report must describe it correctly so a reviewer isn't misled.

- **preview.js probe changes would cascade.** If any probe hard-depends on a real
  origin (e.g. something asserting `location.origin !== "null"`), it needs
  editing → preview asset rebuild + re-stage + the build.rs embedded-inventory
  assertions. Audit first; prefer leaving preview.js untouched.

- **GUI-only runtime confirmation.** These proofs run in the **packaged** binary
  via `scripts/prove-issue038-macos.sh` (env-gated: `MONOGAME_ISSUE0XX_PROOF=1`,
  extract `ISSUE0XX_REPORT=`). I cannot run that headless build loop here, so the
  authoritative pass is: **you run `scripts/prove-issue038-macos.sh`** (or the
  per-issue env-gated binary) and confirm 033/034/035/036 report PASS. Machine
  checks I can do: tsc, protocol tests, vite build, cargo build, and that the
  isolated path/`compileLoadStartIssue23` stay untouched.

## Verification plan

- Machine (me + Qwen): tsc clean; 101/101 protocol tests; vite build; cargo
  build; confirm `compileLoadStartIssue23` + `createIsolatedPreview` unchanged;
  confirm each re-pointed proof's assertions match the iframe evidence table.
- Packaged (you): `scripts/prove-issue038-macos.sh` → 033/033nwe/034/035/036 all
  PASS; spot-check one report's `architecture: "in-page-sandboxed-iframe"` and
  the inverted origin/`parentDomDenied`/`directInvoke` fields.
- Regression: issue 23/25/30 render/restart/multi-file proofs still PASS (the
  iframe must not regress rendering) — the same runner backs them.

## Suggested commit

`frontend(issue-052 task 3): re-point security proofs to the in-page iframe boundary`
— scoped to issue33/34/35/36.ts (+ their markdown records, + preview.js only if
unavoidable). 052 stays Blocked; note marks item 3 `[DONE]`, items 4-6 `[OPEN]`.

## Recommended sequencing within the task

1. Build `runInPagePreviewForProof` + re-point **issue 33** first (it's the
   canonical origin/sandbox proof — smallest, most representative). Get it green
   packaged before touching the others.
2. Then **issue 34** (tackle the acl-invoke-probe reconciliation deliberately).
3. Then **35** and **36** (smaller deltas).
4. Update markdown + commit.

This lets us validate the whole approach on issue 33 before committing to the
harder 34, and keeps each proof independently verifiable.

# Replace the per-project warning wall with a compact safety notice

**Type:** AFK
**Status:** Done
**Blocked by:** [061-establish-readable-ui-type-scale.md](061-establish-readable-ui-type-scale.md), [037-warn-before-first-run-of-new-project.md](037-warn-before-first-run-of-new-project.md)
**Feature area:** Run UX, accessibility
**Triage:** feature-backlog

## Context

The current first-run alert is a large paragraph and acknowledgement is keyed per project. It interrupts normal local experimentation repeatedly. The product owner wants a much less intrusive experience, while the documented fact remains true: the embedded preview is defence in depth, and non-yielding synchronous code can freeze the application.

## Scope

### In scope

- Replace the long per-project alert with a concise, application-level notice shown only before the first user-triggered Run for this notice version.
- Keep the summary to a short heading and no more than three brief sentences.
- Offer an expandable `Details` region or documentation link containing the full security/non-yielding explanation.
- Persist a versioned app-level acknowledgement; changing the notice version may show it once again.
- Preserve Cancel, explicit confirmation, focus management, Escape behavior, concurrency coalescing, and failure-closed persistence.
- Migrate/ignore the old per-project acknowledgement format without exposing stored project identities.

### Out of scope

- Claiming hostile code is fully sandboxed.
- Making non-yielding code stoppable.
- Showing the notice on every new project.

## Acceptance criteria

- [x] The notice appears once per application notice version, not once per project.
- [x] The default view is concise and the full explanation remains available.
- [x] Run cannot proceed before explicit confirmation on first display.
- [x] Confirmation persists; Cancel/Escape do not acknowledge.
- [x] The notice is accessible in both themes and at maximum UI scale.

## Verification

With a clean acknowledgement store, exercise Confirm, Cancel, Escape, concurrent Run clicks, app relaunch, and two different folder projects. Inspect the store to prove no raw project path is introduced. Re-run first-run store tests and packaged PRODUCT smoke.

## Verification record

- **Verdict:** PASS
- **Verifier:** Product owner (manual PRODUCT acceptance) and independent `reviewer` subagent (source/build/tests)
- **Date:** 2026-09-11
- **Evidence:**
  - The product owner exercised the compact notice in the running application,
    confirmed all required interactions work, and authorized the commit.
  - The default view contains a short heading and exactly three concise
    sentences. The native expandable Details region retains the complete,
    truthful defence-in-depth and non-yielding-code explanation.
  - Manual acceptance covered first display, Details, Cancel, Escape, explicit
    confirmation before Run, app-level behavior across projects, and persisted
    behavior after relaunch in both themes/at the configured UI scale.
  - Source review confirmed confirmation writes are awaited before Run proceeds,
    Cancel/Escape do not acknowledge, concurrent calls coalesce through one gate
    promise, and the focus trap includes Details, Cancel, and Confirm.
  - Store schema v2 keys acknowledgement by `safety-notice-v1`; v1 per-project
    stores migrate to an empty v2 store, discarding legacy identity keys. The
    stored shape contains only schema version, notice version, and timestamp.
  - Frontend tests passed (104/104 protocol plus all focused suites); Rust tests
    passed 24/24 PRODUCT and 38/38 PROOF. PRODUCT/PROOF builds, profile checks,
    staged-asset checks, and the preserved eight-product-command inventory
    passed.
  - Automated verification used local source/build tools only and launched no
    browser, Tauri, or other GUI process and performed no network access.

## Commit gate

Commit only after independent PASS. The reviewer must confirm that the concise wording does not overstate isolation.

Suggested commit subject: `frontend: simplify the first-run safety notice`

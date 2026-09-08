# Warn before first run of newly opened project

**Type:** AFK
**Status:** Done
**Blocked by:** [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md)
**PRD references:** 16, 21
**User stories:** US9
**Triage:** needs-triage

## Context

PRD section 16 states the application is intended primarily for users running their own local code, provides defence in depth rather than a complete sandbox for deliberately malicious code, and requires every newly opened project to display this limitation before its first execution, with the acknowledgement persisted against a stable project identity and repeated if that identity materially changes. Functional requirement FR-028 (section 21) requires warning before first execution of every newly opened project and persisting acknowledgement against its stable identity. This issue implements that warning dialog and its persistence, gated in front of the Run action established in issues 23-25, using a simple in-memory "scratch project" identity for now (the full project/manifest model arrives in later issues 50-51).

## Product-warning amendment (2026-09-08)

ADR 0003 makes the embedded iframe the production preview and classifies
synchronous non-yielding user code as unsupported. The warning now discloses
that an unbounded loop in a game callback can freeze both preview and editor and
may require an application relaunch. Finite loops remain supported.

## What to build

Before the very first Run of any given project identity in this application session (and persisted across restarts of the application, not just within one session), show a modal warning dialog stating the PRD-mandated defence-in-depth limitation, requiring explicit user acknowledgement before the first compile+run proceeds; persist the acknowledgement keyed by a stable project identity so subsequent Runs of the same project do not re-prompt, but re-prompt if that identity materially changes (e.g. a different project is opened, or, for the scratch/default project used until issue 50 introduces real projects, treat the one built-in default example as a single stable identity for this issue's proof).

## Scope

### In scope

- A modal warning dialog component in the frontend shown before the first Run of a project identity
- Persistence of the acknowledgement (e.g. via Tauri's local app-data storage, or `localStorage` if acceptable for this shell/security model — confirm this storage is only accessible to the trusted top-level frontend, never the sandboxed preview) keyed by a stable project identity string
- Gating the actual compile+run call (from issue 23) behind this acknowledgement for first-time use
- A minimal stable-identity scheme sufficient for this issue: e.g. a hash of the project's manifest path, or a fixed constant identity for the single built-in scratch project used before issue 50's real project model exists

### Out of scope

- The full project manifest/identity model with save/open (issues 50-51, which this issue's identity scheme will likely be revisited/extended by)
- Any project-switching re-prompt logic beyond the single default project used for this issue's proof (a full multi-project re-prompt test is natural to extend once issue 51 exists, but is not required to be built now)

## Implementation guidance

1. Add a persistent key-value store accessible only to the trusted top-level frontend (e.g. via Tauri's `@tauri-apps/plugin-store` or an equivalent app-data JSON file written through a scoped Tauri command, or Electron's `app.getPath('userData')` + a JSON file) storing `{ [projectIdentity]: { acknowledgedAt: string } }`.
2. Before calling the compile+run flow (issue 23) for the first time in a given identity, check this store for an existing acknowledgement; if absent, show a blocking modal dialog with text closely matching PRD section 16's stated limitation ("This application is intended primarily for running your own local code. It provides defence-in-depth protections against accidental or opportunistic access to desktop privileges, but it does not provide a complete sandbox against deliberately malicious code.") and an explicit "I understand, run this project" confirmation control.
3. On confirmation, write the acknowledgement to the persistent store keyed by the current project identity, then proceed with the compile+run flow.
4. On any subsequent Run of the same identity (including after an application restart), confirm the store already contains an acknowledgement and skip the dialog.
5. Define the project-identity scheme for this issue as a fixed constant (e.g. `"builtin-default-example"`) for the single default project that exists prior to issue 50/51's real project model, with a code comment noting this will be replaced by a real per-project stable identity once local project support (issues 50-51) exists.

## Acceptance criteria

- [x] The very first Run of the application (with no prior acknowledgement persisted) shows the warning dialog before any compile+run occurs
- [x] Confirming the dialog persists the acknowledgement and allows the compile+run flow to proceed
- [x] Restarting the application (simulated by clearing in-memory state but not the persistent store) and pressing Run again does NOT re-show the dialog, proving persistence works across sessions
- [x] Clearing the persisted acknowledgement (simulating a materially different project identity) causes the dialog to reappear on the next Run

## Verification

Delete/reset the persistent acknowledgement store, launch the app, and confirm pressing Run shows the warning dialog before any compilation begins. Acknowledge it, confirm Run proceeds normally (reuse issue 23's render proof as confirmation). Restart the application process entirely (not just reload the page) and press Run again, confirming the dialog does NOT reappear. Then manually clear the persisted store file/entry and press Run again, confirming the dialog reappears. The verifier must perform all four steps and inspect the actual persisted store content (e.g. `cat` the store's JSON file) at each stage.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue037-final-verifier agent, after one failed verification/remediation round
- **Date:** 2026-08-28
- **Evidence:** Frontend type-check/build passed, protocol tests passed 101/101, Rust tests passed 20/20, and the Tauri package built with the exact 57-command/59-file ACL inventory. In process A, the actual Run control displayed the modal before compilation; Cancel caused no side effect; a second Run displayed it again; Confirm persisted `builtin-scratch-v1` before a successful render. Process A exited, then process B launched separately, read the same bounded acknowledgement timestamp, skipped the modal for the same identity, and rendered successfully. Clearing the isolated proof store made the identity unacknowledged again. The proof store contained only schema version, stable identity, and UTC timestamp; no project path or sensitive data.
- **Follow-up (2026-09-08):** Folder projects now use distinct `folder-sha256-<digest>` identities derived from their shell-canonicalized roots (`195fdb6`). The raw path is not sent to the acknowledgement store. Stability, path redaction, Windows normalization, and project-close cleanup are covered by `project-identity.test.ts` and `issue051.test.ts`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `security: warn and persist acknowledgement before first run of a project`

# Approve shell ADR

**Type:** HITL
**Status:** Done
**Blocked by:** [007-render-monogame-web-example-in-tauri.md](007-render-monogame-web-example-in-tauri.md), [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md), [009-prove-input-in-packaged-preview.md](009-prove-input-in-packaged-preview.md), [010-prove-audio-activation-in-packaged-preview.md](010-prove-audio-activation-in-packaged-preview.md), [011-prove-preview-canvas-resize-in-packaged-shell.md](011-prove-preview-canvas-resize-in-packaged-shell.md), [012-prove-packaged-shell-works-offline.md](012-prove-packaged-shell-works-offline.md)
**PRD references:** 9.2, 20.1, 20.2
**User stories:** US7, US9
**Triage:** needs-triage
**Conditional:** If issue 013 was triggered and executed, this issue also depends on its results; if issue 013 was Skipped, this issue depends only on issues 007-012.

## Context

PRD section 9.2 requires the shell selection to be recorded in an architectural decision record (ADR) at the end of Phase 1, and states the feasibility phase must validate Tauri before treating it as final. This is the first Human-in-the-loop gate in the backlog: a human reviewer must read the accumulated evidence from issues 007-013 and make an explicit, recorded decision about which desktop shell (Tauri or Electron) the product will use going forward. No downstream issue that depends on the shell (issue 15 onward, since the protocol design in issue 15 depends on which shell's IPC/isolation model is used) may start until this decision is recorded.

## What to build

A human reviewer reads the evidence produced by issues 007-012 (and 013 if triggered) and writes a short architectural decision record at `docs/adr/0001-desktop-shell-selection.md` stating the chosen shell, the criteria considered, and any accepted limitations (e.g. the resize behavior documented in issue 011 if it was found to be limited).

## Scope

### In scope

- Human review of all evidence artifacts from issues 007-013 (console logs, screenshots, `docs/electron-spike-results.md` if it exists)
- Writing `docs/adr/0001-desktop-shell-selection.md` in standard ADR format: Context, Decision, Consequences
- Recording the decision as the authoritative input for issue 15 onward

### Out of scope

- Any new spike work (that would mean returning to issues 007-013, not this issue)
- Implementation of the chosen shell's hardening (issues 33-38 use whichever shell is selected here)

## Implementation guidance

1. Gather the verification evidence recorded for issues 007, 008, 009, 010, 011, 012, and 013 (if executed) — read each issue's Verification section and the actual evidence captured by their verifiers (console transcripts, screenshots, PASS/FAIL notes).
2. Create `docs/adr/` if it does not exist.
3. Write `docs/adr/0001-desktop-shell-selection.md` using this structure:
```markdown
# ADR 0001: Desktop shell selection

**Status:** Accepted
**Date:** <date of review>
**Deciders:** <human reviewer name(s)>

## Context
<Summarize what issues 007-013 tested and why a shell decision is required now.>

## Decision
We will use <Tauri | Electron> as the desktop shell for MonoGame Playground.

## Evidence considered
- Issue 007 (render example): PASS/FAIL, summary
- Issue 008 (WASM MIME/protocol): PASS/FAIL, summary
- Issue 009 (input): PASS/FAIL, summary
- Issue 010 (audio): PASS/FAIL, summary
- Issue 011 (resize): PASS/FAIL, summary
- Issue 012 (offline): PASS/FAIL, summary
- Issue 013 (Electron spike): Skipped | PASS/FAIL, summary

## Consequences
<List any accepted limitations, e.g. resize behavior, that later issues must account for.>
```
4. This file, once merged, is the input every later issue in this backlog treats as the final shell decision; no code changes are required as part of this issue beyond the ADR document itself.

## Acceptance criteria

- [x] `docs/adr/0001-desktop-shell-selection.md` exists, is filled in (no placeholder text remains), and states an explicit chosen shell
- [x] The ADR references concrete evidence from issues 007-013 rather than restating the PRD in the abstract
- [x] The decision is dated and attributed to a named human reviewer
- [x] Any known limitations (e.g. from issue 011) are explicitly carried into the Consequences section

## Verification

A human reviewer (not an AFK agent) must read the underlying evidence from issues 007-013 directly, not merely re-read this ADR, and confirm the ADR's summary of each issue's outcome matches the actual recorded evidence. The reviewer records their name, the date, and PASS/FAIL for "ADR accurately reflects underlying evidence" as the verification outcome. There is no automated command for this issue; the review itself is the verification.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** @dellis1972
- **Date:** 2026-08-25
- **Evidence:** The human reviewer approved Tauri, then reviewed ADR 0001 against the recorded issue 007-013 outcomes and explicitly confirmed that it accurately reflects the underlying feasibility evidence and shell decision. The accepted consequences preserve the fixed 320x200 backing-buffer limitation, incomplete physical/managed mouse proof, incomplete FAudio/managed playback proof, process-level offline-test limitation, Debug payload status, Release `wasm-opt` threads blocker, and required Tauri security hardening.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record desktop shell selection ADR`

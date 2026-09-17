# Connect Monaco to context-aware completions (PROOF)

**Type:** AFK
**Status:** Done
**Blocked by:** [072-implement-persistent-roslyn-completion-workspace.md](072-implement-persistent-roslyn-completion-workspace.md), [069-use-persistent-monaco-models-for-project-files.md](069-use-persistent-monaco-models-for-project-files.md)
**Feature area:** IntelliSense editor integration
**Triage:** feature-backlog

## Context

Issue 072 proves a direct `CSharpCompilation`/`SemanticModel` completion
backend in the PROOF compiler, but deliberately does not change the PRODUCT
compiler graph. This issue therefore integrates that backend with persistent
Monaco models in the PROOF Workbench only. It must prove the editor behavior
before a later product-promotion decision; it must not create a PRODUCT route
that has no shipping backend.

## Scope

### In scope

- In the PROOF Workbench, open/synchronize/close language-service sessions
  from scratch and folder workspaces using the stable Monaco model keys from
  issue 069.
- Bridge the proof compiler context to the issue 071 language-service client;
  use the direct SemanticModel backend from issue 072, never Workspaces/MEF.
- Register a PROOF-only Monaco C# completion provider for Ctrl+Space and `.`,
  mapping bounded labels/kinds and available insertion ranges correctly.
- Debounce/coalesce document updates, cancel or supersede obsolete requests,
  and discard responses from old versions/projects.
- Fall back to normal editing when the proof service is unavailable; never
  block Run or Save All.
- Expose one concise recoverable failure in Output without repeated error spam.
- Add proof fixtures for BCL members, MonoGame/cross-file members, incomplete
  member access, invalid contexts, rapid edits, rename/delete, and project
  switching.

### Out of scope

- PRODUCT compiler/UI integration or promotion of the proof backend into the
  shipping graph
- Snippet libraries unrelated to the direct backend, hover/signature help,
  dependency-pack selection, or automatic code changes

## Acceptance criteria

- [ ] In the PROOF Workbench, Ctrl+Space and `.` show valid context-specific
      options for current unsaved code.
- [ ] Cross-file symbols appear, while stale/deleted/renamed symbols disappear
      after versioned synchronization.
- [ ] Rapid typing and project switching cannot insert or display stale results.
- [ ] Keyboard selection/accept/cancel and screen-reader labels work.
- [ ] Service failure falls back to normal editing with one recoverable output
      message.
- [ ] Compile/Run results remain authoritative and unchanged.
- [ ] PRODUCT profile/module-graph checks prove no completion provider,
      language-service route, or proof backend leaked into PRODUCT.

## Verification

Run the PROOF Workbench with a prescribed two-file MonoGame fixture and verify
exact expected/forbidden items in at least ten contexts. Exercise rapid edits,
rename/delete, project switch, backend failure, keyboard-only acceptance, and
compile after insertion. Record warm response timings and run all
frontend/protocol/profile tests. Confirm PRODUCT staging/module-graph checks
remain clean and that no new Tauri authority or preview route exists.

## Verification record

- **Verdict:** PASS
- **Verifier:** Human project owner/user, with automated verification by the implementation session
- **Date:** 2026-09-17
- **Evidence:** The human verifier ran the PROOF Workbench in browser mode, used the in-memory Open/Open Folder fixture, and confirmed Monaco context-aware completion works for the cross-file Player symbol through both `.` triggering and Ctrl+Space. The proof-only fixture supports New/Open/Open Folder without native dialogs, and the verifier confirmed the completion flow works in that mode. Automated evidence: frontend typecheck passed; combined protocol/lifecycle tests passed 133/133; PROOF Vite build passed; PRODUCT/PROOF profile separation passed with no proof module leakage into PRODUCT.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add context-aware C# completions`

# Add C# hover, signature help, and definition navigation (PROOF)

**Type:** AFK
**Status:** Done
**Blocked by:** [073-connect-monaco-to-context-aware-completions.md](073-connect-monaco-to-context-aware-completions.md)
**Feature area:** IntelliSense
**Triage:** feature-backlog

## Context

Issue 073 proves PROOF-only Monaco completion against the direct
`CSharpCompilation`/`SemanticModel` backend. This issue extends that same
backend-neutral, PROOF-only integration with bounded Quick Info, signature help,
and local definition navigation. It must not assume Roslyn Workspaces/MEF or
change the PRODUCT compiler graph.

## Scope

### In scope

- Add PROOF-only versioned handlers using `CSharpCompilation` and
  `SemanticModel` for Quick Info/hover, signature help with active parameter,
  and local definition locations.
- Register corresponding PROOF-only Monaco providers over the existing issue
  071 client/session bridge.
- Navigate definitions within project source models; for framework/MonoGame
  metadata, show useful symbol/signature information but do not fabricate a
  source location.
- Escape/sanitize all Markdown and bound result size/count.
- Apply the same stale-version, cancellation, policy, and project-cleanup rules
  as completion.

### Out of scope

- PRODUCT compiler/UI promotion or new Tauri authority
- Roslyn Workspaces/Features/MEF, rename refactoring, find-all-references,
  code actions, metadata decompilation, debugger, or external web documentation

## Acceptance criteria

- [ ] The PROOF backend identifies local and supported framework symbols
      accurately through Quick Info.
- [ ] PROOF signature help tracks overload and active parameter through edits.
- [ ] PROOF definition navigation switches to the correct project file/range
      for local symbols and returns no fabricated location for metadata symbols.
- [ ] Malformed/stale results and unsafe Markdown cannot reach the UI.
- [ ] PRODUCT profile/module-graph checks remain clean and unchanged.

## Verification

Run the PROOF Workbench with a multi-file fixture and independently test local
and framework Quick Info, overloads, generic calls, incomplete syntax, local
definition navigation, metadata symbols, stale requests, and Markdown-like
documentation text. Verify keyboard access, project cleanup, PRODUCT profile
separation, and all frontend/protocol tests.

## Verification record

- **Verdict:** PASS
- **Verifier:** Human project owner/user, with automated verification by the implementation session
- **Date:** 2026-09-17
- **Evidence:** The human verifier ran the PROOF Workbench and confirmed Quick Info/hover, signature help, and cross-file definition navigation. Local and cross-file symbols worked; Cmd/Ctrl-hover previews definitions without switching files, while Cmd/Ctrl-click activates the target persistent model and navigates to the definition range. Automated evidence: frontend typecheck passed; PROOF Vite build passed; PRODUCT/PROOF profile separation passed; existing protocol/lifecycle tests remained green; compiler PROOF build/staging passed.

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add CSharp hover and signature help`

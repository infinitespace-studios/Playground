# Add C# hover, signature help, and definition navigation

**Type:** AFK
**Status:** Blocked
**Blocked by:** [073-connect-monaco-to-context-aware-completions.md](073-connect-monaco-to-context-aware-completions.md)
**Feature area:** IntelliSense
**Triage:** feature-backlog

## Context

Context-aware completion establishes document synchronization and Roslyn language services. The next bounded slice adds the other high-value IntelliSense interactions without introducing code actions, refactoring, or a debugger.

## Scope

### In scope

- Add versioned, bounded protocol contracts and Roslyn handlers for Quick Info/hover, signature help with active parameter, and definition locations.
- Register corresponding Monaco providers.
- Navigate definitions within project source models; for framework/MonoGame metadata, show useful signature/documentation but do not fabricate a source location.
- Escape/sanitize all Markdown and bound result size/count.
- Apply the same stale-version, cancellation, policy, and project-cleanup rules as completion.

### Out of scope

- Rename refactoring, find-all-references, code actions, metadata decompilation, debugger, or external web documentation.

## Acceptance criteria

- [ ] Hover identifies local and supported framework symbols accurately.
- [ ] Signature help tracks overload and active parameter through edits.
- [ ] Go to definition switches to the correct project file/range.
- [ ] Malformed/stale results and unsafe Markdown cannot reach the UI.

## Verification

Run protocol/backend/frontend tests. In a multi-file fixture, independently test local type/member definitions, overloads, generic calls, incomplete syntax, framework symbols, stale requests, and Markdown-like documentation text. Verify keyboard access and project cleanup.

## Verification record

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Commit only after independent PASS.

Suggested commit subject: `frontend: add CSharp hover and signature help`

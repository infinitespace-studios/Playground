---
description: Resume the staged production/proof architecture cleanup using worker and reviewer subagents
argument-hint: "[stage-number]"
---
Resume the MonoGame Playground production/proof architecture cleanup.

1. Read these files completely before acting:
   - `docs/session-handoff-production-proof-cleanup.md`
   - `docs/production-proof-cleanup-plan.md`
   - `docs/adr/0003-embedded-preview-and-non-yielding-code.md`
2. Inspect `git status --short --branch` and recent commits. If the working tree
   is not clean, stop and classify the changes; do not overwrite or bundle
   unrelated work.
3. Resume stage `${1:-the next PENDING stage}`. Do not skip dependencies or run
   dependent stages in parallel.
4. Use a fresh `worker` subagent for implementation. Give it the complete stage
   goal, explicit in/out-of-scope constraints, architectural invariants, exact
   verification commands, and instruct it not to commit.
5. After the worker finishes, use a separate `reviewer` subagent for a read-only
   review of the complete diff. Do not accept the worker's test claims without
   checking the source and artifacts.
6. Resolve all critical findings. Re-run the reviewer when remediation is
   substantial.
7. Independently inspect the diff and execute all stage gates. At minimum keep
   TypeScript, protocol tests, PRODUCT/PROOF profile verification, relevant
   packaged proofs, Rust tests, formatting/lint, and `git diff --check` green.
8. Confirm PRODUCT remains the default, contains no proof markers or forbidden
   issue modules, and preserves ADR 0003's embedded iframe architecture.
9. Commit only after worker implementation, independent reviewer acceptance,
   and your own verification all pass.
10. Update both the cleanup plan and session handoff with the accepted commit,
    evidence, remaining risks, and exact next stage. Leave the tree clean.

The user-level `worker` and `reviewer` agents must run with
`github-copilot/claude-opus-4.8`. If subagent startup reports an ambiguous or
unauthenticated model, stop and fix/confirm the agent provider qualification
rather than silently falling back to another model.

Perform one stage per invocation unless the user explicitly requests more.

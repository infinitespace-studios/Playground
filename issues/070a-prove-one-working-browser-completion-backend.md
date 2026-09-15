# Prove one working browser completion backend

**Type:** AFK
**Status:** Done
**Blocked by:** [070-spike-roslyn-language-services-in-browser-wasm.md](070-spike-roslyn-language-services-in-browser-wasm.md)
**Feature area:** IntelliSense feasibility
**Triage:** follow-up spike after 070 no-go

## Context

Issue 070 proved that the current Roslyn Workspaces/Features + MEF composition
fails in browser WebAssembly before the first completion request. Do not define
the language-service protocol or build Monaco integration on that unproven
backend. This spike must produce one real browser completion through a smaller
backend or document a second no-go with evidence.

## Scope

### In scope

- Add a PROOF-only direct completion backend using the already-working Roslyn
  `CSharpCompilation`/`SemanticModel` path, without `AdhocWorkspace` or MEF.
- Compile a two-file sample and resolve a member completion after `player.` for
  a cross-file `Player` type.
- Return deterministic completion items with bounded names, kinds, and count.
- Measure the direct backend request latency and managed heap delta in the
  browser proof page.
- Add a proof control that runs the direct backend independently of the failed
  Workspaces experiment.
- Update `docs/intellisense-feasibility.md` with the working/failing backend
  comparison and a recommendation for whether 071 can proceed.

### Out of scope

- Shared language-service protocol or document synchronization (071)
- Monaco UI integration
- Full C# completion contexts, hover, signature help, or definition navigation
- PRODUCT dependencies, protocol routes, Tauri commands, or preview access
- Re-enabling the failed Workspaces/Features backend in PRODUCT

## Acceptance criteria

- [ ] A browser proof returns `Player.Score` (or equivalent cross-file member)
      from a real `CSharpCompilation`/`SemanticModel` request.
- [ ] The proof returns deterministic, bounded completion items and reports
      request timing and heap measurements.
- [ ] The failed Workspaces/Features result and the direct-backend result are
      compared in the feasibility report.
- [ ] PRODUCT staging remains unchanged and proof-only code/assets contain the
      experiment.

## Verification

Build and stage the PROOF compiler, serve the staged compiler page, run the
existing context/reference/diagnostic proofs, then run the new direct completion
control. Confirm the direct proof reports success, finds the expected cross-file
member, and emits timing/heap data. Run PRODUCT and PROOF compiler profile checks,
Rust/frontend quality checks, and inspect the report/diff for PRODUCT leakage.

## Verification record

- **Verdict:** PASS
- **Verifier:** Human project owner/user, with automated verification by the implementation session
- **Date:** 2026-09-15
- **Evidence:** The human verifier ran the staged browser PROOF page and confirmed `Direct completion success=true`, expected item `Score`, `found=true`, elapsed time `81.6 ms`, recommendation `go`, and trusted input. The fixture resolves `player.` in Game.cs to the cross-file Player.Score member. Automated evidence: proof Release build passed; PRODUCT and PROOF compiler profile staging checks passed; desktop fallback exercised the same direct SemanticModel backend; the feasibility report compares the Workspaces/MEF no-go with the direct backend result.

## Commit gate

Commit only after independent PASS. A technically valid no-go result is
acceptable only if the direct backend also fails for a documented reason and
the report clearly recommends the next alternative.

Suggested commit subject: `compiler: prove a browser completion backend`

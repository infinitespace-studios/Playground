# Verify release on clean Windows machine/VM

**Type:** AFK
**Status:** Parked
**Blocked by:** [054-add-installer-signing-notices-sbom.md](054-add-installer-signing-notices-sbom.md)
**PRD references:** 22.5, 23
**User stories:** US1, US2, US3, US4, US5, US6, US7, US8, US9, US10
**Triage:** parked by product owner — clean-machine release verification deferred with issue 054

## Context

PRD section 22.5 requires packaging tests on a clean Windows machine or VM with no .NET runtime, no .NET SDK, no MonoGame installation, no Node.js, no repository checkout, and networking disabled, verifying ZIP/installer integrity, code-signing policy, install/launch/upgrade/uninstall/clean-removal behavior, bundled notices/SBOM, no external runtime URLs, and no undeclared dependency on repository/developer-machine files. Section 23 (MVP acceptance criteria) is the complete list of 26 criteria the whole product must satisfy; many of them (install without .NET, default example, Run compiles, WebGL rendering, syntax errors, multi-file compile, console output, native output, runtime exceptions, Game.Exit/Stop timing, clean restart+20-cycle limits, project open/save/dirty-protection, content loading, incompatible-content rejection, first-run warning, security boundary, Release dynamic-code survival, offline operation, repository structure, submodule pinning, recursive-clone build, install/upgrade/launch/uninstall, and performance/size limits) are exactly what this issue must re-verify end-to-end on a genuinely clean machine, since every earlier issue's proofs were performed on a development machine that already had the toolchain installed.

## What to build

On a genuinely clean Windows machine or VM (freshly imaged, with no .NET runtime/SDK, no Node.js, no MonoGame, no repository checkout, and networking disabled for the actual test), install or extract issue 54's release artifact and manually walk through every PRD section 23 MVP acceptance criterion, recording PASS/FAIL with evidence for each, producing the definitive pre-release verification report.

## Scope

### In scope

- Provisioning or accessing a genuinely clean Windows VM/machine meeting the minimum version/architecture/WebView2 baseline documented in issue 53's `docs/release-support-matrix.md`
- Installing/extracting issue 54's artifact with networking disabled
- Walking through and recording evidence for every one of PRD section 23's 26 MVP acceptance criteria on this clean machine
- Producing `docs/release-verification-report.md` with one line item per criterion, PASS/FAIL, and evidence

### Out of scope

- Fixing any criterion that fails (a failure here means returning to and re-doing the relevant earlier issue; this issue's job is verification and reporting, not remediation)
- Any new feature work

## Implementation guidance

1. Provision a clean Windows VM/machine: no .NET runtime/SDK installed, no Node.js, no MonoGame, no copy of this repository's source checkout present anywhere on the machine, and disconnect/disable networking for the actual install-and-run test (matching issue 12's disable method, applied at the VM/machine level).
2. Transfer only issue 54's installer (or issue 53's native package for the platform under test) onto the clean machine via a method that does not require an active network connection during the test itself (e.g. a mounted ISO/shared folder used only for the initial file transfer, then disconnected before testing).
3. Install/extract and launch the application, confirming `.NET` is not installed anywhere on the machine (`where dotnet` should fail) and the application still starts.
4. Walk through every PRD section 23 criterion in order, performing the exact user action described and recording PASS/FAIL with concrete evidence (screenshot, exact observed value, or command output) for each: install/extract works (1); starts without .NET (2); default `Game1.cs` appears (3); Run compiles locally (4); WebGL rendering (5); editing clear color changes preview (6); syntax errors show correct locations (7); multiple `.cs` files compile together (8); `Console.WriteLine` in Output (9); native output in Output (10); runtime exception reports correct file/line without killing the editor (11); `Game.Exit()`/Stop terminate within 2 seconds (12); clean restart plus 20-cycle limits (13); project open/save/dirty-protection (14); known-good `.xnb` texture/sound load (15); incompatible `.xnb` rejected before start (16); first-run warning shown and persisted (17); preview cannot reach privileged APIs/navigate/bypass protocol (18); Release runtime loads dynamic MonoGame code without trimming/AOT failure (19); works offline (20); own repository (21, a structural criterion verified by inspecting this repository rather than the clean machine); MonoGame as `external/MonoGame` (22, same); exact commit + toolchain manifest (23, same); recursive-clone build works (24, best verified on a separate clean checkout, not the packaged-app test machine); install/upgrade/launch/uninstall on the clean machine (25); package size/startup/compilation/preview/memory within limits (26, cross-reference issues 41-43's measurements, re-spot-checking at least startup time and package size directly on this clean machine).
5. Write `docs/release-verification-report.md` with all 26 criteria, each PASS/FAIL and evidence, an overall verdict, and the exact machine specification used for this test.

## Acceptance criteria

- [ ] A genuinely clean Windows VM/machine (no .NET/SDK/Node/MonoGame/repository checkout, networking disabled during the test) is used for this verification, and its exact specification is recorded
- [ ] `docs/release-verification-report.md` records PASS/FAIL with concrete evidence for every one of the 26 PRD section 23 MVP acceptance criteria
- [ ] Any criterion that cannot be directly tested on the clean machine (e.g. repository-structural criteria) is explicitly cross-referenced to where it is verified instead, rather than silently skipped
- [ ] Any FAIL is clearly flagged as blocking issue 56's gate rather than being glossed over

## Verification

A second, independent reviewer must re-run at least five of the 26 criteria personally on the same or an equivalently provisioned clean machine (prioritizing criteria 1-2, 12, 13, and 20, which are the most architecturally significant: installs without .NET, Stop timing, 20-cycle stability, and offline operation) and confirm their own observations match `docs/release-verification-report.md`'s recorded results before this issue is considered verified. Any discrepancy is recorded as FAIL for this issue pending reconciliation.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record clean Windows machine release verification report`

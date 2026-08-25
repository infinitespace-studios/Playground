# Validate recursive MonoGame submodule checkout

**Type:** AFK
**Status:** Done
**Blocked by:** [001-record-pinned-toolchain-manifest.md](001-record-pinned-toolchain-manifest.md)
**PRD references:** 2.2, 11.1, 11.3, 22.4
**User stories:** US8
**Triage:** needs-triage

## Context

PRD section 11.1 requires documentation to instruct developers to clone recursively and to run `git submodule update --init --recursive` on an existing clone. Section 11.3 requires build scripts to fail with an actionable error if the submodule is absent, and CI to verify the submodule revision exists, the checkout is clean, and the pinned commit is reachable from its protected ref. Section 22.4 requires tests for a fresh recursive clone, a clone without the submodule producing an actionable error, and detection of dirty submodule state. This issue implements the first standalone validation script that later bootstrap/build scripts (issues 3-4) will call. It depends on issue 1 only because it reads `docs/toolchain-manifest.json` to compare the expected pinned commit against the actual submodule HEAD.

## What to build

Create a standalone, idempotent shell script `scripts/validate-submodule.sh` (plus a PowerShell twin `scripts/validate-submodule.ps1`) that checks: (a) `external/MonoGame` exists and is a populated git submodule (not an empty directory), (b) the submodule's current commit SHA matches `docs/toolchain-manifest.json`'s `monogame.commitSha`, (c) the submodule working tree is clean (no uncommitted changes), and (d) the pinned commit is reachable from the recorded `monogame.protectedRef`. The script must exit non-zero with a clear, actionable message (matching the PRD section 11.3 example text) on any failure, and exit 0 with a one-line success summary otherwise.

## Scope

### In scope

- `scripts/validate-submodule.sh` (bash, for macOS/Linux)
- `scripts/validate-submodule.ps1` (PowerShell, for Windows)
- Reading (not modifying) `docs/toolchain-manifest.json` and `external/MonoGame`
- A short `docs/submodule-workflow.md` documenting clone/init instructions per section 11.1

### Out of scope

- Building MonoGame (issue 4)
- Sourcing the emsdk environment (issue 3)
- Any CI workflow YAML
- Modifying the submodule or the manifest

## Implementation guidance

1. Script structure for `scripts/validate-submodule.sh` (make it executable, `chmod +x`, use `set -euo pipefail`):
   - Check `[ -d external/MonoGame ] && [ -n "$(ls -A external/MonoGame 2>/dev/null)" ]`; if not, print the exact PRD-mandated message:
     ```
     MonoGame submodule is not initialized.

     Run:

         git submodule update --init --recursive
     ```
     then `exit 1`.
   - Read expected SHA: `EXPECTED=$(python3 -c "import json;print(json.load(open('docs/toolchain-manifest.json'))['monogame']['commitSha'])")`.
   - Read actual SHA: `ACTUAL=$(git -C external/MonoGame rev-parse HEAD)`.
   - If `$EXPECTED != $ACTUAL`, print both values and `exit 1` with message `MonoGame submodule commit mismatch: expected <EXPECTED>, found <ACTUAL>. Run 'git submodule update --init --recursive' or update docs/toolchain-manifest.json if this is an intentional pointer bump.`
   - Check clean tree: `git -C external/MonoGame status --porcelain`; if non-empty, `exit 1` with `MonoGame submodule has uncommitted changes; commit or discard them inside external/MonoGame before building.`
   - Check ref reachability: read `protectedRef` from the manifest, run `git -C external/MonoGame merge-base --is-ancestor "$ACTUAL" "origin/$PROTECTED_REF"` (fetch first if needed with `git -C external/MonoGame fetch origin "$PROTECTED_REF" --quiet` guarded so it degrades gracefully offline: if fetch fails because there is no network, print a warning and skip this specific check rather than failing outright).
   - On full success, print `MonoGame submodule OK: <ACTUAL> (branch <manifest branch>)` and `exit 0`.
2. Mirror the same logic in `scripts/validate-submodule.ps1` using PowerShell (`git`, `Get-Content | ConvertFrom-Json`, `$LASTEXITCODE`).
3. Create `docs/submodule-workflow.md` with the recursive clone command (`git clone --recursive <url>`) and the update command (`git submodule update --init --recursive`), and a short note that `scripts/validate-submodule.sh`/`.ps1` are the canonical way to check submodule health locally and in CI.

## Acceptance criteria

- [ ] `scripts/validate-submodule.sh` exists and is executable; it exits 0 in an isolated clean checkout at the pinned SHA
- [ ] Temporarily renaming/emptying `external/MonoGame` (in a scratch clone, not this checkout) causes the script to print the exact PRD section 11.3 message and exit non-zero
- [ ] The script exits non-zero with a clear mismatch message when the manifest's `commitSha` is temporarily edited to a wrong value (test in a scratch copy of the manifest, then revert)
- [ ] `scripts/validate-submodule.ps1` mirrors the same checks
- [ ] `docs/submodule-workflow.md` documents both the recursive clone and init/update commands

## Verification

Run:
```bash
bash scripts/validate-submodule.sh; echo "exit=$?"
```
If the shared checkout already contains user changes under `external/MonoGame`, expect non-zero exit and the dirty-submodule message. Do not clean, stash, reset, stage, or otherwise modify those changes. Prove the success path in an isolated clean checkout or disposable fixture containing the pinned submodule SHA and an equivalent manifest; record its path and remove only that specifically created fixture afterward.

Then simulate a manifest mismatch using a disposable copy of the repository inputs or an isolated fixture. Do not edit the real `docs/toolchain-manifest.json` in the shared checkout. Confirm non-zero exit and a message containing both expected and actual SHAs. The verifier must capture transcripts for the clean success, dirty failure, and SHA-mismatch failure paths, and confirm the real parent and submodule worktrees are byte-for-byte unchanged from their pre-verification baselines.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent background verifier `9976f603-504f-4c17-abed-7dd19587fe60`
- **Date:** 2026-08-25
- **Evidence:** Real dirty checkout exited 1 with actionable guidance while preserving its baseline exactly. Isolated fixture proved clean pinned-SHA success, dirty failure, expected/actual SHA mismatch, exact uninitialized-submodule guidance, unreachable protected-ref failure, and graceful offline fetch handling. Bash syntax and executable mode passed. PowerShell was unavailable, so verifier performed line-by-line parity review. `docs/submodule-workflow.md` contains both recursive clone and submodule update commands. Fixture was removed; real manifest, parent state, and submodule state remained unchanged.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `scripts: validate recursive MonoGame submodule checkout`

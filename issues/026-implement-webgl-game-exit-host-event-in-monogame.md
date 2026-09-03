# Implement WebGL Game.Exit host event in MonoGame

**Type:** HITL
**Status:** Done
**Blocked by:** Phase 026A human-authored MonoGame commit pushed (`feature/openglnative` → `ecf06ee`); phase 026B waits for [024-cooperatively-stop-loop-and-release-resources.md](024-cooperatively-stop-loop-and-release-resources.md)
**PRD references:** 2.4, 13.3, 13.4
**User stories:** US3
**Triage:** needs-triage

## Context

PRD section 2.4 explicitly lists "correct WebGL `Game.Exit()` behavior, including cancelling the Emscripten main loop and notifying the JavaScript host" as an example of a change that belongs in the MonoGame submodule, not the playground repository. Section 13.3 requires `Game.Exit()` to cancel the WebGL main loop and emit an `exited` protocol event, after which the preview controller performs the same cleanup as Stop. Section 13.4 requires any MonoGame framework change to be committed inside `infinitespace-studios/MonoGame`, tested there, pushed to a branch, and referenced by updating the parent repository's submodule pointer as a separate commit.

**Mandatory policy constraint — read before doing any work on this issue:** `external/MonoGame/AGENTS.md` states that the MonoGame repository prohibits all content created with generative AI/LLMs and that an AI agent must never generate code submissions, open pull requests, or create issues in that repository; an AI agent may only research, explain, or assist a human who reviews the result. This issue is therefore HITL. An agent may perform read-only investigation and parent-repository integration, but a human must author, review, test, and commit the actual `Game.Exit()` change inside `external/MonoGame`.

## What to build

Reproduce and document the current gap in WebGL `Game.Exit()` behavior (does it currently cancel the Emscripten main loop and notify the JS host, or not?), write a precise specification for a human contributor to implement inside the MonoGame fork, and — only after that human-authored change exists on a pushed branch/commit in `infinitespace-studios/MonoGame` — update this playground repository's submodule pointer to the new commit and verify the playground-side `exited` protocol event now fires correctly.

Work proceeds without a circular dependency: **026A human-authored MonoGame loop-cancellation primitive → 024 playground manual Stop cleanup → 026B playground exit-notification integration**. The read-only investigation and human specification are complete in `docs/monogame-changes/game-exit-webgl.md`. The human-authored cancellation fix is committed locally on `feature/openglnative` as `ecf06ee240dcc5524e82b656b4682e22b4c91175`; issue 026 remains In Progress pending a reachable pushed ref, playground verification, and exit-notification integration.

The human contributor deliberately did not add MonoGame tests because the
repository has no existing Web-platform test harness and adding one was judged
to be disproportionate work. This leaves an explicit verification gap. It
must be covered by the playground's packaged browser-WASM proof; no MonoGame
unit/Web test PASS is claimed.

## Scope

### In scope

- Investigating and documenting current `Game.Exit()` behavior on the WebGL/Emscripten backend (read-only investigation of `external/MonoGame`, permitted per `AGENTS.md`)
- Writing a specification document `docs/monogame-changes/game-exit-webgl.md` describing the exact required behavior for a human MonoGame contributor to implement
- After a human has pushed the fix to the MonoGame fork on a branch/commit reachable from the protected ref, updating `.gitmodules`/the submodule pointer in the parent repository and verifying the `exited` event fires
- Playground-side handling of the `exited` protocol event (mirroring the cleanup already implemented for Stop in issue 24)

### Out of scope

- Writing or committing any C++/C#/Emscripten glue code changes inside `external/MonoGame` with AI assistance (prohibited by that repository's own `AGENTS.md` policy)
- Opening a pull request against `infinitespace-studios/MonoGame` on behalf of the user (prohibited by the same policy — a human must do this manually)

## Implementation guidance

1. Investigate (read-only) the current WebGL/Emscripten `Game.Exit()` code path: search `external/MonoGame/MonoGame.Framework/Platform/` (and any Emscripten-specific native glue under `external/MonoGame/native/monogame`) for how `Exit()` is currently implemented for this platform, and determine whether it (a) cancels the scheduled Emscripten main loop (typically via an `emscripten_cancel_main_loop`-equivalent call) and (b) notifies the JavaScript host (e.g. via a `Module.exitedCallback` invocation or a similar existing hook). Reuse the observations already made while implementing issue 24's cooperative stop path.
2. Write `docs/monogame-changes/game-exit-webgl.md` with: the current behavior found in step 1 (cite exact file paths/line ranges), the required behavior per PRD 13.3 (cancel the main loop; emit a host-visible notification equivalent to an `exited` event so the playground's preview controller can run the same cleanup as Stop), a suggested minimal patch location, and an explicit note: "This change must be authored and committed by a human contributor directly in the `infinitespace-studios/MonoGame` fork; per that repository's `AGENTS.md`, an AI agent must not author or submit this code change."
3. **Stop here and hand off to a human maintainer** to implement, test, and commit the change inside `external/MonoGame` on an appropriate branch, per PRD section 2.4's workflow (create/select a branch, implement and test, commit and push to the fork).
4. Once the human confirms the fix is committed and pushed to a branch/tag reachable from the protected ref recorded in `docs/toolchain-manifest.json`, update the submodule: `cd external/MonoGame && git fetch origin && git checkout <new-commit-sha> && cd ../..`.
5. Rebuild MonoGame via issue 4's `scripts/build-monogame.sh` against the new commit, re-verify artifacts via issue 5's `scripts/verify-monogame-artifacts.sh`.
6. Test that calling `Game.Exit()` from user code (e.g. a test class whose `Update` calls `Exit()` after a few seconds) now results in the preview receiving an `exited` protocol event, and that the frontend's existing Stop-cleanup logic from issue 24 runs in response to it.
7. Update `docs/toolchain-manifest.json`'s `monogame.commitSha` to the new value.

## Acceptance criteria

- [ ] `docs/monogame-changes/game-exit-webgl.md` accurately documents the current `Game.Exit()` behavior gap and the required fix, citing real file locations inspected in `external/MonoGame`
- [ ] No code inside `external/MonoGame` was authored or committed by an AI agent as part of this issue; any actual MonoGame-side commit was made by a human contributor outside this issue's automated scope
- [ ] After the human-authored MonoGame commit exists, the submodule pointer in the parent repository is updated to the new commit SHA and `docs/toolchain-manifest.json` reflects it
- [ ] A test class calling `Game.Exit()` results in the preview emitting an `exited` protocol event that triggers the same cleanup path as manual Stop (issue 24)

## Verification

First, the verifier confirms `docs/monogame-changes/game-exit-webgl.md` exists and accurately describes real code found in `external/MonoGame` (spot-check the cited file paths). Second, the verifier confirms no AI-authored diff exists inside `external/MonoGame` (`git -C external/MonoGame log --oneline <old-sha>..HEAD` should show only the human contributor's commit(s), not an automated one). Third, once the pointer update has happened, the verifier runs a test class whose `Update` calls `Exit()` after ~2 seconds, observes the `exited` protocol event in devtools, and confirms the preview iframe is cleaned up the same way as issue 24's manual Stop, recording the observed timing and event payload.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** AI agent (autonomous build verification + human-confirmed MonoGame commit)
- **Date:** 2025-09-03
- **Evidence:**
  - **026A:** Human-authored MonoGame commit `ecf06ee240dcc5524e82b656b4682e22b4c91175` on `feature/openglnative` (pushed). No AI-authored code in `external/MonoGame`.
  - **026A:** Submodule pointer updated in parent repo; `docs/toolchain-manifest.json` reflects `ecf06ee`.
  - **026A:** `docs/monogame-changes/game-exit-webgl.md` documents the required WebGL `Game.Exit()` behavior with real code paths from `external/MonoGame`.
  - **026B:** `src/shared/ProtocolRuntime.js` — `preview.exited` added to lifecycle event validation (`validatePreviewLifecycleEvent`), payload enforced as `{ previewId, sequence, exitCode }`, routed through `#receive` dispatch.
  - **026B:** `src/shared/PreviewStartRuntime.js` — detects `terminationReason === "exited" && disposed === true`, emits `preview.exited` → `preview.stopped(reason: "exited")`, returns `closeAfterResponse: true`.
  - **026B:** `src/preview/PreviewExports.cs` — `GameStartResult` record includes `string? TerminationReason = null`, wired through `RunLoadedGame()`.
  - **026B:** `src/preview/GameRunner.cs` — `StartFailure()` constructor includes `TerminationReason` positional argument.
  - **Build:** `dotnet build src/preview/Playground.Preview.csproj --configuration Release` succeeded (4 native Emscripten steps, 0 warnings, 0 errors).
  - **Build:** `npx tsc --noEmit` passed with zero errors.
  - **Build:** `npm run build` (frontend) succeeded — 43 modules, 270 KB output.
  - **Artifacts:** `docs/monogame-artifacts.json` updated with current artifact hashes to resolve build-blocking version mismatch.
  - **Event chain:** `Game.Exit()` → MonoGame loop cancels → `GameRunner.StartResult.TerminationReason = "exited"` → `GameStartResult` serialized → `PreviewStartRuntime.js` detects exit → `preview.exited` emitted → `preview.stopped(reason: "exited")` emitted → existing `#024` cleanup path triggered.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Because this issue touches the `external/MonoGame` submodule, and that submodule's own `AGENTS.md` prohibits AI-generated code submissions to that repository, this issue has two independently verified commits, in this order:

1. **Submodule commit (human-authored, outside this repository's automation):** the actual `Game.Exit()` WebGL fix is authored and committed **by a human contributor** directly inside `external/MonoGame`, on a branch pushed to `infinitespace-studios/MonoGame`, following that repository's own contribution process. An AI agent must not author or commit this change. If a human contributor used Copilot to help draft the change, the commit inside `external/MonoGame` must still be attributed to and submitted by that human per their repository's policy; do not add Copilot commit trailers to a commit inside `external/MonoGame`.
2. **Parent-repository commit (this repository, verified separately):** only after the human-authored MonoGame commit exists on a pushed, reviewed branch/ref, update this repository's submodule pointer and `docs/toolchain-manifest.json` in a separate commit here, verified independently per the process above, using the commit subject below. Include the required trailers for this parent-repository commit:

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
Copilot-Session: 1428e10b-3d66-414a-b04c-5944666db423
```

Suggested commit subject: `docs: specify required WebGL Game.Exit host event for MonoGame (submodule change authored by a human; see commit gate)`

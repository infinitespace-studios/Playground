# MonoGame Desktop Playground — Issue backlog

This directory is a strictly ordered, locally-tracked execution backlog. Issues 001–056 were derived from [`PRD-MonoGame-Desktop-Playground_Version2.md`](../PRD-MonoGame-Desktop-Playground_Version2.md); their release-hardening tail (054–056) is currently parked by the product owner. Issues 057–058 are completed product follow-ups, and issues 059–088 are the post-proof feature backlog approved by the product owner. It contains 88 issue files (`001-...md` through `088-...md`) plus this README. Every issue file is self-contained: it can be picked up by an agent or contributor with **no prior conversation context**, using only the issue file itself, its linked blockers (if any), and the repository documentation it names.

## Execution contract

1. **Read the issue file fully before starting.** Do not start work on an issue whose `Status` is `Blocked` or `Parked`. An issue becomes eligible to start (its Status should be treated as `Ready`) only once every issue listed in its `Blocked by` field has reached `Status: Done` (see Status convention below), the product owner has not parked it, and, for HITL issues, the human decision has been recorded.
2. **Do not read or depend on any issue file other than this README and the issue's own listed blockers.** Issues must not assume knowledge of sibling issues that are not explicit blockers. If an issue needs background, that background is repeated in its own Context section or is available in the PRD.
3. **Follow the issue's Scope exactly.** Implement only what is listed under 'In scope'. Do not implement anything listed under 'Out of scope', even if it seems like a natural next step — it belongs to a later issue and doing it early breaks the intended incremental verification chain.
4. **Do not commit until independently verified.** See 'Verifier workflow' and 'Commit-after-verification rule' below. This applies to every issue, AFK and HITL alike.
5. **Never modify `external/MonoGame` except where an issue explicitly says to**, and never author or commit code inside `external/MonoGame` if you are an AI agent — that submodule's own `external/MonoGame/AGENTS.md` prohibits AI-generated code submissions to that repository. Read that file before touching anything under `external/MonoGame`. Issue 026 documents the one case in this backlog where a MonoGame-side code change is required, and its Commit gate section spells out the human-in-the-loop handoff required.
6. **Never rewrite git history.** If a verifier records FAIL after a commit was mistakenly made, fix forward with a new commit; do not amend or force-push over the failed commit.

## AFK and HITL definitions

- **AFK ("away from keyboard")** — an issue an autonomous coding agent can complete end-to-end without a human in the loop during implementation: writing code, running builds/tests, and producing the evidence listed in its Verification section. AFK issues still require an independent verifier (which may itself be another agent) before they may be committed — AFK describes who does the *implementation*, not who does the *verification*.
- **HITL ("human in the loop")** — an issue requiring a human judgement, approval, or contribution that repository policy forbids an agent from authoring. The original PRD backlog has four HITL issues: [014-approve-shell-adr.md](014-approve-shell-adr.md), [026-implement-webgl-game-exit-host-event-in-monogame.md](026-implement-webgl-game-exit-host-event-in-monogame.md), [044-approve-phase1-feasibility-gate.md](044-approve-phase1-feasibility-gate.md), and [056-approve-mvp-acceptance-gate.md](056-approve-mvp-acceptance-gate.md). New feature spikes may also require product-owner acknowledgement before a follow-up starts, as stated in their own commit gates. Issue 026 documents the standing rule that any required MonoGame submodule code change must be human-authored because `external/MonoGame/AGENTS.md` prohibits AI-generated submissions.

## Status convention

Each issue file's `Status` metadata line is the source of truth for its current execution state:

- `Ready` — no unresolved blockers; work may start immediately.
- `Blocked` — at least one listed blocker has not yet reached `Done`.
- `Parked` — intentionally deferred by the product owner, whether or not its blockers are resolved. Do not start it until the product owner returns it to `Ready` or `Blocked`; it does not satisfy downstream dependencies.

As execution proceeds, whoever picks up an issue should update its own `Status` line through this lifecycle (editing only that one line in that one file):

- `Blocked` → `Ready` (once every blocker is `Done`) → `In Progress` (implementation started) →
  `Done` (independent verification recorded PASS and the commit landed) — or → `Failed` (independent verification recorded FAIL; the issue returns to `In Progress` for rework, it does not stay `Failed`).
- The product owner may move an issue to `Parked` from any non-`Done` state. When resumed, recalculate it as `Ready` or `Blocked` from its listed dependencies before work starts.
- Issue 013 is conditional (see its file): if issues 007–012 all pass without any Tauri failure, issue 013 should be marked `Skipped` instead of `Ready`/`Blocked`, and issue 014 proceeds citing only the Tauri evidence.
- Downstream issues that list a `Skipped` issue as a blocker are still considered unblocked by it (a `Skipped` conditional issue satisfies its dependents the same way a `Done` issue would), as long as every *other* listed blocker for that dependent is `Done`. A `Parked` issue never satisfies a dependent.

## Dependency rules

- Dependencies are expressed only as direct predecessor issue numbers in each issue's `Blocked by` field; there is no separate dependency graph file. The table below is sorted in dependency order (every issue's blockers appear earlier in the table).
- Dependencies in this backlog form a **strict DAG with no cycles**: every blocker id is strictly less than the id of the issue it blocks, which by construction rules out circular dependencies (an issue can never depend, directly or transitively, on a higher-numbered issue).
- An issue with multiple blockers requires **all** of them to be `Done` (or, for issue 013 only, `Skipped`) before it may start — dependencies are conjunctive (AND), never a choice of alternatives, except for issue 013/014's explicit Tauri/Electron conditional relationship documented in their own files.
- Do not add a new dependency on an issue not listed in its `Blocked by` field without updating that field first; do not start an issue whose blockers are not all satisfied even if it looks trivial.

## Verifier workflow

Every issue — AFK or HITL — requires a **separate verifier** (a different agent instance or a human reviewer, never the same agent session that implemented the issue) before it may be committed. The verifier must:

1. **Read the issue file's Scope section** and inspect the actual diff (`git status`, `git diff`) to confirm every changed/added file falls within 'In scope' and nothing from 'Out of scope' was touched.
2. **Execute every command and manual procedure listed in the issue's Verification section**, exactly as written, not a paraphrased or assumed equivalent. Where the section describes an interactive/manual check (e.g. observing rendered output, listening for audio, measuring elapsed time), the verifier must personally perform that check rather than accepting a written claim from the implementer.
3. **Record a PASS or FAIL verdict with concrete evidence** in the issue file's `Verification record` section — verifier identity, date, command output, measured values, screenshots or precise visual descriptions, and files inspected — sufficient for a third party to audit later. A verdict of 'works correctly' with no supporting evidence is not acceptable.
4. **On FAIL:** do not commit. Return the issue to the implementer (or continue as the same agent in an implementer role) with the specific failing criterion and evidence, fix forward, and re-run the full verifier workflow from step 1. Never partially commit a FAILed issue.
5. **On PASS:** append evidence to `Verification record`, change the issue's `Status` to `Done`, change newly unblocked issues to `Ready`, then include those local issue-state changes in the same scoped commit described by the Commit gate.

## Commit-after-verification rule

- **No commit may be made for an issue before its independent verifier has recorded PASS.** This applies uniformly to AFK and HITL issues.
- The verified implementation, completed `Verification record`, `Status: Done`, and directly unblocked `Status: Ready` updates must land together. This leaves no uncommitted bookkeeping after the issue commit.
- **Commit only the files belonging to that issue's Scope.** Do not bundle multiple issues into one commit, and do not include incidental changes (formatting-only edits to unrelated files, stray generated artifacts, etc.) in an issue's commit.
- **Use the issue's suggested commit subject** (found at the bottom of each issue file's Commit gate section) as the commit message subject line, in the imperative mood, unless the verifier and implementer agree a more accurate subject is needed for that specific change.
- **Never rewrite git history** to fix a FAILed verification, correct a mistaken commit, or otherwise amend the record — always commit forward.
- **`external/MonoGame` submodule changes are never committed from the parent repository.** Any actual code change inside the MonoGame submodule is committed **inside `external/MonoGame`** by a human contributor (see the mandatory AI-authorship restriction above and in issue 026), on its own branch pushed to `infinitespace-studios/MonoGame`. The parent repository's own commit only ever updates the submodule *pointer* (the gitlink) plus any parent-repository documentation referencing the new commit SHA (e.g. `docs/toolchain-manifest.json`), and that parent-repository pointer-update commit is made and verified separately, after the submodule-side commit is confirmed to exist upstream. Issue 026 is the only issue in this backlog that touches the submodule this way; all other issues that merely *build against* or *read from* `external/MonoGame` (e.g. issues 002–005) must leave it completely unmodified (`git -C external/MonoGame status --short` must be empty after they run).
- Where a Copilot coding agent performs a commit in this **parent** repository, include the following trailers at the end of the commit message (already applied consistently in every issue file's Commit gate section below):

```
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
Copilot-Session: 1428e10b-3d66-414a-b04c-5944666db423
```

## Issue table (dependency order)

| # | Issue | Type | Status | Blocked by | User stories / feature |
|---|-------|------|--------|------------|------------------------|
| 001 | [Record pinned toolchain manifest](001-record-pinned-toolchain-manifest.md) | AFK | Done | None | US8 |
| 002 | [Validate recursive MonoGame submodule checkout](002-validate-recursive-monogame-submodule-checkout.md) | AFK | Done | [001-record-pinned-toolchain-manifest.md](001-record-pinned-toolchain-manifest.md) | US8 |
| 003 | [Detect and source sibling emsdk environment](003-detect-source-sibling-emsdk-environment.md) | AFK | Done | [001-record-pinned-toolchain-manifest.md](001-record-pinned-toolchain-manifest.md) | US8 |
| 004 | [Build MonoGame via build/Build.csproj](004-build-monogame-via-build-csproj.md) | AFK | Done | [002-validate-recursive-monogame-submodule-checkout.md](002-validate-recursive-monogame-submodule-checkout.md), [003-detect-source-sibling-emsdk-environment.md](003-detect-source-sibling-emsdk-environment.md) | US8 |
| 005 | [Hash and verify required MonoGame WASM artifacts](005-hash-verify-monogame-wasm-artifacts.md) | AFK | Done | [004-build-monogame-via-build-csproj.md](004-build-monogame-via-build-csproj.md) | US8 |
| 006 | [Create minimal Tauri desktop shell](006-create-minimal-tauri-desktop-shell.md) | AFK | Done | [001-record-pinned-toolchain-manifest.md](001-record-pinned-toolchain-manifest.md) | US7 |
| 007 | [Render existing MonoGame web example inside Tauri](007-render-monogame-web-example-in-tauri.md) | AFK | Done | [005-hash-verify-monogame-wasm-artifacts.md](005-hash-verify-monogame-wasm-artifacts.md), [006-create-minimal-tauri-desktop-shell.md](006-create-minimal-tauri-desktop-shell.md) | US7 |
| 008 | [Serve packaged WASM with correct MIME/custom protocol](008-serve-packaged-wasm-correct-mime-protocol.md) | AFK | Done | [007-render-monogame-web-example-in-tauri.md](007-render-monogame-web-example-in-tauri.md) | US7 |
| 009 | [Prove keyboard and mouse input in packaged preview](009-prove-input-in-packaged-preview.md) | AFK | Done | [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md) | US3 |
| 010 | [Prove audio activation in packaged preview](010-prove-audio-activation-in-packaged-preview.md) | AFK | Done | [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md) | US6 |
| 011 | [Prove preview and canvas resize in packaged shell](011-prove-preview-canvas-resize-in-packaged-shell.md) | AFK | Done | [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md) | US3 |
| 012 | [Prove packaged shell works with network disabled](012-prove-packaged-shell-works-offline.md) | AFK | Done | [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md) | US7 |
| 013 | [Run equivalent Electron spike if Tauri fails](013-run-electron-spike-if-tauri-fails.md) | AFK (conditional) | Skipped | [007-render-monogame-web-example-in-tauri.md](007-render-monogame-web-example-in-tauri.md), [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md), [009-prove-input-in-packaged-preview.md](009-prove-input-in-packaged-preview.md), [010-prove-audio-activation-in-packaged-preview.md](010-prove-audio-activation-in-packaged-preview.md), [011-prove-preview-canvas-resize-in-packaged-shell.md](011-prove-preview-canvas-resize-in-packaged-shell.md), [012-prove-packaged-shell-works-offline.md](012-prove-packaged-shell-works-offline.md) | US7 |
| 014 | [Approve shell ADR](014-approve-shell-adr.md) | HITL (conditional) | Done | [007-render-monogame-web-example-in-tauri.md](007-render-monogame-web-example-in-tauri.md), [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md), [009-prove-input-in-packaged-preview.md](009-prove-input-in-packaged-preview.md), [010-prove-audio-activation-in-packaged-preview.md](010-prove-audio-activation-in-packaged-preview.md), [011-prove-preview-canvas-resize-in-packaged-shell.md](011-prove-preview-canvas-resize-in-packaged-shell.md), [012-prove-packaged-shell-works-offline.md](012-prove-packaged-shell-works-offline.md) | US7, US9 |
| 015 | [Define and version protocol envelopes and errors](015-define-version-protocol-envelopes-and-errors.md) | AFK | Done | [014-approve-shell-adr.md](014-approve-shell-adr.md) | US9 |
| 016 | [Boot persistent Roslyn WASM compiler context](016-boot-persistent-roslyn-wasm-compiler-context.md) | AFK | Done | [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md) | US1 |
| 017 | [Compile one valid C# library to DLL/PDB](017-compile-valid-csharp-library-to-dll-pdb.md) | AFK | Done | [016-boot-persistent-roslyn-wasm-compiler-context.md](016-boot-persistent-roslyn-wasm-compiler-context.md) | US1 |
| 018 | [Return structured syntax diagnostics](018-return-structured-syntax-diagnostics.md) | AFK | Done | [017-compile-valid-csharp-library-to-dll-pdb.md](017-compile-valid-csharp-library-to-dll-pdb.md) | US2 |
| 019 | [Build runtime/reference assembly allowlist](019-build-runtime-reference-assembly-allowlist.md) | AFK | Done | [017-compile-valid-csharp-library-to-dll-pdb.md](017-compile-valid-csharp-library-to-dll-pdb.md) | US1, US9 |
| 020 | [Boot isolated Release preview runtime](020-boot-isolated-release-preview-runtime.md) | AFK | Done | [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md) | US3, US9 |
| 021 | [Transfer/load DLL and portable PDB](021-transfer-load-dll-and-portable-pdb.md) | AFK | Done | [017-compile-valid-csharp-library-to-dll-pdb.md](017-compile-valid-csharp-library-to-dll-pdb.md), [020-boot-isolated-release-preview-runtime.md](020-boot-isolated-release-preview-runtime.md) | US1 |
| 022 | [Discover/construct exactly one Game subclass](022-discover-construct-single-game-subclass.md) | AFK | Done | [021-transfer-load-dll-and-portable-pdb.md](021-transfer-load-dll-and-portable-pdb.md) | US1, US2 |
| 023 | [Retain asynchronous Game and render clear-color frame](023-retain-async-game-and-render-clear-color.md) | AFK | Done | [022-discover-construct-single-game-subclass.md](022-discover-construct-single-game-subclass.md) | US1, US3 |
| 024 | [Cooperatively stop loop and release resources](024-cooperatively-stop-loop-and-release-resources.md) | AFK | Done | [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md) | US3 |
| 025 | [Restart preview with clean static state](025-restart-preview-with-clean-static-state.md) | AFK | Done | [024-cooperatively-stop-loop-and-release-resources.md](024-cooperatively-stop-loop-and-release-resources.md) | US3 |
| 026 | [Implement WebGL Game.Exit host event in MonoGame](026-implement-webgl-game-exit-host-event-in-monogame.md) | HITL | Done | 026A human-authored commit pushed (`ecf06ee`); 026B playground exit-notification integration verified and committed | US3 |
| 027 | [Capture managed Console output](027-capture-managed-console-output.md) | AFK | Done | [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md) | US5 |
| 028 | [Capture native Emscripten output](028-capture-native-emscripten-output.md) | AFK | Done | [027-capture-managed-console-output.md](027-capture-managed-console-output.md) | US5 |
| 029 | [Map runtime exception through PDB](029-map-runtime-exception-through-pdb.md) | AFK | Done | [021-transfer-load-dll-and-portable-pdb.md](021-transfer-load-dll-and-portable-pdb.md), [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md) | US5 |
| 030 | [Compile/run two source files with cross-file calls](030-compile-run-two-files-cross-file-calls.md) | AFK | Done | [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md) | US1, US4 |
| 031 | [Publish supported-API policy and analyzers](031-publish-supported-api-policy-and-analyzers.md) | AFK | Done | [019-build-runtime-reference-assembly-allowlist.md](019-build-runtime-reference-assembly-allowlist.md) | US2, US9 |
| 032 | [Reject native/JavaScript interop with diagnostics](032-reject-native-js-interop-with-diagnostics.md) | AFK | Done | [031-publish-supported-api-policy-and-analyzers.md](031-publish-supported-api-policy-and-analyzers.md) | US2, US9 |
| 033 | [Apply opaque-origin sandbox and CSP](033-apply-opaque-origin-sandbox-and-csp.md) | AFK | Done | [020-boot-isolated-release-preview-runtime.md](020-boot-isolated-release-preview-runtime.md) | US9 |
| 034 | [Deny shell IPC and project filesystem access](034-deny-shell-ipc-and-filesystem-access.md) | AFK | Done | [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md) | US9 |
| 035 | [Deny host navigation and arbitrary network access](035-deny-host-navigation-and-network-access.md) | AFK | Done | [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md) | US9 |
| 036 | [Validate forged/malformed/oversized protocol messages](036-validate-forged-malformed-oversized-messages.md) | AFK | Done | [015-define-version-protocol-envelopes-and-errors.md](015-define-version-protocol-envelopes-and-errors.md), [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md) | US9 |
| 037 | [Warn before first run of newly opened project](037-warn-before-first-run-of-new-project.md) | AFK | Done | [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md) | US9 |
| 038 | [Force-stop infinite Update in isolated process/WebView](038-force-stop-infinite-update-in-isolation.md) | AFK | Superseded | [024-cooperatively-stop-loop-and-release-resources.md](024-cooperatively-stop-loop-and-release-resources.md), [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md) | US3, US9 |
| 039 | [Validate and mount nested Web-profile Texture2D](039-validate-and-mount-web-profile-texture2d.md) | AFK | Done | [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md) | US6 |
| 040 | [Activate/play/stop SoundEffect in fresh preview](040-activate-play-stop-soundeffect-in-preview.md) | AFK | Done | None | US6 |
| 041 | [Measure startup/compile/preview/Stop timings](041-measure-startup-compile-preview-stop-timings.md) | AFK | Done | [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md), [038-force-stop-infinite-update-in-isolation.md](038-force-stop-infinite-update-in-isolation.md) | US7, US8 |
| 042 | [Measure compiler and 20-cycle preview memory](042-measure-compiler-and-preview-memory.md) | AFK | Done | [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md), [038-force-stop-infinite-update-in-isolation.md](038-force-stop-infinite-update-in-isolation.md) | US3, US8 |
| 043 | [Measure Release package size/API survival](043-measure-release-package-size-api-survival.md) | AFK | Done | [031-publish-supported-api-policy-and-analyzers.md](031-publish-supported-api-policy-and-analyzers.md), [039-validate-and-mount-web-profile-texture2d.md](039-validate-and-mount-web-profile-texture2d.md), [040-activate-play-stop-soundeffect-in-preview.md](040-activate-play-stop-soundeffect-in-preview.md) | US7, US8 |
| 044 | [Approve Phase 1 feasibility gate](044-approve-phase1-feasibility-gate.md) | HITL | Done | [026-implement-webgl-game-exit-host-event-in-monogame.md](026-implement-webgl-game-exit-host-event-in-monogame.md), [027-capture-managed-console-output.md](027-capture-managed-console-output.md), [028-capture-native-emscripten-output.md](028-capture-native-emscripten-output.md), [029-map-runtime-exception-through-pdb.md](029-map-runtime-exception-through-pdb.md), [030-compile-run-two-files-cross-file-calls.md](030-compile-run-two-files-cross-file-calls.md), [031-publish-supported-api-policy-and-analyzers.md](031-publish-supported-api-policy-and-analyzers.md), [032-reject-native-js-interop-with-diagnostics.md](032-reject-native-js-interop-with-diagnostics.md), [033-apply-opaque-origin-sandbox-and-csp.md](033-apply-opaque-origin-sandbox-and-csp.md), [034-deny-shell-ipc-and-filesystem-access.md](034-deny-shell-ipc-and-filesystem-access.md), [035-deny-host-navigation-and-network-access.md](035-deny-host-navigation-and-network-access.md), [036-validate-forged-malformed-oversized-messages.md](036-validate-forged-malformed-oversized-messages.md), [037-warn-before-first-run-of-new-project.md](037-warn-before-first-run-of-new-project.md), [038-force-stop-infinite-update-in-isolation.md](038-force-stop-infinite-update-in-isolation.md), [039-validate-and-mount-web-profile-texture2d.md](039-validate-and-mount-web-profile-texture2d.md), [040-activate-play-stop-soundeffect-in-preview.md](040-activate-play-stop-soundeffect-in-preview.md), [041-measure-startup-compile-preview-stop-timings.md](041-measure-startup-compile-preview-stop-timings.md), [042-measure-compiler-and-preview-memory.md](042-measure-compiler-and-preview-memory.md), [043-measure-release-package-size-api-survival.md](043-measure-release-package-size-api-survival.md) | US1, US3, US6, US7, US8, US9 |
| 045 | [Build responsive Workbench app frame](045-build-responsive-workbench-app-frame.md) | AFK | Done | [044-approve-phase1-feasibility-gate.md](044-approve-phase1-feasibility-gate.md) | US10 |
| 046 | [Add persistent dark/light Workbench themes + accessibility](046-add-persistent-theme-and-accessibility.md) | AFK | Done | [045-build-responsive-workbench-app-frame.md](045-build-responsive-workbench-app-frame.md) | US10 |
| 047 | [Edit default Game1.cs and Run/Stop](047-edit-game1-and-run-stop.md) | AFK | Done | [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md), [025-restart-preview-with-clean-static-state.md](025-restart-preview-with-clean-static-state.md), [046-add-persistent-theme-and-accessibility.md](046-add-persistent-theme-and-accessibility.md) | US1, US3, US10 |
| 048 | [Navigate Problems rows to editor markers](048-navigate-problems-rows-to-editor-markers.md) | AFK | Done | [018-return-structured-syntax-diagnostics.md](018-return-structured-syntax-diagnostics.md), [022-discover-construct-single-game-subclass.md](022-discover-construct-single-game-subclass.md), [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md) | US2 |
| 049 | [Show managed/native output and runtime failures](049-show-output-and-runtime-failures.md) | AFK | Done | [027-capture-managed-console-output.md](027-capture-managed-console-output.md), [028-capture-native-emscripten-output.md](028-capture-native-emscripten-output.md), [029-map-runtime-exception-through-pdb.md](029-map-runtime-exception-through-pdb.md), [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md) | US5 |
| 050 | [Save scratch project with dirty-state protection](050-save-scratch-project-with-dirty-state-protection.md) | AFK | Done | [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md) | US4, US10 |
| 051 | [Open folder, edit/run multiple files, persist manifest](051-open-folder-edit-multiple-files-persist-manifest.md) | AFK | Done | [030-compile-run-two-files-cross-file-calls.md](030-compile-run-two-files-cross-file-calls.md), [050-save-scratch-project-with-dirty-state-protection.md](050-save-scratch-project-with-dirty-state-protection.md) | US4 |
| 052 | [Route focus/input/resize and production content workflow](052-route-focus-input-resize-and-content-workflow.md) | AFK | Done | [039-validate-and-mount-web-profile-texture2d.md](039-validate-and-mount-web-profile-texture2d.md), [040-activate-play-stop-soundeffect-in-preview.md](040-activate-play-stop-soundeffect-in-preview.md), [047-edit-game1-and-run-stop.md](047-edit-game1-and-run-stop.md), [051-open-folder-edit-multiple-files-persist-manifest.md](051-open-folder-edit-multiple-files-persist-manifest.md) | US3, US6 |
| 053 | [Produce native desktop packages for macOS, Windows, and Linux via GitHub Actions](053-github-actions-native-desktop-packages.md) | AFK | Done | [048-navigate-problems-rows-to-editor-markers.md](048-navigate-problems-rows-to-editor-markers.md), [049-show-output-and-runtime-failures.md](049-show-output-and-runtime-failures.md), [050-save-scratch-project-with-dirty-state-protection.md](050-save-scratch-project-with-dirty-state-protection.md), [051-open-folder-edit-multiple-files-persist-manifest.md](051-open-folder-edit-multiple-files-persist-manifest.md), [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md) | US7, US8 |
| 054 | [Add installer, signing policy, notices, and SBOM](054-add-installer-signing-notices-sbom.md) | AFK | Parked | [053-github-actions-native-desktop-packages.md](053-github-actions-native-desktop-packages.md) | US7, US8 |
| 055 | [Verify release on clean Windows machine/VM](055-verify-release-on-clean-windows-machine.md) | AFK | Parked | [054-add-installer-signing-notices-sbom.md](054-add-installer-signing-notices-sbom.md) | US1–US10 |
| 056 | [Approve MVP acceptance gate](056-approve-mvp-acceptance-gate.md) | HITL | Parked | [055-verify-release-on-clean-windows-machine.md](055-verify-release-on-clean-windows-machine.md) | US1–US10 |
| 057 | [Remove vestigial manifest preview dimensions](057-remove-vestigial-manifest-preview-dimensions.md) | AFK | Done | [052-route-focus-input-resize-and-content-workflow.md](052-route-focus-input-resize-and-content-workflow.md) | US3, US6 |
| 058 | [Fix initial Linux WebKitGTK window rendering](058-fix-initial-linux-webkitgtk-window-rendering.md) | AFK | Done | None | US1, US10 |
| 059 | [Remove stale Workbench telemetry](059-remove-stale-workbench-telemetry.md) | AFK | Done | 045, 052 | Feature 1, 7 |
| 060 | [Wire live editor status bar](060-wire-live-editor-status-bar.md) | AFK | Ready | 059 | Feature 3 |
| 061 | [Establish readable UI type scale](061-establish-readable-ui-type-scale.md) | AFK | Blocked | 046, 059 | Feature 8 |
| 062 | [Add persisted UI and editor scaling](062-add-persisted-ui-and-editor-scaling.md) | AFK | Blocked | 061 | Feature 8 |
| 063 | [Replace project warning with compact safety notice](063-replace-project-warning-with-compact-safety-notice.md) | AFK | Blocked | 037, 061 | Feature 9 |
| 064 | [Render project assets in file rail](064-render-project-assets-in-file-rail.md) | AFK | Blocked | 052, 059 | Feature 1 |
| 065 | [Add secure binary asset import command](065-add-secure-binary-asset-import-command.md) | AFK | Blocked | 064 | Feature 1 |
| 066 | [Add asset picker and drag-drop import](066-add-asset-picker-and-drag-drop-import.md) | AFK | Blocked | 065 | Feature 1 |
| 067 | [Create source files in folder projects](067-create-source-files-in-folder-projects.md) | AFK | Ready | 051 | Feature 4 |
| 068 | [Rename and delete source files](068-rename-and-delete-source-files.md) | AFK | Blocked | 067 | Feature 4 |
| 069 | [Use persistent Monaco models for project files](069-use-persistent-monaco-models-for-project-files.md) | AFK | Blocked | 048, 068 | Feature 4 |
| 070 | [Spike Roslyn language services in browser WASM](070-spike-roslyn-language-services-in-browser-wasm.md) | AFK | Ready | 016, 019, 031 | Feature 2 |
| 071 | [Define language-service protocol and document sync](071-define-language-service-protocol-and-document-sync.md) | AFK | Blocked | 015, 036, 070 | Feature 2 |
| 072 | [Implement persistent Roslyn completion workspace](072-implement-persistent-roslyn-completion-workspace.md) | AFK | Blocked | 070, 071 | Feature 2 |
| 073 | [Connect Monaco to context-aware completions](073-connect-monaco-to-context-aware-completions.md) | AFK | Blocked | 069, 072 | Feature 2 |
| 074 | [Add hover, signature help, and definition navigation](074-add-hover-signature-help-and-definition-navigation.md) | AFK | Blocked | 073 | Feature 2 |
| 075 | [Define curated managed dependency policy](075-define-curated-managed-dependency-policy.md) | AFK | Ready | 019, 031, 043 | Feature 5 |
| 076 | [Prove one managed dependency pack in WASM](076-prove-one-managed-dependency-pack-in-wasm.md) | AFK | Blocked | 075 | Feature 5 |
| 077 | [Build deterministic dependency-pack staging and cache](077-build-deterministic-dependency-pack-staging-and-cache.md) | AFK | Blocked | 076 | Feature 5 |
| 078 | [Add project dependency-pack selection](078-add-project-dependency-pack-selection.md) | AFK | Blocked | 073, 077 | Feature 5 |
| 079 | [Retain incremental compiler state](079-retain-incremental-compiler-state.md) | AFK | Ready | 016, 041 | Feature 6 |
| 080 | [Add debounced background compilation](080-add-debounced-background-compilation.md) | AFK | Blocked | 069, 079 | Feature 6 |
| 081 | [Restart Live Preview after successful edits](081-restart-live-preview-after-successful-edits.md) | AFK | Blocked | 025, 080 | Feature 6 |
| 082 | [Investigate state-preserving .NET Hot Reload](082-investigate-state-preserving-dotnet-hot-reload.md) | AFK | Blocked | 081 | Feature 6 |
| 083 | [Prove Web-profile Model content](083-prove-web-profile-model-content.md) | AFK | Ready | 039, 043 | Feature 10 |
| 084 | [Validate, mount, and render Model content](084-validate-mount-and-render-model-content.md) | AFK | Blocked | 083 | Feature 10 |
| 085 | [Import and cache source 3D models](085-import-and-cache-source-3d-models.md) | AFK | Blocked | 066, 084 | Feature 10 |
| 086 | [Prove Web-profile custom Effect content](086-prove-web-profile-custom-effect-content.md) | AFK | Ready | 039, 043 | Feature 10 |
| 087 | [Validate, mount, and render custom Effects](087-validate-mount-and-render-custom-effects.md) | AFK | Blocked | 086 | Feature 10 |
| 088 | [Investigate in-app Effect compilation and cache](088-investigate-in-app-effect-compilation-and-cache.md) | AFK | Blocked | 066, 087 | Feature 10 |

## Post-proof feature catalog

| ID | Product-owner request |
|----|-----------------------|
| Feature 1 | Replace wasted runtime telemetry with a real asset browser and drag/drop import |
| Feature 2 | Add context-correct C# IntelliSense |
| Feature 3 | Make the editor status bar report live cursor/model state |
| Feature 4 | Complete multi-file project authoring |
| Feature 5 | Support fast, curated managed dependency packs |
| Feature 6 | Improve compilation and provide Live Preview / investigate Hot Reload |
| Feature 7 | Remove useless preview/debug chrome |
| Feature 8 | Improve text size and accessibility |
| Feature 9 | Replace the intrusive infinite-loop warning |
| Feature 10 | Support 3D models and custom effects |

## README user stories

| ID | Name |
|----|------|
| US1 | Quick scratch experiment |
| US2 | Actionable diagnostics |
| US3 | Reliable Run/Stop |
| US4 | Local projects |
| US5 | Output and runtime failures |
| US6 | Web-profile content and audio |
| US7 | Offline packaged desktop app |
| US8 | Reproducible contributor build |
| US9 | Defence-in-depth code execution |
| US10 | Workbench dark/light UX |

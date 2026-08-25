# Prove keyboard and mouse input in packaged preview

**Type:** AFK
**Status:** Ready
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 19, 22.3, 20.2
**User stories:** US3
**Triage:** needs-triage

## Context

Critical feasibility question 4 (PRD section 19) asks whether WebGL 2, input, audio, and resizing work in the candidate shell. Section 22.3 requires rendering tests for keyboard input, mouse input, and editor/preview focus switching. Section 20.2 requires input to work when the preview is focused. This issue proves input specifically, using the already-rendering MonoGame example from issues 7-8, by modifying the example's own `Game1.cs` temporarily (or using its existing input-reactive behavior if any) to visibly react to keyboard/mouse input, and confirming that reaction inside the packaged Tauri window.

## What to build

Confirm that `Keyboard.GetState()` and `Mouse.GetState()` inside the running `external/MonoGame/Example` game respond correctly to real input events delivered through the packaged Tauri WebView, by adding a small, clearly-marked temporary diagnostic (e.g. changing the clear color when a key is pressed, or logging mouse position) directly in the Example project's `Game1.cs`, observing the effect, then reverting that temporary change afterward so the committed example stays pristine.

## Scope

### In scope

- Temporary input-reactive code added to `external/MonoGame/Example/Game1.cs` for manual verification, then reverted before commit
- Confirming keyboard key-down/key-up and mouse move/click are observed correctly inside the packaged window
- Confirming input only affects the game when the canvas/window has focus

### Out of scope

- Any permanent product code changes (this is a proof-only issue)
- Resize proof (issue 11)
- Audio proof (issue 10)

## Implementation guidance

1. Rebuild the Example project's Web target with a temporary diagnostic: in `external/MonoGame/Example/Game1.cs`, inside `Update`, add something like `if (Keyboard.GetState().IsKeyDown(Keys.Space)) _graphics.GraphicsDevice.Clear(Color.Red)` reasoning as a temporary visual proof (adapt to the file's actual existing structure — read it first with the `view` tool before editing).
2. Rebuild via the same pipeline as issue 4/7 (`dotnet run --project build/Build.csproj` if the Example is built by the main Build.csproj, or the Example's own publish command — confirm which by reading `external/MonoGame/build/Build.csproj`), then re-stage into `artifacts/monogame/` or `artifacts/example-web/` and rebuild the Tauri app.
3. Launch the packaged app, click the canvas to give it focus, press the test key and move/click the mouse, and visually confirm the expected reaction.
4. Revert the temporary diagnostic in `Game1.cs` (`git -C external/MonoGame checkout -- Example/Game1.cs` or manually undo the edit) so the submodule working tree returns to clean before finishing (`git -C external/MonoGame status --short` must be empty again).
5. Rebuild once more after reverting to leave the repository in the same state as after issue 8, and confirm the app still renders (regression check).

## Acceptance criteria

- [ ] A temporary, reverted test confirms keyboard input reaches the running game inside the packaged Tauri window
- [ ] A temporary, reverted test confirms mouse input (position and/or click) reaches the running game
- [ ] Input only affects the game while the canvas has focus (clicking outside the canvas, if there is anywhere else to click, does not trigger game input)
- [ ] `git -C external/MonoGame status --short` is empty after this issue (all temporary diagnostics reverted)

## Verification

Perform the manual steps in Implementation guidance and capture: (1) a description or screenshot of the visual change on key press, (2) a description or screenshot of the visual/logged change on mouse move or click, (3) the output of `git -C external/MonoGame status --short` showing no lingering changes, and (4) confirmation the app still renders normally after reverting and rebuilding. Since this is inherently a manual/interactive proof, the verifier must personally reproduce the input test (not just read the report) and record PASS/FAIL with their own observation.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of keyboard/mouse input in packaged preview`

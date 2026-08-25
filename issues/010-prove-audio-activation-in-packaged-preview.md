# Prove audio activation in packaged preview

**Type:** AFK
**Status:** Ready
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 19, 22.3, 17
**User stories:** US6
**Triage:** needs-triage

## Context

Critical feasibility question 4 (section 19) includes audio. Section 22.3 explicitly requires a rendering test for "audio activation in a newly created preview", which matters because browsers/WebViews require a user gesture before audio can play (autoplay policies), and Emscripten/FAudio-based MonoGame audio backends must cooperate with that restriction. This issue proves that MonoGame's `SoundEffect` playback works inside the packaged Tauri WebView after a user gesture, using the same Example project pattern as issue 9: a temporary, reverted diagnostic in the Example project.

## What to build

Confirm that a `SoundEffect` (or `SoundEffectInstance`) can be created and played inside the running Example game in the packaged Tauri window, triggered by a user input gesture (e.g. a key press, matching how autoplay-restricted audio contexts typically need to be resumed on user interaction), and that audible output occurs.

## Scope

### In scope

- A temporary, reverted diagnostic in `external/MonoGame/Example/Game1.cs` (and a temporary known-good `.xnb` sound asset added to the Example's Content if one is not already present) that plays a sound on a key press
- Confirming audio is audible (or, if the verifier has no audio output device, confirming the underlying Web Audio context reaches the `running` state via devtools) after the gesture

### Out of scope

- Permanent product audio APIs (issue 40 covers the real SoundEffect activation contract)
- Content validation/mounting proofs (issue 39)

## Implementation guidance

1. Check whether `external/MonoGame/Example/Content` already contains a compiled `.xnb` sound asset; if not, this issue may need a minimal known-good Web-profile `.xnb` sound fixture — check if one already exists elsewhere in the MonoGame repo (e.g. under test content) that can be temporarily copied in for this proof, reverting the copy afterward.
2. Add a temporary diagnostic in `Game1.cs`: load the sound in `LoadContent` and call `.Play()` when a key is pressed in `Update` (read the file first to match its existing style).
3. Rebuild via the same MonoGame build + Tauri repackage steps as issue 9.
4. Launch the packaged app, click the canvas to focus/interact with it (satisfying any autoplay gesture requirement), press the test key, and confirm audible sound. If no audio hardware is available in the execution environment, instead open WebView devtools and evaluate `new AudioContext().state` after the gesture, confirming it reports `"running"` rather than `"suspended"`.
5. Revert all temporary changes in `external/MonoGame` (`git -C external/MonoGame status --short` must return to empty) and rebuild to confirm no regression.

## Acceptance criteria

- [ ] A temporary, reverted test confirms a `SoundEffect` plays after a user gesture inside the packaged Tauri window (audible, or confirmed via `AudioContext.state === 'running'` if no audio hardware is available)
- [ ] The audio context is not blocked by autoplay restrictions after the gesture
- [ ] `git -C external/MonoGame status --short` is empty after this issue
- [ ] The app still renders normally after reverting and rebuilding

## Verification

Reproduce the manual steps and capture: audible confirmation or `AudioContext.state` devtools evidence, the exact gesture used to unlock audio, and the post-test `git -C external/MonoGame status --short` output. As with issue 9, the verifier must personally reproduce this interactive test rather than trust a written report, and record PASS/FAIL with their own observation.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** Pending
- **Verifier:** Pending
- **Date:** Pending
- **Evidence:** Pending

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of audio activation in packaged preview`

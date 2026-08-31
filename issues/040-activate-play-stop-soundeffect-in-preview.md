# Activate/play/stop SoundEffect in fresh preview

**Type:** AFK
**Status:** Done
**Blocked by:** None
**PRD references:** 15, 22.3
**User stories:** US6
**Triage:** needs-triage

## Context

PRD section 15 states the initial supported content subset includes non-streaming `SoundEffect` content in addition to `Texture2D` (issue 39). Section 22.3 requires rendering tests for audio and for audio activation in a newly created preview. This issue completes the audio half of the content-mounting contract begun in issue 39, mounting a known-good Web-profile `.xnb` sound asset, playing it via `SoundEffect.Play()`/`SoundEffectInstance`, and explicitly proving it works correctly in a *freshly created* preview instance (i.e. after the clean-restart mechanism from issue 25), not just the first preview ever created in the session — since audio context activation/autoplay-gesture state must be re-established correctly every time a new iframe/runtime boots.

## What to build

Mount a known-good Web-profile `.xnb` `SoundEffect` asset using the same validation/mounting mechanism built in issue 39, load it via `Content.Load<SoundEffect>(...)` inside a test game, play it via a user-gesture-triggered `Play()` call, confirm audible output (or `AudioContext.state === "running"` if no audio hardware is available, per issue 10's proof pattern), and additionally confirm this succeeds again after a Stop/Run cycle (issue 25) creates a brand-new preview instance, proving audio activation state does not incorrectly persist or fail to re-initialize across preview recreations.

## Scope

### In scope

- A known-good Web-profile `.xnb` `SoundEffect` fixture under `examples/ContentExample/Content/` (reuse issue 39's fixture directory and content-validation/mounting code, which is asset-type-agnostic and already handles `Texture2D`; extend it or confirm it also validates/mounts `.xnb` sound files identically)
- A test `Game1` that loads and plays the sound on a key press (or automatically on start, whichever more reliably demonstrates the behavior) and can also explicitly `Stop()` an active `SoundEffectInstance`
- Testing across two consecutive fresh preview instances (Run → Stop → Run again, per issue 25) to confirm audio activation works correctly both times, not only the first time

### Out of scope

- Streaming audio, compressed audio formats (out of scope for the MVP per PRD section 15)
- The full production audio content workflow UI (issue 52)

## Implementation guidance

1. Produce or locate a known-good Web-profile `.xnb` `SoundEffect` fixture (reuse issue 10's approach for locating/building one; save the final fixture under `examples/ContentExample/Content/audio/`).
2. Confirm issue 39's `ValidateXnbPlatform`/mounting code correctly handles a sound asset (the platform-marker check is format-agnostic across content types in MonoGame's `.xnb` header, so this should require no code change, only a test to confirm).
3. Author a test `Game1.cs`:
```csharp
public sealed class Game1 : Microsoft.Xna.Framework.Game
{
    private Microsoft.Xna.Framework.Audio.SoundEffect? _sound;
    private Microsoft.Xna.Framework.Audio.SoundEffectInstance? _instance;
    protected override void LoadContent() { _sound = Content.Load<Microsoft.Xna.Framework.Audio.SoundEffect>("audio/jump"); }
    protected override void Update(Microsoft.Xna.Framework.GameTime gameTime)
    {
        var kb = Microsoft.Xna.Framework.Input.Keyboard.GetState();
        if (kb.IsKeyDown(Microsoft.Xna.Framework.Input.Keys.Space) && (_instance is null || _instance.State != Microsoft.Xna.Framework.Audio.SoundState.Playing))
        {
            _instance?.Stop();
            _instance = _sound!.CreateInstance();
            _instance.Play();
        }
        if (kb.IsKeyDown(Microsoft.Xna.Framework.Input.Keys.Escape)) _instance?.Stop();
        base.Update(gameTime);
    }
}
```
4. Run this through the full compile → mount → run pipeline (reusing the input proof from issue 9 to actually deliver the key press to the packaged preview) and confirm audible playback (or `AudioContext.state`) on the first preview instance.
5. Stop and Run again (issue 25's clean-restart flow) and repeat the same key-press test on the second, freshly created preview instance, confirming audio still activates and plays correctly.
6. Confirm `Stop()` correctly halts playback when the Escape key is pressed, on both instances.

## Acceptance criteria

- [x] A known-good Web-profile `.xnb` `SoundEffect` fixture is mounted and loads via `Content.Load<SoundEffect>(...)` without error
- [x] Pressing the designated key plays audible sound (or is confirmed via `AudioContext.state === "running"` if no audio hardware is available) on the first preview instance
- [x] The same test, repeated after a Stop→Run cycle creates a brand-new preview instance (per issue 25), also succeeds, proving audio activation correctly re-initializes in a fresh preview rather than silently failing on subsequent instances
- [x] `SoundEffectInstance.Stop()` correctly halts playback when invoked

## Verification

Run the test game, press the play key, and confirm audible playback or the `AudioContext.state` evidence, exactly as in issue 10's verification method. Stop the preview, Run it again (a fresh instance per issue 25), and repeat the exact same play-key test, confirming success again. Finally press the stop key and confirm playback halts. The verifier must personally reproduce all three checks (first-instance play, second-instance play after restart, and stop) since this is an interactive audio proof.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent `issue040-verifier` code-review agent
- **Date:** 2026-08-31
- **Evidence:** The packaged proof mounted the 44,280-byte Web-profile PCM fixture and loaded it through `Content.Load<SoundEffect>` in two distinct isolated preview realms and generations. In each preview, a trusted Space key event resumed the deliberately suspended audio context, invoked `SoundEffectInstance.Play()`, reported `Playing`, and produced a measured analyser peak of `0.08732909709215164`; a trusted Escape event invoked `Stop()`, reported `Stopped`, and produced zero non-silent sample windows. Each preview disposed once, retired its window, and cleared its asset transfer. Issue 039/038/025/024 packaged regressions, 142 static tests, TypeScript, 49 Rust tests, proof gating, and fixture regeneration all passed before the verifier returned PASS.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: activate and control SoundEffect playback across fresh previews`

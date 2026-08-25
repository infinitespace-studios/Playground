# Prove audio activation in packaged preview

**Type:** AFK
**Status:** Done
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 19, 22.3, 17
**User stories:** US6
**Triage:** needs-triage

## Context

Critical feasibility question 4 (section 19) includes audio. Section 22.3 explicitly requires a rendering test for "audio activation in a newly created preview", which matters because browsers/WebViews require a user gesture before audio can play (autoplay policies), and Emscripten/FAudio-based MonoGame audio backends must cooperate with that restriction. The existing example already loads `testsound.xnb` into a `SoundEffectInstance`, but playback is commented out. `external/MonoGame/AGENTS.md` prohibits AI-authored changes in that checkout, including temporary changes. This issue must use product-owned proof code outside `external/MonoGame` and must not claim managed playback unless it is actually observed.

## What to build

Confirm that the packaged Tauri WebView can unlock and produce audio after a real user gesture and collect evidence about the existing MonoGame/FAudio audio path. If a product-owned managed probe outside `external/MonoGame` can safely activate the already-loaded sound, prove `SoundEffect` playback. Otherwise limit the verdict to Web Audio activation/output plus successful MonoGame sound loading, and explicitly carry managed `SoundEffect.Play()` as an unproven gap into issue 14 and issue 40.

## Scope

### In scope

- Product-owned, environment-gated audio proof instrumentation outside `external/MonoGame`
- Using the existing `testsound.xnb` and existing MonoGame load path read-only
- Confirming Web Audio reaches `running` and produces a measurable signal after a real gesture
- Confirming managed `SoundEffect` playback only if directly observed through a policy-safe product-owned probe

### Out of scope

- Any changes, temporary or permanent, under `external/MonoGame`
- Permanent product audio APIs (issue 40 covers the real SoundEffect activation contract)
- Content validation/mounting proofs (issue 39)

## Implementation guidance

1. Record the pre-existing `external/MonoGame` status and never edit, clean, reset, stash, or revert it.
2. Add product-owned proof instrumentation gated by an explicit environment variable. Before a gesture, record audio-context state. Require a real click/key gesture, then resume the context, produce a short low-volume test signal, and capture objective signal/output evidence plus context state and errors.
3. Inspect the existing runtime for policy-safe evidence that `testsound.xnb` loads and MonoGame/FAudio initializes. Attempt managed playback only through product-owned code outside `external/MonoGame`; never patch source or generated files inside the submodule.
4. Emit one structured report distinguishing: user gesture observed, context state before/after, output signal produced, MonoGame sound load/backend evidence, managed `SoundEffect.Play()` observed or unproven, and all errors.
5. Confirm a normal run without the environment variable emits no proof output and behaves normally.

## Acceptance criteria

- [x] A real user gesture changes the packaged WebView audio context to `running`
- [x] Objective evidence confirms an audible-path test signal is produced without relying only on a context-state string
- [x] The report confirms whether MonoGame sound loading/backend initialization and managed `SoundEffect.Play()` were each directly observed
- [x] Proof mode is explicitly gated and a normal run is unaffected
- [x] The post-test `external/MonoGame` status exactly matches the recorded pre-test status

## Verification

Independently rebuild and run the packaged app. Personally perform the real gesture and reproduce the structured context-state, signal/output, MonoGame backend, error, proof-gating, and submodule-status evidence. Do not accept synthetic event dispatch as the autoplay-unlocking gesture. Window-bounded captures are allowed; full-screen capture is prohibited. PASS may use the limited claim "WebView audio activation/output and MonoGame sound loading work" only if managed `SoundEffect.Play()` is explicitly marked unproven and carried into issue 14 and issue 40.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS (limited audio claim)
- **Verifier:** Issue 010 Verifier (`87978400-7b67-4fd8-9eb0-3009b267e81b`)
- **Date:** 2026-08-25
- **Evidence:** Independently rebuilt the frontend and packaged application. A trusted platform Space key event reached the WebView as `keydown` with `isTrusted=true`. The audio context transitioned from `suspended` to `running`, was explicitly suspended, and returned to `running` from the gesture. A 440 Hz, gain-0.015, 250 ms signal produced 17 analyser samples, peak `0.014999999664723873`, RMS `0.010650934649414473`, 28 active bins, and an observed oscillator completion. Runtime remained `rendering` with 20 observed frames. `Content/testsound.xnb` was present in the runtime VFS at 3,805,033 bytes, and the synchronous `Content.Load<SoundEffect>` path completed before rendering. Audio, console, and unhandled error counts were all zero. An ungated run stayed active for eight seconds and emitted no proof output. Pre/post `external/MonoGame` status was byte-identical: 590 bytes, SHA-256 `82d73a9dd0e187540798fee5b1a80aa73f5ac0e809330eb138671006fd6229f9`. This proves Web Audio activation and analyser-to-destination signal generation, not physical speaker output. FAudio initialization and managed `SoundEffect.Play()` remain unproven and must be carried into issues 14 and 40.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of audio activation in packaged preview`

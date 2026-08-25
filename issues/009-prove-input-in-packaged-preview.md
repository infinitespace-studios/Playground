# Prove keyboard and mouse input in packaged preview

**Type:** AFK
**Status:** Done
**Blocked by:** [008-serve-packaged-wasm-correct-mime-protocol.md](008-serve-packaged-wasm-correct-mime-protocol.md)
**PRD references:** 19, 22.3, 20.2
**User stories:** US3
**Triage:** needs-triage

## Context

Critical feasibility question 4 (PRD section 19) asks whether WebGL 2, input, audio, and resizing work in the candidate shell. Section 22.3 requires rendering tests for keyboard input, mouse input, and editor/preview focus switching. Section 20.2 requires input to work when the preview is focused. This issue proves input specifically using the already-rendering MonoGame example from issues 7-8. `external/MonoGame/AGENTS.md` prohibits AI-authored changes in the MonoGame checkout, including temporary changes. The proof must therefore use the example's existing keyboard-reactive behavior and product-owned, environment-gated instrumentation outside `external/MonoGame`.

## What to build

Confirm that keyboard and mouse events reach the packaged Tauri preview, focus routing is correct, and the existing managed `Keyboard.GetState()` behavior reacts. Use repeatable product-owned instrumentation that is disabled by default. For mouse input, prove the strongest end-to-end claim possible without changing MonoGame; explicitly distinguish WebView/canvas event delivery from a managed `Mouse.GetState()` observation. If managed mouse state cannot be observed from the existing example, record that narrower gap for issue 14 rather than overstating the result.

## Scope

### In scope

- Existing input-reactive behavior in `external/MonoGame/Example/Game1.cs`, used read-only
- Product-owned, environment-gated proof instrumentation outside `external/MonoGame`
- Confirming keyboard key-down/key-up and mouse move/click reach the focused packaged preview
- Confirming input only affects the game when the canvas/window has focus

### Out of scope

- Any changes, temporary or permanent, under `external/MonoGame`
- Production input-routing implementation; proof instrumentation must be inert unless explicitly enabled
- Resize proof (issue 11)
- Audio proof (issue 10)

## Implementation guidance

1. Record the pre-existing `external/MonoGame` status and never edit, clean, reset, stash, or revert it.
2. Use the example's existing `W`, `S`, `Up`, and `Down` behavior. Add product-owned proof instrumentation that can focus/blur the canvas, deliver controlled key down/up input, sample live rendered pixels, and report whether the expected sprite geometry changed and stopped changing after key-up.
3. Instrument real canvas/window mouse move, down, up, click, focus, and blur events. Deliver controlled mouse interaction inside and outside the canvas and emit a structured report containing coordinates, buttons, targets, focus state, ordering, and whether canvas handlers received each event.
4. Prefer a product-owned managed probe outside `external/MonoGame` if the existing built runtime exposes a policy-safe way to observe `Mouse.GetState()`. Otherwise report canvas/WebView mouse delivery as proven and managed `Mouse.GetState()` as unproven.
5. Gate all commands/reporting behind an explicit environment variable. Confirm a normal run without it emits no proof output and exposes no active proof behavior.

## Acceptance criteria

- [x] The existing managed example visibly confirms keyboard key-down and key-up reach `Keyboard.GetState()`
- [x] Mouse move and click delivery to the focused canvas is independently reproduced; the record states whether managed `Mouse.GetState()` was also observed
- [x] Input only affects the game while the canvas has focus (clicking outside the canvas, if there is anywhere else to click, does not trigger game input)
- [x] Proof mode is explicitly gated and a normal run is unaffected
- [x] The post-test `external/MonoGame` status exactly matches the recorded pre-test status

## Verification

Independently rebuild and run the packaged app. Reproduce key-down/key-up, mouse move/click, and focused/unfocused cases from product-owned structured evidence; do not trust the implementer's report. Verify live frame/pixel evidence for the existing managed keyboard reaction, exact mouse event details, absence of JS/WebGL errors, proof gating, and unchanged `external/MonoGame` status. Window-bounded captures are allowed; full-screen capture is prohibited. PASS may use a limited mouse claim only when the record explicitly says managed `Mouse.GetState()` remains unproven and carries that gap into issue 14.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS (limited mouse claim)
- **Verifier:** Issue 009 Verifier (`53e4e5a0-0ad7-41d2-a9e3-d778b2b5c441`)
- **Date:** 2026-08-25
- **Evidence:** Independently rebuilt the frontend and packaged application. With proof mode enabled, focused `S` key-down moved the existing managed example geometry from `y=140..189` to `10..69`; key-up stopped movement and produced an identical subsequent geometry/hash. Unfocused `W` input left geometry and frame hash unchanged. Canvas mouse events arrived in `move`, `down`, `up`, `click` order with coordinates `(583,388)`, canvas offset `(300,169)`, correct targets/focus, and `buttons=1` during down. Runtime remained `rendering`, six GL checks returned zero, context loss/restoration remained `0/0`, animation continued, and no console or unhandled errors occurred. An ungated 25-second run emitted no proof output. Pre/post `external/MonoGame` status was byte-identical: 590 bytes, SHA-256 `82d73a9dd0e187540798fee5b1a80aa73f5ac0e809330eb138671006fd6229f9`. Mouse events were synthetic (`isTrusted=false`), so this proves DOM canvas delivery only; physical-device input and managed `Mouse.GetState()` remain unproven and must be recorded in issue 14.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `docs: record proof of keyboard/mouse input in packaged preview`

# ADR 0001: Desktop shell selection

**Status:** Accepted
**Date:** 2026-08-25
**Decider:** @dellis1972

## Context

MonoGame Playground needs a desktop shell that can package and run the MonoGame WebAssembly runtime without a development server or internet access. The shell must serve WebAssembly with the correct MIME type, support WebGL rendering and browser input/audio behavior, and provide a viable base for later IPC and isolation hardening.

The Phase 1 spike evaluated Tauri first, as required by the PRD. Issues 007-012 independently verified the mandatory shell criteria. Issue 013 defined an Electron comparison only if a mandatory Tauri criterion failed.

## Decision

We will use Tauri 2 as the desktop shell for MonoGame Playground.

Electron will not be spiked now because all mandatory Tauri shell criteria passed. Issue 013 is therefore Skipped. This decision establishes Tauri's IPC, asset protocol, WebView, packaging, and security model as the basis for issue 015 onward.

## Evidence considered

- **Issue 007 — packaged rendering: PASS.** The Release Tauri app and DMG embedded the staged Debug MonoGame Web payload, launched directly without a development server, rendered animated non-black frames, used exactly one `id="canvas"`, produced no console errors, and opened no network sockets.
- **Issue 008 — WASM MIME and streaming: PASS.** Tauri's built-in `tauri://` asset handler returned `application/wasm` for the native runtime. `WebAssembly.instantiateStreaming` succeeded without a buffer fallback, MIME errors, a custom protocol, or added shell privileges.
- **Issue 009 — input and focus: PASS with limitations.** Existing managed `Keyboard.GetState()` behavior responded to focused key-down and stopped after key-up; unfocused input did not affect the game. Synthetic mouse events reached the canvas in the correct order, but physical-device mouse input and managed `Mouse.GetState()` were not proven.
- **Issue 010 — audio activation: PASS with limitations.** A trusted platform gesture changed Web Audio from `suspended` to `running`, and analyser measurements confirmed signal generation through the destination path. `testsound.xnb` was present and the synchronous managed load path completed before rendering. Physical speaker output, FAudio initialization, and managed `SoundEffect.Play()` were not proven.
- **Issue 011 — resize: PASS with a known limitation.** The native window and CSS canvas resized at three tested dimensions while rendering continued without black frames, WebGL errors, context loss, or JavaScript errors. The canvas backing store and WebGL drawing buffer remained fixed at 320x200 and were CSS-upscaled.
- **Issue 012 — offline operation: PASS.** The packaged app and its WebKit descendants rendered changing non-black frames with no TCP/UDP sockets while macOS enforced `(deny network*)`. Assets loaded from the bundled Tauri protocol. This was process-level isolation; a physical Wi-Fi/Ethernet-off test remains part of later clean-machine release verification.
- **Issue 013 — Electron fallback: Skipped.** No mandatory Tauri shell criterion failed, so the conditional comparison was not triggered.

## Consequences

- Product shell, IPC, privilege, CSP, preview isolation, and packaging work will target Tauri 2. Later issues must not introduce Electron abstractions unless new evidence invalidates this decision.
- Preview layout must account for the current fixed 320x200 WebGL backing buffer. CSS scaling is acceptable for the spike but is not evidence of resolution-aware backbuffer resizing.
- Issue 040 must directly prove managed `SoundEffect.Play()`, FAudio initialization, stop behavior, and audible output. The shell spike proves only Web Audio activation, signal generation, and successful sound-content loading.
- A later input issue must prove physical mouse interaction reaches managed `Mouse.GetState()`. Issue 009 proved only managed keyboard behavior and synthetic DOM mouse delivery.
- Release readiness remains blocked by the MonoGame Web Release publish failure where `wasm-opt` validates atomic SDL2/FAudio output without threads enabled. The current shell proof embeds the verified Debug MonoGame Web payload in a Release Tauri package; choosing Tauri does not waive this runtime blocker.
- Security issues must harden Tauri IPC, filesystem access, navigation, networking, CSP, and preview isolation before untrusted user code can run.
- Clean-machine release testing must repeat offline operation with physical networking disabled and validate platform packaging independently of the development checkout.

# ADR-0002: Isolated preview WebviewWindow for force-stop

## Status

Accepted (issue 038)

## Context

PRD section 8.3 requires that if cooperative termination does not respond
within 2 seconds, the architecture must force-terminate the isolated preview.
The existing iframe-based preview architecture (issues 020–025) hosts the
preview in an in-page `<iframe>` with `sandbox="allow-scripts"` inside the
main WebviewWindow.

On macOS with WKWebView, iframes share the parent window's WebContent process.
An infinite synchronous WASM/JS loop (`while(true){}`) in the preview iframe
blocks the shared JavaScript thread, making the editor's entire DOM and
JavaScript unresponsive. This is an architectural certainty, not a bug.

On Windows with WebView2, the same sharing occurs within a single
ICoreWebView2 instance.

## Decision

Host the preview in a **separate Tauri WebviewWindow** rather than an in-page
iframe. Each WebviewWindow maps to a separate native WebView (WKWebView on
macOS, WebView2 on Windows), which runs user code in an independent OS-level
renderer process.

### Communication bridge

Since `MessagePort` cannot cross WebView boundaries, `_bridge-setup.js`
(loaded before `preview.js` as a non-module script) intercepts the
`installPrivatePortBootstrap` listener and delivers a synthesized bootstrap
with real `MessageChannel` ports. The port1 ends stay in the bridge adapter;
port2 ends go to preview.js, which processes them identically to the former
iframe path.

- **Rust → Preview**: `WebviewWindow::eval()` injects JSON messages via
  `window.__bridge038Receive(jsonString)`. The bridge adapter parses the
  envelope and posts to the correct port1 end → arrives on port2 in
  preview.js.
- **Preview → Rust**: preview.js sends via its port2 → arrives on port1 in
  the bridge adapter → `fetch GET` to
  `playground-preview://localhost/_bridge/send?generation=X&msg=<url-encoded>`
  (WKWebView custom scheme handlers do not reliably support POST).
- **Editor polling**: the editor calls `issue038_collect_bridge_messages` to
  drain the Rust-side queue and posts to its own port2 → arrives on port1 in
  the editor's `ProtocolPortClient`.
- **Binary transfer**: DLL/PDB stored in Rust-side memory via
  `issue038_store_transfer`, preview fetches via
  `playground-preview://localhost/_transfer/{token}/assembly.dll`. The bridge
  adapter intercepts `preview.load.request` messages with a `transferToken`
  field, fetches the binary from the protocol, attaches it to the message
  payload, and transfers it to preview.js as a real `ArrayBuffer`. No
  JSON/Base64 encoding of binaries.

### Force-stop flow

1. Request cooperative stop via the bridge (same protocol as issue 024)
   with a ~500 ms timeout.
2. If cooperative stop acknowledgement is not received within the timeout,
   the `ProtocolPortClient.request()` rejects with `TIMEOUT`.
3. The error handler calls `frame.remove()` which maps to
   `WebviewWindow::destroy()` from Rust — non-blocking, does not depend
   on the hung preview's JS thread.
4. Confirm the preview window no longer exists, retire ports/resources.
5. Generation-bound: the stop timeout captures the current generation;
   a stale timeout from a previous generation cannot destroy a newer window.

### Security

The **primary IPC boundary** is Tauri's ACL: the preview window label
(`preview-isolated-{generation}`) never appears in any capability's
`windows` array, so every `invoke` call is rejected by the runtime authority
before command dispatch.

As **defense-in-depth**, `_bridge-setup.js` attempts to strip `__TAURI_INTERNALS__`
and `__TAURI_IPC__`. However, Tauri may reinject these globals after the
page's initialization scripts run. This is documented platform behavior.
The packaged proof confirms that even when `__TAURI_INTERNALS__` is present
(with `invoke` callable), all 72 commands are rejected by ACL because the
preview window label is excluded from all capability `windows` arrays.
Zero success callbacks are observed.

CSP, navigation filter, and new-window denial match the existing iframe path.

### Visual behavior

The isolated preview window is currently a **separate visible OS window**.
It is not visually embedded in the editor DOM. Users see a second window
titled "MonoGame Preview (isolated)". Position synchronization to overlay
the editor's preview area is a follow-up UX task. The window is visible so
that `requestAnimationFrame` fires and WebGL rendering works.

## Consequences

### Positive

- Every production Run executes user C# in a separate OS process. No
  in-page iframe can run user code.
- The editor UI remains fully responsive during any user-code execution,
  including infinite synchronous loops.
- Force-stop works within the PRD's 2-second budget (empirically < 5 ms
  native destroy time).
- The preview process is cleanly terminated by the OS (no orphans).
- Monotonic native timestamps from Rust prove UI continuity — a blocked JS
  loop cannot fabricate heartbeat evidence.
- Issue 025 three-cycle restart passes through the new architecture.

### Negative

- The existing `MessagePort`-based protocol bridge is adapted via a listener-
  interception layer (`_bridge-setup.js`), adding bridge complexity.
- On Windows, `ICoreWebView2Controller::Close()` has known edge-case hang
  bugs (MicrosoftEdge/WebView2Feedback#3140, #4817). A bounded timeout and
  fallback OS process kill may be needed.
- The preview window is not visually embedded in the editor DOM. Position
  synchronization requires Rust-side window management or a separate visual
  approach (e.g., overlay positioning via Tauri window APIs).

### Platform guarantees

| Platform | Process isolation | Force-stop | Main UI impact |
|---|---|---|---|
| macOS WKWebView | Separate WebContent process per WKWebView (default, Apple may consolidate under extreme memory pressure) | Reliable: `removeFromSuperview()` + ARC dealloc kills WebContent process | None |
| Windows WebView2 | Separate renderer process per origin/environment | Usually reliable: `Close()` terminates renderer (edge-case hangs documented) | None |

## Alternatives considered

1. **Web Worker**: WASM runs in a separate thread, but Workers don't have
   access to WebGL canvas, audio, or DOM — incompatible with MonoGame's
   rendering pipeline.

2. **Electron**: Each `BrowserView`/`BrowserWindow` gets a dedicated Chromium
   renderer process with guaranteed process-per-site isolation. However,
   switching frameworks is a major architectural change beyond this issue's
   scope. Tauri's WebviewWindow approach achieves equivalent isolation on
   both platforms.

3. **Child OS process with headless WebView**: Maximum isolation but requires
   a custom IPC protocol, process management, and no visual rendering proof.

4. **Timer-based cooperative stop**: Cannot work because the hung synchronous
   loop prevents any timer callback from firing in the blocked WebContent
   process.

## Verification status

| Platform | Compiled | Tested | Force-stop proven |
|---|---|---|---|
| macOS aarch64 | ✅ | ✅ (packaged proof) | ✅ (5ms native destroy, heartbeat + input mutation during hang) |
| Windows x64 | ✅ (cross-compile structurally guarded) | ❌ Not tested | ❌ WebView2 `Close()` reliability unproven |

Windows claims are qualified: the code compiles for Windows targets and the
architecture is structurally equivalent, but no packaged Windows proof has
been executed. Known WebView2 `Close()` hang bugs
(MicrosoftEdge/WebView2Feedback#3140, #4817) are documented but not tested.

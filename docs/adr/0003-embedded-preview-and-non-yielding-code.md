# ADR 0003: Embedded preview and non-yielding user code

**Status:** Accepted  
**Date:** 2026-09-08  
**Decider:** Product owner

## Context

Issue 038 proved that a MonoGame preview in a separate Tauri `WebviewWindow`
could be destroyed when user code entered a synchronous infinite loop. That
architecture kept the editor responsive, but it displayed the game in a second
visible OS window and required a substantial cross-WebView bridge, command, ACL,
and lifecycle apparatus.

The separate window produced an unacceptable product experience. MonoGame
Playground is an interactive learning workbench; the preview belongs in the
right-hand preview panel, next to the source being edited. Maintaining a second
window solely to recover from deliberately or accidentally non-yielding code is
not proportionate to the MVP.

An iframe shares the Workbench WebView's JavaScript thread. No timer, Stop
button, DOM removal, or cooperative protocol request can execute while user code
holds that thread indefinitely. Static analysis also cannot reliably detect all
forms of non-termination: an obvious `while (true)` is only one form, alongside
`for (;;)`, recursion, blocking calls, and data-dependent finite-looking loops.

## Decision

The production preview will run in the Workbench preview panel as a replaceable
iframe with exactly the existing opaque-origin sandbox and CSP boundary.

The supported lifecycle is cooperative:

1. User game callbacks return control to MonoGame's browser frame loop.
2. Stop or `Game.Exit()` cancels the Emscripten loop.
3. The preview releases WebGL, audio, object URLs, and message ports.
4. The host removes the iframe; the next Run creates a fresh runtime.

Finite loops are supported. Synchronous code that never yields—including an
unbounded loop in the constructor, `LoadContent`, `Update`, or `Draw`—is outside
the supported execution contract. Such code can freeze the preview and editor
and may require the user to terminate and relaunch the application. The product
does not claim that all possible non-terminating programs can be detected or
rejected before execution.

The first-run warning and product documentation must disclose this limitation.
The two-second Stop requirement applies only to supported code that yields
between frames.

Issue 038 and ADR 0002 remain historical proof that forced termination was
technically possible. The isolated-window code may remain temporarily as a test
harness while old proofs are migrated, but it is not the production UX or a
product guarantee.

## Consequences

### Positive

- The game is visually embedded where users expect it.
- Preview focus, keyboard routing, resizing, and status are part of one coherent
  Workbench UI.
- Production no longer depends on a complex polling bridge between two visible
  windows.
- Normal Run/Stop remains deterministic because each successful Run receives a
  fresh iframe and runtime.

### Negative

- A synchronous non-yielding callback can freeze the entire shared WebView.
- The in-app Stop button and unsaved-change prompt cannot run while that thread
  is blocked; recent unsaved edits may be lost if the application must be
  forcibly terminated.
- The iframe sandbox, CSP, protocol validation, and Tauri IPC denial remain
  defence-in-depth boundaries, not process, CPU, memory, or malicious-code
  isolation.
- Performance measurements taken on the former isolated-window path are
  historical and must not be presented as measurements of the embedded product
  path.

## Supersedes

This decision supersedes ADR 0002 as the product architecture and amends the
forced-stop requirements previously stated in PRD sections 8.3, 13.3, 19, 20,
22, 23, 24, 25, and 26.

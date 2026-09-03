# Human implementation specification: WebGL `Game.Exit`

> **Policy gate:** `external/MonoGame/AGENTS.md` prohibits AI-generated
> submissions. The MonoGame implementation, tests, commit, and push described
> here must be authored and performed by a human contributor. Do not turn this
> document into an automated patch, and do not use an agent to open a MonoGame
> issue or pull request.

## Investigated baseline

- Parent commit: `edbef6cdd6ad314aedf3e9592199dc20278ea811`
- MonoGame commit: `eb687a0ec226b56f0b2b2a1a01ad811a841fc116`
- Investigation was read-only. The checkout was already dirty; the exact
  recursive pre/post status and SHA-256 inventory is in the session evidence
  under `files/issue026-research/`.

At this commit, `Game.Exit()` sets `_shouldExit` and suppresses drawing
(`MonoGame.Framework/Game.cs:395-399`). Near the end of the next `Tick`, the
managed lifecycle is:

1. raise `Exiting`;
2. if it was not cancelled, call `UnloadContent`;
3. call `Platform.Exit`;
4. call `EndRun`;
5. clear `_shouldExit`.

That ordering is visible at `MonoGame.Framework/Game.cs:615-631`.
`Game.Run(Asynchronous)` subscribes to `AsyncRunLoopEnded` and calls
`StartRunLoop` (`Game.cs:481-487`), but Native never raises that event
(`GamePlatform.cs:107-119`; the only repository match for
`RaiseAsyncRunLoopEnded` is its declaration).

`NativeGamePlatform.Exit()` only increments `_isExiting`
(`MonoGame.Framework/Platform/Native/GamePlatform.Native.cs:89-92`). The
synchronous desktop loop calls `RunOneLoop`, then tests
`_isExiting > 0 && ShouldExit()` and breaks
(`GamePlatform.Native.cs:94-105`). In contrast, WebGL `StartRunLoop` stores
`this` in the static `_nativeGamePlatform` field and registers the static
`RunEmscriptenMainLoop` delegate with Emscripten
(`GamePlatform.Native.cs:304-310`). Its callback only invokes `RunOneLoop`
(`GamePlatform.Native.cs:42-46`); it never tests `_isExiting`, calls
`ShouldExit`, cancels the loop, or raises loop-ended.

An `emscripten_cancel_main_loop` import exists at
`GamePlatform.Native.cs:39-40`, but there is no use of it in MonoGame code.
The other repository matches are SDL test/vendor code. There is also no
`JSExport`, `JSImport`, `UnmanagedCallersOnly`, product `postMessage`, or
exit-callback bridge in `MonoGame.Framework`, `native/monogame`, or the Web
example. `Example/wwwroot/main.js:5-14` installs only a location import, and
`main.js:20-23` accesses the Emscripten canvas/filesystem.

The callback is static, and the static `_nativeGamePlatform` field roots the
platform/game graph. No delegate field records the marshalled callback, no
running/cancelled generation is tracked, and neither cancellation nor
`NativeGamePlatform.Dispose` clears `_nativeGamePlatform`
(`GamePlatform.Native.cs:374-397`). A cancelled/restarted runtime therefore
needs explicit static/generation cleanup rather than relying on disposal or
GC.

## Consequence for issue 024

Issue 024 cannot truthfully claim cooperative cancellation today.
`Game.Exit()` reaches `Platform.Exit()`, but the registered browser callback
continues to run. Calling `Game.Dispose()` releases resources while that
callback remains scheduled would allow a later callback to dereference a
disposed/null platform. A playground-local Emscripten import, reflection into
private MonoGame state, or duplicate scheduler is not an acceptable
workaround: loop ownership belongs to MonoGame.

`Game.Exit()` also does **not** dispose the game. Explicit `Game.Dispose`
disposes components and content, then the `GraphicsDeviceManager`, platform,
and global sound system (`Game.cs:102-161`). The graphics manager owns and
disposes the `GraphicsDevice`
(`MonoGame.Framework/GraphicsDeviceManager.cs:273-292`); Native platform
disposal destroys the window, static graphics system, and platform handle
(`GamePlatform.Native.cs:374-397`); sound shutdown drains pooled instances and
destroys the native audio system (`Audio/SoundEffect.cs:125-130`,
`Platform/Native/SoundEffect.Native.cs:29-36`). Cancellation and disposal are
therefore distinct operations, and disposal remains the preview owner's job.

## Required state machine and semantics

Implement two phases without creating a dependency cycle:

1. **026A — human MonoGame change:** provide a correct WebGL loop-cancellation
   primitive and a product-facing exit notification bridge.
2. **024 — playground manual Stop:** consume the cancellation primitive,
   dispose once, then retire ports/URLs/iframe and emit `preview.stopped`.
3. **026B — playground integration:** translate the MonoGame exit notification
   to `preview.exited`, then enter issue 024's completed cleanup path.

The MonoGame implementation must satisfy all of these rules:

- A normal `Game.Exit()` request remains deferred to the end of the current
  managed tick. Preserve `Exiting` (including cancellation),
  `UnloadContent`, `Platform.Exit`, and `EndRun` ordering exactly.
- In the WebGL Emscripten callback, after `RunOneLoop` returns, observe the
  exit request using the same logical desktop condition:
  `_isExiting` is pending and `ShouldExit` permits exit. This is the likely
  ownership point for calling `emscripten_cancel_main_loop`: MonoGame
  registered the callback there and the managed end-of-tick lifecycle has
  completed. Do not cancel before `RunOneLoop` returns.
- Win an atomic/per-runtime cancellation transition exactly once. Call
  Emscripten cancellation exactly once, arrange that no game callback is
  invoked after cancellation, and make a second/concurrent `Exit()` harmless.
  Reentrancy from `Exiting`, `UnloadContent`, `EndRun`, disposal, or a host
  callback must not duplicate cancellation or notification.
- Publish one host notification for a game-requested exit only after loop
  cancellation has won and managed `EndRun` has completed. Its semantic data
  is exit code `0` and cause `game-exit` (future nonzero codes may be added
  separately). Notification failure must not restart the loop or duplicate
  teardown.
- Manual Stop is a distinct host cause. It must use the same idempotent loop
  cancellation ownership but emit **no game-exit notification**. Do not
  implement manual Stop by pretending the game called `Exit()` if that would
  fire the notification. Cancellation must complete before disposal.
- `Game.Exit()`/loop cancellation does not take ownership of
  `Game.Dispose()`. The preview host owns one explicit disposal after
  notification. It must not dispose graphics/audio/content inside the
  scheduler callback and then allow the host to dispose them again.
- On cancellation/disposal, detach any loop-ended subscription as appropriate,
  clear callback/platform static roots, and invalidate the old generation.
  A stale queued callback must be a no-op. Starting a new game/new runtime must
  install a fresh generation and must never call the old platform. Decide and
  test whether same-runtime restart is supported; the playground itself always
  creates a fresh iframe/runtime.
- Define race priority explicitly: the first accepted terminal cause wins.
  A user Stop already in `stopping` suppresses a later game-exit notification;
  a game exit that already won emits once and drives the shared cleanup. Both
  paths cancel and dispose at most once.

## Host bridge

MonoGame currently has no suitable bridge. Add a product-neutral,
browser-only mechanism by which the embedding Web runtime can register for a
structured loop termination (`exitCode`, cause), while keeping MonoGame
independent of the playground protocol. The playground will map it to
`preview.exited`.

Two acceptable designs for human evaluation are:

- a managed registration/event surface whose browser host callback is
  installed during bootstrap; or
- a narrowly named Emscripten/JS module callback invoked by Native platform
  code.

Prefer an explicit registered callback over an ambient `Module` property:
registration makes ownership, replacement, absence, exception handling, and
per-runtime cleanup testable. Do not make MonoGame emit
`preview.exited`/`postMessage` directly. Document callback thread (browser main
thread), lifetime, once-only behavior, and behavior when no host is
registered.

## Likely human-owned MonoGame work

Inspect and, only where the chosen design requires, change:

- `MonoGame.Framework/Platform/Native/GamePlatform.Native.cs`:
  `RunEmscriptenMainLoop`, `_nativeGamePlatform`, `_isExiting`,
  `StartRunLoop`, `Exit`, and `Dispose`;
- `MonoGame.Framework/Game.cs`: verify, rather than casually alter,
  end-of-tick lifecycle and disposal ownership;
- `MonoGame.Framework/GamePlatform.cs`: asynchronous-loop-ended contract and
  any product-neutral registration abstraction;
- `MonoGame.Framework/Platform/Native/Platform.Interop.cs` and
  `native/monogame/include/api_MGP.h` only if the bridge/cancellation is placed
  behind a native export. Current platform exports are only create/destroy,
  poll/start/before hooks, path/platform/backend, window, mouse, cursor, and
  gamepad functions (`api_MGP.h:19-55`); there is no stop or host-exit export;
- `Example/wwwroot/main.js` only for a human-run browser integration harness,
  not for playground protocol coupling.

Keeping cancellation in managed Native platform code uses the already declared
Emscripten import and minimizes C ABI changes. A native export may provide a
cleaner embedding ABI, but adds generated interop/header maintenance and must
still coordinate with managed lifecycle ordering.

## Required human-authored tests

### Human test decision

The human contributor committed the cancellation fix without adding MonoGame
tests. The recorded rationale is that the repository has no existing tests for
the Web platform and introducing the required Web/Emscripten test harness would
be disproportionate work for this change. This is an explicit accepted
verification gap, not evidence that the cases below passed. The playground
must therefore exercise the committed behavior through its packaged
browser-WASM proof before relying on it.

1. Extend the existing `Game` lifecycle coverage near
   `Tests/Framework/GameTest.cs:230-298` to assert one
   `Exiting -> UnloadContent -> EndRun` sequence, cancelled `Exiting` does not
   terminate, and repeated `Exit` remains idempotent.
2. Add a Native/Web scheduler test seam that counts callback, cancellation,
   loop-ended, and host-notification calls. Cover normal exit, cancelled exit,
   second/reentrant exit, manual stop (no exit notification), Stop-vs-Exit
   race, callback queued after cancel, disposal during/after notification, no
   registered host, and fresh generation/restart.
3. Run a real browser-WASM integration test where `Update` calls `Exit`.
   Prove the last frame callback returns, Emscripten cancellation occurs once,
   no subsequent Update/Draw occurs, notification is exactly
   `{ exitCode: 0, cause: "game-exit" }`, and explicit disposal releases
   WebGL/audio. Repeat in a fresh runtime and prove no old callback/static root
   fires.
4. Run a browser manual-stop case proving cancellation once, disposal once,
   and zero game-exit notifications.

Existing command convention is `dotnet test
Tests/MonoGame.Tests.DesktopGL.csproj` (`Tests/README.md:15-31`). After the
human commit, from the parent repository, source the sibling Emscripten SDK and
run the exact product build/verification chain:

```bash
source ../emsdk/emsdk_env.sh
./scripts/build-monogame.sh --allow-dirty
node scripts/verify-preview-native-artifacts.mjs
dotnet build src/preview/Playground.Preview.csproj --configuration Release
node scripts/inspect-preview-wasm.mjs
```

Use `--allow-dirty` only because this recorded checkout already contains
unrelated dirty generated assets; it does not bypass SHA/protected-ref/emsdk
checks. The human must also record the exact command used for the browser test
and its browser/SDK versions.

## Playground protocol ordering (026B)

After issue 024 exposes one cleanup operation, map the bridge event as follows:

1. atomically select `exited` only if no earlier Stop/failure cause won;
2. emit exactly one `preview.exited` with the next sequence and
   `{ previewId, sequence, exitCode: 0 }`;
3. request the shared cleanup with internal reason `exit-cleanup`;
4. after loop cancellation, disposal, port/URL retirement, and iframe cleanup,
   complete exactly one `preview.stopped` with reason `exited`.

This preserves `src/shared/Protocol.md:680-701`: `preview.exited` selects a
cause but never replaces terminal `preview.stopped`. A racing earlier manual
Stop produces only `preview.stopped` reason `requested`.

## Acceptance and evidence checklist

- [ ] Human confirms this specification against the cited MonoGame commit.
- [ ] Human-authored diff contains cancellation, once/generation state, static
      cleanup, and a product-neutral host bridge; no playground protocol in
      MonoGame.
- [ ] Managed lifecycle, Native scheduler, browser exit, manual stop, race,
      stale callback, disposal, and restart tests pass.
- [ ] Browser trace proves cancel once, notification once for Game.Exit, none
      for manual Stop, and no callback after cancel.
- [ ] Graphics/audio/resource ownership and disposal-once evidence recorded.
- [ ] Exact test/build commands, versions, logs, and before/after recursive
      status attached.
- [ ] Human reviews, commits, and pushes the MonoGame change.
- [ ] 026B waits for issue 024 cleanup, then proves
      `preview.exited -> preview.stopped(reason=exited)` ordering.
- [ ] Parent submodule pointer/manifest update is a separate, independently
      verified parent commit.

## Human handoff record

- Suggested branch: `fix/webgl-game-exit-loop`
- Human author/reviewer: human-authored and reviewed by the user
- MonoGame local branch: `feature/openglnative`
- MonoGame branch pushed: not yet recorded
- MonoGame commit SHA (40 hex): `ecf06ee240dcc5524e82b656b4682e22b4c91175`
- Reachable pushed ref/remote URL: `________________`
- Native/unit test command and result: not run; no existing Web-platform test
  harness, and adding one was declined as disproportionate work
- Browser test command, browser, and result: pending playground packaged
  browser-WASM verification
- Emscripten SDK version: `________________`
- Cancellation/notification/disposal trace: `________________`
- Known limitations or same-runtime restart decision: `________________`

Return the full commit SHA and pushed ref before any parent submodule pointer
is changed. This document is a human implementation specification, not an
implementation or patch.

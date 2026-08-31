# Validate and mount nested Web-profile Texture2D

**Type:** AFK
**Status:** Done
**Blocked by:** [023-retain-async-game-and-render-clear-color.md](023-retain-async-game-and-render-clear-color.md)
**PRD references:** 15, 19
**User stories:** US6
**Triage:** needs-triage

## Context

PRD section 15 defines the MVP content contract: assets must be built with the MonoGame Web content profile matching the pinned MonoGame revision, the application must reject a non-Web `.xnb` platform marker before preview startup with an actionable diagnostic explaining how to rebuild with `MonoGamePlatform=Web`, the initial supported subset is uncompressed `Texture2D` and non-streaming `SoundEffect` content, and `Content.RootDirectory`, nested asset paths, path normalization, and missing/incompatible-content diagnostics must be defined and tested. Critical feasibility questions 12 and 20 (section 19) ask whether precompiled `.xnb` files can be mounted dynamically and whether Web-profile content can be validated and mounted before runtime startup. This issue implements Texture2D content mounting and validation; SoundEffect is issue 40.

## What to build

Implement an asset-mounting step that runs before `RunLoadedGame` (issue 23): given one or more `.xnb` files (with nested relative paths, e.g. `Content/textures/player.xnb`) and the user's declared `Content.RootDirectory`, validate each file's platform marker is the Web profile, mount valid files into the preview's virtual filesystem (so `ContentManager.Load<Texture2D>("textures/player")` resolves them), and reject invalid/incompatible files with a clear diagnostic before the game starts, proven with a real known-good Web-profile `.xnb` texture built from the pinned MonoGame revision.

## Scope

### In scope

- A content-validation function that reads a `.xnb` file's header/platform marker and confirms it matches the Web profile (reject with a clear diagnostic otherwise, per PRD 15's exact requirement to explain rebuilding with `MonoGamePlatform=Web`)
- Mounting valid `.xnb` files into the preview's Emscripten/`.NET` virtual filesystem at the correct nested path relative to `Content.RootDirectory`, including recursive directory creation
- Producing a real known-good Web-profile `.xnb` texture fixture, built using MGCB against the pinned MonoGame revision from `external/MonoGame` (or obtained from an existing MonoGame Web example/test fixture already in the submodule, if one exists — check `external/MonoGame/Example/Content` and any test content directories first)
- Loading the mounted texture via `Content.Load<Texture2D>(...)` inside a test `Game1` and confirming it renders (e.g. via `SpriteBatch.Draw`)
- A negative test: attempting to mount a non-Web-profile `.xnb` (e.g. a DesktopGL-profile one, if one can be produced or found) and confirming it is rejected with a clear diagnostic before the game starts

### Out of scope

- SoundEffect content (issue 40)
- Custom Effect content, video, streaming audio, or compressed textures (explicitly out of scope for the MVP per PRD section 15)
- The production content-project discovery/workflow UI (issue 52)

## Implementation guidance

1. Investigate `.xnb` file format's platform marker: MonoGame's `.xnb` header format encodes a platform character (e.g. `w` for Windows, `W`/similar for Web/WebGL depending on this fork's exact convention — inspect `external/MonoGame`'s content pipeline/reader source, e.g. under `external/MonoGame/MonoGame.Framework.Content.Pipeline` or `MonoGame.Framework`'s `ContentReader`, to find the authoritative platform-marker byte and its expected value for the Web profile) at a fixed byte offset near the start of the file.
2. Implement `src/preview/ContentValidator.cs` (or equivalent) with a `ValidateXnbPlatform(byte[] xnbBytes)` method reading the header and confirming the platform marker matches the Web profile; on mismatch, return a `PlaygroundDiagnostic` with a message explicitly instructing the user to rebuild the asset with `MonoGamePlatform=Web` (quoting PRD 15's exact phrasing).
3. Implement asset mounting: before calling `RunLoadedGame`, for each asset entry `(relativePath, bytes)` sent from the frontend (per an `asset.mount` message added to `src/shared/Protocol.md` if not already covered by issue 15's schema — extend the protocol doc now if this specific message type was not yet defined), normalize the path (strip `..` traversal, normalize slashes) and write it into the location MonoGame's `ContentManager`/its underlying virtual file system expects relative to `Content.RootDirectory`, creating intermediate directories recursively.
4. Produce a known-good fixture: use MGCB (`external/MonoGame`'s content pipeline tool, likely invoked via `dotnet mgcb` if available in this build) to build a simple `.png`/texture source into a Web-profile `.xnb`, or locate an existing one already built as part of the Example project's content pipeline output in `artifacts/monogame/` or `external/MonoGame/Example/Content/bin`. Save the resulting fixture under `examples/ContentExample/Content/` (create this path, matching PRD section 10's proposed repository layout) alongside a minimal `Game1.cs` that loads and draws it via `SpriteBatch`.
5. Run the full pipeline: compile the test `Game1.cs`, mount the fixture texture, run, and visually confirm the texture renders on the canvas.
6. Negative test: intentionally corrupt or fabricate an `.xnb` with a non-Web platform marker byte and confirm `ValidateXnbPlatform` rejects it with the expected diagnostic before the game starts (i.e. before `Content.Load` is ever reached).

## Acceptance criteria

- [x] A known-good Web-profile `.xnb` texture fixture exists under `examples/ContentExample/Content/`, hand-assembled against the pinned MonoGame reader/writer format and proven compatible through a real packaged load/render
- [x] The fixture is mounted at the correct nested path relative to `Content.RootDirectory` and successfully loads via `Content.Load<Texture2D>(...)` inside a running test game
- [x] The loaded texture visibly renders via `SpriteBatch.Draw` in the preview canvas
- [x] An `.xnb` with an incorrect/non-Web platform marker is rejected with a diagnostic that explicitly instructs rebuilding with `MonoGamePlatform=Web`, and this rejection happens before the game is started
- [x] Nested relative asset paths (e.g. `textures/player.xnb`) are correctly normalized and mounted, including recursive directory creation

## Verification

Run the full content pipeline: mount the known-good fixture, run the test game, and visually confirm the texture renders (screenshot or precise visual description). Then run the negative test with a deliberately wrong platform marker and confirm the returned diagnostic text explicitly mentions `MonoGamePlatform=Web`, and confirm (via a log or breakpoint-equivalent check) that this rejection occurs strictly before `RunLoadedGame`/`Content.Load` executes. The verifier must observe both the positive rendering result and the exact negative-case diagnostic text.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent `issue039-race-verifier` code-review agent
- **Date:** 2026-08-31
- **Evidence:** The packaged macOS proof mounted the 224-byte fixture at `Content/textures/player.xnb`, loaded it through `Content.Load<Texture2D>`, rendered and sampled the expected multicolor pixels, and measured one construction/run/disposal with window retirement and native-transfer cleanup. The negative DesktopGL fixture returned exactly `PG0010_CONTENT_PLATFORM_MISMATCH`, included `MonoGamePlatform=Web`, and left construction/run at zero with no partial mount. The final verifier also inspected the owner-bound Mount/Load/Start admission wrapper, deferred concurrency coverage, corrected `preview.js` syntax, and regenerated proof evidence before returning PASS.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `preview: validate and mount nested Web-profile Texture2D content`

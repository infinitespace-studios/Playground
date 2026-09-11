# Content workflow (Web profile)

How to add textures and sounds to a Playground project. The preview runs the
pinned MonoGame **Web** profile (`external/MonoGame`, `MonoGamePlatform=Web`),
and a project's `Content/` folder is discovered and mounted automatically before
Run — no manual asset wiring.

## TL;DR

Put assets under your project's `Content/` folder and load them by logical name
(no extension) with `Content.Load<T>`:

```csharp
protected override void LoadContent()
{
    Content.RootDirectory = "Content"; // set by the preview before Run
    _texture = Content.Load<Texture2D>("textures/sprite");   // Content/textures/sprite.png
    _sound   = Content.Load<SoundEffect>("audio/tone");      // Content/audio/tone.wav
}
```

Set `"contentProfile": "Web"` in `playground.json`. On Run, the preview
discovers every supported file under `Content/`, validates it, mounts it into
the runtime's virtual filesystem, and only then starts your game. A content
problem (wrong profile, unsupported/corrupt asset) is reported in the **Output**
panel and the game does not start.

## Supported asset types

| Type | Formats | Pipeline needed? |
|------|---------|------------------|
| `Texture2D` | `.png`, `.jpg`/`.jpeg`, `.bmp` | **No** — raw file, decoded by `Texture2D.FromStream` |
| `Texture2D` | `.xnb` (precompiled) | Optional — a Web-profile `.xnb` also works |
| `SoundEffect` | `.wav` (PCM) | **No** — transcoded to XNB at mount |
| `SoundEffect` | `.xnb` (precompiled) | Optional — a Web-profile `.xnb` also works |

Anything else (e.g. `.mp3`/`.ogg` audio, shader `Effect`, `SpriteFont`, `Model`)
is out of scope for the MVP and is rejected with a clear Output-panel error.

### Images — no build step

The MonoGame Web runtime falls back to `Texture2D.FromStream` (StbImageSharp)
when it finds a raw image instead of an `.xnb`, so **you can drop a `.png`
straight into `Content/` and load it by name**. Supported: PNG, JPEG, BMP.

### Audio — raw PCM WAV, no build step

`Content.Load<SoundEffect>` normally needs an `.xnb`, but the Playground preview
**transcodes a raw PCM `.wav` into the exact XNB SoundEffect container at mount
time** (an audio `.xnb` body is just `WAVEFORMATEX` + PCM + loop/duration
trailer — the same bytes a `.wav` already contains). Requirements, matching the
runtime's supported subset:

- Uncompressed **PCM** (`wFormatTag = 1`) — not float, ADPCM, or
  `WAVE_FORMAT_EXTENSIBLE`
- **8- or 16-bit**, **mono or stereo**
- **8000–48000 Hz**

Anything outside that is rejected with a `PG0211_CONTENT_UNSUPPORTED_WAV`
message telling you what to change.

## Precompiled `.xnb` (optional, advanced)

If you already have MGCB output, a **Web-profile** `.xnb` works too. It must be
built with `MonoGamePlatform=Web` and be uncompressed; a non-Web `.xnb` is
rejected with `PG0010_CONTENT_PLATFORM_MISMATCH` (rebuild with
`/p:MonoGamePlatform=Web`). Because the raw `.png`/`.wav` paths above need no
toolchain, `.xnb` is only worth it for content types the raw paths do not cover
(none, for the MVP's `Texture2D`/`SoundEffect` scope).

## Worked example: `examples/ContentExample/`

```
examples/ContentExample/
  playground.json                     contentProfile: "Web"
  Game1.cs                            loads all three below
  Content/
    textures/player.xnb               precompiled Web-profile texture
    textures/sprite.png               RAW png  -> Texture2D.FromStream
    audio/blip.xnb                    precompiled Web-profile sound
    audio/tone.wav                    RAW wav  -> transcoded to XNB at mount
```

Open the folder and press Run: both textures render side by side and pressing
**Space** plays the tone (**Escape** stops it) — with no content-build step for
the raw `.png`/`.wav`.

### Reproducing the example's raw fixtures

The two raw assets are generated deterministically (no `Math.*` in the sample
path, so rebuilds are byte-identical):

```
node scripts/build-content-fixtures.mjs          # rewrite sprite.png + tone.wav
node scripts/build-content-fixtures.mjs --check   # verify committed bytes
```

`tone.wav` reuses the issue 040 integer sine-table PCM, so transcoding it
produces byte-for-byte the same XNB SoundEffect as the committed `blip.xnb`.

## Error reference

| Code | Meaning |
|------|---------|
| `PG0215_CONTENT_PROFILE_NOT_WEB` | `playground.json` `contentProfile` is not `"Web"` |
| `PG0010_CONTENT_PLATFORM_MISMATCH` | An `.xnb` was built for a non-Web platform |
| `PG0211_CONTENT_UNSUPPORTED_WAV` | WAV is not PCM 8/16-bit mono/stereo 8–48 kHz |
| `PG0213_CONTENT_INVALID_IMAGE` | Not a recognized PNG/JPEG/BMP (or empty/oversized) |
| `PG0214_CONTENT_IMAGE_EXTENSION_MISMATCH` | File contents don't match the extension |
| `PG0212_CONTENT_UNSUPPORTED_EXTENSION` | A `Content/` file type the preview cannot mount |

## `playground.json` manifest schema

The project manifest is a small JSON object. `schemaVersion` is `1`.

```json
{
  "name": "Hello World",
  "schemaVersion": 1,
  "contentProfile": "Web"
}
```

| Field | Meaning |
|-------|---------|
| `name` | Display name (falls back to the folder name if absent) |
| `schemaVersion` | Manifest format version; a newer version than the app supports is rejected on Open |
| `contentProfile` | Content build profile; must be `"Web"` |

The manifest deliberately does **not** carry preview panel dimensions. Render
resolution comes from the game's `GraphicsDeviceManager` back-buffer size, and
the displayed size is CSS-scaled to fill the responsive preview panel (see
`preview.css`). An earlier draft schema included a vestigial
`preview: { width, height }` block that was never applied; it has been removed.
Projects whose on-disk `playground.json` still contains a `preview` block open
normally (the block is ignored) and it is never written back on Save All.

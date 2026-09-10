# Content Fixture Provenance

## textures/player.xnb

- **SHA-256**: `ec8c5439755b300163c43165a3c1c374063f076a8347a982a320d2508106b629`
- **Size**: 224 bytes
- **Platform**: Web (`b` = TargetPlatform.Web, index 12)
- **XNB Version**: 5 (MonoGame 3.8.x format)
- **Profile**: Reach (flags byte 0x00)
- **Compression**: None (uncompressed)
- **SurfaceFormat**: Color (RGBA32, enum value 0)
- **Dimensions**: 4×4 pixels
- **Mipmaps**: 1 (level 0 only)
- **Reader**: `Microsoft.Xna.Framework.Content.Texture2DReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null`

### Build method

Programmatic binary construction matching the MonoGame `ContentWriter` XNB
format as documented in the pinned MonoGame source at `external/MonoGame`.
The MGCB content builder tool was not executed because `external/MonoGame`
is a read-only submodule (per `AGENTS.md`) and building the content pipeline
tools would require modifying the submodule. Instead, the XNB binary was
hand-assembled byte-for-byte to match the exact output format:

- Header layout verified against `ContentWriter.WriteHeader()` in
  `ContentWriter.cs`
- `TargetPlatformIdentifiers[12]` = `'b'` (Web) verified in both
  `ContentWriter.cs` and `ContentManager.cs`
- Texture2D body format verified against `Texture2DContentWriter.Write()`
- Reader type string format verified against `ContentWriter.WriteTypeWriters()`
- 7-bit encoded integers match `BinaryWriter.Write7BitEncodedInt()`
- The fixture is proven by actual MonoGame `Content.Load<Texture2D>()` in
  the packaged proof (`src/frontend/src/proof-content.ts`, the Stage-4
  consolidation of the former `issue039.ts` driver), which exercises the real
  `Texture2DReader.Read()` code path in the pinned MonoGame runtime DLL.

### XNB binary layout

| Offset | Length | Field | Value |
|--------|--------|-------|-------|
| 0 | 3 | Magic | `XNB` (0x58 0x4E 0x42) |
| 3 | 1 | Platform | `b` (0x62 = Web) |
| 4 | 1 | Version | 5 |
| 5 | 1 | Flags | 0x00 (Reach, uncompressed) |
| 6 | 4 | File size | 224 (LE int32) |
| 10 | 1 | Reader count | 1 (7-bit encoded) |
| 11 | var | Reader type | Length-prefixed UTF-8 string |
| var | 4 | Reader version | 0 (LE int32) |
| var | 1 | Shared resources | 0 (7-bit encoded) |
| var | 1 | Type reader index | 1 (7-bit encoded, 1-based) |
| var | 4 | SurfaceFormat | 0 (Color/RGBA32) |
| var | 4 | Width | 4 |
| var | 4 | Height | 4 |
| var | 4 | Mipmap count | 1 |
| var | 4 | Level 0 data size | 64 |
| var | 64 | Pixel data | 4×4 RGBA (see pattern below) |

### Pixel pattern (RGBA, row-major)

```
Row 0: Red(255,0,0,255)    Green(0,255,0,255)    Blue(0,0,255,255)       White(255,255,255,255)
Row 1: Yellow(255,255,0,255) Cyan(0,255,255,255)  Magenta(255,0,255,255)  Black(0,0,0,255)
Row 2: Orange(255,128,0,255) Purple(128,0,255,255) Pink(255,192,203,255)  Gray(128,128,128,255)
Row 3: CornflowerBlue(100,149,237,255) ×4
```

This pattern is chosen so that:
- Each pixel is unique and identifiable in proof screenshots
- Row 3 matches MonoGame's default `Color.CornflowerBlue` clear color for comparison
- The pattern can be verified programmatically by reading back pixel data

### Source references

- `external/MonoGame/MonoGame.Framework.Content.Pipeline/Serialization/Compiler/ContentWriter.cs` — XNB header format, `TargetPlatformIdentifiers` array
- `external/MonoGame/MonoGame.Framework.Content.Pipeline/Serialization/Compiler/Texture2DContentWriter.cs` — Texture2D binary content layout
- `external/MonoGame/MonoGame.Framework/Content/ContentReaders/Texture2DReader.cs` — Runtime reader that will consume this fixture
- `external/MonoGame/MonoGame.Framework/Content/ContentManager.cs` — Path resolution: `RootDirectory + "/" + assetName + ".xnb"`
- `external/MonoGame/MonoGame.Framework.Content.Pipeline/TargetPlatform.cs` — `Web` enum member at index 12

## audio/blip.xnb

- **SHA-256**: `247f196aa6e26aa2982286d20dbd8a91a40beaa90b76e445bf70fda6ba4a70eb`
- **Size**: 44,280 bytes
- **Platform**: Web (`b` = TargetPlatform.Web, index 12)
- **XNB Version**: 5 (MonoGame 3.8.x format)
- **Profile**: Reach (flags byte 0x00)
- **Compression**: None (uncompressed, non-streaming)
- **Audio format**: WAVEFORMATEX, `wFormatTag` 1 (PCM), mono, 22,050 Hz, 16-bit,
  `nBlockAlign` 2, `nAvgBytesPerSec` 44,100, `cbSize` 0
- **Payload**: 22,050 samples (44,100 bytes) — exactly 1.000 s
- **Declared duration**: 1,000 ms; loop start 0, loop length 22,050 samples
- **Reader**: `Microsoft.Xna.Framework.Content.SoundEffectReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null`

### Build method

Programmatic binary construction matching the pinned MonoGame
`SoundEffectWriter`/`SoundEffectReader` contract at `external/MonoGame`, for the
same reason as `textures/player.xnb`: `external/MonoGame` is a read-only
submodule (per its `AGENTS.md`), so MGCB was not executed. The generator is
committed at `scripts/build-audio-content-fixture.mjs`, which shares its
assembler with the packaged proof
(`src/frontend/src/audio-content-fixture.ts`):

```
node scripts/build-audio-content-fixture.mjs          # rewrite the fixture
node scripts/build-audio-content-fixture.mjs --check  # verify the committed bytes
```

The sample data is produced from a 50-entry integer sine table with an
integer-only fade envelope, never `Math.sin`, so Node and the WebView emit
byte-identical output. The packaged issue 040 proof rebuilds these exact bytes
inside the preview, asserts the SHA-256 above, mounts them, and loads them with
the real `SoundEffectReader.Read()` path in the pinned MonoGame runtime.

### XNB binary layout

| Offset | Length | Field | Value |
|--------|--------|-------|-------|
| 0 | 3 | Magic | `XNB` (0x58 0x4E 0x42) |
| 3 | 1 | Platform | `b` (0x62 = Web) |
| 4 | 1 | Version | 5 |
| 5 | 1 | Flags | 0x00 (Reach, uncompressed) |
| 6 | 4 | File size | 44,280 (LE int32) |
| 10 | 1 | Reader count | 1 (7-bit encoded) |
| 11 | 1 | Reader type length | 124 (7-bit encoded) |
| 12 | 124 | Reader type | `Microsoft.Xna.Framework.Content.SoundEffectReader, …` |
| 136 | 4 | Reader version | 0 (LE int32) |
| 140 | 1 | Shared resources | 0 (7-bit encoded) |
| 141 | 1 | Type reader index | 1 (7-bit encoded, 1-based) |
| 142 | 4 | Format size | 18 (LE int32) |
| 146 | 18 | WAVEFORMATEX | PCM/mono/22,050 Hz/16-bit |
| 164 | 4 | Data size | 44,100 (LE int32) |
| 168 | 44,100 | PCM data | 441 Hz tone, peak 8,192 (≈ −12 dBFS) |
| 44,268 | 4 | Loop start | 0 |
| 44,272 | 4 | Loop length | 22,050 |
| 44,276 | 4 | Duration (ms) | 1,000 |

### Audio characteristics

- 441 Hz (22,050 / 50) so the single-cycle table repeats exactly 441 times
- Peak amplitude 8,192 of 32,767 (≈ −12 dBFS) — clearly audible but not loud
- 10 ms linear fade in and out so playback starts and ends at silence with no click
- Content is intentionally short and looped by the test games so playback can be
  observed and then explicitly stopped

### Source references

- `external/MonoGame/MonoGame.Framework.Content.Pipeline/Serialization/Compiler/SoundEffectContentWriter.cs` — format/data/loop/duration write order
- `external/MonoGame/MonoGame.Framework.Content.Pipeline/Audio/AudioFormat.cs` — 18-byte WAVEFORMATEX layout written by MGCB
- `external/MonoGame/MonoGame.Framework/Content/ContentReaders/SoundEffectReader.cs` — runtime reader that consumes this fixture
- `external/MonoGame/MonoGame.Framework/Audio/SoundEffect.cs` — PCM branch (`wFormatTag == 1`) used by this fixture
- `external/MonoGame/MonoGame.Framework/Platform/Native/SoundEffect.Native.cs` — FAudio buffer creation used by the Web (Native profile) runtime

## textures/sprite.png and audio/tone.wav (RAW fixtures — issue 052)

These two are **raw** assets that need no MGCB step: the preview loads
`sprite.png` via the MonoGame Web runtime's `Texture2D.FromStream` fallback, and
transcodes `tone.wav` (raw PCM) into an XNB SoundEffect at mount time
(`src/preview/WavToXnb.cs`). They demonstrate the issue 052 content workflow
(see `docs/content-workflow.md`).

- **textures/sprite.png**: 8×8 truecolour-with-alpha PNG (colour type 6), a
  deterministic gradient. Signature + IHDR + IDAT (zlib `deflateSync`) + IEND,
  each chunk CRC-32'd.
- **audio/tone.wav**: RIFF/WAVE PCM, mono, 22,050 Hz, 16-bit, wrapping the
  **same** integer sine-table PCM as `audio/blip.xnb` (issue 040). Transcoding it
  produces byte-for-byte the committed `blip.xnb` SoundEffect body (verified: the
  transcoded XNB is 44,280 bytes, identical to `blip.xnb`).

### Build method

Generated deterministically (no `Math.*` in the sample path) by
`scripts/build-content-fixtures.mjs`:

```
node scripts/build-content-fixtures.mjs          # rewrite both
node scripts/build-content-fixtures.mjs --check   # verify committed bytes
```

Both were verified to pass the real preview validators on the host:
`ImageContent.Validate` (png) and `WavToXnb.Convert` → `ContentValidator.Validate`
(wav → xnb), the exact code paths the packaged preview mount gate runs.

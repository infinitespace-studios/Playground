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
  the packaged proof (issue039.ts), which exercises the real
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

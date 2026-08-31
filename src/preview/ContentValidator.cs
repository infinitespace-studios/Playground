using System.Text;

namespace Playground.Preview;

/// <summary>
/// Validates XNB file headers for the Web content profile before preview startup.
/// The XNB binary format (MonoGame 3.8.x, format version 5) is:
///   Bytes 0-2: Magic "XNB" (0x58, 0x4E, 0x42)
///   Byte 3:    Platform identifier char ('b' = Web/WebAssembly)
///   Byte 4:    Format version (5 for current MonoGame, 4 for legacy XNA)
///   Byte 5:    Flags (bit 0 = HiDef, bit 6 = LZ4 compressed, bit 7 = LZX compressed)
///   Bytes 6-9: Total file size as little-endian int32
///   Then:      7-bit encoded reader count, reader type strings, shared resource count, content data
/// </summary>
internal static class ContentValidator
{
    /// <summary>Web platform identifier byte in the XNB header (index 12 in TargetPlatform enum).</summary>
    internal const byte WebPlatformByte = (byte)'b';

    /// <summary>Current XNB format version.</summary>
    internal const byte CurrentFormatVersion = 5;

    /// <summary>Legacy XNA format version also accepted by MonoGame ContentReader.</summary>
    internal const byte LegacyFormatVersion = 4;

    private const byte FlagCompressedLz4 = 0x40;
    private const byte FlagCompressedLzx = 0x80;
    private const byte FlagHiDef = 0x01;
    private const int HeaderSize = 10; // 3 magic + 1 platform + 1 version + 1 flags + 4 fileSize
    private const int MaxKnownSurfaceFormat = 72;
    private const int MaxTextureDimension = 8192;
    private const int MaxTextureMipCount = 14; // log2(8192) + 1
    private const int SurfaceFormatColor = 0;
    private const int SurfaceFormatColorSRgb = 32;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private const string Texture2DReaderType =
        "Microsoft.Xna.Framework.Content.Texture2DReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null";
    private const string UnsupportedReaderType =
        "Microsoft.Xna.Framework.Content.SpriteFontReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null";

    // Known platform identifiers from MonoGame ContentWriter.TargetPlatformIdentifiers
    private static readonly Dictionary<byte, string> KnownPlatforms = new()
    {
        [(byte)'w'] = "Windows",
        [(byte)'x'] = "Xbox360",
        [(byte)'i'] = "iOS",
        [(byte)'a'] = "Android",
        [(byte)'d'] = "DesktopGL",
        [(byte)'X'] = "MacOSX",
        [(byte)'n'] = "NativeClient",
        [(byte)'r'] = "RaspberryPi",
        [(byte)'P'] = "PlayStation4",
        [(byte)'5'] = "PlayStation5",
        [(byte)'O'] = "XboxOne",
        [(byte)'S'] = "Switch",
        [(byte)'b'] = "Web",
        [(byte)'V'] = "DesktopVK",
        [(byte)'G'] = "WindowsDX12",
        [(byte)'s'] = "XboxSeries",
        [(byte)'4'] = "DesktopGL4",
    };

    internal sealed record ValidationResult(
        bool Valid,
        string? DiagnosticId,
        string? DiagnosticMessage,
        byte? PlatformByte,
        string? PlatformName,
        byte? Version,
        byte? Flags,
        int? DeclaredSize,
        bool? Compressed,
        string? DetectedReaderType,
        int? ReaderCount);

    internal sealed record SelfTestCaseResult(bool Valid, string? DiagnosticId);

    /// <summary>
    /// Validates an XNB file's header for Web platform compatibility.
    /// Returns a ValidationResult indicating whether the file is acceptable.
    /// </summary>
    internal static ValidationResult Validate(ReadOnlySpan<byte> bytes, string assetPath)
    {
        // Check minimum header size
        if (bytes.Length < HeaderSize)
        {
            return Failure("PG0201_CONTENT_INVALID_HEADER",
                $"The content file '{BoundPath(assetPath)}' is too small to contain a valid XNB header ({bytes.Length} bytes, minimum {HeaderSize}).");
        }

        // Validate magic bytes
        if (bytes[0] != (byte)'X' || bytes[1] != (byte)'N' || bytes[2] != (byte)'B')
        {
            return Failure("PG0201_CONTENT_INVALID_HEADER",
                $"The content file '{BoundPath(assetPath)}' does not have a valid XNB magic header.");
        }

        var platformByte = bytes[3];
        var version = bytes[4];
        var flags = bytes[5];
        var declaredSize = BitConverter.ToInt32(bytes.Slice(6, 4));

        // Determine platform name
        KnownPlatforms.TryGetValue(platformByte, out var platformName);

        // Validate platform marker
        if (platformByte != WebPlatformByte)
        {
            var platformDesc = platformName ?? $"unknown (0x{platformByte:X2})";
            return new ValidationResult(
                Valid: false,
                DiagnosticId: "PG0010_CONTENT_PLATFORM_MISMATCH",
                DiagnosticMessage: $"The content file '{BoundPath(assetPath)}' was built for platform '{platformDesc}', " +
                    $"but the Playground preview requires the Web profile. Rebuild your content with `MonoGamePlatform=Web`.",
                PlatformByte: platformByte,
                PlatformName: platformName,
                Version: version,
                Flags: flags,
                DeclaredSize: declaredSize,
                Compressed: IsCompressed(flags),
                DetectedReaderType: null,
                ReaderCount: null);
        }

        // Validate version
        if (version != CurrentFormatVersion && version != LegacyFormatVersion)
        {
            return Failure("PG0202_CONTENT_UNSUPPORTED_VERSION",
                $"The content file '{BoundPath(assetPath)}' has unsupported XNB format version {version} (expected {CurrentFormatVersion} or {LegacyFormatVersion}).",
                platformByte, platformName, version, flags, declaredSize);
        }

        // Reject compressed content (initial subset: uncompressed only)
        if (IsCompressed(flags))
        {
            var compressionType = (flags & FlagCompressedLzx) != 0 ? "LZX" : "LZ4";
            return Failure("PG0203_CONTENT_COMPRESSED",
                $"The content file '{BoundPath(assetPath)}' uses {compressionType} compression, which is not supported by the Playground preview. Rebuild without compression.",
                platformByte, platformName, version, flags, declaredSize, compressed: true);
        }

        // Validate declared size against actual size (exact match)
        if (declaredSize != bytes.Length)
        {
            return Failure("PG0204_CONTENT_SIZE_MISMATCH",
                $"The content file '{BoundPath(assetPath)}' declares size {declaredSize} bytes but the actual data is {bytes.Length} bytes.",
                platformByte, platformName, version, flags, declaredSize);
        }

        // Parse reader metadata to validate content type
        var readerResult = ParseReaderMetadata(bytes[HeaderSize..declaredSize], assetPath);
        if (readerResult is not null)
            return readerResult with
            {
                PlatformByte = platformByte,
                PlatformName = platformName,
                Version = version,
                Flags = flags,
                DeclaredSize = declaredSize,
                Compressed = false,
            };

        // Extract reader info for the success result
        var (readerCount, readerType) = ExtractReaderInfo(bytes[HeaderSize..declaredSize]);

        return new ValidationResult(
            Valid: true,
            DiagnosticId: null,
            DiagnosticMessage: null,
            PlatformByte: platformByte,
            PlatformName: platformName,
            Version: version,
            Flags: flags,
            DeclaredSize: declaredSize,
            Compressed: false,
            DetectedReaderType: readerType,
            ReaderCount: readerCount);
    }

    /// <summary>
    /// Attempts to parse and validate the reader metadata and content structure.
    /// Returns a failure ValidationResult if the reader metadata is unsupported; null if OK.
    /// </summary>
    private static ValidationResult? ParseReaderMetadata(ReadOnlySpan<byte> body, string assetPath)
    {
        if (body.Length < 1) return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        // Read 7-bit encoded int (reader count)
        var (readerCount, consumed) = Read7BitEncodedInt(body);
        if (consumed < 0 || readerCount < 0)
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        if (readerCount == 0)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' declares zero content type readers.");
        }

        if (readerCount != 1)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"Only single-reader Texture2D content is supported; this file declares {readerCount} readers.");
        }

        var remaining = body[consumed..];

        // Read single reader type string
        var (readerType, typeConsumed) = ReadLengthPrefixedString(remaining);
        if (typeConsumed < 0 || readerType is null)
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        remaining = remaining[typeConsumed..];

        // Read reader version (int32)
        if (!TryReadInt32(ref remaining, out var readerVersion))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        if (readerType != Texture2DReaderType || readerVersion != 0)
        {
            return Failure("PG0206_CONTENT_UNSUPPORTED_TYPE",
                $"The content file '{BoundPath(assetPath)}' uses reader type '{BoundReaderType(readerType)}', " +
                "which is not supported by the Playground preview. Only Texture2D content is currently supported.",
                readerType: readerType, readerCount: readerCount);
        }

        // Read shared resource count (7-bit encoded)
        var (sharedResourceCount, sharedConsumed) = Read7BitEncodedInt(remaining);
        if (sharedConsumed < 0 || sharedResourceCount < 0)
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        remaining = remaining[sharedConsumed..];

        if (sharedResourceCount != 0)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' declares {sharedResourceCount} shared resources, which are not supported by the Playground preview.",
                readerType: readerType, readerCount: readerCount);
        }

        // Read root content reader selector (7-bit encoded, must be 1 for single-reader Texture2D)
        var (readerSelector, selectorConsumed) = Read7BitEncodedInt(remaining);
        if (selectorConsumed < 0)
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        remaining = remaining[selectorConsumed..];

        if (readerSelector != 1)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' declares root reader selector {readerSelector}; expected 1 for Texture2D content.",
                readerType: readerType, readerCount: readerCount);
        }

        if (!TryReadInt32(ref remaining, out var surfaceFormat))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (surfaceFormat < 0 || surfaceFormat > MaxKnownSurfaceFormat)
        {
            return Failure("PG0206_CONTENT_UNSUPPORTED_TYPE",
                $"The content file '{BoundPath(assetPath)}' uses unsupported surface format {surfaceFormat}.",
                readerType: readerType, readerCount: readerCount);
        }
        if (surfaceFormat is not (SurfaceFormatColor or SurfaceFormatColorSRgb))
        {
            return Failure("PG0206_CONTENT_UNSUPPORTED_TYPE",
                $"The content file '{BoundPath(assetPath)}' uses surface format {surfaceFormat}, " +
                "but only Color (0) and ColorSRgb (32) Texture2D content is currently supported.",
                readerType: readerType, readerCount: readerCount);
        }

        if (!TryReadInt32(ref remaining, out var width))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (width <= 0 || width > MaxTextureDimension)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' has invalid texture width {width}.",
                readerType: readerType, readerCount: readerCount);
        }

        if (!TryReadInt32(ref remaining, out var height))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (height <= 0 || height > MaxTextureDimension)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' has invalid texture height {height}.",
                readerType: readerType, readerCount: readerCount);
        }

        if (!TryReadInt32(ref remaining, out var mipCount))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (mipCount <= 0 || mipCount > MaxTextureMipCount)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' has invalid mipmap count {mipCount}.",
                readerType: readerType, readerCount: readerCount);
        }
        var maxMipsForDimensions = (int)Math.Floor(Math.Log2(Math.Max(width, height))) + 1;
        if (mipCount > maxMipsForDimensions)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' has invalid mipmap count {mipCount}.",
                readerType: readerType, readerCount: readerCount);
        }

        for (var m = 0; m < mipCount; m++)
        {
            if (!TryReadInt32(ref remaining, out var mipSize))
                return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
            long mipWidth = Math.Max(1, width >> m);
            long mipHeight = Math.Max(1, height >> m);
            long expectedMipBytes = mipWidth * mipHeight * 4;
            if (mipSize != expectedMipBytes)
            {
                return Failure("PG0205_CONTENT_MALFORMED_READERS",
                    $"The content file '{BoundPath(assetPath)}' declares mip level {m} size {mipSize} bytes but expected {expectedMipBytes} bytes for {mipWidth}×{mipHeight} Color data.",
                    readerType: readerType, readerCount: readerCount);
            }
            if (mipSize > remaining.Length)
            {
                return Failure("PG0205_CONTENT_MALFORMED_READERS",
                    $"The content file '{BoundPath(assetPath)}' declares mip level {m} size {mipSize} bytes, which exceeds the remaining {remaining.Length} bytes.",
                    readerType: readerType, readerCount: readerCount);
            }

            remaining = remaining[mipSize..];
        }

        if (remaining.Length != 0)
        {
            return Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' contains {remaining.Length} unexpected trailing bytes after Texture2D payload parsing.",
                readerType: readerType, readerCount: readerCount);
        }

        return null;
    }

    private static (int readerCount, string? readerType) ExtractReaderInfo(ReadOnlySpan<byte> body)
    {
        if (body.Length < 1) return (0, null);
        var (readerCount, consumed) = Read7BitEncodedInt(body);
        if (consumed < 0 || readerCount <= 0) return (readerCount, null);
        var remaining = body[consumed..];
        var (readerType, _) = ReadLengthPrefixedString(remaining);
        return (readerCount, readerType);
    }

    private static (int value, int bytesConsumed) Read7BitEncodedInt(ReadOnlySpan<byte> data)
    {
        var result = 0;
        var shift = 0;
        for (var i = 0; i < Math.Min(5, data.Length); i++)
        {
            var b = data[i];
            if (i == 4 && (b & 0xF0) != 0)
                return (-1, -1);
            result |= (b & 0x7F) << shift;
            if ((b & 0x80) == 0)
            {
                var consumed = i + 1;
                if (Canonical7BitByteCount(result) != consumed)
                    return (-1, -1);
                return (result, consumed);
            }
            shift += 7;
        }
        return (-1, -1); // malformed
    }

    private static int Canonical7BitByteCount(int value)
    {
        if (value < 0) return -1;
        if (value < 0x80) return 1;
        if (value < 0x4000) return 2;
        if (value < 0x200000) return 3;
        if (value < 0x10000000) return 4;
        return 5;
    }

    private static (string? value, int bytesConsumed) ReadLengthPrefixedString(ReadOnlySpan<byte> data)
    {
        var (length, consumed) = Read7BitEncodedInt(data);
        if (consumed < 0 || length < 0 || consumed + length > data.Length)
            return (null, -1);
        try
        {
            var value = StrictUtf8.GetString(data.Slice(consumed, length));
            return (value, consumed + length);
        }
        catch
        {
            return (null, -1);
        }
    }

    private static bool TryReadInt32(ref ReadOnlySpan<byte> data, out int value)
    {
        if (data.Length < 4)
        {
            value = 0;
            return false;
        }

        value = BitConverter.ToInt32(data.Slice(0, 4));
        data = data[4..];
        return true;
    }

    internal static Dictionary<string, SelfTestCaseResult> RunSelfTestCases()
    {
        const string assetPath = "textures/player.xnb";

        var good = BuildTexture2DContent();
        var suffixedReader = BuildTexture2DContent(readerType: Texture2DReaderType.Replace(
            "Texture2DReader", "Texture2DReaderSuffix", StringComparison.Ordinal));
        var wrongReaderAssembly = BuildTexture2DContent(readerType: Texture2DReaderType.Replace(
            "Version=3.8.5.1", "Version=3.8.4.0", StringComparison.Ordinal));
        var wrongReaderVersion = BuildTexture2DContent(readerVersion: 1);
        var invalidUtf8 = CloneAndMutate(good, bytes =>
        {
            bytes[HeaderSize + 2] = 0xFF;
            bytes[HeaderSize + 3] = 0xFE;
        });
        var overlong7Bit = BuildOverlong7BitReaderCount(good);
        var impossibleMips = BuildTexture2DContent(
            width: 2,
            height: 2,
            mipData:
            [
                CreateTexturePixels()[..16].ToArray(),
                CreateTexturePixels()[..4].ToArray(),
                CreateTexturePixels()[..4].ToArray(),
                CreateTexturePixels()[..4].ToArray(),
            ]);
        var truncated = good[..^1].ToArray();
        WriteDeclaredSize(truncated, truncated.Length);

        return new Dictionary<string, SelfTestCaseResult>(StringComparer.Ordinal)
        {
            ["good-fixture"] = ToSelfTestCaseResult(Validate(good, assetPath)),
            ["wrong-platform"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(platformByte: (byte)'d'), assetPath)),
            ["compressed"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(flags: FlagCompressedLz4), assetPath)),
            ["truncated"] = ToSelfTestCaseResult(Validate(truncated, assetPath)),
            ["bad-magic"] = ToSelfTestCaseResult(Validate(CloneAndMutate(good, bytes => bytes[0] = (byte)'Y'), assetPath)),
            ["bad-size"] = ToSelfTestCaseResult(Validate(CloneAndMutate(good, bytes => WriteDeclaredSize(bytes, bytes.Length - 1)), assetPath)),
            ["appended-bytes"] = ToSelfTestCaseResult(Validate(
                [.. good, 0xAA, 0xBB, 0xCC], assetPath)),
            ["suffixed-reader"] = ToSelfTestCaseResult(Validate(suffixedReader, assetPath)),
            ["wrong-reader-version"] = ToSelfTestCaseResult(Validate(wrongReaderVersion, assetPath)),
            ["wrong-reader-assembly"] = ToSelfTestCaseResult(Validate(wrongReaderAssembly, assetPath)),
            ["invalid-utf8"] = ToSelfTestCaseResult(Validate(invalidUtf8, assetPath)),
            ["overlong-7bit"] = ToSelfTestCaseResult(Validate(overlong7Bit, assetPath)),
            ["multi-reader"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(readerTypes: [Texture2DReaderType, Texture2DReaderType]), assetPath)),
            ["bad-root-index"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(readerSelector: 2), assetPath)),
            ["unsupported-reader"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(readerType: UnsupportedReaderType), assetPath)),
            ["wrong-mip-size"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(mipData: [CreateTexturePixels()[..^1].ToArray()]), assetPath)),
            ["dimension-impossible-mips"] = ToSelfTestCaseResult(Validate(impossibleMips, assetPath)),
            ["zero-width"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(width: 0), assetPath)),
            ["excess-mip-count"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(mipData: Enumerable.Range(0, 15)
                    .Select(_ => new byte[] { 0x00, 0x00, 0x00, 0x00 })
                    .ToArray()), assetPath)),
            ["nonzero-shared-resources"] = ToSelfTestCaseResult(Validate(
                BuildTexture2DContent(sharedResourceCount: 1), assetPath)),
            ["malformed-7bit"] = ToSelfTestCaseResult(Validate(
                CloneAndMutate(good, bytes =>
                {
                    bytes[HeaderSize + 0] = 0x80;
                    bytes[HeaderSize + 1] = 0x80;
                    bytes[HeaderSize + 2] = 0x80;
                    bytes[HeaderSize + 3] = 0x80;
                    bytes[HeaderSize + 4] = 0x80;
                }), assetPath)),
        };
    }

    private static SelfTestCaseResult ToSelfTestCaseResult(ValidationResult result)
        => new(result.Valid, result.DiagnosticId);

    private static byte[] CloneAndMutate(byte[] source, Action<byte[]> mutate)
    {
        var clone = source.ToArray();
        mutate(clone);
        return clone;
    }

    private static byte[] BuildTexture2DContent(
        byte platformByte = WebPlatformByte,
        byte version = CurrentFormatVersion,
        byte flags = 0,
        string? readerType = Texture2DReaderType,
        string[]? readerTypes = null,
        int readerVersion = 0,
        int sharedResourceCount = 0,
        int readerSelector = 1,
        int surfaceFormat = SurfaceFormatColor,
        int width = 4,
        int height = 4,
        IReadOnlyList<byte[]>? mipData = null,
        byte[]? trailingBytes = null)
    {
        mipData ??= new[] { CreateTexturePixels() };
        readerTypes ??= readerType is null ? Array.Empty<string>() : new[] { readerType };

        var bytes = new List<byte>(256);
        bytes.Add((byte)'X');
        bytes.Add((byte)'N');
        bytes.Add((byte)'B');
        bytes.Add(platformByte);
        bytes.Add(version);
        bytes.Add(flags);
        bytes.AddRange(new byte[] { 0, 0, 0, 0 });

        Append7BitEncodedInt(bytes, readerTypes.Length);
        foreach (var type in readerTypes)
        {
            AppendLengthPrefixedString(bytes, type);
            bytes.AddRange(BitConverter.GetBytes(readerVersion));
        }

        Append7BitEncodedInt(bytes, sharedResourceCount);
        Append7BitEncodedInt(bytes, readerSelector);
        bytes.AddRange(BitConverter.GetBytes(surfaceFormat));
        bytes.AddRange(BitConverter.GetBytes(width));
        bytes.AddRange(BitConverter.GetBytes(height));
        bytes.AddRange(BitConverter.GetBytes(mipData.Count));
        foreach (var mip in mipData)
        {
            bytes.AddRange(BitConverter.GetBytes(mip.Length));
            bytes.AddRange(mip);
        }

        if (trailingBytes is not null)
            bytes.AddRange(trailingBytes);

        var result = bytes.ToArray();
        WriteDeclaredSize(result, result.Length);
        return result;
    }

    private static byte[] BuildOverlong7BitReaderCount(byte[] good)
    {
        var mutated = new byte[good.Length + 1];
        Array.Copy(good, 0, mutated, 0, HeaderSize);
        mutated[HeaderSize] = 0x81;
        mutated[HeaderSize + 1] = 0x00;
        Array.Copy(good, HeaderSize + 1, mutated, HeaderSize + 2, good.Length - (HeaderSize + 1));
        WriteDeclaredSize(mutated, mutated.Length);
        return mutated;
    }

    private static byte[] CreateTexturePixels()
        => [
            0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff,
            0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
            0xff, 0xff, 0x00, 0xff, 0x00, 0xff, 0xff, 0xff,
            0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff,
            0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff,
            0xff, 0xc0, 0xcb, 0xff, 0x80, 0x80, 0x80, 0xff,
            0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
            0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
        ];

    private static void WriteDeclaredSize(byte[] bytes, int declaredSize)
        => BitConverter.GetBytes(declaredSize).CopyTo(bytes, 6);

    private static void Append7BitEncodedInt(List<byte> bytes, int value)
    {
        uint remaining = (uint)value;
        while (remaining >= 0x80)
        {
            bytes.Add((byte)((remaining & 0x7F) | 0x80));
            remaining >>= 7;
        }

        bytes.Add((byte)remaining);
    }

    private static void AppendLengthPrefixedString(List<byte> bytes, string value)
    {
        var encoded = Encoding.UTF8.GetBytes(value);
        Append7BitEncodedInt(bytes, encoded.Length);
        bytes.AddRange(encoded);
    }

    private static bool IsCompressed(byte flags)
        => (flags & (FlagCompressedLz4 | FlagCompressedLzx)) != 0;

    private static string BoundPath(string path)
        => path.Length <= 128 ? path : path[..125] + "…";

    private static string BoundReaderType(string readerType)
        => readerType.Length <= 256 ? readerType : readerType[..253] + "…";

    private static ValidationResult Failure(
        string id, string message,
        byte? platformByte = null, string? platformName = null,
        byte? version = null, byte? flags = null, int? declaredSize = null,
        bool? compressed = null, string? readerType = null, int? readerCount = null) =>
        new(false, id, message, platformByte, platformName, version, flags,
            declaredSize, compressed, readerType, readerCount);

    private static ValidationResult? FailureShort(string id, string assetPath) =>
        Failure(id,
            $"The content file '{BoundPath(assetPath)}' has truncated or malformed reader metadata.");
}

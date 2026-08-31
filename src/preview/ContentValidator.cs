using System.Buffers.Binary;
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
    private const int WaveFormatExSize = 18; // WAVEFORMATEX including cbSize, as MGCB always writes
    private const int WaveFormatPcm = 1;
    private const int MinSoundSampleRate = 8000;
    private const int MaxSoundSampleRate = 48000;
    private const int MaxSoundDataBytes = 8 * 1024 * 1024;
    private const int SoundDurationToleranceMilliseconds = 50;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private const string Texture2DReaderType =
        "Microsoft.Xna.Framework.Content.Texture2DReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null";
    private const string SoundEffectReaderType =
        "Microsoft.Xna.Framework.Content.SoundEffectReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null";
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
                $"Only single-reader Texture2D or SoundEffect content is supported; this file declares {readerCount} readers.");
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

        var isTexture = readerType == Texture2DReaderType;
        var isSoundEffect = readerType == SoundEffectReaderType;
        if ((!isTexture && !isSoundEffect) || readerVersion != 0)
        {
            return Failure("PG0206_CONTENT_UNSUPPORTED_TYPE",
                $"The content file '{BoundPath(assetPath)}' uses reader type '{BoundReaderType(readerType)}', " +
                "which is not supported by the Playground preview. Only uncompressed Texture2D and " +
                "non-streaming SoundEffect content is currently supported.",
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
                $"The content file '{BoundPath(assetPath)}' declares root reader selector {readerSelector}; expected 1 for single-reader content.",
                readerType: readerType, readerCount: readerCount);
        }

        return isSoundEffect
            ? ParseSoundEffectPayload(remaining, assetPath, readerType, readerCount)
            : ParseTexture2DPayload(remaining, assetPath, readerType, readerCount);
    }

    /// <summary>
    /// Validates the Texture2DReader payload: surface format, dimensions, mip chain, and exact length.
    /// Returns a failure ValidationResult, or null when the payload is acceptable.
    /// </summary>
    private static ValidationResult? ParseTexture2DPayload(
        ReadOnlySpan<byte> remaining, string assetPath, string readerType, int readerCount)
    {
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

    /// <summary>
    /// Validates the SoundEffectReader payload against the pinned MonoGame 3.8.5.1 layout:
    ///   int32 format size | WAVEFORMATEX | int32 data size | PCM data |
    ///   int32 loop start | int32 loop length | int32 duration (ms)
    /// Only uncompressed, non-streaming PCM is accepted, matching PRD section 15's
    /// initial supported content subset.
    /// Returns a failure ValidationResult, or null when the payload is acceptable.
    /// </summary>
    private static ValidationResult? ParseSoundEffectPayload(
        ReadOnlySpan<byte> remaining, string assetPath, string readerType, int readerCount)
    {
        ValidationResult Malformed(string message) =>
            Failure("PG0205_CONTENT_MALFORMED_READERS",
                $"The content file '{BoundPath(assetPath)}' {message}",
                readerType: readerType, readerCount: readerCount);

        ValidationResult Unsupported(string message) =>
            Failure("PG0206_CONTENT_UNSUPPORTED_TYPE",
                $"The content file '{BoundPath(assetPath)}' {message}",
                readerType: readerType, readerCount: readerCount);

        if (!TryReadInt32(ref remaining, out var formatSize))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (formatSize != WaveFormatExSize)
        {
            return Unsupported(
                $"declares a {formatSize}-byte audio format header, but only the {WaveFormatExSize}-byte " +
                "WAVEFORMATEX header written by the MonoGame content pipeline is supported.");
        }
        if (formatSize > remaining.Length)
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        var format = remaining[..formatSize];
        remaining = remaining[formatSize..];

        var formatTag = BinaryPrimitives.ReadInt16LittleEndian(format[..2]);
        var channels = BinaryPrimitives.ReadInt16LittleEndian(format.Slice(2, 2));
        var sampleRate = BinaryPrimitives.ReadInt32LittleEndian(format.Slice(4, 4));
        var averageBytesPerSecond = BinaryPrimitives.ReadInt32LittleEndian(format.Slice(8, 4));
        var blockAlign = BinaryPrimitives.ReadInt16LittleEndian(format.Slice(12, 2));
        var bitsPerSample = BinaryPrimitives.ReadInt16LittleEndian(format.Slice(14, 2));
        var cbSize = BinaryPrimitives.ReadInt16LittleEndian(format.Slice(16, 2));

        if (formatTag != WaveFormatPcm)
        {
            return Unsupported(
                $"uses audio format tag {formatTag}, but only uncompressed PCM (1) SoundEffect content " +
                "is currently supported. Rebuild the asset without compression.");
        }
        if (channels is not (1 or 2))
            return Unsupported($"declares {channels} audio channels; only mono (1) and stereo (2) are supported.");
        if (bitsPerSample is not (8 or 16))
            return Unsupported($"declares {bitsPerSample} bits per sample; only 8-bit and 16-bit PCM are supported.");
        if (sampleRate < MinSoundSampleRate || sampleRate > MaxSoundSampleRate)
        {
            return Unsupported(
                $"declares a {sampleRate} Hz sample rate; only {MinSoundSampleRate}–{MaxSoundSampleRate} Hz is supported.");
        }
        if (cbSize != 0)
            return Unsupported($"declares {cbSize} bytes of extra format data; only plain PCM headers are supported.");

        var expectedBlockAlign = channels * bitsPerSample / 8;
        if (blockAlign != expectedBlockAlign)
            return Malformed($"declares block alignment {blockAlign} but expected {expectedBlockAlign}.");
        var expectedAverageBytesPerSecond = sampleRate * expectedBlockAlign;
        if (averageBytesPerSecond != expectedAverageBytesPerSecond)
        {
            return Malformed(
                $"declares {averageBytesPerSecond} average bytes per second but expected {expectedAverageBytesPerSecond}.");
        }

        if (!TryReadInt32(ref remaining, out var dataSize))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (dataSize <= 0)
            return Malformed($"declares {dataSize} bytes of audio data.");
        if (dataSize > MaxSoundDataBytes)
        {
            return Unsupported(
                $"declares {dataSize} bytes of audio data, which exceeds the {MaxSoundDataBytes} byte non-streaming limit.");
        }
        if (dataSize % expectedBlockAlign != 0)
        {
            return Malformed(
                $"declares {dataSize} bytes of audio data, which is not a multiple of the {expectedBlockAlign} byte block alignment.");
        }
        if (dataSize > remaining.Length)
        {
            return Malformed(
                $"declares {dataSize} bytes of audio data, which exceeds the remaining {remaining.Length} bytes.");
        }

        remaining = remaining[dataSize..];

        if (!TryReadInt32(ref remaining, out var loopStart))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (!TryReadInt32(ref remaining, out var loopLength))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);
        if (!TryReadInt32(ref remaining, out var durationMilliseconds))
            return FailureShort("PG0205_CONTENT_MALFORMED_READERS", assetPath);

        var sampleCount = dataSize / expectedBlockAlign;
        if (loopStart < 0 || loopStart > sampleCount)
            return Malformed($"declares loop start {loopStart}, which is outside the {sampleCount} decoded samples.");
        if (loopLength < 0 || (long)loopStart + loopLength > sampleCount)
            return Malformed($"declares loop length {loopLength}, which is outside the {sampleCount} decoded samples.");

        if (durationMilliseconds <= 0)
            return Malformed($"declares a {durationMilliseconds} ms duration.");
        var expectedDuration = (int)((long)sampleCount * 1000 / sampleRate);
        if (Math.Abs(durationMilliseconds - expectedDuration) > SoundDurationToleranceMilliseconds)
        {
            return Malformed(
                $"declares a {durationMilliseconds} ms duration but {sampleCount} samples at {sampleRate} Hz are {expectedDuration} ms.");
        }

        if (remaining.Length != 0)
        {
            return Malformed(
                $"contains {remaining.Length} unexpected trailing bytes after SoundEffect payload parsing.");
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
        const string soundPath = "audio/blip.xnb";

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
            ["sound-good-fixture"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(), soundPath)),
            ["sound-good-stereo-8bit"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(channels: 2, bitsPerSample: 8, sampleCount: 400), soundPath)),
            ["sound-wrong-platform"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(platformByte: (byte)'d'), soundPath)),
            ["sound-compressed-flag"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(flags: FlagCompressedLzx), soundPath)),
            ["sound-non-pcm-format"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(formatTag: 2), soundPath)),
            ["sound-bad-format-size"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(formatSizeOverride: 16), soundPath)),
            ["sound-nonzero-cbsize"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(cbSize: 2), soundPath)),
            ["sound-bad-channels"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(channels: 3), soundPath)),
            ["sound-bad-bits"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(bitsPerSample: 24), soundPath)),
            ["sound-bad-sample-rate"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(sampleRate: 96000, averageBytesPerSecond: 192000), soundPath)),
            ["sound-block-align-mismatch"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(blockAlign: 4), soundPath)),
            ["sound-average-bytes-mismatch"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(averageBytesPerSecond: 1234), soundPath)),
            ["sound-zero-data"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(sampleCount: 0), soundPath)),
            ["sound-unaligned-data"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(extraDataBytes: 1), soundPath)),
            ["sound-data-size-overflow"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(declaredDataSizeDelta: 64), soundPath)),
            ["sound-loop-out-of-range"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(loopStart: 10, loopLength: 100_000), soundPath)),
            ["sound-negative-loop-start"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(loopStart: -1), soundPath)),
            ["sound-duration-mismatch"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(durationMilliseconds: 9_000), soundPath)),
            ["sound-trailing-bytes"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(trailingBytes: [0x01, 0x02, 0x03, 0x04]), soundPath)),
            ["sound-truncated-tail"] = ToSelfTestCaseResult(Validate(
                TruncateContent(BuildSoundEffectContent(), 6), soundPath)),
            ["sound-multi-reader"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(readerTypes: [SoundEffectReaderType, Texture2DReaderType]), soundPath)),
            ["sound-suffixed-reader"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(readerType: SoundEffectReaderType.Replace(
                    "SoundEffectReader", "SoundEffectReaderSuffix", StringComparison.Ordinal)), soundPath)),
            ["sound-wrong-reader-version"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(readerVersion: 1), soundPath)),
            ["sound-bad-root-index"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(readerSelector: 2), soundPath)),
            ["sound-nonzero-shared-resources"] = ToSelfTestCaseResult(Validate(
                BuildSoundEffectContent(sharedResourceCount: 1), soundPath)),
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

    private static byte[] BuildSoundEffectContent(
        byte platformByte = WebPlatformByte,
        byte version = CurrentFormatVersion,
        byte flags = 0,
        string? readerType = SoundEffectReaderType,
        string[]? readerTypes = null,
        int readerVersion = 0,
        int sharedResourceCount = 0,
        int readerSelector = 1,
        int formatTag = WaveFormatPcm,
        int channels = 1,
        int sampleRate = 22050,
        int bitsPerSample = 16,
        int? blockAlign = null,
        int? averageBytesPerSecond = null,
        int cbSize = 0,
        int? formatSizeOverride = null,
        int sampleCount = 2205,
        int extraDataBytes = 0,
        int declaredDataSizeDelta = 0,
        int loopStart = 0,
        int loopLength = 0,
        int? durationMilliseconds = null,
        byte[]? trailingBytes = null)
    {
        readerTypes ??= readerType is null ? [] : [readerType];
        var effectiveBlockAlign = blockAlign ?? channels * bitsPerSample / 8;
        var declaredBlockAlign = effectiveBlockAlign <= 0 ? 1 : effectiveBlockAlign;
        var dataByteCount = sampleCount * (channels * bitsPerSample / 8) + extraDataBytes;
        if (dataByteCount < 0) dataByteCount = 0;
        var data = new byte[dataByteCount];
        for (var index = 0; index < data.Length; index++)
            data[index] = (byte)(index * 7 % 251);

        var format = new List<byte>(WaveFormatExSize);
        format.AddRange(BitConverter.GetBytes((short)formatTag));
        format.AddRange(BitConverter.GetBytes((short)channels));
        format.AddRange(BitConverter.GetBytes(sampleRate));
        format.AddRange(BitConverter.GetBytes(
            averageBytesPerSecond ?? sampleRate * declaredBlockAlign));
        format.AddRange(BitConverter.GetBytes((short)declaredBlockAlign));
        format.AddRange(BitConverter.GetBytes((short)bitsPerSample));
        format.AddRange(BitConverter.GetBytes((short)cbSize));

        var bytes = new List<byte>(256 + data.Length)
        {
            (byte)'X',
            (byte)'N',
            (byte)'B',
            platformByte,
            version,
            flags,
            0, 0, 0, 0,
        };

        Append7BitEncodedInt(bytes, readerTypes.Length);
        foreach (var type in readerTypes)
        {
            AppendLengthPrefixedString(bytes, type);
            bytes.AddRange(BitConverter.GetBytes(readerVersion));
        }

        Append7BitEncodedInt(bytes, sharedResourceCount);
        Append7BitEncodedInt(bytes, readerSelector);
        bytes.AddRange(BitConverter.GetBytes(formatSizeOverride ?? format.Count));
        bytes.AddRange(format);
        bytes.AddRange(BitConverter.GetBytes(data.Length + declaredDataSizeDelta));
        bytes.AddRange(data);
        bytes.AddRange(BitConverter.GetBytes(loopStart));
        bytes.AddRange(BitConverter.GetBytes(loopLength));
        var frameBytes = channels * bitsPerSample / 8;
        var decodedSamples = frameBytes <= 0 ? 0 : data.Length / frameBytes;
        bytes.AddRange(BitConverter.GetBytes(
            durationMilliseconds ?? (sampleRate <= 0 ? 0 : (int)((long)decodedSamples * 1000 / sampleRate))));
        if (trailingBytes is not null)
            bytes.AddRange(trailingBytes);

        var result = bytes.ToArray();
        WriteDeclaredSize(result, result.Length);
        return result;
    }

    private static byte[] TruncateContent(byte[] content, int removeByteCount)
    {
        var truncated = content[..^removeByteCount];
        WriteDeclaredSize(truncated, truncated.Length);
        return truncated;
    }

    private static byte[] BuildOverlong7BitReaderCount(byte[] good)    {
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

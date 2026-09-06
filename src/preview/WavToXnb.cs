using System.Buffers.Binary;
using System.Text;

namespace Playground.Preview;

/// <summary>
/// Transcodes a raw PCM WAV file into the MonoGame Web-profile XNB SoundEffect
/// container, so `Content.Load&lt;SoundEffect&gt;("name")` can load a project's
/// `Content/name.wav` with no MGCB step (issue 052). This is pure byte
/// re-framing — no resampling or codec conversion. An XNB SoundEffect body is:
///
///   [int32 formatSize=18][WAVEFORMATEX (18 bytes)][int32 dataSize][PCM data]
///   [int32 loopStart][int32 loopLength][int32 durationMs]
///
/// and a WAV's `fmt ` chunk IS a WAVEFORMATEX while its `data` chunk IS the PCM,
/// so the transcode extracts those two chunks and wraps them in the XNB header +
/// single SoundEffectReader metadata. The output is designed to pass
/// <see cref="ContentValidator.Validate"/> unchanged.
///
/// Supported input (matching PRD §15 and ContentValidator's accepted subset):
/// uncompressed PCM (format tag 1), 8- or 16-bit, mono or stereo, 8000–48000 Hz.
/// Everything else (float, ADPCM, WAVE_FORMAT_EXTENSIBLE, 24-bit, &gt;2 channels,
/// out-of-range sample rate) is rejected with a clear diagnostic.
/// </summary>
internal static class WavToXnb
{
    private const byte WebPlatformByte = (byte)'b';
    private const byte CurrentFormatVersion = 5;
    private const int WaveFormatExSize = 18; // WAVEFORMATEX including cbSize=0
    private const int WaveFormatPcm = 1;
    private const int MinSoundSampleRate = 8000;
    private const int MaxSoundSampleRate = 48000;
    private const int MaxSoundDataBytes = 8 * 1024 * 1024;

    // Must match ContentValidator.SoundEffectReaderType exactly so the emitted
    // XNB validates and the runtime resolves the SoundEffectReader.
    private const string SoundEffectReaderType =
        "Microsoft.Xna.Framework.Content.SoundEffectReader, MonoGame.Framework, Version=3.8.5.1, Culture=neutral, PublicKeyToken=null";

    internal sealed record TranscodeResult(
        bool Success,
        byte[]? Xnb,
        string? DiagnosticId,
        string? DiagnosticMessage);

    private static TranscodeResult Fail(string id, string message) => new(false, null, id, message);

    /// <summary>
    /// Convert raw `.wav` bytes into XNB SoundEffect bytes, or return a
    /// diagnostic describing why the WAV is unsupported.
    /// </summary>
    internal static TranscodeResult Convert(ReadOnlySpan<byte> wav, string assetPath)
    {
        var path = BoundPath(assetPath);

        // ── RIFF/WAVE container header ──────────────────────────────────────
        // "RIFF" <int32 riffSize> "WAVE" then a sequence of <fourCC><int32 size><body(+pad)>
        if (wav.Length < 12 ||
            wav[0] != (byte)'R' || wav[1] != (byte)'I' || wav[2] != (byte)'F' || wav[3] != (byte)'F' ||
            wav[8] != (byte)'W' || wav[9] != (byte)'A' || wav[10] != (byte)'V' || wav[11] != (byte)'E')
        {
            return Fail("PG0210_CONTENT_INVALID_WAV",
                $"The audio file '{path}' is not a valid RIFF/WAVE file.");
        }

        var riffSize = BinaryPrimitives.ReadInt32LittleEndian(wav.Slice(4, 4));
        // riffSize covers everything after the first 8 bytes; clamp to the buffer.
        var declaredEnd = 8L + riffSize;
        var end = declaredEnd > 0 && declaredEnd <= wav.Length ? (int)declaredEnd : wav.Length;

        // ── Walk chunks, capturing `fmt ` and `data` ───────────────────────
        ReadOnlySpan<byte> fmt = default;
        ReadOnlySpan<byte> data = default;
        var haveFmt = false;
        var haveData = false;

        var offset = 12;
        while (offset + 8 <= end)
        {
            var id0 = wav[offset];
            var id1 = wav[offset + 1];
            var id2 = wav[offset + 2];
            var id3 = wav[offset + 3];
            var chunkSize = BinaryPrimitives.ReadInt32LittleEndian(wav.Slice(offset + 4, 4));
            if (chunkSize < 0)
                return Fail("PG0210_CONTENT_INVALID_WAV", $"The audio file '{path}' has a malformed chunk length.");
            var bodyStart = offset + 8;
            if ((long)bodyStart + chunkSize > wav.Length)
                return Fail("PG0210_CONTENT_INVALID_WAV",
                    $"The audio file '{path}' declares a chunk that runs past the end of the file.");

            var body = wav.Slice(bodyStart, chunkSize);
            if (id0 == (byte)'f' && id1 == (byte)'m' && id2 == (byte)'t' && id3 == (byte)' ')
            {
                fmt = body;
                haveFmt = true;
            }
            else if (id0 == (byte)'d' && id1 == (byte)'a' && id2 == (byte)'t' && id3 == (byte)'a')
            {
                data = body;
                haveData = true;
            }

            // Chunks are word-aligned: an odd size is followed by a pad byte.
            var advance = chunkSize + (chunkSize & 1);
            offset = bodyStart + advance;
            if (haveFmt && haveData) break;
        }

        if (!haveFmt)
            return Fail("PG0210_CONTENT_INVALID_WAV", $"The audio file '{path}' has no 'fmt ' chunk.");
        if (!haveData)
            return Fail("PG0210_CONTENT_INVALID_WAV", $"The audio file '{path}' has no 'data' chunk.");

        // ── Parse the fmt chunk (must be a plain PCM WAVEFORMAT[EX]) ────────
        // 16 bytes = WAVEFORMAT (PCM); 18 = WAVEFORMATEX with cbSize; 40 =
        // WAVE_FORMAT_EXTENSIBLE (unsupported here).
        if (fmt.Length < 16)
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' has a truncated 'fmt ' chunk ({fmt.Length} bytes).");

        var formatTag = BinaryPrimitives.ReadInt16LittleEndian(fmt.Slice(0, 2));
        var channels = BinaryPrimitives.ReadInt16LittleEndian(fmt.Slice(2, 2));
        var sampleRate = BinaryPrimitives.ReadInt32LittleEndian(fmt.Slice(4, 4));
        var bitsPerSample = BinaryPrimitives.ReadInt16LittleEndian(fmt.Slice(14, 2));

        if (formatTag != WaveFormatPcm)
        {
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' uses WAV format tag {formatTag}, but only uncompressed PCM (1) " +
                "is supported. Float, ADPCM, and WAVE_FORMAT_EXTENSIBLE audio are not supported.");
        }
        if (channels is not (1 or 2))
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' has {channels} channels; only mono (1) and stereo (2) are supported.");
        if (bitsPerSample is not (8 or 16))
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' is {bitsPerSample}-bit; only 8-bit and 16-bit PCM are supported.");
        if (sampleRate < MinSoundSampleRate || sampleRate > MaxSoundSampleRate)
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' has a {sampleRate} Hz sample rate; only {MinSoundSampleRate}–{MaxSoundSampleRate} Hz is supported.");

        // Canonical block align / byte rate (recomputed, not trusted from the
        // source header — the SoundEffect ctor only reads channels/rate/bits, and
        // ContentValidator requires these exact derived values).
        var blockAlign = channels * bitsPerSample / 8;
        var avgBytesPerSecond = sampleRate * blockAlign;

        var dataSize = data.Length;
        if (dataSize <= 0)
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV", $"The audio file '{path}' has no audio samples.");
        if (dataSize > MaxSoundDataBytes)
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' has {dataSize} bytes of audio data, which exceeds the {MaxSoundDataBytes} byte non-streaming limit.");
        if (dataSize % blockAlign != 0)
            return Fail("PG0211_CONTENT_UNSUPPORTED_WAV",
                $"The audio file '{path}' has {dataSize} bytes of audio data, which is not a multiple of its {blockAlign}-byte frame size.");

        var sampleCount = dataSize / blockAlign;
        var durationMs = (int)((long)sampleCount * 1000 / sampleRate);
        if (durationMs <= 0) durationMs = 1; // within ContentValidator's ±50ms tolerance

        // ── Emit the XNB SoundEffect container ─────────────────────────────
        var body2 = new List<byte>(64 + dataSize);

        // WAVEFORMATEX (18 bytes, cbSize = 0)
        var format = new byte[WaveFormatExSize];
        BinaryPrimitives.WriteInt16LittleEndian(format.AsSpan(0, 2), WaveFormatPcm);
        BinaryPrimitives.WriteInt16LittleEndian(format.AsSpan(2, 2), (short)channels);
        BinaryPrimitives.WriteInt32LittleEndian(format.AsSpan(4, 4), sampleRate);
        BinaryPrimitives.WriteInt32LittleEndian(format.AsSpan(8, 4), avgBytesPerSecond);
        BinaryPrimitives.WriteInt16LittleEndian(format.AsSpan(12, 2), (short)blockAlign);
        BinaryPrimitives.WriteInt16LittleEndian(format.AsSpan(14, 2), (short)bitsPerSample);
        BinaryPrimitives.WriteInt16LittleEndian(format.AsSpan(16, 2), 0); // cbSize

        AppendInt32(body2, WaveFormatExSize);
        body2.AddRange(format);
        AppendInt32(body2, dataSize);
        body2.AddRange(data.ToArray());
        AppendInt32(body2, 0);            // loopStart (samples)
        AppendInt32(body2, 0);            // loopLength (samples)
        AppendInt32(body2, durationMs);

        var xnb = new List<byte>(HeaderAndReaderSize() + body2.Count);
        xnb.Add((byte)'X');
        xnb.Add((byte)'N');
        xnb.Add((byte)'B');
        xnb.Add(WebPlatformByte);
        xnb.Add(CurrentFormatVersion);
        xnb.Add(0);                        // flags: uncompressed
        xnb.AddRange(new byte[] { 0, 0, 0, 0 }); // fileSize placeholder (filled below)

        Append7BitEncodedInt(xnb, 1);      // reader count
        AppendLengthPrefixedString(xnb, SoundEffectReaderType);
        AppendInt32(xnb, 0);               // reader version
        Append7BitEncodedInt(xnb, 0);      // shared resource count
        Append7BitEncodedInt(xnb, 1);      // root object reader selector
        xnb.AddRange(body2);

        var result = xnb.ToArray();
        BinaryPrimitives.WriteInt32LittleEndian(result.AsSpan(6, 4), result.Length);
        return new TranscodeResult(true, result, null, null);
    }

    private static int HeaderAndReaderSize() => 10 + 1 + 5 + SoundEffectReaderType.Length + 4 + 1 + 1;

    private static void AppendInt32(List<byte> bytes, int value)
    {
        Span<byte> tmp = stackalloc byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(tmp, value);
        bytes.Add(tmp[0]);
        bytes.Add(tmp[1]);
        bytes.Add(tmp[2]);
        bytes.Add(tmp[3]);
    }

    private static void Append7BitEncodedInt(List<byte> bytes, int value)
    {
        var remaining = (uint)value;
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

    private static string BoundPath(string path)
        => path.Length <= 128 ? path : path[..125] + "…";

    internal sealed record WavSelfTestCaseResult(bool Transcoded, bool ValidatesAsXnb, string? DiagnosticId);

    /// <summary>
    /// In-runtime self-test (mirrors <see cref="ContentValidator.RunSelfTestCases"/>):
    /// every supported WAV must transcode AND its XNB must pass
    /// <see cref="ContentValidator.Validate"/>; every unsupported WAV must be
    /// rejected with a diagnostic. Exposed via a JSExport so the packaged proof
    /// can assert the round-trip end to end.
    /// </summary>
    internal static Dictionary<string, WavSelfTestCaseResult> RunSelfTestCases()
    {
        WavSelfTestCaseResult Run(byte[] wav, string name)
        {
            var r = Convert(wav, name + ".wav");
            if (!r.Success)
                return new WavSelfTestCaseResult(false, false, r.DiagnosticId);
            var v = ContentValidator.Validate(r.Xnb!, name + ".xnb");
            return new WavSelfTestCaseResult(true, v.Valid, v.DiagnosticId);
        }

        return new Dictionary<string, WavSelfTestCaseResult>(StringComparer.Ordinal)
        {
            ["mono-16bit-22050"] = Run(BuildTestWav(1, 1, 22050, 16, 2205), "mono-16bit-22050"),
            ["stereo-16bit-44100"] = Run(BuildTestWav(1, 2, 44100, 16, 4410), "stereo-16bit-44100"),
            ["mono-8bit-8000"] = Run(BuildTestWav(1, 1, 8000, 8, 800), "mono-8bit-8000"),
            ["stereo-8bit-48000"] = Run(BuildTestWav(1, 2, 48000, 8, 480), "stereo-8bit-48000"),
            ["mono-16bit-18byte-fmt"] = Run(BuildTestWav(1, 1, 22050, 16, 100, fmtChunkSize: 18), "ext-fmt"),
            ["list-chunk-skipped"] = Run(BuildTestWav(1, 1, 22050, 16, 100, includeListChunk: true), "list"),
            ["odd-size-padding"] = Run(BuildTestWav(1, 1, 22050, 8, 101), "odd"),
            ["reject-float"] = Run(BuildTestWav(3, 1, 22050, 16, 100), "float"),
            ["reject-adpcm"] = Run(BuildTestWav(2, 1, 22050, 16, 100), "adpcm"),
            ["reject-extensible"] = Run(BuildTestWav(unchecked((short)0xFFFE), 2, 44100, 16, 100, fmtChunkSize: 40), "ext"),
            ["reject-24bit"] = Run(BuildTestWav(1, 1, 22050, 24, 100), "b24"),
            ["reject-3-channels"] = Run(BuildTestWav(1, 3, 22050, 16, 100), "ch3"),
            ["reject-rate-too-high"] = Run(BuildTestWav(1, 1, 96000, 16, 100), "hi"),
            ["reject-rate-too-low"] = Run(BuildTestWav(1, 1, 4000, 16, 100), "lo"),
            ["reject-not-riff"] = Run(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 }, "garbage"),
            ["reject-empty"] = Run(Array.Empty<byte>(), "empty"),
        };
    }

    private static byte[] BuildTestWav(
        short formatTag, short channels, int sampleRate, short bits, int sampleCount,
        int fmtChunkSize = 16, bool includeListChunk = false)
    {
        var blockAlign = channels * bits / 8;
        var dataSize = sampleCount * (blockAlign <= 0 ? 1 : blockAlign);
        var data = new byte[dataSize];
        for (var i = 0; i < data.Length; i++) data[i] = (byte)(i * 7 % 251);

        var fmt = new List<byte>();
        AppendInt16(fmt, formatTag);
        AppendInt16(fmt, channels);
        AppendInt32(fmt, sampleRate);
        AppendInt32(fmt, sampleRate * (blockAlign <= 0 ? 1 : blockAlign));
        AppendInt16(fmt, (short)(blockAlign <= 0 ? 1 : blockAlign));
        AppendInt16(fmt, bits);
        if (fmtChunkSize >= 18) AppendInt16(fmt, 0);
        while (fmt.Count < fmtChunkSize) fmt.Add(0);

        var body = new List<byte>();
        body.AddRange("WAVE"u8.ToArray());
        if (includeListChunk)
        {
            body.AddRange("LIST"u8.ToArray());
            var payload = "INFOISFT"u8.ToArray();
            AppendInt32(body, payload.Length);
            body.AddRange(payload);
        }
        body.AddRange("fmt "u8.ToArray());
        AppendInt32(body, fmtChunkSize);
        body.AddRange(fmt);
        body.AddRange("data"u8.ToArray());
        AppendInt32(body, dataSize);
        body.AddRange(data);

        var riff = new List<byte>();
        riff.AddRange("RIFF"u8.ToArray());
        AppendInt32(riff, body.Count);
        riff.AddRange(body);
        return riff.ToArray();
    }

    private static void AppendInt16(List<byte> bytes, short value)
    {
        Span<byte> tmp = stackalloc byte[2];
        BinaryPrimitives.WriteInt16LittleEndian(tmp, value);
        bytes.Add(tmp[0]);
        bytes.Add(tmp[1]);
    }
}

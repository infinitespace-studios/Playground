namespace Playground.Preview;

/// <summary>
/// Lightweight magic-byte validation for raw image assets (issue 052). Unlike
/// audio, raw images need no transcode: the MonoGame Web runtime's
/// <c>ContentManager.ReadAsset</c> falls back to <c>Texture2D.FromStream</c>
/// (StbImageSharp) for <c>.png/.jpg/.jpeg/.bmp</c> when no <c>.xnb</c> exists, so
/// the mount just stages the raw bytes. This validator rejects obviously-wrong or
/// truncated files up front with a clear diagnostic, and guards against an
/// extension that lies about its contents (e.g. a <c>.png</c> holding JPEG data).
/// It does NOT fully decode the image — decode errors still surface at load time
/// through the runtime, but the common cases (empty/garbage/mislabelled) fail
/// early with a user-facing message.
/// </summary>
internal static class ImageContent
{
    internal sealed record ValidationResult(bool Valid, string? DiagnosticId, string? DiagnosticMessage);

    // Largest raw image we will stage (decoded textures are bounded separately by
    // the runtime's 8192px limit; this caps the encoded upload).
    private const int MaxImageBytes = 16 * 1024 * 1024;

    private static ValidationResult Ok { get; } = new(true, null, null);

    private static ValidationResult Fail(string id, string message) => new(false, id, message);

    /// <summary>
    /// Validate that <paramref name="bytes"/> looks like a real image of the kind
    /// its <paramref name="extension"/> claims (png/jpg/jpeg/bmp).
    /// </summary>
    internal static ValidationResult Validate(ReadOnlySpan<byte> bytes, string assetPath, string extension)
    {
        var path = BoundPath(assetPath);

        if (bytes.Length == 0)
            return Fail("PG0213_CONTENT_INVALID_IMAGE", $"The image file '{path}' is empty.");
        if (bytes.Length > MaxImageBytes)
            return Fail("PG0213_CONTENT_INVALID_IMAGE",
                $"The image file '{path}' is {bytes.Length} bytes, which exceeds the {MaxImageBytes} byte limit.");

        var kind = DetectKind(bytes);
        if (kind is null)
            return Fail("PG0213_CONTENT_INVALID_IMAGE",
                $"The image file '{path}' is not a recognized PNG, JPEG, or BMP image.");

        // Guard against a mislabelled extension (e.g. JPEG bytes named .png).
        var expected = extension switch
        {
            "png" => "png",
            "jpg" or "jpeg" => "jpeg",
            "bmp" => "bmp",
            _ => null,
        };
        if (expected is not null && kind != expected)
        {
            return Fail("PG0214_CONTENT_IMAGE_EXTENSION_MISMATCH",
                $"The image file '{path}' has a .{extension} extension but its contents are {kind.ToUpperInvariant()}. " +
                "Rename the file to match its actual format.");
        }

        return Ok;
    }

    /// <summary>Returns "png"/"jpeg"/"bmp" from the leading magic bytes, or null.</summary>
    private static string? DetectKind(ReadOnlySpan<byte> b)
    {
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (b.Length >= 8 &&
            b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 &&
            b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            return "png";

        // JPEG: FF D8 FF
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
            return "jpeg";

        // BMP: 42 4D ("BM")
        if (b.Length >= 2 && b[0] == 0x42 && b[1] == 0x4D)
            return "bmp";

        return null;
    }

    internal sealed record ImageSelfTestCaseResult(bool Valid, string? DiagnosticId);

    /// <summary>
    /// In-runtime self-test (mirrors the ContentValidator/WavToXnb pattern): valid
    /// signatures pass, empty/garbage/mislabelled fail with a diagnostic.
    /// </summary>
    internal static Dictionary<string, ImageSelfTestCaseResult> RunSelfTestCases()
    {
        static byte[] Png() => new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0 };
        static byte[] Jpeg() => new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0, 0, 0, 0 };
        static byte[] Bmp() => new byte[] { 0x42, 0x4D, 0, 0, 0, 0, 0, 0 };

        ImageSelfTestCaseResult R(ValidationResult v) => new(v.Valid, v.DiagnosticId);

        return new Dictionary<string, ImageSelfTestCaseResult>(StringComparer.Ordinal)
        {
            ["png-good"] = R(Validate(Png(), "a.png", "png")),
            ["jpg-good"] = R(Validate(Jpeg(), "a.jpg", "jpg")),
            ["jpeg-good"] = R(Validate(Jpeg(), "a.jpeg", "jpeg")),
            ["bmp-good"] = R(Validate(Bmp(), "a.bmp", "bmp")),
            ["empty"] = R(Validate(Array.Empty<byte>(), "a.png", "png")),
            ["garbage"] = R(Validate(new byte[] { 1, 2, 3, 4, 5, 6, 7, 8 }, "a.png", "png")),
            ["jpeg-labelled-png"] = R(Validate(Jpeg(), "a.png", "png")),
            ["png-labelled-bmp"] = R(Validate(Png(), "a.bmp", "bmp")),
        };
    }

    private static string BoundPath(string path)
        => path.Length <= 128 ? path : path[..125] + "…";
}

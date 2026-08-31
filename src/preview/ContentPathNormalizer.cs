using System.Globalization;
using System.Text;

namespace Playground.Preview;

/// <summary>
/// Normalizes and validates content asset paths for the preview virtual filesystem.
/// Implements Protocol.md section 8 path normalization rules.
/// </summary>
internal static class ContentPathNormalizer
{
    private const int MaxPathUtf8Bytes = 512;
    private const int MaxSegmentCount = 32;

    internal sealed record NormalizationResult(
        bool Valid,
        string? CanonicalPath,
        string? Error,
        string? ErrorCode);

    /// <summary>
    /// Validates and normalizes a content asset path per Protocol.md section 8.
    /// </summary>
    internal static NormalizationResult Normalize(string? path)
    {
        if (string.IsNullOrEmpty(path))
            return Reject("ASSET_PATH_INVALID", "Asset path must not be empty.");

        // Require valid Unicode scalar values (no unpaired surrogates)
        if (!IsValidUnicodeScalars(path))
            return Reject("ASSET_PATH_INVALID", "Asset path contains invalid Unicode.");

        // NFC normalize
        string normalized;
        try
        {
            normalized = path.Normalize(NormalizationForm.FormC);
        }
        catch
        {
            return Reject("ASSET_PATH_INVALID", "Asset path cannot be normalized to NFC.");
        }

        // Replace backslashes with forward slashes
        normalized = normalized.Replace('\\', '/');

        // Reject leading /, //, drive/URI prefix, NUL, ASCII controls, percent, query/hash, trailing /
        if (normalized.Length == 0)
            return Reject("ASSET_PATH_INVALID", "Asset path is empty after normalization.");
        if (normalized[0] == '/')
            return Reject("ASSET_PATH_INVALID", "Asset path must not be absolute (leading '/').");
        if (normalized[^1] == '/')
            return Reject("ASSET_PATH_INVALID", "Asset path must not end with '/'.");
        if (normalized.Contains("//"))
            return Reject("ASSET_PATH_INVALID", "Asset path must not contain '//'.");

        // Check for forbidden characters
        foreach (var ch in normalized)
        {
            if (ch == '\0' || (ch >= '\u0001' && ch <= '\u001f') || ch == '\u007f')
                return Reject("ASSET_PATH_INVALID", "Asset path contains NUL or ASCII control characters.");
            if (ch == '%')
                return Reject("ASSET_PATH_INVALID", "Asset path must not contain percent encoding.");
            if (ch is '?' or '#')
                return Reject("ASSET_PATH_INVALID", "Asset path must not contain query or hash delimiters.");
        }

        // Split on '/' and validate segments
        var segments = normalized.Split('/');
        var validSegments = new List<string>(segments.Length);
        foreach (var segment in segments)
        {
            if (segment is "" or ".")
                continue;
            if (segment == "..")
                return Reject("ASSET_PATH_INVALID", "Asset path must not contain '..' traversal segments.");
            // Reject drive/URI prefix (colon in any segment)
            if (segment.Contains(':'))
                return Reject("ASSET_PATH_INVALID", "Asset path segment must not contain ':'.");
            validSegments.Add(segment);
        }

        if (validSegments.Count == 0)
            return Reject("ASSET_PATH_INVALID", "Asset path resolves to empty after segment normalization.");

        if (validSegments.Count > MaxSegmentCount)
            return Reject("ASSET_PATH_INVALID", $"Asset path exceeds maximum segment count ({MaxSegmentCount}).");

        var canonical = string.Join('/', validSegments);

        // Enforce UTF-8 byte limit
        try
        {
            var strictUtf8 = new UTF8Encoding(false, true);
            if (strictUtf8.GetByteCount(canonical) > MaxPathUtf8Bytes)
                return Reject("ASSET_PATH_INVALID", $"Asset path exceeds {MaxPathUtf8Bytes} UTF-8 byte limit.");
        }
        catch
        {
            return Reject("ASSET_PATH_INVALID", "Asset path has invalid UTF-8 encoding.");
        }

        // Verify the input was already canonical (wire path must equal canonical result)
        if (path != canonical)
            return Reject("ASSET_PATH_INVALID", "Asset path is not in canonical form.");

        return new NormalizationResult(true, canonical, null, null);
    }

    /// <summary>
    /// Validates a Content.RootDirectory value.
    /// Must be a simple relative path suitable as a virtual directory prefix.
    /// </summary>
    internal static NormalizationResult NormalizeRootDirectory(string? rootDirectory)
    {
        // Default to "Content" per MonoGame convention
        if (string.IsNullOrEmpty(rootDirectory))
            return new NormalizationResult(true, "Content", null, null);

        var result = Normalize(rootDirectory);
        if (!result.Valid) return result;

        // Root directory must not end in .xnb
        if (result.CanonicalPath!.EndsWith(".xnb", StringComparison.OrdinalIgnoreCase))
            return Reject("ASSET_PATH_INVALID", "Content root directory must not end with .xnb.");

        return result;
    }

    /// <summary>
    /// Checks for duplicate or case-colliding canonical paths within a set.
    /// The virtual filesystem is case-sensitive to match Web/Emscripten MEMFS.
    /// </summary>
    internal static (bool hasDuplicate, string? duplicatePath) CheckDuplicates(
        IReadOnlyList<string> canonicalPaths)
    {
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var path in canonicalPaths)
        {
            if (!seen.Add(path))
                return (true, path);
        }
        return (false, null);
    }

    /// <summary>
    /// Resolves the full virtual filesystem path for an asset, given the content root directory
    /// and the asset's logical path (without .xnb extension).
    /// ContentManager resolves: Path.Combine(TitleContainer.Location, RootDirectory, assetName + ".xnb")
    /// On Web, TitleContainer.Location is empty, so the path is RootDirectory/assetPath directly.
    /// </summary>
    internal static string ResolveVirtualPath(string contentRootDirectory, string assetLogicalPath)
    {
        // Mount at contentRoot/assetPath (relative to MEMFS working directory)
        return $"{contentRootDirectory}/{assetLogicalPath}";
    }

    private static bool IsValidUnicodeScalars(string value)
    {
        for (var i = 0; i < value.Length; i++)
        {
            var ch = value[i];
            if (char.IsHighSurrogate(ch))
            {
                if (i + 1 >= value.Length || !char.IsLowSurrogate(value[i + 1]))
                    return false;
                i++; // skip low surrogate
            }
            else if (char.IsLowSurrogate(ch))
            {
                return false;
            }
        }
        return true;
    }

    private static NormalizationResult Reject(string code, string error)
        => new(false, null, error, code);
}

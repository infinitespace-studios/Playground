using System.Runtime.InteropServices.JavaScript;
using System.Text.Json;

namespace Playground.Preview;

// Content mount transaction surface of the preview runtime (issue 052 lineage).
// Split out of PreviewExports.cs by responsibility; same `PreviewExports`
// partial, so mount state, JSExport names, JSON source-generation compatibility,
// locking, and cleanup ordering are unchanged. Holds the phased mount
// transaction (validate/stage/commit), content-kind routing, and the mount
// state/helper/record surface.
public static partial class PreviewExports
{
    private static readonly object AssetMountGate = new();
    private static readonly Dictionary<string, byte[]> MountedAssets = new(StringComparer.Ordinal);
    private static readonly HashSet<string> CommittedMountIds = new(StringComparer.Ordinal);
    private static string _contentRootDirectory = "Content";
    private static bool _assetsMountedSuccessfully;
    private static bool _startupAdmitted;

    private static string? _pendingMountId;
    private static string? _pendingMountRoot;
    private static List<(string canonical, int byteLength, string sha256)>? _pendingMountPaths;
    private static readonly List<(string virtualPath, byte[] bytes, string sha256)> _stagedAssets = new();

    /// Phase 1: Validate paths, limits, duplicates. Accept metadata-only JSON (no bytes).
    /// Returns phase:"validated" on success so the caller can proceed to MountSingleAsset calls.
    [JSExport]
    public static string MountContentAssets(
        string? mountId,
        string? contentRootDirectory,
        string? assetsJson)
    {
        lock (AssetMountGate)
        {
            if (Volatile.Read(ref _loadState) > 2 || Volatile.Read(ref _startupAdmitted))
                return SerializeMountFailure("INVALID_STATE",
                    "Assets cannot be mounted after preview has started or been torn down.");

            ResetPendingMountState();

            if (string.IsNullOrEmpty(mountId))
                return SerializeMountFailure("MALFORMED_PAYLOAD", "Mount ID is required.");

            if (CommittedMountIds.Contains(mountId))
                return SerializeMountFailure("DUPLICATE_MOUNT_ID",
                    "This mount ID has already been used.");

            var rootResult = ContentPathNormalizer.NormalizeRootDirectory(contentRootDirectory);
            if (!rootResult.Valid)
                return SerializeMountFailure(rootResult.ErrorCode!,
                    rootResult.Error ?? "Invalid content root directory.");

            var rootDir = rootResult.CanonicalPath!;

            AssetMetaEntry[]? metas;
            try
            {
                metas = JsonSerializer.Deserialize(
                    assetsJson ?? "[]", PreviewJsonContext.Default.AssetMetaEntryArray);
            }
            catch (JsonException)
            {
                return SerializeMountFailure("MALFORMED_PAYLOAD", "Asset metadata is malformed JSON.");
            }

            if (metas is null || metas.Length == 0)
                return SerializeMountFailure("MALFORMED_PAYLOAD", "At least one asset is required.");

            if (metas.Length > 256)
                return SerializeMountFailure("TOO_MANY_ASSETS",
                    $"Asset count {metas.Length} exceeds the limit of 256.");

            long aggregateBytes = 0;
            var validPaths = new List<(string canonical, int byteLength, string sha256)>(metas.Length);

            foreach (var meta in metas)
            {
                if (meta.ByteLength <= 0 || meta.ByteLength > 16 * 1024 * 1024)
                    return SerializeMountFailure("ASSET_TOO_LARGE",
                        $"Asset '{meta.Path}' exceeds the 16 MiB individual limit.");

                aggregateBytes += meta.ByteLength;
                if (aggregateBytes > 24 * 1024 * 1024)
                    return SerializeMountFailure("ASSET_TOTAL_TOO_LARGE",
                        "Aggregate asset size exceeds the 24 MiB limit.");

                var pathResult = ContentPathNormalizer.Normalize(meta.Path);
                if (!pathResult.Valid)
                    return SerializeMountFailure(pathResult.ErrorCode!,
                        pathResult.Error ?? $"Invalid asset path: {meta.Path}");

                var virtualPath = ContentPathNormalizer.ResolveVirtualPath(rootDir, pathResult.CanonicalPath!);
                if (MountedAssets.ContainsKey(virtualPath))
                    return SerializeMountFailure("ASSET_PATH_ALREADY_MOUNTED",
                        $"Asset path '{pathResult.CanonicalPath}' is already mounted.");

                if (string.IsNullOrWhiteSpace(meta.Sha256) ||
                    meta.Sha256.Length != 64 ||
                    !meta.Sha256.All(char.IsAsciiHexDigit))
                {
                    return SerializeMountFailure("MALFORMED_PAYLOAD",
                        $"Asset '{meta.Path}' has an invalid SHA-256 declaration.");
                }

                validPaths.Add((pathResult.CanonicalPath!, meta.ByteLength, meta.Sha256.ToLowerInvariant()));
            }

            var (hasDuplicate, duplicatePath) = ContentPathNormalizer.CheckDuplicates(
                validPaths.Select(path => path.canonical).ToList());
            if (hasDuplicate)
                return SerializeMountFailure("ASSET_PATH_DUPLICATE",
                    $"Duplicate asset path: {duplicatePath}");

            _pendingMountId = mountId;
            _pendingMountRoot = rootDir;
            _pendingMountPaths = validPaths;

            return JsonSerializer.Serialize(
                new AssetMountPhaseResult(true, "validated", validPaths.Count, rootDir),
                PreviewJsonContext.Default.AssetMountPhaseResult);
        }
    }

    /// Phase 2: Validate and stage one asset. Called once per asset after MountContentAssets validates.
    /// Accepts Uint8Array directly via dotnet wasm interop (no JSON number arrays).
    [JSExport]
    public static string MountSingleAsset(
        string? mountId,
        string? contentRootDirectory,
        string? assetPath,
        byte[]? bytes,
        string? expectedSha256)
    {
        lock (AssetMountGate)
        {
            if (_pendingMountId is null || _pendingMountId != mountId)
                return SerializeMountFailure("INVALID_STATE", "No validated mount in progress.");

            if (Volatile.Read(ref _startupAdmitted))
                return AbortPendingMount("INVALID_STATE",
                    "Assets cannot be mounted after startup has been admitted.");

            var rootResult = ContentPathNormalizer.NormalizeRootDirectory(contentRootDirectory);
            if (!rootResult.Valid)
                return AbortPendingMount(rootResult.ErrorCode!, rootResult.Error ?? "Invalid content root directory.");

            if (bytes is null || bytes.Length == 0)
                return AbortPendingMount("MALFORMED_PAYLOAD", $"Asset '{assetPath}' has empty bytes.");

            var pathResult = ContentPathNormalizer.Normalize(assetPath);
            if (!pathResult.Valid)
                return AbortPendingMount(pathResult.ErrorCode!,
                    pathResult.Error ?? $"Invalid asset path: {assetPath}");

            var rootDir = _pendingMountRoot!;
            if (!string.Equals(rootResult.CanonicalPath, rootDir, StringComparison.Ordinal))
            {
                return AbortPendingMount("MALFORMED_PAYLOAD",
                    $"Asset '{pathResult.CanonicalPath}' content root mismatch: expected '{rootDir}', got '{rootResult.CanonicalPath}'.");
            }

            var pendingPaths = _pendingMountPaths!;
            if (_stagedAssets.Count >= pendingPaths.Count)
                return AbortPendingMount("MALFORMED_PAYLOAD", "Asset staging exceeded the declared manifest length.");

            var expectedEntry = pendingPaths[_stagedAssets.Count];
            if (!string.Equals(pathResult.CanonicalPath, expectedEntry.canonical, StringComparison.Ordinal))
            {
                return AbortPendingMount("MALFORMED_PAYLOAD",
                    $"Asset order mismatch: expected '{expectedEntry.canonical}', got '{pathResult.CanonicalPath}'.");
            }

            // Content-type-aware admission (issue 052). Route by the asset's
            // MAGIC BYTES, not its extension: the frontend renames a raw `.wav`
            // to a `.xnb` mount path (so Content.Load<SoundEffect> resolves and
            // CommitMount's proof re-derivation stays consistent), so the file's
            // extension no longer identifies its real contents. Detecting by
            // content is also strictly more robust (a mislabelled file can't slip
            // through). Each kind is validated appropriately and the FINAL bytes
            // to stage are produced:
            //   XNB magic ('XNB')     -> ContentValidator.Validate (unchanged; the
            //                            issue 39/40 path is byte-identical), stage raw
            //   RIFF/WAVE magic       -> WavToXnb.Convert -> ContentValidator.Validate
            //                            the result, stage the transcoded XNB
            //   PNG/JPEG/BMP magic    -> image sniff (+ extension guard), stage raw
            //                            (MonoGame Web's Texture2D.FromStream fallback
            //                            loads these directly by extension)
            // The integrity checks below (sha256/byteLength vs the manifest) run
            // against the RAW transferred bytes; `stagedBytes` is what gets written.
            var canonical = pathResult.CanonicalPath!;
            var extension = GetAssetExtension(canonical);
            byte[] stagedBytes;
            switch (DetectContentKind(bytes))
            {
                case ContentKind.Xnb:
                {
                    var validation = ContentValidator.Validate(bytes, canonical);
                    if (!validation.Valid)
                        return AbortPendingMount("PREVIEW_LOAD_FAILED",
                            validation.DiagnosticMessage ?? "Content validation failed.",
                            validation.DiagnosticId, validation.DiagnosticMessage);
                    stagedBytes = bytes;
                    break;
                }
                case ContentKind.Wav:
                {
                    var transcode = WavToXnb.Convert(bytes, canonical);
                    if (!transcode.Success)
                        return AbortPendingMount("PREVIEW_LOAD_FAILED",
                            transcode.DiagnosticMessage ?? "Audio transcode failed.",
                            transcode.DiagnosticId, transcode.DiagnosticMessage);
                    // Defence in depth: the transcoded XNB must pass the same
                    // validator a real MGCB .xnb would.
                    var validation = ContentValidator.Validate(transcode.Xnb!, canonical);
                    if (!validation.Valid)
                        return AbortPendingMount("PREVIEW_LOAD_FAILED",
                            validation.DiagnosticMessage ?? "Transcoded audio failed validation.",
                            validation.DiagnosticId, validation.DiagnosticMessage);
                    stagedBytes = transcode.Xnb!;
                    break;
                }
                case ContentKind.Image:
                {
                    var image = ImageContent.Validate(bytes, canonical, extension);
                    if (!image.Valid)
                        return AbortPendingMount("PREVIEW_LOAD_FAILED",
                            image.DiagnosticMessage ?? "Image validation failed.",
                            image.DiagnosticId, image.DiagnosticMessage);
                    stagedBytes = bytes;
                    break;
                }
                default:
                    return AbortPendingMount("PREVIEW_LOAD_FAILED",
                        $"The content file '{canonical}' is not a recognized asset. " +
                        "Supported: XNB, PNG, JPEG, BMP, or PCM WAV.",
                        "PG0212_CONTENT_UNSUPPORTED_EXTENSION",
                        $"Unsupported content for '{canonical}'.");
            }

            var sha256 = Convert.ToHexString(
                System.Security.Cryptography.SHA256.HashData(bytes)).ToLowerInvariant();

            if (!string.IsNullOrEmpty(expectedSha256) && sha256 != expectedSha256)
            {
                return AbortPendingMount("MALFORMED_PAYLOAD",
                    $"Asset '{assetPath}' SHA-256 mismatch: expected {expectedSha256}, got {sha256}.");
            }

            if (bytes.Length != expectedEntry.byteLength)
            {
                return AbortPendingMount("MALFORMED_PAYLOAD",
                    $"Asset '{pathResult.CanonicalPath}' byte length mismatch: expected {expectedEntry.byteLength}, got {bytes.Length}.");
            }

            if (!string.Equals(sha256, expectedEntry.sha256, StringComparison.Ordinal))
            {
                return AbortPendingMount("MALFORMED_PAYLOAD",
                    $"Asset '{pathResult.CanonicalPath}' manifest SHA-256 mismatch: expected {expectedEntry.sha256}, got {sha256}.");
            }

            var virtualPath = ContentPathNormalizer.ResolveVirtualPath(rootDir, pathResult.CanonicalPath!);

            // Stage the asset (don't write yet). For .wav the staged bytes are the
            // transcoded XNB; the virtual path already carries the manifest's
            // (frontend-rewritten) .xnb extension, so CommitMount's proof
            // re-derivation stays consistent with no CommitMount changes.
            _stagedAssets.Add((virtualPath, stagedBytes, sha256));

            // Check if all pending assets are now staged
            if (_stagedAssets.Count == pendingPaths.Count)
            {
                return JsonSerializer.Serialize(
                    new AssetMountPhaseResult(true, "staged", _stagedAssets.Count, rootDir),
                    PreviewJsonContext.Default.AssetMountPhaseResult);
            }

            return JsonSerializer.Serialize(
                new AssetMountPhaseResult(true, "staging", _stagedAssets.Count, rootDir),
                PreviewJsonContext.Default.AssetMountPhaseResult);
        }
    }

    /// Phase 3: Atomically write all staged assets to the filesystem. Rollback on any failure.
    [JSExport]
    public static string CommitMount(string? mountId)
    {
        lock (AssetMountGate)
        {
            if (_pendingMountId is null || _pendingMountId != mountId)
                return SerializeMountFailure("INVALID_STATE", "No staged mount to commit.");

            if (Volatile.Read(ref _startupAdmitted))
                return AbortPendingMount("INVALID_STATE",
                    "Mount commit rejected: startup has been admitted.");

            if (_stagedAssets.Count != _pendingMountPaths!.Count)
                return SerializeMountFailure("INVALID_STATE", "Not all assets staged yet.");

            var rootDir = _pendingMountRoot!;
            var writtenPaths = new List<string>();

            try
            {
                // Write all staged assets
                foreach (var (virtualPath, bytes, sha256) in _stagedAssets)
                {
                    var directory = Path.GetDirectoryName(virtualPath);
                    if (!string.IsNullOrEmpty(directory))
                        Directory.CreateDirectory(directory);

                    InjectMountWriteFault(writtenPaths.Count);

                    File.WriteAllBytes(virtualPath, bytes);
                    MountedAssets[virtualPath] = bytes;
                    writtenPaths.Add(virtualPath);
                }

                // All writes succeeded, commit the mount
                CommittedMountIds.Add(mountId!);
                _contentRootDirectory = rootDir;
                _assetsMountedSuccessfully = true;

                // Build mounted files proof
                var mountedFiles = new List<MountedFileDescriptor>();
                var totalBytes = 0;
                foreach (var path in _pendingMountPaths)
                {
                    var vp = ContentPathNormalizer.ResolveVirtualPath(rootDir, path.canonical);
                    if (MountedAssets.ContainsKey(vp))
                    {
                        totalBytes += MountedAssets[vp].Length;
                        var h = Convert.ToHexString(
                            System.Security.Cryptography.SHA256.HashData(MountedAssets[vp])).ToLowerInvariant();
                        mountedFiles.Add(new MountedFileDescriptor(path.canonical, vp, MountedAssets[vp].Length, h));
                    }
                }

                // Clear staging state
                ResetPendingMountState();

                return JsonSerializer.Serialize(
                    new AssetMountResult(
                        true,
                        mountId,
                        mountedFiles.Count,
                        totalBytes,
                        rootDir,
                        mountedFiles.ToArray(),
                        null),
                    PreviewJsonContext.Default.AssetMountResult);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or NotSupportedException or PathTooLongException or DirectoryNotFoundException)
            {
                // Rollback: delete all files written by this mount
                var rollbackErrors = new List<string>();
                foreach (var path in writtenPaths)
                {
                    try
                    {
                        File.Delete(path);
                        MountedAssets.Remove(path);
                    }
                    catch (Exception rollbackException) when (rollbackException is IOException or UnauthorizedAccessException or NotSupportedException)
                    {
                        rollbackErrors.Add($"{path}: {rollbackException.Message}");
                    }
                }

                // Clear staging state
                ResetPendingMountState();

                return SerializeMountFailure("FILESYSTEM_ERROR",
                    $"Mount commit failed: {ex.Message}. Rollback errors: {rollbackErrors.Count}.");
            }
        }
    }

    [JSExport]
    public static string ConfigureContentRoot(string? contentRootDirectory)
    {
        lock (AssetMountGate)
        {
            var rootResult = ContentPathNormalizer.NormalizeRootDirectory(contentRootDirectory);
            if (!rootResult.Valid)
                return JsonSerializer.Serialize(new { success = false, error = rootResult.Error });

            _contentRootDirectory = rootResult.CanonicalPath!;
            return JsonSerializer.Serialize(new
            {
                success = true,
                contentRootDirectory = _contentRootDirectory,
            });
        }
    }

    [JSExport]
    public static string QueryMountState()
    {
        lock (AssetMountGate)
        {
            return JsonSerializer.Serialize(
                new AssetMountStateResult(
                    _assetsMountedSuccessfully,
                    MountedAssets.Count,
                    MountedAssets.Sum(kv => kv.Value.Length),
                    CommittedMountIds.Count,
                    _contentRootDirectory,
                    CommittedMountIds.ToArray()),
                PreviewJsonContext.Default.AssetMountStateResult);
        }
    }

    [JSExport]
    public static string CleanupMountedAssets()
    {
        lock (AssetMountGate)
        {
            var count = MountedAssets.Count;
            var totalBytes = MountedAssets.Sum(kv => kv.Value.Length);
            foreach (var path in MountedAssets.Keys.ToArray())
            {
                try { File.Delete(path); } catch { /* best effort cleanup */ }
            }
            MountedAssets.Clear();
            CommittedMountIds.Clear();
            _assetsMountedSuccessfully = false;
            return JsonSerializer.Serialize(new
            {
                success = true,
                removedFileCount = count,
                removedByteLength = totalBytes,
            });
        }
    }

    private static string SerializeMountFailure(
        string code, string message,
        string? diagnosticId = null, string? diagnosticMessage = null) =>
        JsonSerializer.Serialize(
            new AssetMountResult(
                false, null, 0, 0, null, null,
                new LoadError(code, message),
                diagnosticId is null ? null : new MountDiagnostic(diagnosticId, diagnosticMessage ?? message)),
            PreviewJsonContext.Default.AssetMountResult);

    private static string AbortPendingMount(
        string code,
        string message,
        string? diagnosticId = null,
        string? diagnosticMessage = null)
    {
        ResetPendingMountState();
        return SerializeMountFailure(code, message, diagnosticId, diagnosticMessage);
    }

    private static void ResetPendingMountState()
    {
        _pendingMountId = null;
        _pendingMountRoot = null;
        _pendingMountPaths = null;
        _stagedAssets.Clear();
    }

    /// <summary>
    /// Lower-cased extension (without the dot) of a canonical asset path, or ""
    /// when there is none. Used to route content-type-aware mount admission.
    /// </summary>
    private static string GetAssetExtension(string canonicalPath)
    {
        var lastDot = canonicalPath.LastIndexOf('.');
        var lastSlash = canonicalPath.LastIndexOf('/');
        if (lastDot < 0 || lastDot < lastSlash || lastDot == canonicalPath.Length - 1)
            return string.Empty;
        return canonicalPath[(lastDot + 1)..].ToLowerInvariant();
    }

    private enum ContentKind { Unknown, Xnb, Wav, Image }

    /// <summary>
    /// Identify a mounted asset by its leading MAGIC BYTES (issue 052). Routing
    /// by content rather than extension is required because the frontend renames
    /// a raw `.wav` to a `.xnb` mount path, and is more robust against a
    /// mislabelled file. Returns the coarse kind; per-kind validators
    /// (ContentValidator / WavToXnb / ImageContent) do the exact checks.
    /// </summary>
    private static ContentKind DetectContentKind(ReadOnlySpan<byte> b)
    {
        // XNB: 'X' 'N' 'B'
        if (b.Length >= 3 && b[0] == (byte)'X' && b[1] == (byte)'N' && b[2] == (byte)'B')
            return ContentKind.Xnb;
        // RIFF/WAVE: "RIFF" .... "WAVE"
        if (b.Length >= 12 &&
            b[0] == (byte)'R' && b[1] == (byte)'I' && b[2] == (byte)'F' && b[3] == (byte)'F' &&
            b[8] == (byte)'W' && b[9] == (byte)'A' && b[10] == (byte)'V' && b[11] == (byte)'E')
            return ContentKind.Wav;
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if (b.Length >= 8 &&
            b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47 &&
            b[4] == 0x0D && b[5] == 0x0A && b[6] == 0x1A && b[7] == 0x0A)
            return ContentKind.Image;
        // JPEG: FF D8 FF
        if (b.Length >= 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF)
            return ContentKind.Image;
        // BMP: 'B' 'M'
        if (b.Length >= 2 && b[0] == 0x42 && b[1] == 0x4D)
            return ContentKind.Image;
        return ContentKind.Unknown;
    }

    internal sealed record AssetEntry(string Path, byte[] Bytes);
    internal sealed record AssetMetaEntry(string Path, int ByteLength, string Sha256);
    internal sealed record AssetMountPhaseResult(
        bool Success, string Phase, int AssetCount, string RootDir);
    // Content-integrity descriptor for one mounted asset (asset path, virtual
    // path, byte length, SHA-256). Product mount evidence — not proof
    // instrumentation. Wire property names are unchanged.
    internal sealed record MountedFileDescriptor(
        string AssetPath, string VirtualPath, int ByteLength, string Sha256);
    internal sealed record MountDiagnostic(string Id, string Message);
    internal sealed record AssetMountResult(
        bool Success,
        string? MountId,
        int MountedFileCount,
        int MountedByteLength,
        string? ContentRootDirectory,
        MountedFileDescriptor[]? MountedFiles,
        LoadError? Error,
        MountDiagnostic? Diagnostic = null);
    internal sealed record AssetMountStateResult(
        bool Mounted,
        int MountedFileCount,
        int MountedByteLength,
        int CommittedMountCount,
        string ContentRootDirectory,
        string[] CommittedMountIds);
}

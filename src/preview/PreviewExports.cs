using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices.JavaScript;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Xna.Framework;

namespace Playground.Preview;

public static partial class PreviewExports
{
    private const string MonoGameSourceSha256 = "a84677fb75b20be1559803ce8f3afb72f88a7dc63afda5ff2d0c5a6e1e27a251";
    private static readonly string RuntimeIdentity = Guid.NewGuid().ToString("D");
    private static readonly object LifecycleGate = new();
    private static int _callCount;
    private static int _loadState;
    private static GameRunner? _gameRunner;
    private static Type? _lastStoppedGameType;
    private static TextWriter? _originalOut;
    private static TextWriter? _originalError;
    private static ForwardingTextWriter? _forwardingOut;
    private static ForwardingTextWriter? _forwardingError;
    private static RuntimeExceptionMapper? _exceptionMapper;
    private static int _runtimeBoundaryInstalled;
    private static int _runtimeBoundaryActive;
    private static int _runtimeFailureReported;

    [JSImport("globalThis.__playgroundForwardOutput")]
    internal static partial void ForwardOutput(
        string source, string stream, string category, string text);

    [JSImport("globalThis.__playgroundBeginManagedRuntimeFailure")]
    internal static partial bool BeginManagedRuntimeFailure(string report);

    [JSImport("globalThis.__playgroundCompleteManagedRuntimeFailure")]
    internal static partial void CompleteManagedRuntimeFailure(string report);

    [JSExport]
    public static void InitializeRuntimeFailureBoundary()
    {
        if (Interlocked.Exchange(ref _runtimeBoundaryInstalled, 1) == 0)
            AppDomain.CurrentDomain.UnhandledException += OnUnhandledException;
    }

    [JSExport]
    public static string Ping()
    {
        var monoGameAssembly = typeof(Game).Assembly;
        var monoGameIdentity = monoGameAssembly.GetName();
        var proof = new PreviewContextInfo(
            ProtocolVersion: 1,
            Message: "preview-context-alive",
            RuntimeIdentity,
            RuntimeStartupCount: 1,
            CallCount: ++_callCount,
            Configuration: "Release",
            PublishTrimmed: false,
            NativeAot: false,
            RunAOTCompilation: false,
            WasmEnableThreads: false,
            WasmBuildNative: true,
            ExecutionMode: "interpreter",
            MonoGameAssemblyName: monoGameIdentity.Name!,
            MonoGameAssemblyVersion: monoGameIdentity.Version!.ToString(),
            MonoGameSourceSha256,
            SafeMetadataType: typeof(Game).FullName!);

        return JsonSerializer.Serialize(proof, PreviewJsonContext.Default.PreviewContextInfo);
    }

    // Proof-only mount write-fault seam. In the product build this partial
    // method has no implementation, so every call site is elided by the
    // compiler and the shipped runtime contains no fault-injection path. The
    // proof build supplies the body in PreviewExports.Proof.cs.
    static partial void InjectMountWriteFault(int writeIndex);

    // Proof-only game-instance reflection counter seams. The counters
    // (FrameCount/UpdateCount/DisposeCount/CallbackAfterDisposedCount) exist
    // only on the proof scenario game fixtures, never on real user games, so
    // reading them is proof instrumentation. In the product build these partial
    // methods have no implementation, so the call sites are elided and the
    // shipped runtime contains no reflection-counter reads or their name
    // literals; the teardown/failure counter fields simply stay null. The proof
    // build supplies the bodies (via ReadProofCounter) in PreviewExports.Proof.cs.
    static partial void ObserveStoppedGameCounters(
        Type? gameType, ref int? frameCount, ref int? disposeCount);
    static partial void ObserveRuntimeFailureCounters(
        Type? gameType, ref int? frameCount, ref int? updateCount,
        ref int? disposeCount, ref int? callbackAfterDisposedCount);

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

    [JSExport]
    public static string LoadUserAssembly(
        byte[]? dllBytes,
        byte[]? pdbBytes,
        string? expectedAssemblySha256,
        string? expectedPdbSha256,
        string? expectedAssemblyName,
        string? expectedSourcePathsJson,
        string? primarySourcePath)
    {
        if (Volatile.Read(ref _loadState) != 0)
        {
            return SerializeLoadFailure(true, "INVALID_STATE", "This preview cannot accept another load.");
        }

        ValidatedLoad validated;
        try
        {
            validated = ValidateLoad(
                dllBytes,
                pdbBytes,
                expectedAssemblySha256,
                expectedPdbSha256,
                expectedAssemblyName,
                expectedSourcePathsJson,
                primarySourcePath);
        }
        catch (Exception exception) when (
            exception is ArgumentException or
            BadImageFormatException or
            OverflowException or
            DecoderFallbackException)
        {
            return SerializeLoadFailure(false, "PREVIEW_LOAD_FAILED", exception.Message);
        }

        if (Interlocked.CompareExchange(ref _loadState, 1, 0) != 0)
        {
            return SerializeLoadFailure(true, "INVALID_STATE", "This preview cannot accept another load.");
        }

        try
        {
            var assembly = Assembly.Load(dllBytes!, pdbBytes!);
            var identity = assembly.GetName();
            var fullName = assembly.FullName;
            if (string.IsNullOrWhiteSpace(fullName) || string.IsNullOrWhiteSpace(identity.Name))
            {
                throw new BadImageFormatException("The loaded assembly has no usable identity.");
            }
            if (!string.Equals(identity.Name, validated.ExpectedAssemblyName, StringComparison.Ordinal))
            {
                throw new BadImageFormatException("The loaded assembly identity does not match the binary proof.");
            }
            lock (LifecycleGate)
            {
                if (_loadState != 1)
                {
                    return SerializeLoadFailure(
                        true, "INVALID_STATE", "The preview was torn down while assembly loading was in progress.");
                }
                _gameRunner = new GameRunner(assembly);
                _exceptionMapper = new RuntimeExceptionMapper(
                    assembly, pdbBytes!, validated.ExpectedSourcePaths);
                Volatile.Write(ref _loadState, 2);
            }
            return JsonSerializer.Serialize(
                new AssemblyLoadResult(
                    true,
                    true,
                    new AssemblyLoadEvidence(
                        fullName,
                        identity.Name,
                        dllBytes!.Length,
                        pdbBytes!.Length,
                        validated.DocumentCount,
                        validated.VisibleSequencePointCount,
                        validated.LogicalPath,
                        validated.AssemblySha256,
                        validated.PdbSha256,
                        validated.CodeViewGuid,
                        validated.CodeViewStamp,
                        validated.PortablePdbGuid,
                        validated.PortablePdbStamp,
                        validated.ExpectedAssemblyName,
                        validated.ExpectedSourcePaths),
                    null),
                PreviewJsonContext.Default.AssemblyLoadResult);
        }
        catch (Exception exception) when (IsExpectedAssemblyLoadFailure(exception))
        {
            Interlocked.CompareExchange(ref _loadState, 3, 1);
            return SerializeLoadFailure(true, "PREVIEW_LOAD_FAILED", "Assembly.Load failed after runtime mutation began.");
        }
    }

    [JSExport]
    public static string DiscoverAndConstructGame()
    {
        lock (LifecycleGate)
        {
            if (_loadState != 2 || _gameRunner is null)
            {
                return JsonSerializer.Serialize(
                    new GamePipelineResult(
                        false, null, null, false, null,
                        new LoadError("INVALID_STATE", "A user assembly must be loaded before game discovery.")),
                    PreviewJsonContext.Default.GamePipelineResult);
            }

            var discovery = _gameRunner.DiscoverGameType();
            if (!discovery.Success)
            {
                return JsonSerializer.Serialize(
                    new GamePipelineResult(
                        false, null, null, false, discovery.Diagnostic,
                        new LoadError("PREVIEW_LOAD_FAILED", "Game type validation failed.")),
                    PreviewJsonContext.Default.GamePipelineResult);
            }

            var construction = _gameRunner.ConstructGame();
            return JsonSerializer.Serialize(
                new GamePipelineResult(
                    construction.Success,
                    discovery.GameTypeFullName,
                    construction.ConstructedTypeFullName,
                    construction.AssignableToGame,
                    construction.Diagnostic,
                    construction.Error is null
                        ? null
                        : new LoadError(construction.Error.Code, construction.Error.Message),
                    construction.ConstructionAttempts,
                    construction.RetainedGame),
                PreviewJsonContext.Default.GamePipelineResult);
        }
    }

    [JSExport]
    public static string RunLoadedGame()
    {
        GameRunner? runner;
        lock (LifecycleGate)
        {
            runner = _loadState == 2 ? _gameRunner : null;
            if (runner is not null)
            {
                Volatile.Write(ref _startupAdmitted, true);
                InstallConsoleCapture();
                Volatile.Write(ref _runtimeBoundaryActive, 1);
            }
        }

        if (runner is null)
            return SerializeStartFailure("INVALID_STATE", "A constructed game must be loaded before start.");

        var discovery = runner.DiscoverGameType();
        if (!discovery.Success)
            return SerializeStartFailure("PREVIEW_START_FAILED", "No valid Game subclass was found.");
        var construction = runner.ConstructGame();
        if (!construction.Success)
            return SerializeStartFailure(
                construction.Error?.Code ?? "PREVIEW_START_FAILED",
                construction.Error?.Message ?? "The Game subclass could not be constructed.",
                construction.Exception is null ? null : _exceptionMapper?.Map(construction.Exception));
        var start = runner.RunGame();
        var failure = start.Exception is null ? null : _exceptionMapper?.Map(start.Exception);
        return JsonSerializer.Serialize(
            new GameStartResult(
                start.Success,
                start.State,
                start.RunAttempts,
                start.RunReturned,
                start.RunDurationMilliseconds,
                start.RetainedGame,
                start.Disposed,
                start.DisposeAttempts,
                start.Error is null ? null : new LoadError(start.Error.Code, start.Error.Message),
                start.TerminationReason,
                failure),
            PreviewJsonContext.Default.GameStartResult);
    }

    [JSExport]
    public static string QueryRunState()
    {
        GameRunner? runner;
        lock (LifecycleGate)
        {
            runner = _gameRunner;
        }
        if (runner is null)
        {
            return JsonSerializer.Serialize(
                new GameRunStateResult(
                    "stopped", 0, 0, false, null, false, true, 0, null, null, null, null),
                PreviewJsonContext.Default.GameRunStateResult);
        }

        var snapshot = runner.Snapshot();
        // Responsibility-neutral product run state: the shipping runtime reports
        // lifecycle facts only. Game-instance reflection counters are proof-only
        // instrumentation and are produced by `QueryRunStateProof` in the proof
        // build; the product result leaves those fields null.
        return JsonSerializer.Serialize(
            new GameRunStateResult(
                snapshot.State,
                snapshot.ConstructionAttempts,
                snapshot.RunAttempts,
                snapshot.RunReturned,
                snapshot.RunDurationMilliseconds,
                snapshot.RetainedGame,
                snapshot.Disposed,
                snapshot.DisposeAttempts,
                null,
                null,
                null,
                null),
            PreviewJsonContext.Default.GameRunStateResult);
    }

    [JSExport]
    public static string TeardownGame()
        => StopGameCore(false);

    [JSExport]
    public static string StopGame()
        => StopGameCore(false);

    private static string StopGameCore(bool runtimeFailure)
    {
        if (!runtimeFailure)
            Volatile.Write(ref _runtimeBoundaryActive, 0);
        lock (LifecycleGate)
        {
            var runner = Interlocked.Exchange(ref _gameRunner, null);
            var previousState = Interlocked.Exchange(ref _loadState, 4);
            if (runner is null)
            {
                RestoreConsoleCapture();
                return JsonSerializer.Serialize(
                    new GameTeardownResult(
                        true, false, 0, false, null, previousState == 4, null, null),
                    PreviewJsonContext.Default.GameTeardownResult);
            }

            var gameType = runner.Snapshot().GameType;
            GameRunner.DisposalResult disposal;
            try
            {
                disposal = runner.Teardown();
                _lastStoppedGameType = gameType;
            }
            finally
            {
                RestoreConsoleCapture();
            }
            // Product path leaves the game-instance reflection counters null; the
            // proof build supplies them via the ObserveStoppedGameCounters seam.
            int? stoppedFrameCount = null;
            int? stoppedDisposeCount = null;
            ObserveStoppedGameCounters(gameType, ref stoppedFrameCount, ref stoppedDisposeCount);
            return JsonSerializer.Serialize(
                new GameTeardownResult(
                    disposal.Success,
                    disposal.HadGame,
                    disposal.DisposeAttempts,
                    disposal.RetainedGame,
                    disposal.Error is null ? null : new LoadError(disposal.Error.Code, disposal.Error.Message),
                    false,
                    stoppedFrameCount,
                    stoppedDisposeCount),
                PreviewJsonContext.Default.GameTeardownResult);
        }
    }

    private static void OnUnhandledException(object sender, UnhandledExceptionEventArgs args)
    {
        if (Volatile.Read(ref _runtimeBoundaryActive) != 1 ||
            args.ExceptionObject is not Exception exception)
            return;
        var failure = _exceptionMapper?.Map(exception);
        if (failure is null ||
            Interlocked.CompareExchange(ref _runtimeFailureReported, 1, 0) != 0)
            return;
        Volatile.Write(ref _runtimeBoundaryActive, 0);
        try
        {
            if (!BeginManagedRuntimeFailure(JsonSerializer.Serialize(
                    failure, PreviewJsonContext.Default.RuntimeExceptionReport)))
                return;
            var teardown = JsonSerializer.Deserialize(
                StopGameCore(true), PreviewJsonContext.Default.GameTeardownResult);
            // Product path leaves the game-instance reflection counters null; the
            // proof build supplies them via the ObserveRuntimeFailureCounters seam.
            int? failureFrameCount = null;
            int? failureUpdateCount = null;
            int? failureDisposeCount = null;
            int? failureCallbackAfterDisposedCount = null;
            ObserveRuntimeFailureCounters(
                _lastStoppedGameType,
                ref failureFrameCount,
                ref failureUpdateCount,
                ref failureDisposeCount,
                ref failureCallbackAfterDisposedCount);
            failure = failure with {
                CleanupSucceeded = teardown?.Success == true,
                DisposeAttempts = teardown?.DisposeAttempts,
                FrameCount = failureFrameCount,
                UpdateCount = failureUpdateCount,
                ProofDisposeCount = failureDisposeCount,
                CallbackAfterDisposedCount = failureCallbackAfterDisposedCount,
            };
            CompleteManagedRuntimeFailure(JsonSerializer.Serialize(
                failure, PreviewJsonContext.Default.RuntimeExceptionReport));
        }
        catch (Exception boundaryFailure) when (!GameRunner.IsFatal(boundaryFailure))
        {
            // The original exception remains unhandled; never replace it with reporting failure.
        }
    }

    private static void InstallConsoleCapture()
    {
        if (_forwardingOut is not null || _forwardingError is not null)
            return;
        _originalOut = Console.Out;
        _originalError = Console.Error;
        _forwardingOut = new ForwardingTextWriter(
            text => ForwardOutput("managed", "stdout", "console", text));
        _forwardingError = new ForwardingTextWriter(
            text => ForwardOutput("managed", "stderr", "console", text));
        Console.SetOut(_forwardingOut);
        Console.SetError(_forwardingError);
    }

    private static void RestoreConsoleCapture()
    {
        var output = Interlocked.Exchange(ref _forwardingOut, null);
        var error = Interlocked.Exchange(ref _forwardingError, null);
        if (_originalOut is not null)
            Console.SetOut(_originalOut);
        if (_originalError is not null)
            Console.SetError(_originalError);
        _originalOut = null;
        _originalError = null;
        output?.Dispose();
        error?.Dispose();
    }

    private static bool IsExpectedAssemblyLoadFailure(Exception exception) =>
        exception is ArgumentException or
            BadImageFormatException or
            FileLoadException or
            FileNotFoundException or
            TypeLoadException or
            NotSupportedException;

    private static ValidatedLoad ValidateLoad(
        byte[]? dllBytes,
        byte[]? pdbBytes,
        string? expectedAssemblySha256,
        string? expectedPdbSha256,
        string? expectedAssemblyName,
        string? expectedSourcePathsJson,
        string? primarySourcePath)
    {
        if (dllBytes is null || pdbBytes is null || dllBytes.Length == 0 || pdbBytes.Length == 0)
            throw new ArgumentException("Assembly and portable PDB bytes must be non-empty.");
        if (dllBytes.Length > 8 * 1024 * 1024) throw new ArgumentException("The assembly exceeds the 8 MiB limit.");
        if (pdbBytes.Length > 8 * 1024 * 1024) throw new ArgumentException("The PDB exceeds the 8 MiB limit.");
        if (checked(dllBytes.Length + pdbBytes.Length) > 12 * 1024 * 1024)
            throw new ArgumentException("The binary pair exceeds the aggregate limit.");

        var assemblySha256 = Convert.ToHexString(SHA256.HashData(dllBytes)).ToLowerInvariant();
        var pdbSha256 = Convert.ToHexString(SHA256.HashData(pdbBytes)).ToLowerInvariant();
        if (assemblySha256 != expectedAssemblySha256 || pdbSha256 != expectedPdbSha256)
            throw new ArgumentException("Managed input digests do not match the channel-bound digests.");
        if (string.IsNullOrEmpty(expectedAssemblyName) ||
            expectedAssemblyName.Length > 128 ||
            !char.IsAsciiLetter(expectedAssemblyName[0]) && expectedAssemblyName[0] != '_' ||
            expectedAssemblyName.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not ('_' or '.' or '-')))
            throw new ArgumentException("The expected assembly name is invalid.");
        var strictUtf8 = new UTF8Encoding(false, true);
        string[] expectedSourcePaths;
        try
        {
            expectedSourcePaths = JsonSerializer.Deserialize(
                expectedSourcePathsJson ?? "", PreviewJsonContext.Default.StringArray)
                ?? throw new ArgumentException("The binary proof source paths are missing.");
        }
        catch (JsonException)
        {
            throw new ArgumentException("The binary proof source paths are malformed.");
        }
        if (expectedSourcePaths.Length is 0 or > 64 ||
            expectedSourcePaths.Distinct(StringComparer.Ordinal).Count() != expectedSourcePaths.Length ||
            expectedSourcePaths.Any(path => !IsCanonicalLogicalPath(path, strictUtf8)) ||
            primarySourcePath is null ||
            !expectedSourcePaths.Contains(primarySourcePath, StringComparer.Ordinal))
            throw new ArgumentException("The binary proof source path identity is invalid.");

        BlobContentId codeViewId;
        using (var peReader = new PEReader(new MemoryStream(dllBytes, writable: false)))
        {
            if (!peReader.HasMetadata || peReader.PEHeaders.CorHeader is null ||
                !peReader.GetMetadataReader().IsAssembly)
                throw new BadImageFormatException("The assembly is not a managed PE image.");
            var codeViewEntries = peReader.ReadDebugDirectory()
                .Where(entry => entry.Type == DebugDirectoryEntryType.CodeView)
                .ToArray();
            if (codeViewEntries.Length != 1)
                throw new BadImageFormatException("The assembly must contain exactly one CodeView entry.");
            var codeView = peReader.ReadCodeViewDebugDirectoryData(codeViewEntries[0]);
            codeViewId = new BlobContentId(codeView.Guid, codeViewEntries[0].Stamp);
        }

        using var provider = MetadataReaderProvider.FromPortablePdbStream(
            new MemoryStream(pdbBytes, writable: false));
        var reader = provider.GetMetadataReader();
        var header = reader.DebugMetadataHeader
            ?? throw new BadImageFormatException("The portable PDB has no debug metadata header.");
        var pdbId = new BlobContentId(header.Id);
        if (pdbId != codeViewId)
            throw new BadImageFormatException("The assembly CodeView identifier does not match the portable PDB.");

        var documents = new Dictionary<DocumentHandle, string>();
        foreach (var handle in reader.Documents)
        {
            var path = reader.GetString(reader.GetDocument(handle).Name);
            if (!IsCanonicalLogicalPath(path, strictUtf8))
                throw new BadImageFormatException("The portable PDB contains a non-canonical document path.");
            documents.Add(handle, path);
        }

        var visibleSequencePoints = 0;
        var visiblePaths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var handle in reader.MethodDebugInformation)
        {
            var information = reader.GetMethodDebugInformation(handle);
            foreach (var point in information.GetSequencePoints())
            {
                if (point.IsHidden) continue;
                var documentHandle = point.Document.IsNil ? information.Document : point.Document;
                if (documentHandle.IsNil || !documents.TryGetValue(documentHandle, out var path))
                    throw new BadImageFormatException("A visible sequence point has no valid document.");
                if (!expectedSourcePaths.Contains(path, StringComparer.Ordinal))
                    throw new BadImageFormatException("A visible sequence point references an undeclared source path.");
                visibleSequencePoints++;
                visiblePaths.Add(path);
            }
        }
        if (visibleSequencePoints == 0 || !visiblePaths.Contains(primarySourcePath))
            throw new BadImageFormatException("The portable PDB contains no visible source mapping.");
        if (expectedSourcePaths.Any(path => !documents.Values.Contains(path, StringComparer.Ordinal)))
            throw new BadImageFormatException("A declared source path is absent from the portable PDB.");

        return new ValidatedLoad(
            assemblySha256,
            pdbSha256,
            documents.Count,
            visibleSequencePoints,
            primarySourcePath,
            codeViewId.Guid.ToString("D"),
            codeViewId.Stamp,
            pdbId.Guid.ToString("D"),
            pdbId.Stamp,
            expectedAssemblyName,
            expectedSourcePaths);
    }

    private static bool IsCanonicalLogicalPath(string path, UTF8Encoding strictUtf8)
    {
        if (string.IsNullOrEmpty(path) || !path.IsNormalized(NormalizationForm.FormC) ||
            path[0] == '/' || path[^1] == '/' || path.IndexOfAny(['\\', ':', '%', '?', '#']) >= 0)
            return false;
        try
        {
            if (strictUtf8.GetByteCount(path) > 512) return false;
        }
        catch (EncoderFallbackException)
        {
            return false;
        }
        if (path.Any(character => character is '\0' or <= '\u001f' or '\u007f')) return false;
        return path.Split('/').All(segment => segment is not ("" or "." or ".."));
    }

    private static string SerializeLoadFailure(bool mutationStarted, string code, string message) =>
        JsonSerializer.Serialize(
            new AssemblyLoadResult(false, mutationStarted, null, new LoadError(code, message)),
            PreviewJsonContext.Default.AssemblyLoadResult);

    private static string SerializeStartFailure(
        string code, string message, RuntimeExceptionReport? failure = null) =>
        JsonSerializer.Serialize(
            new GameStartResult(false, "stopped", 0, false, null, false, false, 0,
                new LoadError(code, message), null, failure),
            PreviewJsonContext.Default.GameStartResult);

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
    // Preview runtime context descriptor returned by Ping (protocol version,
    // runtime identity, configuration/build flags, MonoGame identity). Product
    // attestation of the shipped runtime — not proof instrumentation. Wire
    // property names are unchanged.
    internal sealed record PreviewContextInfo(
        int ProtocolVersion,
        string Message,
        string RuntimeIdentity,
        int RuntimeStartupCount,
        int CallCount,
        string Configuration,
        bool PublishTrimmed,
        bool NativeAot,
        bool RunAOTCompilation,
        bool WasmEnableThreads,
        bool WasmBuildNative,
        string ExecutionMode,
        string MonoGameAssemblyName,
        string MonoGameAssemblyVersion,
        string MonoGameSourceSha256,
        string SafeMetadataType);

    // Compiled-binary supply-chain evidence for a loaded user assembly (assembly
    // and PDB SHA-256, byte lengths, source paths, CodeView/PDB identity).
    // Product binary-integrity evidence — not proof instrumentation. Wire
    // property names are unchanged.
    internal sealed record AssemblyLoadEvidence(
        string AssemblyFullName,
        string AssemblySimpleName,
        int AssemblyByteLength,
        int PdbByteLength,
        int DocumentCount,
        int VisibleSequencePointCount,
        string LogicalPath,
        string AssemblySha256,
        string PdbSha256,
        string CodeViewGuid,
        uint CodeViewStamp,
        string PortablePdbGuid,
        uint PortablePdbStamp,
        string ExpectedAssemblyName,
        string[] ExpectedSourcePaths);

    internal sealed record AssemblyLoadResult(
        bool Success,
        bool MutationStarted,
        AssemblyLoadEvidence? Proof,
        LoadError? Error);

    internal sealed record LoadError(string Code, string Message);
    internal sealed record GamePipelineResult(
        bool Success,
        string? GameTypeFullName,
        string? ConstructedTypeFullName,
        bool AssignableToGame,
        GameRunner.PlaygroundDiagnostic? Diagnostic,
        LoadError? Error,
        int ConstructionAttempts = 0,
        bool RetainedGame = false);
    internal sealed record GameTeardownResult(
        bool Success,
        bool HadGame,
        int DisposeAttempts,
        bool RetainedGame,
        LoadError? Error,
        bool AlreadyTornDown,
        int? FrameCount,
        int? ProofDisposeCount);
    internal sealed record GameStartResult(
        bool Success,
        string State,
        int RunAttempts,
        bool RunReturned,
        double? RunDurationMilliseconds,
        bool RetainedGame,
        bool Disposed,
        int DisposeAttempts,
        LoadError? Error,
        string? TerminationReason = null,
        RuntimeExceptionReport? Failure = null);
    internal sealed record GameRunStateResult(
        string State,
        int ConstructionAttempts,
        int RunAttempts,
        bool RunReturned,
        double? RunDurationMilliseconds,
        bool RetainedGame,
        bool Disposed,
        int DisposeAttempts,
        int? FrameCount,
        int? ProofDisposeCount,
        int? RunCount,
        int? StaticConstructorCount);
    private sealed record ValidatedLoad(
        string AssemblySha256,
        string PdbSha256,
        int DocumentCount,
        int VisibleSequencePointCount,
        string LogicalPath,
        string CodeViewGuid,
        uint CodeViewStamp,
        string PortablePdbGuid,
        uint PortablePdbStamp,
        string ExpectedAssemblyName,
        string[] ExpectedSourcePaths);
}

[JsonSourceGenerationOptions(JsonSerializerDefaults.Web)]
[JsonSerializable(typeof(PreviewExports.PreviewContextInfo))]
[JsonSerializable(typeof(PreviewExports.AssemblyLoadResult))]
[JsonSerializable(typeof(PreviewExports.GamePipelineResult))]
[JsonSerializable(typeof(PreviewExports.GameTeardownResult))]
[JsonSerializable(typeof(PreviewExports.GameStartResult))]
[JsonSerializable(typeof(PreviewExports.GameRunStateResult))]
[JsonSerializable(typeof(PreviewExports.AssetMountResult))]
[JsonSerializable(typeof(PreviewExports.AssetMountStateResult))]
[JsonSerializable(typeof(PreviewExports.AssetMetaEntry[]))]
[JsonSerializable(typeof(PreviewExports.AssetMountPhaseResult))]
[JsonSerializable(typeof(PreviewExports.AssetEntry[]))]
[JsonSerializable(typeof(RuntimeExceptionReport))]
[JsonSerializable(typeof(string[]))]
internal sealed partial class PreviewJsonContext : JsonSerializerContext;

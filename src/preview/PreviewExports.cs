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
        var proof = new PreviewContextProof(
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

        return JsonSerializer.Serialize(proof, PreviewJsonContext.Default.PreviewContextProof);
    }

    [JSExport]
    public static string Issue034FileSystemProbe()
    {
        var paths = new[]
        {
            "/issue034-controlled-canary.txt",
            "tests/security/fixtures/issue034-canary.txt",
            "/Users/issue034-controlled-canary.txt",
        };
        var results = paths.Select((path, index) =>
        {
            try
            {
                _ = File.ReadAllText(path);
                return new { probe = index, read = true, error = (string?)null };
            }
            catch (Exception exception)
            {
                return new
                {
                    probe = index,
                    read = false,
                    error = (string?)exception.GetType().Name
                };
            }
        }).ToArray();
        return JsonSerializer.Serialize(new
        {
            currentDirectory = Environment.CurrentDirectory,
            results,
            anyRead = results.Any(result => result.read),
        });
    }

    private static readonly object AssetMountGate = new();
    private static readonly Dictionary<string, byte[]> MountedAssets = new(StringComparer.Ordinal);
    private static readonly HashSet<string> CommittedMountIds = new(StringComparer.Ordinal);
    private static string _contentRootDirectory = "Content";
    private static bool _assetsMountedSuccessfully;
    private static bool _startupAdmitted;
    private static readonly byte[] Issue039GoodXnb =
    [
        0x58, 0x4e, 0x42, 0x62, 0x05, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x7a,
        0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x2e, 0x58, 0x6e,
        0x61, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2e,
        0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x2e, 0x54, 0x65, 0x78, 0x74,
        0x75, 0x72, 0x65, 0x32, 0x44, 0x52, 0x65, 0x61, 0x64, 0x65, 0x72, 0x2c,
        0x20, 0x4d, 0x6f, 0x6e, 0x6f, 0x47, 0x61, 0x6d, 0x65, 0x2e, 0x46, 0x72,
        0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2c, 0x20, 0x56, 0x65, 0x72,
        0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x33, 0x2e, 0x38, 0x2e, 0x35, 0x2e, 0x31,
        0x2c, 0x20, 0x43, 0x75, 0x6c, 0x74, 0x75, 0x72, 0x65, 0x3d, 0x6e, 0x65,
        0x75, 0x74, 0x72, 0x61, 0x6c, 0x2c, 0x20, 0x50, 0x75, 0x62, 0x6c, 0x69,
        0x63, 0x4b, 0x65, 0x79, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x6e, 0x75,
        0x6c, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x04, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x40, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff,
        0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff,
        0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff,
        0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff, 0xff, 0xc0, 0xcb, 0xff,
        0x80, 0x80, 0x80, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
        0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
    ];
    private static readonly byte[] Issue039WrongPlatformXnb =
    [
        0x58, 0x4e, 0x42, 0x64, 0x05, 0x00, 0xe0, 0x00, 0x00, 0x00, 0x01, 0x7a,
        0x4d, 0x69, 0x63, 0x72, 0x6f, 0x73, 0x6f, 0x66, 0x74, 0x2e, 0x58, 0x6e,
        0x61, 0x2e, 0x46, 0x72, 0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2e,
        0x43, 0x6f, 0x6e, 0x74, 0x65, 0x6e, 0x74, 0x2e, 0x54, 0x65, 0x78, 0x74,
        0x75, 0x72, 0x65, 0x32, 0x44, 0x52, 0x65, 0x61, 0x64, 0x65, 0x72, 0x2c,
        0x20, 0x4d, 0x6f, 0x6e, 0x6f, 0x47, 0x61, 0x6d, 0x65, 0x2e, 0x46, 0x72,
        0x61, 0x6d, 0x65, 0x77, 0x6f, 0x72, 0x6b, 0x2c, 0x20, 0x56, 0x65, 0x72,
        0x73, 0x69, 0x6f, 0x6e, 0x3d, 0x33, 0x2e, 0x38, 0x2e, 0x35, 0x2e, 0x31,
        0x2c, 0x20, 0x43, 0x75, 0x6c, 0x74, 0x75, 0x72, 0x65, 0x3d, 0x6e, 0x65,
        0x75, 0x74, 0x72, 0x61, 0x6c, 0x2c, 0x20, 0x50, 0x75, 0x62, 0x6c, 0x69,
        0x63, 0x4b, 0x65, 0x79, 0x54, 0x6f, 0x6b, 0x65, 0x6e, 0x3d, 0x6e, 0x75,
        0x6c, 0x6c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
        0x04, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00,
        0x40, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00, 0xff, 0x00, 0xff, 0x00, 0xff,
        0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff,
        0x00, 0xff, 0xff, 0xff, 0xff, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff,
        0xff, 0x80, 0x00, 0xff, 0x80, 0x00, 0xff, 0xff, 0xff, 0xc0, 0xcb, 0xff,
        0x80, 0x80, 0x80, 0xff, 0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
        0x64, 0x95, 0xed, 0xff, 0x64, 0x95, 0xed, 0xff,
    ];

    private static string? _pendingMountId;
    private static string? _pendingMountRoot;
    private static List<(string canonical, int byteLength, string sha256)>? _pendingMountPaths;
    private static readonly List<(string virtualPath, byte[] bytes, string sha256)> _stagedAssets = new();
    private static int _proofInjectWriteFailureAtIndex = -1;

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

            // Validate XNB content
            var validation = ContentValidator.Validate(bytes, pathResult.CanonicalPath!);
            if (!validation.Valid)
            {
                return AbortPendingMount(
                    "PREVIEW_LOAD_FAILED",
                    validation.DiagnosticMessage ?? "Content validation failed.",
                    validation.DiagnosticId,
                    validation.DiagnosticMessage);
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

            // Stage the asset (don't write yet)
            _stagedAssets.Add((virtualPath, bytes, sha256));

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

                    if (_proofInjectWriteFailureAtIndex == writtenPaths.Count)
                        throw new IOException("Injected proof write failure");

                    File.WriteAllBytes(virtualPath, bytes);
                    MountedAssets[virtualPath] = bytes;
                    writtenPaths.Add(virtualPath);
                }

                // All writes succeeded, commit the mount
                CommittedMountIds.Add(mountId!);
                _contentRootDirectory = rootDir;
                _assetsMountedSuccessfully = true;

                // Build mounted files proof
                var mountedFiles = new List<MountedFileProof>();
                var totalBytes = 0;
                foreach (var path in _pendingMountPaths)
                {
                    var vp = ContentPathNormalizer.ResolveVirtualPath(rootDir, path.canonical);
                    if (MountedAssets.ContainsKey(vp))
                    {
                        totalBytes += MountedAssets[vp].Length;
                        var h = Convert.ToHexString(
                            System.Security.Cryptography.SHA256.HashData(MountedAssets[vp])).ToLowerInvariant();
                        mountedFiles.Add(new MountedFileProof(path.canonical, vp, MountedAssets[vp].Length, h));
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

    /// Query game state counters for issue039 proof.
    /// Returns FrameCount, DisposeCount, RunCount, StaticConstructorCount from the
    /// loaded Game type's static properties (if any), plus GameRunner snapshot.
    [JSExport]
    public static string QueryIssue039State()
    {
        lock (LifecycleGate)
        {
            var runner = _gameRunner;
            if (runner is null)
            {
                return JsonSerializer.Serialize(
                    new Issue039StateResult("stopped", 0, 0, false, false, 0, null, null, null, null),
                    PreviewJsonContext.Default.Issue039StateResult);
            }
            var snapshot = runner.Snapshot();
            return JsonSerializer.Serialize(
                new Issue039StateResult(
                    snapshot.State,
                    snapshot.ConstructionAttempts,
                    snapshot.RunAttempts,
                    snapshot.RunReturned,
                    snapshot.Disposed,
                    snapshot.DisposeAttempts,
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "FrameCount"),
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "DisposeCount"),
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "RunCount"),
                    snapshot.GameType is null ? null : ReadProofCounter(snapshot.GameType, "StaticConstructorCount")),
                PreviewJsonContext.Default.Issue039StateResult);
        }
    }

    [JSExport]
    public static string RunContentValidatorSelfTest()
        => JsonSerializer.Serialize(
            ContentValidator.RunSelfTestCases(),
            (JsonTypeInfo<Dictionary<string, ContentValidator.SelfTestCaseResult>>)
            PreviewJsonContext.Default.GetTypeInfo(typeof(Dictionary<string, ContentValidator.SelfTestCaseResult>))!);

    [JSExport]
    public static string RunAtomicMountSelfTest()
    {
        static AssetMountPhaseResult? DeserializePhase(string json) =>
            JsonSerializer.Deserialize(json, PreviewJsonContext.Default.AssetMountPhaseResult);

        static AssetMountResult? DeserializeMount(string json) =>
            JsonSerializer.Deserialize(json, PreviewJsonContext.Default.AssetMountResult);

        ClearAllMountState();
        try
        {
            var goodSha = Convert.ToHexString(SHA256.HashData(Issue039GoodXnb)).ToLowerInvariant();
            var badSha = Convert.ToHexString(SHA256.HashData(Issue039WrongPlatformXnb)).ToLowerInvariant();
            var firstMountId = "issue039-atomic-selftest-1";
            var staleMountId = "issue039-atomic-selftest-2";
            var replacementMountId = "issue039-atomic-selftest-3";

            var firstMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/good_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                    new AssetMetaEntry("textures/bad_fixture.xnb", Issue039WrongPlatformXnb.Length, badSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            var firstPhase = DeserializePhase(MountContentAssets(firstMountId, "Content", firstMetadata));
            var firstStage = DeserializePhase(MountSingleAsset(
                firstMountId,
                "Content",
                "textures/good_fixture.xnb",
                Issue039GoodXnb.ToArray(),
                goodSha));
            var secondStage = DeserializeMount(MountSingleAsset(
                firstMountId,
                "Content",
                "textures/bad_fixture.xnb",
                Issue039WrongPlatformXnb.ToArray(),
                badSha));

            int mountedCountAfterAbort;
            int stagedCountAfterAbort;
            bool pendingMountClearedAfterAbort;
            lock (AssetMountGate)
            {
                mountedCountAfterAbort = MountedAssets.Count;
                stagedCountAfterAbort = _stagedAssets.Count;
                pendingMountClearedAfterAbort = _pendingMountId is null;
            }

            var rollbackMountId = "issue039-atomic-selftest-rollback";
            var rollbackVirtualPath1 = ContentPathNormalizer.ResolveVirtualPath("Content", "textures/rollback_a.xnb");
            var rollbackVirtualPath2 = ContentPathNormalizer.ResolveVirtualPath("Content", "textures/rollback_b.xnb");
            var rollbackMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/rollback_a.xnb", Issue039GoodXnb.Length, goodSha),
                    new AssetMetaEntry("textures/rollback_b.xnb", Issue039GoodXnb.Length, goodSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            bool rollbackAttempted;
            bool rollbackFirstFileDeleted;
            bool rollbackMountedAssetsZero;
            bool rollbackCommittedIdAbsent;
            bool rollbackMountedSuccessUnchanged;
            var mountedSuccessBeforeRollback = _assetsMountedSuccessfully;
            try
            {
                _proofInjectWriteFailureAtIndex = 1;
                var rollbackPhase = DeserializePhase(MountContentAssets(rollbackMountId, "Content", rollbackMetadata));
                var rollbackStage1 = DeserializePhase(MountSingleAsset(
                    rollbackMountId,
                    "Content",
                    "textures/rollback_a.xnb",
                    Issue039GoodXnb.ToArray(),
                    goodSha));
                var rollbackStage2 = DeserializePhase(MountSingleAsset(
                    rollbackMountId,
                    "Content",
                    "textures/rollback_b.xnb",
                    Issue039GoodXnb.ToArray(),
                    goodSha));
                var rollbackCommit = DeserializeMount(CommitMount(rollbackMountId));
                rollbackAttempted =
                    rollbackPhase?.Success == true &&
                    rollbackStage1?.Success == true &&
                    rollbackStage2?.Success == true &&
                    rollbackCommit?.Success == false &&
                    rollbackCommit.Error?.Code == "FILESYSTEM_ERROR";
                lock (AssetMountGate)
                {
                    rollbackMountedAssetsZero = MountedAssets.Count == 0;
                    rollbackCommittedIdAbsent = !CommittedMountIds.Contains(rollbackMountId);
                    rollbackMountedSuccessUnchanged = _assetsMountedSuccessfully == mountedSuccessBeforeRollback;
                }
                rollbackFirstFileDeleted =
                    !File.Exists(rollbackVirtualPath1) &&
                    !File.Exists(rollbackVirtualPath2);
            }
            finally
            {
                _proofInjectWriteFailureAtIndex = -1;
            }

            // Test 4: Startup-admitted race prevention
            // Validate and stage an asset, then mark startup admitted
            // CommitMount must reject with zero writes and clear staging
            bool startupCommitRejected;
            bool startupMountedZero;
            bool startupStagingCleared;
            bool startupPendingCleared;
            {
                var raceId = "issue039-atomic-selftest-race";
                var raceMetadata = JsonSerializer.Serialize(
                    new[]
                    {
                        new AssetMetaEntry("textures/race_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                    },
                    PreviewJsonContext.Default.AssetMetaEntryArray);
                var racePhase = DeserializePhase(MountContentAssets(raceId, "Content", raceMetadata));
                var raceStage = DeserializePhase(MountSingleAsset(
                    raceId, "Content", "textures/race_fixture.xnb",
                    Issue039GoodXnb.ToArray(), goodSha));
                // Simulate startup admission
                Volatile.Write(ref _startupAdmitted, true);
                var raceCommit = DeserializeMount(CommitMount(raceId));
                startupCommitRejected = raceCommit?.Success == false &&
                    raceCommit.Error?.Code == "INVALID_STATE";
                lock (AssetMountGate)
                {
                    startupMountedZero = MountedAssets.Count == 0;
                    startupStagingCleared = _stagedAssets.Count == 0;
                    startupPendingCleared = _pendingMountId is null;
                }
                Volatile.Write(ref _startupAdmitted, false); // reset for remaining tests
            }

            var staleMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/stale_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            var stalePhase = DeserializePhase(MountContentAssets(staleMountId, "Content", staleMetadata));
            var staleStage = DeserializePhase(MountSingleAsset(
                staleMountId,
                "Content",
                "textures/stale_fixture.xnb",
                Issue039GoodXnb.ToArray(),
                goodSha));

            var replacementMetadata = JsonSerializer.Serialize(
                new[]
                {
                    new AssetMetaEntry("textures/replacement_fixture.xnb", Issue039GoodXnb.Length, goodSha),
                },
                PreviewJsonContext.Default.AssetMetaEntryArray);
            var replacementPhase = DeserializePhase(MountContentAssets(
                replacementMountId,
                "Content",
                replacementMetadata));
            var staleCommit = DeserializeMount(CommitMount(staleMountId));

            bool staleStagingCleared;
            string? pendingMountIdAfterReplacement;
            int mountedCountAfterReplacement;
            int stagedCountAfterReplacement;
            lock (AssetMountGate)
            {
                staleStagingCleared = _stagedAssets.Count == 0 && _pendingMountId == replacementMountId;
                pendingMountIdAfterReplacement = _pendingMountId;
                mountedCountAfterReplacement = MountedAssets.Count;
                stagedCountAfterReplacement = _stagedAssets.Count;
            }

            return JsonSerializer.Serialize(
                new AtomicMountSelfTestResult(
                    firstPhase?.Success == true && firstPhase.Phase == "validated",
                    firstStage?.Success == true && firstStage.Phase == "staging" && firstStage.AssetCount == 1,
                    secondStage?.Success == false &&
                        secondStage.Error?.Code == "PREVIEW_LOAD_FAILED" &&
                        secondStage.Diagnostic?.Id == "PG0010_CONTENT_PLATFORM_MISMATCH",
                    mountedCountAfterAbort,
                    stagedCountAfterAbort,
                    pendingMountClearedAfterAbort,
                    stalePhase?.Success == true && stalePhase.Phase == "validated",
                    staleStage?.Success == true && staleStage.Phase == "staged" && staleStage.AssetCount == 1,
                    replacementPhase?.Success == true && replacementPhase.Phase == "validated",
                    rollbackAttempted,
                    rollbackFirstFileDeleted,
                    rollbackMountedAssetsZero,
                    rollbackCommittedIdAbsent,
                    rollbackMountedSuccessUnchanged,
                    staleStagingCleared,
                    staleCommit?.Success == false && staleCommit.Error?.Code == "INVALID_STATE",
                    mountedCountAfterReplacement,
                    stagedCountAfterReplacement,
                    pendingMountIdAfterReplacement,
                    startupCommitRejected,
                    startupMountedZero,
                    startupStagingCleared,
                    startupPendingCleared),
                PreviewJsonContext.Default.AtomicMountSelfTestResult);
        }
        finally
        {
            ClearAllMountState();
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

    private static void ClearAllMountState()
    {
        lock (AssetMountGate)
        {
            foreach (var path in MountedAssets.Keys.ToArray())
            {
                try { File.Delete(path); } catch { /* best effort cleanup */ }
            }
            MountedAssets.Clear();
            CommittedMountIds.Clear();
            _assetsMountedSuccessfully = false;
            Volatile.Write(ref _startupAdmitted, false);
            _contentRootDirectory = "Content";
            ResetPendingMountState();
        }
    }

    [JSExport]
    public static string RunForwardingTextWriterSelfTest()
    {
        var received = new List<string>();
        ForwardingTextWriter? writer = null;
        writer = new ForwardingTextWriter(text =>
        {
            received.Add(text);
            if (text == "reenter")
                writer!.WriteLine("nested");
        });
        writer.Write('a');
        writer.Write("b\r");
        writer.Write('\n');
        writer.WriteLine("");
        writer.Write("partial");
        writer.Flush();
        writer.WriteLine("reenter");
        writer.WriteLine(string.Concat(Enumerable.Repeat("🙂", 5_000)));
        writer.Dispose();
        var expected = new[] {
            "ab", "", "partial", "reenter", "nested",
            string.Concat(Enumerable.Repeat("🙂", 4_096)),
            string.Concat(Enumerable.Repeat("🙂", 904)),
        };
        return JsonSerializer.Serialize(new {
            success = received.SequenceEqual(expected),
            eventCount = received.Count,
            utf8ByteLengths = received.Select(Encoding.UTF8.GetByteCount).ToArray(),
        });
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
                    new AssemblyLoadProof(
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
                failure),
            PreviewJsonContext.Default.GameStartResult);
    }

    [JSExport]
    public static string RunGameRunnerBehavioralSelfTest()
    {
        var game = new RunnerSelfTestGame();
        GameRunner? runner = null;
        GameRunner.StartResult? competing = null;
        GameRunner.DisposalResult? racingTeardown = null;
        var callbacks = 0;
        runner = new GameRunner(game, _ =>
        {
            callbacks++;
            competing = runner!.RunGame();
            racingTeardown = runner.Teardown();
        });
        var admitted = runner.RunGame();
        var repeatedTeardown = runner.Teardown();
        var fatal = new Dictionary<string, bool>
        {
            [nameof(OutOfMemoryException)] = GameRunner.IsFatal(new OutOfMemoryException()),
            [nameof(StackOverflowException)] = GameRunner.IsFatal(new StackOverflowException()),
            [nameof(AccessViolationException)] = GameRunner.IsFatal(new AccessViolationException()),
            [nameof(AppDomainUnloadedException)] = GameRunner.IsFatal(new AppDomainUnloadedException()),
            [nameof(CannotUnloadAppDomainException)] = GameRunner.IsFatal(new CannotUnloadAppDomainException()),
            [nameof(InvalidOperationException)] = GameRunner.IsFatal(new InvalidOperationException()),
        };
        return JsonSerializer.Serialize(
            new RunnerBehavioralSelfTest(
                callbacks,
                admitted.RunAttempts,
                admitted.RetainedGame,
                admitted.Disposed,
                competing?.Error?.Code,
                racingTeardown?.DisposeAttempts ?? 0,
                repeatedTeardown.HadGame,
                game.DisposeCount,
                fatal),
            PreviewJsonContext.Default.RunnerBehavioralSelfTest);
    }

    [JSExport]
    public static string QueryRunState(bool includeProofGameCounters)
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
        int? frameCount = null;
        int? proofDisposeCount = null;
        int? runCount = null;
        int? staticConstructorCount = null;
        if (includeProofGameCounters && snapshot.GameType is not null)
        {
            frameCount = ReadProofCounter(snapshot.GameType, "FrameCount");
            proofDisposeCount = ReadProofCounter(snapshot.GameType, "DisposeCount");
            runCount = ReadProofCounter(snapshot.GameType, "RunCount");
            staticConstructorCount = ReadProofCounter(snapshot.GameType, "StaticConstructorCount");
        }
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
                frameCount,
                proofDisposeCount,
                runCount,
                staticConstructorCount),
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
            return JsonSerializer.Serialize(
                new GameTeardownResult(
                    disposal.Success,
                    disposal.HadGame,
                    disposal.DisposeAttempts,
                    disposal.RetainedGame,
                    disposal.Error is null ? null : new LoadError(disposal.Error.Code, disposal.Error.Message),
                    false,
                    gameType is null ? null : ReadProofCounter(gameType, "FrameCount"),
                    gameType is null ? null : ReadProofCounter(gameType, "DisposeCount")),
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
            failure = failure with {
                CleanupSucceeded = teardown?.Success == true,
                DisposeAttempts = teardown?.DisposeAttempts,
                FrameCount = _lastStoppedGameType is null
                    ? null : ReadProofCounter(_lastStoppedGameType, "FrameCount"),
                UpdateCount = _lastStoppedGameType is null
                    ? null : ReadProofCounter(_lastStoppedGameType, "UpdateCount"),
                ProofDisposeCount = _lastStoppedGameType is null
                    ? null : ReadProofCounter(_lastStoppedGameType, "DisposeCount"),
                CallbackAfterDisposedCount = _lastStoppedGameType is null
                    ? null : ReadProofCounter(_lastStoppedGameType, "CallbackAfterDisposedCount"),
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

    [JSExport]
    public static string QueryStoppedGameProof()
    {
        var gameType = _lastStoppedGameType;
        return JsonSerializer.Serialize(
            new GameStoppedProof(
                gameType is null ? null : ReadProofCounter(gameType, "FrameCount"),
                gameType is null ? null : ReadProofCounter(gameType, "UpdateCount"),
                gameType is null ? null : ReadProofCounter(gameType, "DisposeCount"),
                gameType is null ? null : ReadProofCounter(gameType, "CallbackAfterDisposedCount"),
                gameType is null ? null : ReadProofCounter(gameType, "AudioCreateCount"),
                gameType is null ? null : ReadProofCounter(gameType, "AudioPlayCount"),
                gameType is null ? null : ReadProofCounter(gameType, "AudioDisposeCount")),
            PreviewJsonContext.Default.GameStoppedProof);
    }

    private static bool IsExpectedAssemblyLoadFailure(Exception exception) =>
        exception is ArgumentException or
            BadImageFormatException or
            FileLoadException or
            FileNotFoundException or
            TypeLoadException or
            NotSupportedException;

    private static int? ReadProofCounter(Type type, string name)
    {
        try
        {
            var property = type.GetProperty(
                name, BindingFlags.Public | BindingFlags.Static | BindingFlags.FlattenHierarchy);
            return property?.PropertyType == typeof(int) ? (int?)property.GetValue(null) : null;
        }
        catch (Exception exception) when (!GameRunner.IsFatal(exception))
        {
            return null;
        }
    }

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
                new LoadError(code, message), failure),
            PreviewJsonContext.Default.GameStartResult);

    internal sealed record AssetEntry(string Path, byte[] Bytes);
    internal sealed record AssetMetaEntry(string Path, int ByteLength, string Sha256);
    internal sealed record AssetMountPhaseResult(
        bool Success, string Phase, int AssetCount, string RootDir);
    internal sealed record MountedFileProof(
        string AssetPath, string VirtualPath, int ByteLength, string Sha256);
    internal sealed record MountDiagnostic(string Id, string Message);
    internal sealed record AssetMountResult(
        bool Success,
        string? MountId,
        int MountedFileCount,
        int MountedByteLength,
        string? ContentRootDirectory,
        MountedFileProof[]? MountedFiles,
        LoadError? Error,
        MountDiagnostic? Diagnostic = null);
    internal sealed record AssetMountStateResult(
        bool Mounted,
        int MountedFileCount,
        int MountedByteLength,
        int CommittedMountCount,
        string ContentRootDirectory,
        string[] CommittedMountIds);
    internal sealed record AtomicMountSelfTestResult(
        bool InitialMountValidated,
        bool FirstAssetStaged,
        bool SecondAssetFailed,
        int MountedCountAfterAbort,
        int StagedCountAfterAbort,
        bool PendingMountClearedAfterAbort,
        bool StaleMountValidated,
        bool StaleAssetStaged,
        bool ReplacementMountValidated,
        bool RollbackAttempted,
        bool RollbackFirstFileDeleted,
        bool RollbackMountedAssetsZero,
        bool RollbackCommittedIdAbsent,
        bool RollbackMountedSuccessUnchanged,
        bool StaleStagingCleared,
        bool StaleCommitRejected,
        int MountedCountAfterReplacement,
        int StagedCountAfterReplacement,
        string? PendingMountIdAfterReplacement,
        bool StartupCommitRejected,
        bool StartupMountedZero,
        bool StartupStagingCleared,
        bool StartupPendingCleared);
    internal sealed record Issue039StateResult(
        string State,
        int ConstructionAttempts,
        int RunAttempts,
        bool RunReturned,
        bool Disposed,
        int DisposeAttempts,
        int? FrameCount,
        int? DisposeCount,
        int? RunCount,
        int? StaticConstructorCount);
    internal sealed record PreviewContextProof(
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

    internal sealed record AssemblyLoadProof(
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
        AssemblyLoadProof? Proof,
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
    internal sealed record RunnerBehavioralSelfTest(
        int RunCallbacks,
        int RunAttempts,
        bool RetainedGame,
        bool Disposed,
        string? CompetingErrorCode,
        int RacingDisposeAttempts,
        bool RepeatedTeardownHadGame,
        int GameDisposeCount,
        Dictionary<string, bool> FatalClassifications);
    internal sealed record GameStoppedProof(
        int? FrameCount,
        int? UpdateCount,
        int? DisposeCount,
        int? CallbackAfterDisposedCount,
        int? AudioCreateCount,
        int? AudioPlayCount,
        int? AudioDisposeCount);
    private sealed class RunnerSelfTestGame : Game
    {
        public int DisposeCount { get; private set; }

        protected override void Dispose(bool disposing)
        {
            if (disposing) DisposeCount++;
            base.Dispose(disposing);
        }
    }
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
[JsonSerializable(typeof(PreviewExports.PreviewContextProof))]
[JsonSerializable(typeof(PreviewExports.AssemblyLoadResult))]
[JsonSerializable(typeof(PreviewExports.GamePipelineResult))]
[JsonSerializable(typeof(PreviewExports.GameTeardownResult))]
[JsonSerializable(typeof(PreviewExports.GameStartResult))]
[JsonSerializable(typeof(PreviewExports.GameRunStateResult))]
[JsonSerializable(typeof(PreviewExports.RunnerBehavioralSelfTest))]
[JsonSerializable(typeof(PreviewExports.GameStoppedProof))]
[JsonSerializable(typeof(PreviewExports.AssetMountResult))]
[JsonSerializable(typeof(PreviewExports.AssetMountStateResult))]
[JsonSerializable(typeof(PreviewExports.AtomicMountSelfTestResult))]
[JsonSerializable(typeof(PreviewExports.Issue039StateResult))]
[JsonSerializable(typeof(PreviewExports.AssetMetaEntry[]))]
[JsonSerializable(typeof(PreviewExports.AssetMountPhaseResult))]
[JsonSerializable(typeof(PreviewExports.AssetEntry[]))]
[JsonSerializable(typeof(Dictionary<string, ContentValidator.SelfTestCaseResult>))]
[JsonSerializable(typeof(RuntimeExceptionReport))]
[JsonSerializable(typeof(string[]))]
internal sealed partial class PreviewJsonContext : JsonSerializerContext;

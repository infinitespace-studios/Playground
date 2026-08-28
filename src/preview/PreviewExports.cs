using System.Reflection;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices.JavaScript;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
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

    [JSImport("globalThis.__playgroundForwardOutput")]
    internal static partial void ForwardOutput(
        string source, string stream, string category, string text);

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
                        validated.ExpectedAssemblyName),
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
                InstallConsoleCapture();
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
                construction.Error?.Message ?? "The Game subclass could not be constructed.");
        var start = runner.RunGame();
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
                start.Error is null ? null : new LoadError(start.Error.Code, start.Error.Message)),
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
        => StopGameCore();

    [JSExport]
    public static string StopGame()
        => StopGameCore();

    private static string StopGameCore()
    {
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
            expectedAssemblyName);
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

    private static string SerializeStartFailure(string code, string message) =>
        JsonSerializer.Serialize(
            new GameStartResult(false, "stopped", 0, false, null, false, false, 0,
                new LoadError(code, message)),
            PreviewJsonContext.Default.GameStartResult);

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
        string ExpectedAssemblyName);

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
        LoadError? Error);
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
        string ExpectedAssemblyName);
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
[JsonSerializable(typeof(string[]))]
internal sealed partial class PreviewJsonContext : JsonSerializerContext;

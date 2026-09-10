using System.Runtime.InteropServices.JavaScript;
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

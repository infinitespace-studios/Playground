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
    private const string MonoGameSourceSha256 = "9d2845d17767ffa295aed45f52d57bf9bc0f73b4e02cee8ac3cbe7502a0be836";
    private static readonly string RuntimeIdentity = Guid.NewGuid().ToString("D");
    private static readonly object LifecycleGate = new();
    private static int _callCount;
    private static int _loadState;
    private static GameRunner? _gameRunner;

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
    public static string TeardownGame()
    {
        lock (LifecycleGate)
        {
            var runner = Interlocked.Exchange(ref _gameRunner, null);
            var previousState = Interlocked.Exchange(ref _loadState, 4);
            if (runner is null)
            {
                return JsonSerializer.Serialize(
                    new GameTeardownResult(true, false, 0, false, null, previousState == 4),
                    PreviewJsonContext.Default.GameTeardownResult);
            }

            var disposal = runner.Teardown();
            return JsonSerializer.Serialize(
                new GameTeardownResult(
                    disposal.Success,
                    disposal.HadGame,
                    disposal.DisposeAttempts,
                    disposal.RetainedGame,
                    disposal.Error is null ? null : new LoadError(disposal.Error.Code, disposal.Error.Message),
                    false),
                PreviewJsonContext.Default.GameTeardownResult);
        }
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
        bool AlreadyTornDown);
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
[JsonSerializable(typeof(string[]))]
internal sealed partial class PreviewJsonContext : JsonSerializerContext;

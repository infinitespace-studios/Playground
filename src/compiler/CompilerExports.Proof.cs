using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis.CSharp;

namespace Playground.Compiler;

// Proof-only compiler surface. This compilation unit is included ONLY when the
// compiler is built/staged for the PROOF profile (MONOGAME_FRONTEND_PROFILE=proof
// selects the `MonoGameCompilerProof` MSBuild constant/item in the csproj). The
// default PRODUCT publish never compiles this file, so the shipped compiler wasm
// carries none of these JSExports, proof records, or retention-proof authorizers.
//
// Everything here is proof/diagnostics instrumentation: the persistent-context
// `Ping` handshake proof, the inline base64 `Compile` reference/diagnostics
// surface (the product compile path is the retained binary transfer:
// `CompileAndRetain` → `ConsumeAssembly`/`ConsumePdb` → `AbortRetained`), and the
// behavioral retention-proof authorizers (`AuthorizeRetentionProof`,
// `CompleteRetentionProof`, `ConfigureNextRetentionTestLease`,
// `GetRetentionState`). It reaches into the SAME `CompilerExports` partial as the
// product runtime, so it observes product retention state without duplicating any
// product lifecycle code.
public static partial class CompilerExports
{
    private const string ExpectedRoslynPackageVersion = "4.12.0";
    private static readonly string RuntimeIdentity = Guid.NewGuid().ToString("D");
    private static int _callCount;
    private static bool _retentionProofAuthorized;

    [JSExport]
    public static string Ping()
    {
        var roslynAssembly = typeof(CSharpSyntaxTree).Assembly;
        var compilationType = typeof(CSharpCompilation);

        var proof = new CompilerContextProof(
            ProtocolVersion: 1,
            Message: "compiler-context-alive",
            Call: ++_callCount,
            RuntimeIdentity,
            RuntimeStartupCount: 1,
            RoslynAssembly: roslynAssembly.GetName().Name!,
            RoslynAssemblyVersion: roslynAssembly.GetName().Version!.ToString(),
            RoslynPackageVersion: ExpectedRoslynPackageVersion,
            RoslynCompilationType: compilationType.FullName!);

        return JsonSerializer.Serialize(proof, CompilerProofJsonContext.Default.CompilerContextProof);
    }

    [JSExport]
    public static string Compile(string? requestJson)
    {
        if (requestJson is null)
        {
            return SerializeError("MALFORMED_PAYLOAD", "The compilation request must not be null.");
        }

        if (requestJson.Length > MaxRequestJsonBytes)
        {
            return SerializeError("MESSAGE_TOO_LARGE", "The compilation request exceeds the 32 MiB JSON limit.");
        }

        try
        {
            if (StrictUtf8.GetByteCount(requestJson) > MaxRequestJsonBytes)
            {
                return SerializeError("MESSAGE_TOO_LARGE", "The compilation request exceeds the 32 MiB JSON limit.");
            }
        }
        catch (EncoderFallbackException)
        {
            return SerializeError("MALFORMED_PAYLOAD", "The compilation request contains invalid Unicode.");
        }

        CompileRequest? request;
        try
        {
            request = JsonSerializer.Deserialize(
                requestJson,
                CompilerJsonContext.Default.CompileRequest);
        }
        catch (JsonException)
        {
            return SerializeError(
                "MALFORMED_PAYLOAD",
                "The compilation request JSON is malformed or missing required fields.");
        }

        var validationError = ValidateRequest(request);
        if (validationError is not null)
        {
            return SerializeError(validationError.Code, validationError.Message);
        }

        CompilationResult result;
        try
        {
            result = CompilationService.Compile(request!.Sources!, BrowserMetadataReferences.Allowlisted);
        }
        catch (PlatformNotSupportedException exception)
        {
            return SerializeError(
                "INTERNAL_ERROR",
                $"Compilation used an unsupported browser runtime operation: {exception.Message}");
        }

        if (result.Success)
        {
            if (result.Assembly!.Length > MaxAssemblyBytes)
            {
                return SerializeError(
                    "ASSEMBLY_TOO_LARGE",
                    "The emitted assembly exceeds the 8 MiB limit.",
                    result.AssemblyName);
            }

            if (result.Pdb!.Length > MaxPdbBytes)
            {
                return SerializeError(
                    "PDB_TOO_LARGE",
                    "The emitted portable PDB exceeds the 8 MiB limit.",
                    result.AssemblyName);
            }

            if (checked(result.Assembly.Length + result.Pdb.Length) > MaxBinaryBytes)
            {
                return SerializeError(
                    "BINARY_PAYLOAD_TOO_LARGE",
                    "The emitted assembly and portable PDB exceed the 12 MiB aggregate limit.",
                    result.AssemblyName);
            }
        }

        var response = result.Success
            ? new CompileResponse(
                true,
                result.AssemblyName,
                Convert.ToBase64String(result.Assembly!),
                Convert.ToBase64String(result.Pdb!),
                result.Assembly!.Length,
                result.Pdb!.Length,
                result.Diagnostics,
                result.Validity,
                CompilationSettingsProof.V1,
                null)
            : new CompileResponse(
                false,
                result.AssemblyName,
                null,
                null,
                0,
                0,
                result.Diagnostics,
                result.Validity,
                CompilationSettingsProof.V1,
                new CompileError("COMPILE_FAILED", "Compilation failed; no binaries were returned."));

        return JsonSerializer.Serialize(response, CompilerProofJsonContext.Default.CompileResponse);
    }

    [JSExport]
    public static bool AuthorizeRetentionProof()
    {
        lock (RetainedLock)
        {
            if (_retained is not null || _retentionProofAuthorized) return false;
            _retentionProofAuthorized = true;
            return true;
        }
    }

    [JSExport]
    public static void CompleteRetentionProof()
    {
        lock (RetainedLock)
        {
            _nextRetentionTestLease = null;
            _retentionProofAuthorized = false;
        }
    }

    [JSExport]
    public static bool ConfigureNextRetentionTestLease(int milliseconds)
    {
        lock (RetainedLock)
        {
            if (!_retentionProofAuthorized || _retained is not null ||
                _nextRetentionTestLease is not null ||
                milliseconds is < 100 or > 1000) return false;
            _nextRetentionTestLease = TimeSpan.FromMilliseconds(milliseconds);
            return true;
        }
    }

    [JSExport]
    public static string GetRetentionState()
    {
        lock (RetainedLock)
        {
            return JsonSerializer.Serialize(
                new RetentionState(
                    _retained is null ? 0 : 1,
                    _retained is null ? 0 : _retained.Assembly.Length + _retained.Pdb.Length,
                    _retained?.CompileId,
                    _retained?.CorrelationId),
                CompilerProofJsonContext.Default.RetentionState);
        }
    }

    private static string SerializeError(string code, string message, string assemblyName = "")
    {
        var response = new CompileResponse(
            false,
            assemblyName,
            null,
            null,
            0,
            0,
            Array.Empty<CompilerDiagnostic>(),
            null,
            CompilationSettingsProof.V1,
            new CompileError(code, message));
        return JsonSerializer.Serialize(response, CompilerProofJsonContext.Default.CompileResponse);
    }

    internal sealed record CompilerContextProof(
        int ProtocolVersion,
        string Message,
        int Call,
        string RuntimeIdentity,
        int RuntimeStartupCount,
        string RoslynAssembly,
        string RoslynAssemblyVersion,
        string RoslynPackageVersion,
        string RoslynCompilationType);

    internal sealed record CompilationSettingsProof(
        string LanguageVersion,
        string OutputKind,
        string Optimization,
        string DebugInformationFormat,
        bool AllowUnsafe,
        string Nullable,
        bool Deterministic,
        int WarningLevel,
        bool WarningsAsErrors)
    {
        public static CompilationSettingsProof V1 { get; } = new(
            "13.0",
            "dynamicallyLinkedLibrary",
            "debug",
            "portablePdb",
            false,
            "disable",
            true,
            CompilationService.WarningLevel,
            false);
    }

    internal sealed record CompileResponse(
        bool Success,
        string AssemblyName,
        string? AssemblyBase64,
        string? PdbBase64,
        int AssemblyByteLength,
        int PdbByteLength,
        IReadOnlyList<CompilerDiagnostic> Diagnostics,
        CompilationValidity? Validity,
        CompilationSettingsProof Settings,
        CompileError? Error);

    internal sealed record RetentionState(
        int RetainedCount, int RetainedBytes, string? CompileId, string? CorrelationId);
}

[JsonSourceGenerationOptions(
    JsonSerializerDefaults.Web,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(CompilerExports.CompilerContextProof))]
[JsonSerializable(typeof(CompilerExports.CompileResponse))]
[JsonSerializable(typeof(CompilerExports.RetentionState))]
internal sealed partial class CompilerProofJsonContext : JsonSerializerContext;

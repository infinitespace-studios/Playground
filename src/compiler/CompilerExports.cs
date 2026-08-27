using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices.JavaScript;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Playground.Compiler;

public static partial class CompilerExports
{
    private const int MaxRequestJsonBytes = 32 * 1024 * 1024;
    private const int MaxSourceFiles = 64;
    private const int MaxPathBytes = 512;
    private const int MaxSourceBytes = 1024 * 1024;
    private const int MaxAggregateSourceBytes = 4 * 1024 * 1024;
    private const int MaxAssemblyBytes = 8 * 1024 * 1024;
    private const int MaxPdbBytes = 8 * 1024 * 1024;
    private const int MaxBinaryBytes = 12 * 1024 * 1024;
    private const string ExpectedRoslynPackageVersion = "4.12.0";
    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: true);
    private static readonly string RuntimeIdentity = Guid.NewGuid().ToString("D");
    private static int _callCount;

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

        return JsonSerializer.Serialize(proof, CompilerJsonContext.Default.CompilerContextProof);
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

        return JsonSerializer.Serialize(response, CompilerJsonContext.Default.CompileResponse);
    }

    private static ValidationFailure? ValidateRequest(CompileRequest? request)
    {
        if (request is null)
        {
            return new("MALFORMED_PAYLOAD", "The compilation request must be a JSON object.");
        }

        if (request.ProtocolVersion is null)
        {
            return new("MISSING_PROTOCOL_VERSION", "protocolVersion is required.");
        }

        if (request.ProtocolVersion != 1)
        {
            return new("UNSUPPORTED_PROTOCOL_VERSION", "protocolVersion must be 1.");
        }

        if (request.Sources is null || request.Sources.Count == 0)
        {
            return new("MALFORMED_PAYLOAD", "At least one source is required.");
        }

        if (request.Sources.Count > MaxSourceFiles)
        {
            return new("TOO_MANY_SOURCE_FILES", "A compilation request may contain at most 64 sources.");
        }

        var paths = new HashSet<string>(StringComparer.Ordinal);
        var aggregateSourceBytes = 0;
        for (var index = 0; index < request.Sources.Count; index++)
        {
            var source = request.Sources[index];
            if (source is null || string.IsNullOrEmpty(source.Path))
            {
                return new(
                    "MALFORMED_PAYLOAD",
                    $"sources[{index}].path must be a non-empty string.");
            }

            int pathBytes;
            try
            {
                pathBytes = StrictUtf8.GetByteCount(source.Path);
            }
            catch (EncoderFallbackException)
            {
                return new(
                    "MALFORMED_PAYLOAD",
                    $"sources[{index}].path contains invalid Unicode.");
            }

            if (pathBytes > MaxPathBytes)
            {
                return new(
                    "FIELD_TOO_LARGE",
                    $"sources[{index}].path exceeds the 512-byte UTF-8 limit.");
            }

            if (!IsCanonicalLogicalPath(source.Path))
            {
                return new(
                    "MALFORMED_PAYLOAD",
                    $"sources[{index}].path must be a canonical logical path.");
            }

            if (!paths.Add(source.Path))
            {
                return new(
                    "MALFORMED_PAYLOAD",
                    $"sources[{index}].path duplicates another canonical source path.");
            }

            if (string.IsNullOrEmpty(source.Text))
            {
                return new(
                    "MALFORMED_PAYLOAD",
                    $"sources[{index}].text must be a non-empty string.");
            }

            int sourceBytes;
            try
            {
                sourceBytes = StrictUtf8.GetByteCount(source.Text);
            }
            catch (EncoderFallbackException)
            {
                return new(
                    "MALFORMED_PAYLOAD",
                    $"sources[{index}].text contains invalid Unicode.");
            }

            if (sourceBytes > MaxSourceBytes)
            {
                return new(
                    "SOURCE_TOO_LARGE",
                    $"sources[{index}].text exceeds the 1 MiB UTF-8 limit.");
            }

            aggregateSourceBytes = checked(aggregateSourceBytes + sourceBytes);
            if (aggregateSourceBytes > MaxAggregateSourceBytes)
            {
                return new(
                    "SOURCE_TOO_LARGE",
                    "Aggregate source text exceeds the 4 MiB UTF-8 limit.");
            }
        }

        var settings = request.Settings;
        if (settings is not null &&
            (settings.LanguageVersion != "13.0" ||
             settings.Nullable != "disable" ||
             settings.Optimization != "debug" ||
             settings.AllowUnsafe ||
             settings.WarningsAsErrors))
        {
            return new(
                "MALFORMED_PAYLOAD",
                "settings must match the fixed protocol v1 compiler settings.");
        }

        return null;
    }

    private static bool IsCanonicalLogicalPath(string path)
    {
        if (!path.IsNormalized(NormalizationForm.FormC) ||
            path[0] == '/' ||
            path[^1] == '/' ||
            path.Contains('\\') ||
            path.Contains(':') ||
            path.Contains('%') ||
            path.Contains('?') ||
            path.Contains('#'))
        {
            return false;
        }

        foreach (var character in path)
        {
            if (character is '\0' or <= '\u001f' or '\u007f')
            {
                return false;
            }
        }

        foreach (var segment in path.Split('/'))
        {
            if (segment is "" or "." or "..")
            {
                return false;
            }
        }

        return true;
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
        return JsonSerializer.Serialize(response, CompilerJsonContext.Default.CompileResponse);
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

    internal sealed record CompileRequest(
        int? ProtocolVersion,
        IReadOnlyList<CompilationSource?>? Sources,
        CompileSettings? Settings);

    internal sealed record CompileSettings(
        [property: JsonRequired] string? LanguageVersion,
        [property: JsonRequired] string? Nullable,
        [property: JsonRequired] string? Optimization,
        [property: JsonRequired] bool AllowUnsafe,
        [property: JsonRequired] bool WarningsAsErrors);

    internal sealed record CompileError(string Code, string Message);
    private sealed record ValidationFailure(string Code, string Message);

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
}

[JsonSourceGenerationOptions(
    JsonSerializerDefaults.Web,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(CompilerExports.CompilerContextProof))]
[JsonSerializable(typeof(CompilerExports.CompileRequest))]
[JsonSerializable(typeof(CompilerExports.CompileResponse))]
internal sealed partial class CompilerJsonContext : JsonSerializerContext;

internal static class BrowserMetadataReferences
{
    private const string ManifestResource = "Playground.Compiler.ReferenceAllowlist.json";
    private const string ReferencePrefix = "Playground.Compiler.References.";

    internal static IReadOnlyList<MetadataReference> Allowlisted { get; } = CreateAllowlisted();

    private static IReadOnlyList<MetadataReference> CreateAllowlisted()
    {
        var hostAssembly = typeof(BrowserMetadataReferences).Assembly;
        using var manifestStream = hostAssembly.GetManifestResourceStream(ManifestResource)
            ?? throw new InvalidOperationException(
                "The bundled compiler reference allowlist was not found.");
        using var manifest = JsonDocument.Parse(manifestStream);
        var entries = manifest.RootElement.GetProperty("assemblies").EnumerateArray().ToArray();
        var expectedResources = entries
            .Select(entry => ReferencePrefix + entry.GetProperty("simpleName").GetString() + ".dll")
            .ToHashSet(StringComparer.Ordinal);
        var actualResources = hostAssembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(ReferencePrefix, StringComparison.Ordinal))
            .ToArray();

        if (actualResources.Length != expectedResources.Count ||
            actualResources.Distinct(StringComparer.Ordinal).Count() != actualResources.Length ||
            !actualResources.ToHashSet(StringComparer.Ordinal).SetEquals(expectedResources))
        {
            throw new InvalidOperationException(
                "Bundled compiler reference resources do not exactly match the allowlist.");
        }

        var references = new List<MetadataReference>(entries.Length);
        var identities = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entry in entries)
        {
            var simpleName = entry.GetProperty("simpleName").GetString()
                ?? throw new InvalidOperationException("An allowlisted assembly has no simple name.");
            var resourceName = ReferencePrefix + simpleName + ".dll";
            using var stream = hostAssembly.GetManifestResourceStream(resourceName)
                ?? throw new InvalidOperationException(
                    $"Bundled compiler reference resource is missing: {resourceName}.");
            using var bytesStream = new MemoryStream();
            stream.CopyTo(bytesStream);
            var bytes = bytesStream.ToArray();
            ValidateIdentityAndHash(entry, bytes, identities);
            references.Add(MetadataReference.CreateFromImage(
                ImmutableArray.CreateRange(bytes),
                filePath: simpleName + ".dll"));
        }

        return references;
    }

    private static void ValidateIdentityAndHash(
        JsonElement entry,
        byte[] bytes,
        HashSet<string> identities)
    {
        using var peReader = new PEReader(new MemoryStream(bytes, writable: false));
        if (!peReader.HasMetadata)
        {
            throw new InvalidOperationException("An allowlisted compiler reference has no metadata.");
        }

        var reader = peReader.GetMetadataReader();
        if (!reader.IsAssembly)
        {
            throw new InvalidOperationException("An allowlisted compiler reference is not an assembly.");
        }

        var definition = reader.GetAssemblyDefinition();
        var simpleName = reader.GetString(definition.Name);
        var version = definition.Version.ToString();
        var token = GetPublicKeyToken(reader, definition);
        var expectedToken = entry.GetProperty("publicKeyToken").ValueKind == JsonValueKind.Null
            ? null
            : entry.GetProperty("publicKeyToken").GetString();
        var digest = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

        if (simpleName != entry.GetProperty("simpleName").GetString() ||
            version != entry.GetProperty("version").GetString() ||
            token != expectedToken ||
            digest != entry.GetProperty("sha256").GetString())
        {
            throw new InvalidOperationException(
                $"Bundled compiler reference identity or hash mismatch: {simpleName}.");
        }

        var identity = $"{simpleName}, Version={version}, PublicKeyToken={token ?? "null"}";
        if (!identities.Add(identity))
        {
            throw new InvalidOperationException(
                $"Duplicate bundled compiler reference identity: {identity}.");
        }
    }

    private static string? GetPublicKeyToken(
        MetadataReader reader,
        AssemblyDefinition definition)
    {
        if (definition.PublicKey.IsNil)
        {
            return null;
        }

        var publicKey = reader.GetBlobBytes(definition.PublicKey);
        if (publicKey.Length == 0)
        {
            return null;
        }

        var hash = SHA1.HashData(publicKey);
        var token = hash[^8..];
        Array.Reverse(token);
        return Convert.ToHexString(token).ToLowerInvariant();
    }
}

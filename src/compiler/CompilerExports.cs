using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Runtime.InteropServices.JavaScript;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;

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
    private static readonly TimeSpan RetentionLease = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan CompilationLease = TimeSpan.FromSeconds(35);
    private static readonly UTF8Encoding StrictUtf8 = new(
        encoderShouldEmitUTF8Identifier: false,
        throwOnInvalidBytes: true);
    private static readonly object RetainedLock = new();
    private static RetainedCompilation? _retained;
    private static (string CompileId, string CorrelationId)? _lastFinalizedOwner;
    private static TimeSpan? _nextRetentionTestLease;

    [JSExport]
    public static string CompileAndRetain(
        string? compileId,
        string? correlationId,
        string? assemblyName,
        string? requestJson)
    {
        if (!Guid.TryParseExact(compileId, "D", out var parsedCompileId) ||
            parsedCompileId.ToString("D") != compileId ||
            parsedCompileId.Version != 4)
        {
            return SerializeBinaryError("MALFORMED_PAYLOAD", "compileId must be a canonical lowercase UUIDv4.");
        }
        if (!Guid.TryParseExact(correlationId, "D", out var parsedCorrelationId) ||
            parsedCorrelationId.ToString("D") != correlationId ||
            parsedCorrelationId.Version != 4)
        {
            return SerializeBinaryError("MALFORMED_PAYLOAD", "correlationId must be a canonical lowercase UUIDv4.");
        }

        if (string.IsNullOrEmpty(assemblyName) ||
            assemblyName.Length > 128 ||
            (!char.IsAsciiLetter(assemblyName[0]) && assemblyName[0] != '_') ||
            assemblyName.Any(character =>
                !char.IsAsciiLetterOrDigit(character) && character is not ('_' or '.' or '-')))
        {
            return SerializeBinaryError("MALFORMED_PAYLOAD", "assemblyName is invalid.");
        }

        var validation = DeserializeAndValidateRequest(requestJson, out var request);
        if (validation is not null)
        {
            return SerializeBinaryError(validation.Code, validation.Message);
        }

        lock (RetainedLock)
        {
            CleanupExpiredRetention();
            if (_retained is not null)
            {
                return SerializeBinaryError("INVALID_STATE", "A compilation lease is already active.");
            }
            _retained = CreateLease(
                compileId,
                correlationId,
                Array.Empty<byte>(),
                Array.Empty<byte>(),
                ready: false,
                CompilationLease);
        }

        CompilationResult result;
        try
        {
            result = CompilationService.Compile(
                request!.Sources!,
                BrowserMetadataReferences.Allowlisted,
                assemblyName);
        }
        catch (PlatformNotSupportedException exception)
        {
            AbortRetained(compileId, correlationId);
            return SerializeBinaryError(
                "INTERNAL_ERROR",
                $"Compilation used an unsupported browser runtime operation: {exception.Message}");
        }
        catch
        {
            AbortRetained(compileId, correlationId);
            throw;
        }

        if (!result.Success)
        {
            AbortRetained(compileId, correlationId);
            return JsonSerializer.Serialize(
                new BinaryCompileResponse(
                    false, compileId, result.AssemblyName, 0, 0,
                    result.Diagnostics, result.Validity,
                    new CompileError("COMPILE_FAILED", "Compilation failed; no binaries were retained.")),
                CompilerJsonContext.Default.BinaryCompileResponse);
        }

        var sizeError = ValidateBinarySizes(result);
        if (sizeError is not null)
        {
            AbortRetained(compileId, correlationId);
            return SerializeBinaryError(sizeError.Code, sizeError.Message);
        }

        lock (RetainedLock)
        {
            CleanupExpiredRetention();
            if (_retained is null ||
                _retained.CompileId != compileId ||
                _retained.CorrelationId != correlationId ||
                _retained.Ready)
            {
                return SerializeBinaryError("INVALID_STATE", "The compilation lease expired or changed.");
            }
            _retained.Timer.Dispose();
            var retentionLease = _nextRetentionTestLease ?? RetentionLease;
            _nextRetentionTestLease = null;
            _retained = CreateLease(
                compileId, correlationId, result.Assembly!, result.Pdb!, true, retentionLease);
        }

        return JsonSerializer.Serialize(
            new BinaryCompileResponse(
                true, compileId, result.AssemblyName,
                result.Assembly!.Length, result.Pdb!.Length,
                result.Diagnostics, result.Validity, null),
            CompilerJsonContext.Default.BinaryCompileResponse);
    }

    [JSExport]
    public static byte[] ConsumeAssembly(string? compileId, string? correlationId) =>
        ConsumeRetained(compileId, correlationId, assembly: true);

    [JSExport]
    public static byte[] ConsumePdb(string? compileId, string? correlationId) =>
        ConsumeRetained(compileId, correlationId, assembly: false);

    [JSExport]
    public static bool AbortRetained(string? compileId, string? correlationId)
    {
        lock (RetainedLock)
        {
            if (_retained is null ||
                _retained.CompileId != compileId ||
                _retained.CorrelationId != correlationId)
            {
                return _lastFinalizedOwner is { } owner &&
                    owner.CompileId == compileId && owner.CorrelationId == correlationId;
            }
            ClearRetentionLocked();
            return true;
        }
    }

    private static byte[] ConsumeRetained(
        string? compileId,
        string? correlationId,
        bool assembly)
    {
        lock (RetainedLock)
        {
            CleanupExpiredRetention();
            if (_retained is null ||
                _retained.CompileId != compileId ||
                _retained.CorrelationId != correlationId ||
                !_retained.Ready)
            {
                throw new InvalidOperationException("No ready compilation lease matches the owner.");
            }
            if (assembly ? _retained.AssemblyConsumed : _retained.PdbConsumed)
            {
                throw new InvalidOperationException("The retained binary was already consumed.");
            }

            var bytes = assembly ? _retained.Assembly : _retained.Pdb;
            if (assembly)
            {
                _retained.Assembly = Array.Empty<byte>();
                _retained.AssemblyConsumed = true;
            }
            else
            {
                _retained.Pdb = Array.Empty<byte>();
                _retained.PdbConsumed = true;
            }
            if (_retained.AssemblyConsumed && _retained.PdbConsumed)
                ClearRetentionLocked(zeroArrays: false);
            return bytes;
        }
    }

    private static RetainedCompilation CreateLease(
        string compileId, string correlationId, byte[] assembly, byte[] pdb,
        bool ready, TimeSpan lease)
    {
        var timer = new Timer(_ =>
        {
            lock (RetainedLock)
            {
                if (_retained?.CompileId == compileId &&
                    _retained.CorrelationId == correlationId)
                    ClearRetentionLocked();
            }
        }, null, lease, Timeout.InfiniteTimeSpan);
        return new RetainedCompilation(
            compileId, correlationId, assembly, pdb, ready, false, false,
            DateTime.UtcNow + lease, timer);
    }

    private static void ClearRetentionLocked(bool zeroArrays = true)
    {
        if (_retained is null) return;
        _retained.Timer.Dispose();
        if (zeroArrays)
        {
            CryptographicOperations.ZeroMemory(_retained.Assembly);
            CryptographicOperations.ZeroMemory(_retained.Pdb);
        }
        _lastFinalizedOwner = (_retained.CompileId, _retained.CorrelationId);
        _retained.Assembly = Array.Empty<byte>();
        _retained.Pdb = Array.Empty<byte>();
        _retained = null;
    }

    private static void CleanupExpiredRetention()
    {
        if (_retained is not null && _retained.ExpiresAtUtc <= DateTime.UtcNow)
            ClearRetentionLocked();
    }

    private static ValidationFailure? DeserializeAndValidateRequest(
        string? requestJson,
        out CompileRequest? request)
    {
        request = null;
        if (requestJson is null)
        {
            return new("MALFORMED_PAYLOAD", "The compilation request must not be null.");
        }
        try
        {
            if (StrictUtf8.GetByteCount(requestJson) > MaxRequestJsonBytes)
            {
                return new("MESSAGE_TOO_LARGE", "The compilation request exceeds the 32 MiB JSON limit.");
            }
            request = JsonSerializer.Deserialize(requestJson, CompilerJsonContext.Default.CompileRequest);
        }
        catch (JsonException)
        {
            return new("MALFORMED_PAYLOAD", "The compilation request JSON is malformed.");
        }
        catch (EncoderFallbackException)
        {
            return new("MALFORMED_PAYLOAD", "The compilation request contains invalid Unicode.");
        }
        return ValidateRequest(request);
    }

    private static ValidationFailure? ValidateBinarySizes(CompilationResult result)
    {
        if (result.Assembly!.Length > MaxAssemblyBytes)
            return new("ASSEMBLY_TOO_LARGE", "The emitted assembly exceeds the 8 MiB limit.");
        if (result.Pdb!.Length > MaxPdbBytes)
            return new("PDB_TOO_LARGE", "The emitted portable PDB exceeds the 8 MiB limit.");
        if (checked(result.Assembly.Length + result.Pdb.Length) > MaxBinaryBytes)
            return new("BINARY_PAYLOAD_TOO_LARGE", "The emitted binaries exceed the 12 MiB aggregate limit.");
        return null;
    }

    private static string SerializeBinaryError(string code, string message) =>
        JsonSerializer.Serialize(
            new BinaryCompileResponse(
                false, "", "", 0, 0, Array.Empty<CompilerDiagnostic>(), null,
                new CompileError(code, message)),
            CompilerJsonContext.Default.BinaryCompileResponse);

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

    internal sealed record BinaryCompileResponse(
        bool Success,
        string CompileId,
        string AssemblyName,
        int AssemblyByteLength,
        int PdbByteLength,
        IReadOnlyList<CompilerDiagnostic> Diagnostics,
        CompilationValidity? Validity,
        CompileError? Error);

    private sealed class RetainedCompilation(
        string compileId, string correlationId, byte[] assembly, byte[] pdb,
        bool ready, bool assemblyConsumed, bool pdbConsumed, DateTime expiresAtUtc, Timer timer)
    {
        public string CompileId { get; } = compileId;
        public string CorrelationId { get; } = correlationId;
        public byte[] Assembly { get; set; } = assembly;
        public byte[] Pdb { get; set; } = pdb;
        public bool Ready { get; } = ready;
        public bool AssemblyConsumed { get; set; } = assemblyConsumed;
        public bool PdbConsumed { get; set; } = pdbConsumed;
        public DateTime ExpiresAtUtc { get; } = expiresAtUtc;
        public Timer Timer { get; } = timer;
    }
}

[JsonSourceGenerationOptions(
    JsonSerializerDefaults.Web,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(CompilerExports.CompileRequest))]
[JsonSerializable(typeof(CompilerExports.BinaryCompileResponse))]
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

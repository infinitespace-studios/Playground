using System.Collections.Immutable;
using System.Reflection.Metadata;
using System.Reflection.PortableExecutable;
using System.Security.Cryptography;
using System.Text;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.Emit;
using Microsoft.CodeAnalysis.Text;

namespace Playground.Compiler;

public sealed record CompilationSource(string Path, string Text);

public sealed record CompilerDiagnostic(
    string Origin,
    string Severity,
    string Id,
    string Message,
    string File,
    int Line,
    int Column);

public sealed record CompilationValidity(
    bool HasMetadata,
    bool HasCliHeader,
    bool HasManagedMetadata,
    bool HasPortablePdbMetadata,
    bool ContainsExpectedType,
    bool ContainsExpectedMethod);

public sealed record CompilationResult(
    bool Success,
    string AssemblyName,
    byte[]? Assembly,
    byte[]? Pdb,
    IReadOnlyList<CompilerDiagnostic> Diagnostics,
    CompilationValidity? Validity);

public static class CompilationService
{
    public const int WarningLevel = 4;

    public static CompilationResult Compile(
        IReadOnlyList<CompilationSource> files,
        IReadOnlyList<MetadataReference> references,
        string? requestedAssemblyName = null)
    {
        var trees = files
            .OrderBy(file => file.Path, StringComparer.Ordinal)
            .Select(file => CSharpSyntaxTree.ParseText(
                CreateBrowserPortablePdbSource(file),
                new CSharpParseOptions(LanguageVersion.CSharp13),
                path: ""))
            .ToImmutableArray();

        var assemblyName = requestedAssemblyName ?? $"UserGame_{Guid.NewGuid():N}";
        var compilation = CSharpCompilation.Create(
            assemblyName,
            trees,
            references,
            new CSharpCompilationOptions(
                OutputKind.DynamicallyLinkedLibrary,
                optimizationLevel: OptimizationLevel.Debug,
                generalDiagnosticOption: ReportDiagnostic.Default,
                warningLevel: WarningLevel,
                allowUnsafe: false,
                nullableContextOptions: NullableContextOptions.Disable,
                deterministic: true,
                concurrentBuild: false));

        var policyDiagnostics = PolicyAnalyzer.Analyze(compilation);
        if (policyDiagnostics.Count != 0)
        {
            var compilerDiagnostics = ToDiagnostics(compilation.GetDiagnostics(), files);
            return new CompilationResult(
                false,
                assemblyName,
                null,
                null,
                SortDiagnostics(compilerDiagnostics.Concat(policyDiagnostics)),
                null);
        }

        using var assemblyStream = new MemoryStream();
        using var pdbStream = new MemoryStream();
        var emitResult = compilation.Emit(
            assemblyStream,
            pdbStream,
            options: new EmitOptions(debugInformationFormat: DebugInformationFormat.PortablePdb));
        var diagnostics = SortDiagnostics(
            ToDiagnostics(emitResult.Diagnostics, files).Concat(policyDiagnostics));

        if (!emitResult.Success)
        {
            return new CompilationResult(false, assemblyName, null, null, diagnostics, null);
        }

        var assembly = assemblyStream.ToArray();
        var pdb = pdbStream.ToArray();
        var validity = ValidateEmittedBinaries(assembly, pdb);

        if (!validity.HasMetadata ||
            !validity.HasCliHeader ||
            !validity.HasManagedMetadata ||
            !validity.HasPortablePdbMetadata)
        {
            var validationDiagnostic = new CompilerDiagnostic(
                "playground",
                "error",
                "PG0004_UNSUPPORTED_ASSEMBLY",
                "Roslyn emitted binaries that failed managed PE or portable PDB validation.",
                "",
                0,
                0);
            return new CompilationResult(
                false,
                assemblyName,
                null,
                null,
                diagnostics.Append(validationDiagnostic).ToArray(),
                validity);
        }

        return new CompilationResult(true, assemblyName, assembly, pdb, diagnostics, validity);
    }

    private static SourceText CreateBrowserPortablePdbSource(CompilationSource file)
    {
        var sourceBytes = Encoding.UTF8.GetBytes(file.Text);
        var checksum = Convert.ToHexString(SHA256.HashData(sourceBytes));
        // Avoid Roslyn's background checksum task, which cannot block on single-threaded browser WASM.
        var text =
            $"#pragma checksum \"{file.Path}\" \"{{8829d00f-11b8-4213-878b-770e8597ac16}}\" \"{checksum}\"\n" +
            $"#line 1 \"{file.Path}\"\n" +
            file.Text;
        return SourceText.From(text, Encoding.UTF8, SourceHashAlgorithm.Sha256);
    }

    private static IReadOnlyList<CompilerDiagnostic> ToDiagnostics(
        ImmutableArray<Diagnostic> diagnostics,
        IReadOnlyList<CompilationSource> files)
    {
        var logicalPaths = files
            .Select(file => file.Path)
            .ToHashSet(StringComparer.Ordinal);

        return SortDiagnostics(diagnostics
            .Where(diagnostic => diagnostic.Severity != DiagnosticSeverity.Hidden)
            .Select(diagnostic =>
            {
                var lineSpan = diagnostic.Location.GetMappedLineSpan();
                var hasSource =
                    diagnostic.Location.IsInSource &&
                    lineSpan.IsValid &&
                    logicalPaths.Contains(lineSpan.Path);
                return new CompilerDiagnostic(
                    "compiler",
                    diagnostic.Severity switch
                    {
                        DiagnosticSeverity.Error => "error",
                        DiagnosticSeverity.Warning => "warning",
                        _ => "info",
                    },
                    diagnostic.Id,
                    diagnostic.GetMessage(),
                    hasSource ? lineSpan.Path : "",
                    // Roslyn and Monaco both count UTF-16 code units; expose them as 1-based coordinates.
                    hasSource ? lineSpan.StartLinePosition.Line + 1 : 0,
                    hasSource ? lineSpan.StartLinePosition.Character + 1 : 0);
            }))
            .ToArray();
    }

    private static IReadOnlyList<CompilerDiagnostic> SortDiagnostics(
        IEnumerable<CompilerDiagnostic> diagnostics)
    {
        return diagnostics
            .OrderBy(diagnostic => diagnostic.File, StringComparer.Ordinal)
            .ThenBy(diagnostic => diagnostic.Line)
            .ThenBy(diagnostic => diagnostic.Column)
            .ThenBy(diagnostic => diagnostic.Severity, StringComparer.Ordinal)
            .ThenBy(diagnostic => diagnostic.Id, StringComparer.Ordinal)
            .ToArray();
    }

    private static CompilationValidity ValidateEmittedBinaries(byte[] assembly, byte[] pdb)
    {
        using var peStream = new MemoryStream(assembly, writable: false);
        using var peReader = new PEReader(peStream);
        var hasMetadata = peReader.HasMetadata;
        var hasCliHeader = peReader.PEHeaders.CorHeader is not null;
        var hasManagedMetadata = false;
        var containsExpectedType = false;
        var containsExpectedMethod = false;

        if (hasMetadata && hasCliHeader)
        {
            var metadataReader = peReader.GetMetadataReader();
            hasManagedMetadata = metadataReader.IsAssembly;
            foreach (var typeHandle in metadataReader.TypeDefinitions)
            {
                var type = metadataReader.GetTypeDefinition(typeHandle);
                if (metadataReader.GetString(type.Name) != "Foo")
                {
                    continue;
                }

                containsExpectedType = true;
                containsExpectedMethod = type.GetMethods()
                    .Select(metadataReader.GetMethodDefinition)
                    .Any(method => metadataReader.GetString(method.Name) == "Bar");
            }
        }

        using var pdbStream = new MemoryStream(pdb, writable: false);
        using var pdbProvider = MetadataReaderProvider.FromPortablePdbStream(pdbStream);
        var pdbReader = pdbProvider.GetMetadataReader();
        var hasPortablePdbMetadata = pdbReader.MetadataKind == MetadataKind.Ecma335;

        return new CompilationValidity(
            hasMetadata,
            hasCliHeader,
            hasManagedMetadata,
            hasPortablePdbMetadata,
            containsExpectedType,
            containsExpectedMethod);
    }
}

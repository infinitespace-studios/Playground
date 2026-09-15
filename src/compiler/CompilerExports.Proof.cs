using System.Collections.Immutable;
using System.Diagnostics;
using System.Runtime.InteropServices.JavaScript;
using System.Text;
using System.Threading;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.Completion;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Host.Mef;
using Microsoft.CodeAnalysis.Text;

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

    /// <summary>
    /// PROOF-only Roslyn Workspaces/Features feasibility spike. This deliberately
    /// returns measurements and correctness evidence instead of mutating the
    /// PRODUCT compiler or protocol surface.
    /// </summary>
    [JSExport]
    public static async Task<string> RunLanguageServiceSpike()
    {
        var wall = Stopwatch.StartNew();
        var gcBefore = GC.GetTotalMemory(forceFullCollection: false);
        try
        {
            var hostStart = Stopwatch.StartNew();
            var mefAssemblies = MefHostServices.DefaultAssemblies
                .Concat(new[]
                {
                    typeof(CSharpSyntaxTree).Assembly,
                    typeof(CompletionService).Assembly,
                    typeof(AdhocWorkspace).Assembly,
                    System.Reflection.Assembly.Load("Microsoft.CodeAnalysis.CSharp.Workspaces"),
                })
                .Distinct();
            using var workspace = new AdhocWorkspace(MefHostServices.Create(mefAssemblies));
            var hostInitializationMs = hostStart.Elapsed.TotalMilliseconds;

            var projectInfo = ProjectInfo.Create(
                ProjectId.CreateNewId(),
                VersionStamp.Create(),
                "IntelliSenseSpike",
                "IntelliSenseSpike",
                LanguageNames.CSharp,
                parseOptions: new CSharpParseOptions(LanguageVersion.CSharp13),
                compilationOptions: new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary)
                    .WithConcurrentBuild(false),
                metadataReferences: BrowserMetadataReferences.Allowlisted);
            var project = workspace.AddProject(projectInfo);
            var gameId = DocumentId.CreateNewId(project.Id, "Game1.cs");
            var playerId = DocumentId.CreateNewId(project.Id, "Player.cs");
            workspace.TryApplyChanges(workspace.CurrentSolution
                .AddDocument(gameId, "Game1.cs", SourceText.From("public class Game1 { }"))
                .AddDocument(playerId, "Player.cs", SourceText.From("public class Player { public int Score; public void Jump() { } }")));

            var gameDocument = workspace.CurrentSolution.GetDocument(gameId)
                ?? throw new InvalidOperationException("Game1.cs document was not created.");
            _ = workspace.CurrentSolution.GetDocument(playerId)
                ?? throw new InvalidOperationException("Player.cs document was not created.");
            var completionService = CompletionService.GetService(gameDocument)
                ?? throw new InvalidOperationException("Roslyn returned no CompletionService for the C# document.");

            var scenarios = new[]
            {
                new CompletionSpikeScenario("after-dot", "using System; class Sample { void M() { var value = \"x\"; value./*cursor*/ } }", "ToString"),
                new CompletionSpikeScenario("statement-context", "using System; class Sample { void M() { Con/*cursor*/ } }", "Console"),
                new CompletionSpikeScenario("generic-type", "using System; using System.Collections.Generic; class Sample { List<Str/*cursor*/> values; }", "String"),
                new CompletionSpikeScenario("incomplete-syntax", "class Sample { void M() { var value = 1; value./*cursor*/ }", "ToString"),
                new CompletionSpikeScenario("cross-file-symbol", "class Sample { Player value = new Player(); void M() { value./*cursor*/ } }", "Score"),
            };
            var correctness = new List<CompletionSpikeCase>();
            var completionMeasurements = new List<double>();
            var documentUpdateMeasurements = new List<double>();
            double firstCompletionMs = 0;

            for (var index = 0; index < 30; index++)
            {
                var scenario = scenarios[index % scenarios.Length];
                var marker = "/*cursor*/";
                var source = scenario.Source;
                var cursor = source.IndexOf(marker, StringComparison.Ordinal);
                if (cursor < 0) throw new InvalidOperationException($"Scenario {scenario.Name} has no cursor marker.");
                var withoutMarker = source.Replace(marker, string.Empty, StringComparison.Ordinal);
                var prefix = withoutMarker[..cursor];
                var line = prefix.Count(character => character == '\n') + 1;
                var lastNewline = prefix.LastIndexOf('\n');
                var column = cursor - lastNewline;
                var position = cursor;

                var updateStart = Stopwatch.StartNew();
                var updatedGame = gameDocument.WithText(SourceText.From(withoutMarker));
                workspace.TryApplyChanges(updatedGame.Project.Solution);
                gameDocument = workspace.CurrentSolution.GetDocument(gameId)!;
                documentUpdateMeasurements.Add(updateStart.Elapsed.TotalMilliseconds);

                var activeDocument = gameDocument;

                var completionStart = Stopwatch.StartNew();
                var list = await completionService.GetCompletionsAsync(activeDocument, position);
                var elapsed = completionStart.Elapsed.TotalMilliseconds;
                completionMeasurements.Add(elapsed);
                if (index == 0) firstCompletionMs = elapsed;
                if (index < scenarios.Length)
                {
                    var items = list?.ItemsList.Select(item => item.DisplayText).ToArray() ?? Array.Empty<string>();
                    correctness.Add(new CompletionSpikeCase(
                        scenario.Name,
                        scenario.ExpectedItem,
                        items.Contains(scenario.ExpectedItem, StringComparer.Ordinal),
                        items.Take(20).ToArray(),
                        line,
                        column));
                }
            }

            var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            var cancellationObserved = false;
            try
            {
                await completionService.GetCompletionsAsync(gameDocument, 1, cancellationToken: cancellation.Token);
            }
            catch (OperationCanceledException)
            {
                cancellationObserved = true;
            }

            var gcAfter = GC.GetTotalMemory(forceFullCollection: false);
            var report = new LanguageServiceSpikeReport(
                true,
                "go",
                null,
                new LanguageServiceEnvironment(
                    "4.12.0",
                    "net9.0/browser-wasm",
                    BrowserMetadataReferences.Allowlisted.Count,
                    workspace.CurrentSolution.GetProject(project.Id)?.Documents.Count() ?? 0),
                correctness,
                new LanguageServiceMeasurements(
                    hostInitializationMs,
                    firstCompletionMs,
                    Percentile(documentUpdateMeasurements, 0.50),
                    Percentile(completionMeasurements, 0.50),
                    Percentile(completionMeasurements, 0.95),
                    completionMeasurements.Count,
                    gcBefore,
                    gcAfter,
                    false),
                new LanguageServiceResponsiveness(cancellationObserved, true),
                wall.Elapsed.TotalMilliseconds);
            return JsonSerializer.Serialize(report, CompilerProofJsonContext.Default.LanguageServiceSpikeReport);
        }
        catch (Exception exception)
        {
            var report = new LanguageServiceSpikeReport(
                false,
                "no-go",
                $"{exception.GetType().Name}: {exception.Message}",
                new LanguageServiceEnvironment("4.12.0", "net9.0/browser-wasm", 0, 0),
                Array.Empty<CompletionSpikeCase>(),
                new LanguageServiceMeasurements(0, 0, 0, 0, 0, 0, gcBefore, GC.GetTotalMemory(false), false),
                new LanguageServiceResponsiveness(false, false),
                wall.Elapsed.TotalMilliseconds);
            return JsonSerializer.Serialize(report, CompilerProofJsonContext.Default.LanguageServiceSpikeReport);
        }
    }

    /// <summary>
    /// A smaller backend experiment that avoids Workspaces and MEF entirely.
    /// It proves one useful completion by compiling sources with the already
    /// working browser CSharpCompilation path and querying a SemanticModel.
    /// </summary>
    [JSExport]
    public static string RunDirectCompletionBackendSpike()
    {
        var stopwatch = Stopwatch.StartNew();
        var gcBefore = GC.GetTotalMemory(forceFullCollection: false);
        const string marker = "/*cursor*/";
        const string sourceWithMarker =
            "public class Game { Player player = new Player(); void M() { player./*cursor*/ } }";
        var cursor = sourceWithMarker.IndexOf(marker, StringComparison.Ordinal);
        var source = sourceWithMarker.Replace(marker, string.Empty, StringComparison.Ordinal);
        try
        {
            var files = new[]
            {
                new CompilationSource("Game.cs", source),
                new CompilationSource("Player.cs", "public class Player { public int Score; public void Jump() { } }")
            };
            var trees = files
                .Select(file => CSharpSyntaxTree.ParseText(
                    SourceText.From(file.Text),
                    new CSharpParseOptions(LanguageVersion.CSharp13),
                    file.Path))
                .ToImmutableArray();
            var compilation = CSharpCompilation.Create(
                "DirectCompletionSpike",
                trees,
                BrowserMetadataReferences.Allowlisted,
                new CSharpCompilationOptions(
                    OutputKind.DynamicallyLinkedLibrary,
                    allowUnsafe: false,
                    concurrentBuild: false,
                    deterministic: true));
            var compilerDiagnostics = compilation.GetDiagnostics()
                .Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)
                .Select(diagnostic => $"{diagnostic.Id}: {diagnostic.GetMessage()}")
                .ToArray();
            var compilerErrors = compilerDiagnostics.Length;
            var gameTree = trees[0];
            var model = compilation.GetSemanticModel(gameTree);
            var token = gameTree.GetRoot().FindToken(cursor - 1);
            var access = token.Parent?
                .AncestorsAndSelf()
                .OfType<MemberAccessExpressionSyntax>()
                .FirstOrDefault();
            var receiverType = access is null ? null : model.GetTypeInfo(access.Expression).Type;
            var items = receiverType?.GetMembers()
                .Where(symbol => !symbol.IsImplicitlyDeclared && !string.IsNullOrEmpty(symbol.Name))
                .Select(symbol => new DirectCompletionItem(symbol.Name, symbol.Kind.ToString()))
                .DistinctBy(item => item.Name)
                .OrderBy(item => item.Name, StringComparer.Ordinal)
                .Take(100)
                .ToArray() ?? Array.Empty<DirectCompletionItem>();
            var found = items.Any(item => item.Name == "Score");
            var gcAfter = GC.GetTotalMemory(forceFullCollection: false);
            var result = new DirectCompletionBackendReport(
                found,
                "direct-semantic-model",
                compilerErrors,
                compilerDiagnostics,
                "Game.cs",
                cursor,
                "Score",
                items,
                stopwatch.Elapsed.TotalMilliseconds,
                gcBefore,
                gcAfter,
                false,
                found ? "go" : "no-go",
                null);
            return JsonSerializer.Serialize(result, CompilerProofJsonContext.Default.DirectCompletionBackendReport);
        }
        catch (Exception exception)
        {
            var result = new DirectCompletionBackendReport(
                false,
                "direct-semantic-model",
                -1,
                Array.Empty<string>(),
                "Game.cs",
                cursor,
                "Score",
                Array.Empty<DirectCompletionItem>(),
                stopwatch.Elapsed.TotalMilliseconds,
                gcBefore,
                GC.GetTotalMemory(false),
                false,
                "no-go",
                $"{exception.GetType().Name}: {exception.Message}");
            return JsonSerializer.Serialize(result, CompilerProofJsonContext.Default.DirectCompletionBackendReport);
        }
    }

    internal sealed record DirectCompletionItem(string Name, string Kind);
    internal sealed record DirectCompletionBackendReport(
        bool Success,
        string Backend,
        int CompilerErrorCount,
        IReadOnlyList<string> CompilerDiagnostics,
        string File,
        int CursorOffset,
        string ExpectedItem,
        IReadOnlyList<DirectCompletionItem> Items,
        double ElapsedMs,
        long GcBytesBefore,
        long GcBytesAfter,
        bool RssMeasured,
        string Recommendation,
        string? Error);

    private static double Percentile(IReadOnlyList<double> values, double percentile)
    {
        if (values.Count == 0) return 0;
        var ordered = values.OrderBy(value => value).ToArray();
        var index = Math.Clamp((int)Math.Ceiling(ordered.Length * percentile) - 1, 0, ordered.Length - 1);
        return ordered[index];
    }

    private sealed record CompletionSpikeScenario(string Name, string Source, string ExpectedItem);
    internal sealed record CompletionSpikeCase(string Name, string ExpectedItem, bool Found, IReadOnlyList<string> SampleItems, int Line, int Column);
    internal sealed record LanguageServiceEnvironment(string RoslynPackageVersion, string Target, int ReferenceCount, int DocumentCount);
    internal sealed record LanguageServiceMeasurements(double HostInitializationMs, double FirstCompletionMs, double DocumentUpdateP50Ms, double CompletionP50Ms, double CompletionP95Ms, int CompletionRequestCount, long GcBytesBefore, long GcBytesAfter, bool RssMeasured);
    internal sealed record LanguageServiceResponsiveness(bool CancellationObserved, bool StaleResultSuppressionRequired);
    internal sealed record LanguageServiceSpikeReport(bool Success, string Recommendation, string? Error, LanguageServiceEnvironment Environment, IReadOnlyList<CompletionSpikeCase> Correctness, LanguageServiceMeasurements Measurements, LanguageServiceResponsiveness Responsiveness, double TotalElapsedMs);

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
[JsonSerializable(typeof(CompilerExports.LanguageServiceSpikeReport))]
[JsonSerializable(typeof(CompilerExports.LanguageServiceEnvironment))]
[JsonSerializable(typeof(CompilerExports.LanguageServiceMeasurements))]
[JsonSerializable(typeof(CompilerExports.LanguageServiceResponsiveness))]
[JsonSerializable(typeof(CompilerExports.CompletionSpikeCase))]
[JsonSerializable(typeof(CompilerExports.DirectCompletionBackendReport))]
[JsonSerializable(typeof(CompilerExports.DirectCompletionItem))]
internal sealed partial class CompilerProofJsonContext : JsonSerializerContext;

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

    private static readonly object LanguageSessionLock = new();
    private static LanguageSession? _languageSession;

    [JSExport]
    public static string LanguageFeatureHandle(string? requestJson)
    {
        try
        {
            if (string.IsNullOrEmpty(requestJson) || requestJson.Length > 256 * 1024)
                throw new LanguageServiceFailure("MESSAGE_TOO_LARGE", "Language feature request exceeds the size limit.");
            using var json = JsonDocument.Parse(requestJson);
            var root = json.RootElement;
            var sessionId = root.GetProperty("sessionId").GetString();
            var uri = root.GetProperty("uri").GetString();
            var version = root.GetProperty("version").GetInt32();
            var offset = root.GetProperty("offset").GetInt32();
            var operation = root.GetProperty("operation").GetString();
            if (!IsCanonicalUuidV4(sessionId) || string.IsNullOrEmpty(uri) || version < 1 || offset < 0)
                throw new LanguageServiceFailure("MALFORMED_PAYLOAD", "Language feature identity or position is invalid.");
            lock (LanguageSessionLock)
            {
                var session = RequireLanguageSession(sessionId!);
                if (!session.Documents.TryGetValue(uri!, out var document))
                    throw new LanguageServiceFailure("DOCUMENT_NOT_FOUND", "Language document was not opened.");
                if (version != document.Version)
                    throw new LanguageServiceFailure("STALE_DOCUMENT_VERSION", "Language feature request is stale.");
                if (session.Compilation is null)
                    throw new LanguageServiceFailure("INVALID_STATE", "Language compilation is not initialized.");
                var model = session.Compilation.GetSemanticModel(document.Tree);
                var position = Math.Min(offset, document.Text.Length);
                return operation switch
                {
                    "quickInfo" => SerializeFeatureSuccess(writer => WriteQuickInfo(writer, document, model, position)),
                    "signatureHelp" => SerializeFeatureSuccess(writer => WriteSignatureHelp(writer, document, model, position)),
                    "definition" => SerializeFeatureSuccess(writer => WriteDefinitions(writer, document, model, position)),
                    _ => throw new LanguageServiceFailure("UNKNOWN_MESSAGE_TYPE", "Unknown language feature operation."),
                };
            }
        }
        catch (LanguageServiceFailure failure)
        {
            return SerializeFeatureFailure(failure.Code, failure.Message);
        }
        catch (Exception exception)
        {
            return SerializeFeatureFailure("INTERNAL_ERROR", $"{exception.GetType().Name}: {exception.Message}");
        }
    }

    private static ISymbol? SymbolAt(SemanticModel model, SyntaxTree tree, int position)
    {
        var textLength = tree.GetText().Length;
        foreach (var candidate in new[] {
            Math.Clamp(position, 0, Math.Max(0, textLength - 1)),
            Math.Clamp(position - 1, 0, Math.Max(0, textLength - 1)),
        }.Distinct())
        {
            var token = tree.GetRoot().FindToken(candidate);
            foreach (var node in token.Parent?.AncestorsAndSelf() ?? Enumerable.Empty<SyntaxNode>())
            {
                var symbol = model.GetSymbolInfo(node).Symbol ?? model.GetTypeInfo(node).Type;
                if (symbol is not null) return symbol;
            }
        }
        return null;
    }

    private static void WriteQuickInfo(Utf8JsonWriter writer, LanguageDocument document, SemanticModel model, int position)
    {
        var symbol = SymbolAt(model, document.Tree, position);
        writer.WriteStartObject();
        if (symbol is null)
        {
            writer.WriteBoolean("found", false);
        }
        else
        {
            writer.WriteBoolean("found", true);
            writer.WriteString("display", symbol.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat));
            writer.WriteString("kind", symbol.Kind.ToString());
            var documentation = symbol.GetDocumentationCommentXml(cancellationToken: default);
            if (!string.IsNullOrEmpty(documentation)) writer.WriteString("documentation", documentation);
        }
        writer.WriteEndObject();
    }

    private static void WriteSignatureHelp(Utf8JsonWriter writer, LanguageDocument document, SemanticModel model, int position)
    {
        var safePosition = Math.Max(0, Math.Min(position, document.Text.Length));
        var token = document.Tree.GetRoot().FindToken(Math.Max(0, safePosition - 1));
        var invocation = token.Parent?.AncestorsAndSelf().OfType<InvocationExpressionSyntax>().FirstOrDefault();
        var methods = new List<IMethodSymbol>();
        if (invocation is not null)
        {
            var info = model.GetSymbolInfo(invocation);
            methods.AddRange(info.CandidateSymbols.OfType<IMethodSymbol>());
            if (info.Symbol is IMethodSymbol selectedMethod) methods.Add(selectedMethod);
        }
        var distinctMethods = methods
            .GroupBy(method => method.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat), StringComparer.Ordinal)
            .Select(group => group.First())
            .Take(20)
            .ToArray();
        var activeParameter = invocation?.ArgumentList.Arguments.Count(argument => argument.SpanStart < safePosition) ?? 0;
        writer.WriteStartObject();
        writer.WriteNumber("activeParameter", activeParameter);
        writer.WriteStartArray("signatures");
        foreach (var method in distinctMethods)
        {
            writer.WriteStartObject();
            writer.WriteString("label", method.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat));
            writer.WriteStartArray("parameters");
            foreach (var parameter in method.Parameters)
            {
                writer.WriteStartObject();
                writer.WriteString("label", parameter.ToDisplayString(SymbolDisplayFormat.MinimallyQualifiedFormat));
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static void WriteDefinitions(Utf8JsonWriter writer, LanguageDocument document, SemanticModel model, int position)
    {
        var symbol = SymbolAt(model, document.Tree, position);
        writer.WriteStartObject();
        writer.WriteStartArray("locations");
        if (symbol is not null)
        {
            foreach (var location in symbol.Locations.Where(location => location.IsInSource && location.SourceTree is not null).Take(8))
            {
                var span = location.GetLineSpan();
                writer.WriteStartObject();
                writer.WriteString("path", span.Path);
                writer.WriteNumber("startLine", span.StartLinePosition.Line + 1);
                writer.WriteNumber("startColumn", span.StartLinePosition.Character + 1);
                writer.WriteNumber("endLine", span.EndLinePosition.Line + 1);
                writer.WriteNumber("endColumn", span.EndLinePosition.Character + 1);
                writer.WriteEndObject();
            }
        }
        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static string SerializeFeatureSuccess(Action<Utf8JsonWriter> writeData)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", true);
            writer.WritePropertyName("data");
            writeData(writer);
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string SerializeFeatureFailure(string code, string message)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteBoolean("success", false);
            writer.WriteStartObject("error");
            writer.WriteString("code", code);
            writer.WriteString("message", message);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    [JSExport]
    public static string LanguageServiceHandle(string? requestJson)
    {
        string? type = null;
        string? correlationId = null;
        try
        {
            if (string.IsNullOrEmpty(requestJson) || requestJson.Length > 8 * 1024 * 1024)
                throw new LanguageServiceFailure("MESSAGE_TOO_LARGE", "Language request exceeds the size limit.");
            using var document = JsonDocument.Parse(requestJson);
            var root = document.RootElement;
            if (!root.TryGetProperty("protocolVersion", out var protocol) || protocol.ValueKind != JsonValueKind.Number)
                throw new LanguageServiceFailure("MISSING_PROTOCOL_VERSION", "protocolVersion is required.", control: true);
            if (protocol.GetInt32() != 1)
                throw new LanguageServiceFailure("UNSUPPORTED_PROTOCOL_VERSION", "Unsupported language protocol version.", control: true);
            type = root.GetProperty("type").GetString();
            correlationId = root.GetProperty("correlationId").GetString();
            if (!IsCanonicalUuidV4(correlationId) || string.IsNullOrEmpty(type))
                throw new LanguageServiceFailure("MALFORMED_ENVELOPE", "Language envelope identity is invalid.", control: true);
            var payload = root.GetProperty("payload");
            return type switch
            {
                "language.session.open.request" => HandleLanguageSessionOpen(correlationId!, type!, payload),
                "language.session.close.request" => HandleLanguageSessionClose(correlationId!, type!, payload),
                "language.document.open.request" => HandleLanguageDocument(correlationId!, type!, payload, replace: false),
                "language.document.replace.request" => HandleLanguageDocument(correlationId!, type!, payload, replace: true),
                "language.document.close.request" => HandleLanguageDocumentClose(correlationId!, type!, payload),
                "language.completion.request" => HandleLanguageCompletion(correlationId!, type!, payload),
                _ => throw new LanguageServiceFailure("UNKNOWN_MESSAGE_TYPE", "Unknown language-service message type.", control: true),
            };
        }
        catch (LanguageServiceFailure failure)
        {
            if (failure.Control || !IsCanonicalUuidV4(correlationId) || string.IsNullOrEmpty(type))
                return SerializeLanguageControlError(failure.Code, failure.Message, correlationId, type);
            return SerializeLanguageResponseError(correlationId!, ResponseTypeFor(type!), failure.Code, failure.Message);
        }
        catch (Exception exception)
        {
            if (!IsCanonicalUuidV4(correlationId) || string.IsNullOrEmpty(type))
                return SerializeLanguageControlError("INTERNAL_ERROR", "Language service request failed.", correlationId, type);
            return SerializeLanguageResponseError(correlationId!, ResponseTypeFor(type!), "INTERNAL_ERROR", $"{exception.GetType().Name}: {exception.Message}");
        }
    }

    private static string HandleLanguageSessionOpen(string correlationId, string type, JsonElement payload)
    {
        var sessionId = RequireUuid(payload, "sessionId");
        lock (LanguageSessionLock)
        {
            if (_languageSession is not null && _languageSession.Id != sessionId)
                throw new LanguageServiceFailure("LANGUAGE_SESSION_CONFLICT", "A different language session is active.");
            _languageSession ??= new LanguageSession(sessionId);
            if (payload.TryGetProperty("documents", out var documents))
            {
                if (documents.ValueKind != JsonValueKind.Array || documents.GetArrayLength() > 256)
                    throw new LanguageServiceFailure("TOO_MANY_DOCUMENTS", "Language session document limit exceeded.");
                foreach (var document in documents.EnumerateArray())
                    UpsertLanguageDocument(_languageSession, document, replace: false);
            }
            return SerializeLanguageResponse(correlationId, type, writer =>
            {
                writer.WriteStartObject("data");
                writer.WriteString("sessionId", sessionId);
                writer.WriteBoolean("accepted", true);
                writer.WriteEndObject();
            });
        }
    }

    private static string HandleLanguageSessionClose(string correlationId, string type, JsonElement payload)
    {
        var sessionId = RequireUuid(payload, "sessionId");
        lock (LanguageSessionLock)
        {
            if (_languageSession?.Id == sessionId) _languageSession = null;
            return SerializeLanguageResponse(correlationId, type, writer =>
            {
                writer.WriteStartObject("data");
                writer.WriteString("sessionId", sessionId);
                writer.WriteBoolean("accepted", true);
                writer.WriteEndObject();
            });
        }
    }

    private static string HandleLanguageDocument(string correlationId, string type, JsonElement payload, bool replace)
    {
        var sessionId = RequireUuid(payload, "sessionId");
        var uri = RequireDocumentUri(payload, "uri");
        var path = RequireLogicalPath(payload, "path");
        var version = RequireVersion(payload, "version");
        var text = RequireDocumentText(payload, "text");
        lock (LanguageSessionLock)
        {
            var session = RequireLanguageSession(sessionId);
            if (replace && !session.Documents.ContainsKey(uri))
                throw new LanguageServiceFailure("DOCUMENT_NOT_FOUND", "Language document was not opened.");
            if (session.Documents.TryGetValue(uri, out var existing))
            {
                if (version < existing.Version)
                    throw new LanguageServiceFailure("STALE_DOCUMENT_VERSION", "Document version is stale.");
                if (version == existing.Version && (existing.Text != text || existing.Path != path))
                    throw new LanguageServiceFailure("DOCUMENT_VERSION_CONFLICT", "Document version conflicts with stored text.");
                if (version == existing.Version)
                    return SerializeLanguageDocumentResponse(correlationId, type, existing);
            }
            var next = new LanguageDocument(uri, path, version, text, CSharpSyntaxTree.ParseText(
                SourceText.From(text, Encoding.UTF8), new CSharpParseOptions(LanguageVersion.CSharp13), path));
            session.Documents[uri] = next;
            RebuildLanguageCompilation(session);
            return SerializeLanguageDocumentResponse(correlationId, type, next);
        }
    }

    private static string HandleLanguageDocumentClose(string correlationId, string type, JsonElement payload)
    {
        var sessionId = RequireUuid(payload, "sessionId");
        var uri = RequireDocumentUri(payload, "uri");
        var version = RequireVersion(payload, "version");
        lock (LanguageSessionLock)
        {
            var session = RequireLanguageSession(sessionId);
            if (session.Documents.TryGetValue(uri, out var existing) && version < existing.Version)
                throw new LanguageServiceFailure("STALE_DOCUMENT_VERSION", "Document version is stale.");
            session.Documents.Remove(uri);
            RebuildLanguageCompilation(session);
            return SerializeLanguageResponse(correlationId, type, writer =>
            {
                writer.WriteStartObject("data");
                writer.WriteString("sessionId", sessionId);
                writer.WriteString("uri", uri);
                writer.WriteNumber("version", version);
                writer.WriteBoolean("accepted", true);
                writer.WriteEndObject();
            });
        }
    }

    private static string HandleLanguageCompletion(string correlationId, string type, JsonElement payload)
    {
        var sessionId = RequireUuid(payload, "sessionId");
        var uri = RequireDocumentUri(payload, "uri");
        var version = RequireVersion(payload, "version");
        var position = payload.GetProperty("position");
        var offset = position.GetProperty("offset").GetInt32();
        if (offset < 0) throw new LanguageServiceFailure("MALFORMED_PAYLOAD", "Completion offset is invalid.");
        lock (LanguageSessionLock)
        {
            var session = RequireLanguageSession(sessionId);
            if (!session.Documents.TryGetValue(uri, out var document))
                throw new LanguageServiceFailure("DOCUMENT_NOT_FOUND", "Language document was not opened.");
            if (version != document.Version)
                throw new LanguageServiceFailure("STALE_DOCUMENT_VERSION", "Completion requested for a stale document version.");
            if (session.Compilation is null)
                throw new LanguageServiceFailure("INVALID_STATE", "Language compilation is not initialized.");
            var positionInText = Math.Min(offset, document.Text.Length);
            var token = document.Tree.GetRoot().FindToken(Math.Max(0, positionInText - 1));
            var access = token.Parent?.AncestorsAndSelf().OfType<MemberAccessExpressionSyntax>().FirstOrDefault();
            var receiverType = access is null ? null : session.Compilation.GetSemanticModel(document.Tree).GetTypeInfo(access.Expression).Type;
            var items = receiverType?.GetMembers()
                .Where(symbol => !symbol.IsImplicitlyDeclared && !string.IsNullOrEmpty(symbol.Name) && IsCompletionPolicyAllowed(symbol))
                .Select(symbol => (Name: symbol.Name, Kind: CompletionKind(symbol.Kind)))
                .Distinct()
                .OrderBy(item => item.Name, StringComparer.Ordinal)
                .ThenBy(item => item.Kind, StringComparer.Ordinal)
                .Take(100)
                .ToArray() ?? Array.Empty<(string Name, string Kind)>();
            return SerializeLanguageResponse(correlationId, type, writer =>
            {
                writer.WriteStartObject("data");
                writer.WriteString("sessionId", sessionId);
                writer.WriteString("uri", uri);
                writer.WriteNumber("version", version);
                writer.WriteStartArray("items");
                foreach (var item in items)
                {
                    writer.WriteStartObject();
                    writer.WriteString("label", item.Name);
                    writer.WriteString("kind", item.Kind);
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
                writer.WriteBoolean("isIncomplete", false);
                writer.WriteEndObject();
            });
        }
    }

    private static void UpsertLanguageDocument(LanguageSession session, JsonElement payload, bool replace)
    {
        var uri = RequireDocumentUri(payload, "uri");
        var path = RequireLogicalPath(payload, "path");
        var version = RequireVersion(payload, "version");
        var text = RequireDocumentText(payload, "text");
        if (replace && !session.Documents.ContainsKey(uri))
            throw new LanguageServiceFailure("DOCUMENT_NOT_FOUND", "Language document was not opened.");
        if (!session.Documents.ContainsKey(uri) && session.Documents.Count >= 256)
            throw new LanguageServiceFailure("TOO_MANY_DOCUMENTS", "Language session document limit exceeded.");
        var aggregateBytes = session.Documents.Values.Sum(document => Encoding.UTF8.GetByteCount(document.Text));
        if (session.Documents.TryGetValue(uri, out var existing))
        {
            if (version < existing.Version)
                throw new LanguageServiceFailure("STALE_DOCUMENT_VERSION", "Document version is stale.");
            if (version == existing.Version && (existing.Text != text || existing.Path != path))
                throw new LanguageServiceFailure("DOCUMENT_VERSION_CONFLICT", "Document version conflicts with stored text.");
            if (version == existing.Version) return;
            aggregateBytes -= Encoding.UTF8.GetByteCount(existing.Text);
        }
        if (aggregateBytes + Encoding.UTF8.GetByteCount(text) > 8 * 1024 * 1024)
            throw new LanguageServiceFailure("LANGUAGE_SESSION_CONFLICT", "Language session text exceeds its aggregate limit.");
        session.Documents[uri] = new LanguageDocument(
            uri, path, version, text,
            CSharpSyntaxTree.ParseText(SourceText.From(text, Encoding.UTF8), new CSharpParseOptions(LanguageVersion.CSharp13), path));
        RebuildLanguageCompilation(session);
    }

    private static void RebuildLanguageCompilation(LanguageSession session)
    {
        session.Compilation = CSharpCompilation.Create(
            "LanguageSession",
            session.Documents.Values.Select(document => document.Tree),
            BrowserMetadataReferences.Allowlisted,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, allowUnsafe: false, concurrentBuild: false, deterministic: true));
    }

    private static LanguageSession RequireLanguageSession(string id) =>
        _languageSession is { } session && session.Id == id
            ? session
            : throw new LanguageServiceFailure("LANGUAGE_SESSION_NOT_FOUND", "Language session was not opened.");

    private static string RequireUuid(JsonElement payload, string name)
    {
        var value = payload.GetProperty(name).GetString();
        if (!IsCanonicalUuidV4(value)) throw new LanguageServiceFailure("MALFORMED_PAYLOAD", $"{name} must be a canonical UUIDv4.");
        return value!;
    }

    private static int RequireVersion(JsonElement payload, string name)
    {
        var value = payload.GetProperty(name).GetInt32();
        if (value < 1) throw new LanguageServiceFailure("MALFORMED_PAYLOAD", $"{name} must be positive.");
        return value;
    }

    private static string RequireDocumentUri(JsonElement payload, string name)
    {
        var value = payload.GetProperty(name).GetString();
        if (string.IsNullOrEmpty(value) || value.Length > 512 || !value.StartsWith("playground-model://", StringComparison.Ordinal) || value.Contains("..", StringComparison.Ordinal) || value.Contains('\\'))
            throw new LanguageServiceFailure("MALFORMED_PAYLOAD", "uri must be a stable playground-model URI.");
        return value;
    }

    private static string RequireLogicalPath(JsonElement payload, string name)
    {
        var value = payload.GetProperty(name).GetString();
        if (string.IsNullOrEmpty(value) || value.Length > 512 || value.StartsWith('/') || value.EndsWith('/') || value.Contains('\\') || value.Split('/').Any(segment => segment is "" or "." or ".."))
            throw new LanguageServiceFailure("MALFORMED_PAYLOAD", "path must be canonical and relative.");
        return value;
    }

    private static string RequireDocumentText(JsonElement payload, string name)
    {
        var value = payload.GetProperty(name).GetString();
        if (value is null || Encoding.UTF8.GetByteCount(value) > 1024 * 1024)
            throw new LanguageServiceFailure("DOCUMENT_TEXT_TOO_LARGE", "Document text exceeds the 1 MiB limit.");
        return value;
    }

    private static bool IsCanonicalUuidV4(string? value) =>
        value is not null && Guid.TryParseExact(value, "D", out var id) && id.Version == 4 && id.ToString("D") == value;

    private static bool IsCompletionPolicyAllowed(ISymbol symbol)
    {
        // Completion is advisory, but do not knowingly advertise the primary
        // native/JS interop escape hatches that PolicyAnalyzer rejects at Run.
        return symbol.Name is not ("DllImport" or "UnmanagedCallersOnly" or
            "LibraryImport" or "JSImport" or "JSExport" or "Marshal" or
            "NativeLibrary") && !symbol.Name.StartsWith("Unsafe", StringComparison.Ordinal);
    }

    private static string CompletionKind(SymbolKind kind) => kind switch
    {
        SymbolKind.NamedType => "class",
        SymbolKind.Method => "method",
        SymbolKind.Property => "property",
        SymbolKind.Field => "field",
        SymbolKind.Namespace => "namespace",
        SymbolKind.Local or SymbolKind.Parameter => "variable",
        _ => "other",
    };

    private static string ResponseTypeFor(string type) => type.Replace(".request", ".response", StringComparison.Ordinal);

    private static string SerializeLanguageDocumentResponse(string correlationId, string type, LanguageDocument document) =>
        SerializeLanguageResponse(correlationId, type, writer =>
        {
            writer.WriteStartObject("data");
            writer.WriteString("uri", document.Uri);
            writer.WriteString("path", document.Path);
            writer.WriteNumber("version", document.Version);
            writer.WriteString("text", document.Text);
            writer.WriteEndObject();
        });

    private static string SerializeLanguageResponse(string correlationId, string type, Action<Utf8JsonWriter> writeData)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("protocolVersion", 1);
            writer.WriteString("correlationId", correlationId);
            writer.WriteString("type", ResponseTypeFor(type));
            writer.WriteStartObject("result");
            writer.WriteBoolean("success", true);
            writeData(writer);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string SerializeLanguageResponseError(string correlationId, string type, string code, string message)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("protocolVersion", 1);
            writer.WriteString("correlationId", correlationId);
            writer.WriteString("type", ResponseTypeFor(type));
            writer.WriteStartObject("result");
            writer.WriteBoolean("success", false);
            writer.WriteStartObject("error");
            writer.WriteString("code", code);
            writer.WriteString("message", message);
            writer.WriteEndObject();
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static string SerializeLanguageControlError(string code, string message, string? correlationId, string? type)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteNumber("protocolVersion", 1);
            writer.WriteString("correlationId", Guid.NewGuid().ToString("D"));
            writer.WriteString("type", "protocol.error");
            writer.WriteStartObject("payload");
            writer.WriteStartObject("error");
            writer.WriteString("code", code);
            writer.WriteString("message", message);
            writer.WriteEndObject();
            if (IsCanonicalUuidV4(correlationId)) writer.WriteString("rejectedCorrelationId", correlationId);
            if (!string.IsNullOrEmpty(type)) writer.WriteString("rejectedType", type);
            writer.WriteEndObject();
            writer.WriteEndObject();
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private sealed class LanguageSession(string id)
    {
        public string Id { get; } = id;
        public Dictionary<string, LanguageDocument> Documents { get; } = new(StringComparer.Ordinal);
        public CSharpCompilation? Compilation { get; set; }
    }

    private sealed record LanguageDocument(string Uri, string Path, int Version, string Text, SyntaxTree Tree);
    private sealed class LanguageServiceFailure(string code, string message, bool control = false) : Exception(code)
    {
        public string Code { get; } = code;
        public string MessageText { get; } = message;
        public bool Control { get; } = control;
        public override string Message => MessageText;
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
                .Where(symbol => !symbol.IsImplicitlyDeclared && !string.IsNullOrEmpty(symbol.Name) && IsCompletionPolicyAllowed(symbol))
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

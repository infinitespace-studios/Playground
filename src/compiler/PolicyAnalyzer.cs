using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

namespace Playground.Compiler;

public static class PolicyAnalyzer
{
    private const string JavaScriptInteropNamespace =
        "System.Runtime.InteropServices.JavaScript";

    public static IReadOnlyList<CompilerDiagnostic> Analyze(CSharpCompilation compilation)
    {
        var diagnostics = new List<CompilerDiagnostic>();

        foreach (var tree in compilation.SyntaxTrees)
        {
            var root = tree.GetRoot();
            var model = compilation.GetSemanticModel(tree);

            AnalyzeAttributes(tree, root, model, diagnostics);
            AnalyzeUnsafeSyntax(tree, root, diagnostics);
            AnalyzeJavaScriptInterop(tree, root, model, diagnostics);
        }

        return diagnostics
            .DistinctBy(diagnostic => (
                diagnostic.Id,
                diagnostic.File,
                diagnostic.Line,
                diagnostic.Column))
            .ToArray();
    }

    private static void AnalyzeAttributes(
        SyntaxTree tree,
        SyntaxNode root,
        SemanticModel model,
        List<CompilerDiagnostic> diagnostics)
    {
        foreach (var attribute in root.DescendantNodes().OfType<AttributeSyntax>())
        {
            var constructor = model.GetSymbolInfo(attribute).Symbol as IMethodSymbol;
            var attributeType = constructor?.ContainingType;
            if (IsType(
                    attributeType,
                    "System.Runtime.InteropServices",
                    "DllImportAttribute"))
            {
                diagnostics.Add(MakeDiagnostic(
                    "PG0101",
                    "DllImport is not permitted in playground code.",
                    tree,
                    attribute.Name.GetLocation()));
            }
            else if (IsType(
                         attributeType,
                         "System.Runtime.InteropServices",
                         "UnmanagedCallersOnlyAttribute"))
            {
                diagnostics.Add(MakeDiagnostic(
                    "PG0102",
                    "UnmanagedCallersOnly is not permitted in playground code.",
                    tree,
                    attribute.Name.GetLocation()));
            }
        }
    }

    private static void AnalyzeUnsafeSyntax(
        SyntaxTree tree,
        SyntaxNode root,
        List<CompilerDiagnostic> diagnostics)
    {
        var candidates = new List<(SyntaxNode Anchor, Location Location)>();

        candidates.AddRange(root.DescendantTokens()
            .Where(token =>
                token.IsKind(SyntaxKind.UnsafeKeyword) ||
                token.IsKind(SyntaxKind.FixedKeyword))
            .Select(token => (token.Parent!, token.GetLocation())));
        candidates.AddRange(root.DescendantNodes()
            .OfType<PointerTypeSyntax>()
            .Select(node => ((SyntaxNode)node, node.GetLocation())));
        candidates.AddRange(root.DescendantNodes()
            .OfType<StackAllocArrayCreationExpressionSyntax>()
            .Select(node => ((SyntaxNode)node, node.StackAllocKeyword.GetLocation())));
        candidates.AddRange(root.DescendantNodes()
            .OfType<ImplicitStackAllocArrayCreationExpressionSyntax>()
            .Select(node => ((SyntaxNode)node, node.StackAllocKeyword.GetLocation())));
        var anchors = candidates.Select(candidate => candidate.Anchor).ToHashSet();
        foreach (var candidate in candidates
                     .Where(candidate =>
                         !candidate.Anchor.Ancestors().Any(anchors.Contains))
                     .OrderBy(candidate => candidate.Location.SourceSpan.Start))
        {
            diagnostics.Add(MakeDiagnostic(
                "PG0103",
                "Unsafe code is not permitted in playground code.",
                tree,
                candidate.Location));
        }
    }

    private static void AnalyzeJavaScriptInterop(
        SyntaxTree tree,
        SyntaxNode root,
        SemanticModel model,
        List<CompilerDiagnostic> diagnostics)
    {
        var sourceDefinesBlockedNamespace = root.DescendantNodes()
            .OfType<BaseNamespaceDeclarationSyntax>()
            .Any(declaration =>
                IsJavaScriptInteropName(declaration.Name.ToString()));
        var blockedAliases = root.DescendantNodes()
            .OfType<UsingDirectiveSyntax>()
            .Where(usingDirective =>
                usingDirective.Alias is not null &&
                usingDirective.Name is not null &&
                IsBlockedReference(
                    usingDirective.Name,
                    model,
                    sourceDefinesBlockedNamespace,
                    null))
            .Select(usingDirective => usingDirective.Alias!.Name.Identifier.ValueText)
            .ToHashSet(StringComparer.Ordinal);

        foreach (var usingDirective in root.DescendantNodes().OfType<UsingDirectiveSyntax>())
        {
            if (usingDirective.Name is not null &&
                IsBlockedReference(
                    usingDirective.Name,
                    model,
                    sourceDefinesBlockedNamespace,
                    blockedAliases))
            {
                diagnostics.Add(MakeDiagnostic(
                    "PG0104",
                    "Direct System.Runtime.InteropServices.JavaScript use is not permitted in playground code.",
                    tree,
                    usingDirective.Name.GetLocation()));
            }
        }

        var blockedMemberAccesses = root.DescendantNodes()
            .OfType<MemberAccessExpressionSyntax>()
            .Where(node =>
                !node.Ancestors().OfType<UsingDirectiveSyntax>().Any() &&
                IsBlockedReference(
                    node,
                    model,
                    sourceDefinesBlockedNamespace,
                    blockedAliases))
            .ToArray();
        var blockedMemberSet = blockedMemberAccesses.ToHashSet();
        foreach (var memberAccess in blockedMemberAccesses
                     .Where(node =>
                         !node.Ancestors()
                             .OfType<MemberAccessExpressionSyntax>()
                             .Any(blockedMemberSet.Contains)))
        {
            diagnostics.Add(MakeDiagnostic(
                "PG0104",
                "Direct System.Runtime.InteropServices.JavaScript use is not permitted in playground code.",
                tree,
                memberAccess.GetLocation()));
        }

        foreach (var name in root.DescendantNodes().OfType<NameSyntax>())
        {
            if (name.Ancestors().Any(ancestor =>
                    ancestor is UsingDirectiveSyntax ||
                    ancestor is BaseNamespaceDeclarationSyntax) ||
                name.AncestorsAndSelf()
                    .OfType<MemberAccessExpressionSyntax>()
                    .Any(blockedMemberSet.Contains) ||
                name.Parent is NameSyntax &&
                IsBlockedReference(
                    (NameSyntax)name.Parent,
                    model,
                    sourceDefinesBlockedNamespace,
                    blockedAliases) ||
                !IsBlockedReference(
                    name,
                    model,
                    sourceDefinesBlockedNamespace,
                    blockedAliases))
            {
                continue;
            }

            diagnostics.Add(MakeDiagnostic(
                "PG0104",
                "Direct System.Runtime.InteropServices.JavaScript use is not permitted in playground code.",
                tree,
                name.GetLocation()));
        }
    }

    private static bool IsBlockedReference(
        SyntaxNode node,
        SemanticModel model,
        bool sourceDefinesBlockedNamespace,
        IReadOnlySet<string>? blockedAliases)
    {
        var alias = node is NameSyntax name ? model.GetAliasInfo(name) : null;
        var symbolInfo = model.GetSymbolInfo(node);
        var symbol = alias?.Target ?? symbolInfo.Symbol ??
            symbolInfo.CandidateSymbols.FirstOrDefault();
        if (IsJavaScriptInteropSymbol(symbol))
        {
            return true;
        }

        if (symbol is not null && symbol.Kind != SymbolKind.ErrorType)
        {
            return false;
        }

        if (sourceDefinesBlockedNamespace)
        {
            return false;
        }

        var text = node.ToString().Replace("global::", "", StringComparison.Ordinal);
        if (IsJavaScriptInteropName(text))
        {
            return true;
        }

        var firstSegment = text.Split(['.', ':'], 2)[0];
        return blockedAliases?.Contains(firstSegment) == true;
    }

    private static bool IsJavaScriptInteropSymbol(ISymbol? symbol)
    {
        symbol = symbol is IAliasSymbol alias ? alias.Target : symbol;
        if (symbol is null || symbol.Locations.Any(location => location.IsInSource))
        {
            return false;
        }

        var namespaceName = symbol switch
        {
            INamespaceSymbol namespaceSymbol => namespaceSymbol.ToDisplayString(),
            INamedTypeSymbol typeSymbol => typeSymbol.ContainingNamespace.ToDisplayString(),
            _ => symbol.ContainingType?.ContainingNamespace.ToDisplayString() ??
                symbol.ContainingNamespace?.ToDisplayString() ??
                "",
        };
        return IsJavaScriptInteropName(namespaceName);
    }

    private static bool IsJavaScriptInteropName(string name) =>
        name == JavaScriptInteropNamespace ||
        name.StartsWith(JavaScriptInteropNamespace + ".", StringComparison.Ordinal);

    private static bool IsType(
        INamedTypeSymbol? type,
        string namespaceName,
        string metadataName) =>
        type?.MetadataName == metadataName &&
        type.ContainingNamespace.ToDisplayString() == namespaceName &&
        !type.Locations.Any(location => location.IsInSource);

    private static CompilerDiagnostic MakeDiagnostic(
        string id,
        string message,
        SyntaxTree tree,
        Location location)
    {
        var lineSpan = location.GetMappedLineSpan();
        return new CompilerDiagnostic(
            "playground",
            "error",
            id,
            message,
            lineSpan.IsValid ? lineSpan.Path : tree.FilePath,
            lineSpan.IsValid ? lineSpan.StartLinePosition.Line + 1 : 0,
            lineSpan.IsValid ? lineSpan.StartLinePosition.Character + 1 : 0);
    }
}

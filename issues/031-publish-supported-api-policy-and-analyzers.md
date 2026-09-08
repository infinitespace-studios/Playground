# Publish supported-API policy and analyzers

**Type:** AFK
**Status:** Done
**Blocked by:** [019-build-runtime-reference-assembly-allowlist.md](019-build-runtime-reference-assembly-allowlist.md)
**PRD references:** 12.3, 16
**User stories:** US2, US9
**Triage:** needs-triage

## Context

PRD section 12.3 requires the repository to publish a versioned supported-API policy containing allowed assembly identities, allowed/prohibited namespaces/types/members, reflection behavior and rooted reflection metadata, exact handling of `DllImport`, `UnmanagedCallersOnly`, `Marshal`, unsafe code, indirect native calls, and JavaScript interop, and the analyzer diagnostic associated with each prohibited category. It explicitly states an assembly allowlist alone is not considered an API or security boundary — this policy document plus enforcing analyzers are required in addition to issue 19's reference allowlist. Section 16 requires excluding JavaScript interop and direct native interop assemblies from compiler references unless explicitly approved. This issue authors the policy document and wires a Roslyn analyzer/syntax-walker into `CompilationService` that inspects the parsed syntax trees for prohibited constructs before/during compilation.

## What to build

Create `docs/supported-api-policy.md` documenting the full policy per PRD 12.3, and implement a Roslyn syntax-analysis pass in `src/compiler/` (e.g. `PolicyAnalyzer.cs`) that walks each compiled syntax tree for `DllImportAttribute` usage, `UnmanagedCallersOnlyAttribute` usage, `unsafe` code blocks/keywords, and any reference to a small explicit blocklist of native/JS-interop-capable namespaces, producing a `PlaygroundDiagnostic` with a distinct diagnostic ID for each prohibited category, integrated into `CompilationService.Compile`'s returned diagnostics list.

## Scope

### In scope

- `docs/supported-api-policy.md`: allowed assembly identities (reuse issue 19's `docs/reference-allowlist.json` list), allowed/prohibited namespace list, reflection policy statement, and one diagnostic ID per prohibited category (e.g. `PG0101` DllImport, `PG0102` UnmanagedCallersOnly, `PG0103` unsafe code, `PG0104` JS interop)
- `src/compiler/PolicyAnalyzer.cs`: a syntax-walker producing `PlaygroundDiagnostic` entries for each prohibited construct found
- Wiring `PolicyAnalyzer` into `CompilationService.Compile` so its diagnostics are merged with Roslyn's own compiler diagnostics in the returned result
- Unit-style proof for at least the `DllImport` and `unsafe` categories (the JS-interop and `UnmanagedCallersOnly` rejection proofs are covered by issue 32, which depends on this issue's analyzer)

### Out of scope

- Rejecting the actual constructs at the language/compiler-options level (e.g. `AllowUnsafe=false` in `CSharpCompilationOptions`, already set in issue 17, prevents `unsafe` code from compiling at all via a normal Roslyn diagnostic — this issue's analyzer is for constructs that would otherwise compile successfully, like `DllImport` on a non-unsafe method) — clearly distinguish which prohibited categories are already blocked by Roslyn's own compiler options versus which require this custom analyzer
- The full end-to-end interop-rejection test suite (issue 32)

## Implementation guidance

1. Create `docs/supported-api-policy.md` with sections: "Allowed assembly identities" (link to `docs/reference-allowlist.json`), "Allowed namespaces" (System.*, Microsoft.Xna.Framework.*, netstandard-exposed types), "Prohibited constructs" (a table: construct → diagnostic ID → reason), "Reflection policy" (reflection over user/MonoGame types is allowed; reflection is not a bypass for prohibited constructs since the analyzer inspects syntax, not just direct calls), "Analyzer enforcement" (state that `PolicyAnalyzer` runs on every compile before/alongside Roslyn's own diagnostics).
2. Implement `src/compiler/PolicyAnalyzer.cs`:
```csharp
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;

public static class PolicyAnalyzer
{
    public static IReadOnlyList<PlaygroundDiagnostic> Analyze(SyntaxTree tree)
    {
        var diagnostics = new List<PlaygroundDiagnostic>();
        var root = tree.GetRoot();

        foreach (var attr in root.DescendantNodes().OfType<AttributeSyntax>())
        {
            var name = attr.Name.ToString();
            if (name.Contains("DllImport"))
                diagnostics.Add(MakeDiagnostic("PG0101", "DllImport is not permitted in playground code.", tree, attr));
            if (name.Contains("UnmanagedCallersOnly"))
                diagnostics.Add(MakeDiagnostic("PG0102", "UnmanagedCallersOnly is not permitted in playground code.", tree, attr));
        }

        foreach (var unsafeNode in root.DescendantNodes().Where(n => n is UnsafeStatementSyntax))
            diagnostics.Add(MakeDiagnostic("PG0103", "Unsafe code blocks are not permitted in playground code.", tree, unsafeNode));

        // Prohibited namespace usage (e.g. anything under System.Runtime.InteropServices.JavaScript,
        // which would allow direct JS interop bypassing the protocol boundary).
        foreach (var usingDirective in root.DescendantNodes().OfType<UsingDirectiveSyntax>())
        {
            var ns = usingDirective.Name?.ToString() ?? "";
            if (ns.StartsWith("System.Runtime.InteropServices.JavaScript"))
                diagnostics.Add(MakeDiagnostic("PG0104", "Direct JavaScript interop is not permitted in playground code.", tree, usingDirective));
        }

        return diagnostics;
    }

    private static PlaygroundDiagnostic MakeDiagnostic(string id, string message, SyntaxTree tree, SyntaxNode node)
    {
        var span = node.GetLocation().GetLineSpan();
        return new PlaygroundDiagnostic("error", id, message, tree.FilePath, span.StartLinePosition.Line + 1, span.StartLinePosition.Character + 1);
    }
}
```
3. In `CompilationService.Compile`, after parsing each `SyntaxTree` and before/alongside `compilation.Emit`, call `PolicyAnalyzer.Analyze` on every tree, merge its diagnostics into the returned `Diagnostics` list, and treat any `PolicyAnalyzer` diagnostic as compile failure (`Success = false`) even if Roslyn's own `Emit` would otherwise have succeeded.
4. Test with a source containing `[System.Runtime.InteropServices.DllImport("user32.dll")] static extern int MessageBox(...);` and confirm diagnostic `PG0101` is returned and `Success == false`.

## Acceptance criteria

- [x] `docs/supported-api-policy.md` documents allowed assembly identities, allowed namespaces, a table of prohibited constructs with their diagnostic IDs, and the reflection policy statement
- [x] `PolicyAnalyzer.Analyze` detects `DllImportAttribute` usage and returns diagnostic `PG0101` with the correct file/line
- [x] `PolicyAnalyzer.Analyze` detects `UnmanagedCallersOnlyAttribute` usage and returns diagnostic `PG0102`
- [x] `PolicyAnalyzer.Analyze` detects `unsafe` blocks and returns diagnostic `PG0103`
- [x] `CompilationService.Compile` merges `PolicyAnalyzer` diagnostics into its result and treats any of them as a compile failure

## Verification

Compile a test source containing a `DllImport`-attributed method through `CompilationService.Compile` and confirm the result has `Success = false` with a `PG0101` diagnostic at the correct line. Repeat for a source containing an `unsafe` block (confirm `PG0103`) and for one referencing `System.Runtime.InteropServices.JavaScript` (confirm `PG0104`). The verifier must run all three cases and check the exact diagnostic ID and line number returned for each.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-031 verifier
- **Date:** 2026-08-28
- **Evidence:** Semantic PG0101-PG0104 forms, lookalike false-positive
  controls, deterministic diagnostics, no-binary policy failures, all 13
  allowlist identities, and issue-030 regression passed. Unmanaged function
  pointers remain reserved for issue 032. Committed as `c09062a`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: publish supported-API policy and enforce it with an analyzer`

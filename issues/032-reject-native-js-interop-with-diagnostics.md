# Reject native/JavaScript interop with diagnostics

**Type:** AFK
**Status:** Done
**Blocked by:** [031-publish-supported-api-policy-and-analyzers.md](031-publish-supported-api-policy-and-analyzers.md)
**PRD references:** 12.3, 16
**User stories:** US2, US9
**Triage:** needs-triage

## Context

This issue extends issue 31's `PolicyAnalyzer` and policy document into a complete, tested rejection suite covering every prohibited category named in PRD section 12.3: `DllImport`, `UnmanagedCallersOnly`, `Marshal`, unsafe code, indirect native calls, and JavaScript interop. Section 16 requires excluding JavaScript interop and direct native interop assemblies from compiler references unless explicitly approved, and requires deterministic diagnostics for unsupported assemblies/APIs. This issue closes any remaining gaps in issue 31's analyzer (specifically `System.Runtime.InteropServices.Marshal` usage and any indirect/reflection-based native call attempt) and produces the full documented test matrix.

## What to build

Extend `PolicyAnalyzer.cs` to also detect `System.Runtime.InteropServices.Marshal` member access (e.g. `Marshal.GetDelegateForFunctionPointer`, `Marshal.AllocHGlobal`) and function-pointer-based indirect native calls (`delegate* unmanaged<...>` syntax), assigning each its own diagnostic ID, and build a complete test matrix proving every one of the six named prohibited categories from PRD 12.3 is rejected with a clear, correctly-located diagnostic.

## Scope

### In scope

- Extending `PolicyAnalyzer.Analyze` with detection for `Marshal.*` member access (diagnostic `PG0105`) and unmanaged function-pointer types `delegate* unmanaged<...>` (diagnostic `PG0106`)
- Updating `docs/supported-api-policy.md`'s prohibited-constructs table with the two new diagnostic IDs
- A complete test matrix exercising all six categories: `DllImport` (PG0101), `UnmanagedCallersOnly` (PG0102), unsafe code (PG0103), JS interop namespace (PG0104), `Marshal` usage (PG0105), unmanaged function pointers (PG0106)

### Out of scope

- Any new prohibited category beyond the six named in PRD 12.3 (do not invent additional categories not requested)
- Enforcing this at the reference-allowlist level (issue 19 already excludes any native/JS-interop assembly from the reference set; this issue is about detecting attempts to use APIs that are technically reachable through allowed assemblies like `System.Runtime.InteropServices`, which is itself an allowed core reference per issue 19's list — the analyzer exists precisely because the assembly is allowed for legitimate uses like structs/attributes, but specific dangerous members within it are not)

## Implementation guidance

1. Extend `PolicyAnalyzer.Analyze` with two more checks:
```csharp
foreach (var memberAccess in root.DescendantNodes().OfType<MemberAccessExpressionSyntax>())
{
    if (memberAccess.Expression.ToString().EndsWith("Marshal") &&
        memberAccess.ToString().Contains("Marshal."))
        diagnostics.Add(MakeDiagnostic("PG0105", "System.Runtime.InteropServices.Marshal is not permitted in playground code.", tree, memberAccess));
}

foreach (var fnPtr in root.DescendantNodes().OfType<FunctionPointerTypeSyntax>())
    diagnostics.Add(MakeDiagnostic("PG0106", "Unmanaged function pointers are not permitted in playground code.", tree, fnPtr));
```
   (Adjust the `Marshal` detection to specifically match the type name resolved via semantic analysis rather than a naive string check if the syntax-only approach produces false positives on user types coincidentally named `Marshal` — use `SemanticModel.GetSymbolInfo` if a `Compilation`/`SemanticModel` is available at the point `PolicyAnalyzer` runs; if only syntax trees are available at that stage, document this as a known limitation and note that a semantic-model-based pass is preferred if refactoring is feasible within this issue's scope.)
2. Update `docs/supported-api-policy.md`'s table to include `PG0105` and `PG0106`.
3. Build a test matrix as six small source snippets, one per diagnostic ID, each compiled individually through `CompilationService.Compile`, asserting `Success == false` and the exact expected diagnostic ID appears, at the correct line.
4. Additionally compile one "clean" source (the working `Game1`/`Player` fixture from issue 30) through the same pipeline and confirm it produces zero `PG01xx` diagnostics, proving the analyzer does not produce false positives on ordinary MonoGame code.

## Acceptance criteria

- [x] Six distinct test sources, one per prohibited category (`DllImport`, `UnmanagedCallersOnly`, unsafe code, JS interop namespace, `Marshal` usage, unmanaged function pointers), each produce `Success = false` with the correct, unique diagnostic ID at the correct line
- [x] `docs/supported-api-policy.md`'s prohibited-constructs table lists all six categories with their diagnostic IDs
- [x] The known-good two-file fixture from issue 30 compiles with zero `PG01xx` diagnostics, confirmed as a false-positive regression check
- [x] Diagnostics are deterministic: recompiling the same source twice produces the identical diagnostic ID/location both times

## Verification

Compile all six prohibited-category test sources individually and record the returned diagnostic ID and location for each, confirming they match the expected mapping exactly. Then compile the issue 30 fixture and confirm zero `PG01xx` diagnostics are present. Recompile at least one prohibited-category test source a second time and confirm the identical diagnostic is returned (determinism check). The verifier must run all eight compiles (six prohibited + one clean + one repeat) and record each result.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Independent issue-032 verifier
- **Date:** 2026-08-28
- **Evidence:** Two packaged proofs and independent semantic probes verified
  PG0101-PG0106, Marshal aliases/imports/lookalikes, unmanaged calling
  conventions, deterministic diagnostics, no binary emission, and clean
  issue-030/031 regressions. Committed as `f78ef3a`.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: reject native and JavaScript interop with deterministic diagnostics`

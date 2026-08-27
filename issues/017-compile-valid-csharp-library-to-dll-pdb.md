# Compile one valid C# library to DLL/PDB

**Type:** AFK
**Status:** Done
**Blocked by:** [016-boot-persistent-roslyn-wasm-compiler-context.md](016-boot-persistent-roslyn-wasm-compiler-context.md)
**PRD references:** 12.1, 12.2, 20.2
**User stories:** US1
**Triage:** needs-triage

## Context

PRD section 12.1 requires the compiler service to accept one or more source files with logical paths and optional settings, and return success/failure, managed assembly bytes, portable PDB bytes, and structured diagnostics, using the suggested `CompilationResult` record shape. Section 12.2 specifies the required compilation settings: DLL output kind, debug optimization, portable PDB enabled, unsafe code disabled by default, nullable disabled by default, a fixed C# language version, deterministic inputs, and a unique assembly name per compile for load isolation. Section 20.2 requires Roslyn to emit a valid managed assembly as part of the feasibility spike's acceptance criteria. This issue builds on the booted compiler context from issue 16 to actually invoke `CSharpCompilation` for a single valid source file and emit real DLL/PDB bytes.

## What to build

Implement `CompilationService.cs` in `src/compiler/` that accepts one in-memory C# source file, compiles it with `CSharpCompilation` using the exact settings from PRD 12.2, emits assembly and portable PDB bytes into memory streams, and exposes the result through a `[JSExport]` method returning the `CompilationResult` shape (success flag + Base64 assembly/PDB for this issue only, per PRD 12.5's note that the initial spike may use Base64; issue 21+ will move to transferable buffers per `src/shared/Protocol.md` from issue 15).

## Scope

### In scope

- `src/compiler/CompilationService.cs` implementing the suggested `CompilationResult` record and a `Compile(IReadOnlyList<(string path, string text)> files)` method
- Applying every PRD 12.2 setting explicitly (do not rely on Roslyn defaults where the PRD specifies a value)
- A `[JSExport] public static string Compile(string requestJson)` entry point per PRD 12.5's suggested interface, accepting a JSON request with one file and returning a JSON response with Base64 assembly/PDB
- Proving the emitted assembly is loadable and valid (e.g. via `System.Reflection.Metadata` inspection or by round-tripping through `Assembly.Load` in a separate throwaway .NET process/test, not necessarily inside the browser yet)

### Out of scope

- Diagnostics for invalid/erroneous source (issue 18)
- The reference allowlist (issue 19) — for this issue, a minimal hard-coded reference set sufficient to compile a trivial class is acceptable, to be replaced by the real allowlist in issue 19
- Loading the DLL into the preview runtime (issue 21)

## Implementation guidance

1. Create `src/compiler/CompilationService.cs`:
```csharp
using System.Collections.Immutable;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

public sealed record CompilerDiagnostic(string Severity, string Id, string Message, string File, int Line, int Column);
public sealed record CompilationResult(bool Success, byte[]? Assembly, byte[]? Pdb, IReadOnlyList<CompilerDiagnostic> Diagnostics);

public static class CompilationService
{
    public static CompilationResult Compile(IReadOnlyList<(string Path, string Text)> files, IReadOnlyList<MetadataReference> references)
    {
        var trees = files.Select(f => CSharpSyntaxTree.ParseText(f.Text, path: f.Path,
            options: new CSharpParseOptions(LanguageVersion.CSharp12))).ToImmutableArray();

        var assemblyName = $"UserGame_{Guid.NewGuid():N}"; // unique per PRD 12.2 load isolation

        var compilation = CSharpCompilation.Create(
            assemblyName,
            trees,
            references,
            new CSharpCompilationOptions(
                OutputKind.DynamicallyLinkedLibrary,
                optimizationLevel: OptimizationLevel.Debug,
                allowUnsafe: false,
                nullableContextOptions: NullableContextOptions.Disable,
                deterministic: true,
                warningLevel: 4));

        using var peStream = new MemoryStream();
        using var pdbStream = new MemoryStream();
        var emitResult = compilation.Emit(peStream, pdbStream,
            options: new Microsoft.CodeAnalysis.Emit.EmitOptions(debugInformationFormat: Microsoft.CodeAnalysis.Emit.DebugInformationFormat.PortablePdb));

        var diagnostics = emitResult.Diagnostics
            .Select(d => new CompilerDiagnostic(
                d.Severity.ToString().ToLowerInvariant(), d.Id, d.GetMessage(),
                d.Location.SourceTree?.FilePath ?? "",
                d.Location.GetLineSpan().StartLinePosition.Line + 1,
                d.Location.GetLineSpan().StartLinePosition.Character + 1))
            .ToList();

        if (!emitResult.Success)
            return new CompilationResult(false, null, null, diagnostics);

        return new CompilationResult(true, peStream.ToArray(), pdbStream.ToArray(), diagnostics);
    }
}
```
2. Add `CompilerExports.Compile(string requestJson)`: deserialize `{ files: [{ path, text }] }`, call `CompilationService.Compile` with a minimal reference set (e.g. `typeof(object).Assembly`'s location plus the `netstandard`/`System.Runtime` reference facades available in the browser-wasm SDK pack — inspect `dotnet --list-sdks`/the browser-wasm ref pack directory to find these), serialize the result with Base64-encoded `Assembly`/`Pdb` back to JSON.
3. Prove validity: write the emitted bytes to disk from a throwaway console harness (outside the browser, plain `dotnet run` against a copy of `CompilationService.cs` compiled for a normal TFM is acceptable purely to prove `Emit` succeeded and the PE header is well-formed) OR use `System.Reflection.Metadata.PEReader` to parse the emitted bytes and confirm a valid PE/CLI header, plus confirm the PDB stream is a valid portable PDB (magic number `0x424A5342` "BSJB" for the embedded metadata, or via `System.Reflection.Metadata.MetadataReader`).
4. Test with a simple valid input, e.g. `public class Foo { public int Bar() => 42; }`.

## Acceptance criteria

- [x] `CompilationService.Compile` returns `Success = true` for a trivial valid C# class using the browser-wasm reference set
- [x] The emitted assembly bytes parse as a valid PE/CLI image (confirmed via `PEReader` or equivalent inspection)
- [x] The emitted PDB bytes are a valid portable PDB (confirmed via a portable PDB reader or magic-number check)
- [x] Every PRD 12.2 setting is explicitly set in code (DLL output kind, Debug optimization, unsafe disabled, nullable disabled, deterministic, a fixed `LanguageVersion`, unique assembly name per compile)
- [x] The `[JSExport] Compile(string requestJson)` entry point round-trips a JSON request/response containing Base64 assembly and PDB bytes

## Verification

Write and run a small throwaway verification harness (e.g. `dotnet-script` or a scratch console project referencing the same `CompilationService.cs` file) that calls `CompilationService.Compile` with the trivial `Foo` class above and asserts `Success == true`, `Assembly.Length > 0`, `Pdb.Length > 0`, and that `new System.Reflection.PortableExecutable.PEReader(new MemoryStream(result.Assembly)).HasMetadata` is true. Additionally call the `[JSExport] Compile` entry point from the same JS harness used in issue 16 and confirm the JSON response contains non-empty Base64 `assembly`/`pdb` fields. The verifier must run both checks and record their output.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

### Attempt 1

- **Verdict:** FAIL
- **Verifier:** Issue 017 Verifier (`4fe9e6e3-b521-47a1-bdcb-e13b27d50434`)
- **Date:** 2026-08-27
- **Evidence:** Valid browser-WASM compilation, PE/CLI metadata, portable PDB, trusted calls, unique assembly names, and the single embedded `System.Runtime` reference all passed. Protocol bounds failed because 513-byte paths and 65-source requests were accepted.

### Attempt 2

- **Verdict:** PASS
- **Verifier:** Issue 017 Verifier (`4fe9e6e3-b521-47a1-bdcb-e13b27d50434`)
- **Date:** 2026-08-27
- **Evidence:** Fresh Release build completed with zero warnings/errors. One runtime handled trusted Ping and two trusted Compile calls, emitting unique assemblies with 2,560-byte DLLs and 716-byte PDBs. Independent PE/PDB parsing confirmed managed PE/CLI metadata, `Foo.Bar`, `Foo.cs`, source checksum, and line mapping. Browser boundary tests accepted 64 sources, a 512-byte NFC path, one 1 MiB source, and 4 MiB aggregate source while rejecting the next unit above each limit with the protocol error and no binaries. Duplicate, traversal, noncanonical, invalid-scalar, version, and settings cases were rejected before Roslyn. All PRD settings and 8/8/12 MiB output ceilings matched protocol v1. No runtime, console, request, or external-network errors occurred; generated output stayed ignored and `external/MonoGame` remained unchanged.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: compile single valid C# source to DLL and portable PDB`

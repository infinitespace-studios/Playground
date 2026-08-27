# Return structured syntax diagnostics

**Type:** AFK
**Status:** Done
**Blocked by:** [017-compile-valid-csharp-library-to-dll-pdb.md](017-compile-valid-csharp-library-to-dll-pdb.md)
**PRD references:** 12.1, 14.2, 22.1
**User stories:** US2
**Triage:** needs-triage

## Context

PRD section 12.1 requires the compiler to return structured diagnostics on failure. Section 14.2 requires the Problems panel to display severity, diagnostic ID, message, filename, line, and column for each diagnostic, and requires selecting a diagnostic to focus its source location. Section 22.1 requires compiler tests for syntax errors and portable PDB line mapping. This issue extends the `CompilationService` from issue 17 to correctly surface Roslyn's own syntax/semantic diagnostics (not yet the playground-owned diagnostics like "no Game subclass", which come later in issues 22 and 31-32) with accurate file/line/column information for invalid source.

## What to build

Feed intentionally invalid C# source (a syntax error, e.g. a missing semicolon or unbalanced brace) into `CompilationService.Compile` and confirm the returned `Diagnostics` list contains an entry with the correct `Severity` ("error"), a real Roslyn diagnostic `Id` (e.g. `CS1002`), an accurate human-readable `Message`, and the correct `File`, `Line`, and `Column` matching the actual location of the injected error in the source text.

## Scope

### In scope

- Verifying/adjusting the diagnostic-mapping code in `CompilationService.cs` added in issue 17 so line/column are 1-based and match what Monaco/most editors expect (issue 17's sketch already does `+ 1`; confirm this against real Roslyn output for multiple error positions, including errors on line 1 and on a later line, and for multi-file input where the error is in the second file)
- Testing at least three distinct syntax error categories: unterminated statement, unbalanced braces, and an unknown type reference
- Confirming diagnostics still include Roslyn warnings (not just errors) since PRD 12.2 says warnings are reported but not treated as errors by default

### Out of scope

- Playground-owned diagnostics like missing/multiple Game subclasses (issue 22)
- Unsupported-API diagnostics (issues 31-32)
- Wiring diagnostics into the actual Problems panel UI (issue 48)

## Implementation guidance

1. Using the harness from issue 17's verification, feed source strings with deliberate errors, e.g.:
   - `public class Foo { public int Bar() => 42 }` (missing semicolon — expect `CS1002` or similar at the correct line/column).
   - `public class Foo { public int Bar() => 42;` (unbalanced brace — expect an end-of-file/`CS1513` diagnostic).
   - `public class Foo { public Bar Baz() => null; }` (unknown type `Bar` — expect `CS0246`).
   - A two-file input where file `Player.cs` has the error and `Game1.cs` is valid; confirm the returned diagnostic's `File` field says `Player.cs`, not `Game1.cs`.
2. For each case, assert the returned `CompilationResult.Success` is `false`, `Diagnostics` is non-empty, and at least one diagnostic's `Id`, `Line`, `Column`, and `File` match manual inspection of the source (count lines/columns by hand to confirm the mapping code is correct, especially for multi-line files).
3. Confirm a compile with only a warning (e.g. an unused variable, if that produces a warning in this language version) still returns `Success = true` with a non-empty `Diagnostics` list containing a `"warning"` severity entry, proving warnings are not treated as errors by default (PRD 12.2).
4. If any line/column offset is found to be wrong (off-by-one, or not accounting for multi-file compilation correctly), fix `CompilationService.cs`'s diagnostic-mapping code from issue 17 rather than creating a new file.

## Acceptance criteria

- [x] A missing-semicolon error returns a diagnostic with `Severity="error"`, a real Roslyn `Id` (e.g. `CS1002`), and `Line`/`Column` matching the exact character position of the error in the source
- [x] An unknown-type error returns the correct `Id` (e.g. `CS0246`) and correct location
- [x] A two-file compile with an error only in the second file returns a diagnostic whose `File` field names the second file, not the first
- [x] A compile that produces only a warning still returns `Success = true` with the warning present in `Diagnostics`

## Verification

Run the throwaway harness from issue 17 (or an extended version of it) against each of the four cases in Implementation guidance and print the full `Diagnostics` list for manual inspection. The verifier must independently count the expected line/column of each injected error by reading the raw source string and confirm the returned values match exactly, and confirm the two-file case reports the correct filename.

## Verification record

Complete this section during independent verification. Do not delete failed attempts; append the latest result.

- **Verdict:** PASS
- **Verifier:** Issue 018 Verifier (`8f93f879-5e18-4a25-b71f-3a6da25dd0f6`)
- **Date:** 2026-08-27
- **Evidence:** Fresh Release browser-WASM build completed with zero warnings/errors. A trusted diagnostic-proof click reproduced `CS1002` at `Syntax/MissingSemicolon.cs:1:43`, `CS1513` at `Syntax/UnbalancedBrace.cs:1:43`, `CS0246` at `Types/UnknownType.cs:1:27`, and a two-file CRLF/astral-Unicode `CS0246` at the manually calculated UTF-16 location `Game/Player.cs:3:40`. Warning-only `CS0219` at `Warnings/UnusedLocal.cs:1:44` succeeded with a 2,560-byte DLL and 788-byte PDB. Errors returned `COMPILE_FAILED` with no binaries; every diagnostic had the required origin, severity, ID, message, and coordinates. Adversarial ordering, foreign `#line` suppression, logical PDB path/checksum, Ping, valid compilation, one runtime startup, and absence of browser/runtime/network errors all passed. Generated output remained ignored and `external/MonoGame` was unchanged.

## Commit gate

Do not commit any change for this issue until an independent verifier (a separate agent or human reviewer, not the one who implemented this issue) has inspected the diff, executed every command in the Verification section above, and recorded an explicit PASS with the evidence produced. If the verifier records FAIL, fix the issue and resubmit for verification; never commit on a FAIL. On PASS, commit only the files that belong to this issue's Scope (do not bundle unrelated changes).

Suggested commit subject: `compiler: return structured syntax diagnostics with accurate locations`

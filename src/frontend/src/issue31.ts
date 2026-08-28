import game1Text from "../../../tests/compiler/fixtures/cross-file/Game1.cs?raw";
import playerText from "../../../tests/compiler/fixtures/cross-file/Player.cs?raw";
import {
  compileSourcesThroughPersistentCompiler,
  preparePackagedProofRuntime,
} from "./issue21";

interface Diagnostic {
  origin?: string;
  severity?: string;
  id?: string;
  message?: string;
  file?: string;
  line?: number;
  column?: number;
}

interface FailedCompilation {
  compileId?: string;
  correlationId?: string;
  success?: boolean;
  error?: {
    code?: string;
    diagnostics?: Diagnostic[];
  };
}

const compile = async (
  assemblyName: string,
  sources: readonly { path: string; text: string }[],
) => compileSourcesThroughPersistentCompiler({
  assemblyName,
  sources,
  primarySourcePath: sources[0].path,
}) as Promise<FailedCompilation>;

function requirePolicyDiagnostic(
  result: FailedCompilation,
  id: string,
  file: string,
  line: number,
  column: number,
): Diagnostic {
  const diagnostics = result.error?.diagnostics ?? [];
  const matches = diagnostics.filter(diagnostic =>
    diagnostic.id === id &&
    diagnostic.file === file &&
    diagnostic.line === line &&
    diagnostic.column === column);
  if (result.success !== false ||
      result.error?.code !== "COMPILE_FAILED" ||
      matches.length !== 1 ||
      matches[0].origin !== "playground" ||
      matches[0].severity !== "error" ||
      matches[0].file !== file)
    throw new Error(`Expected ${id} at ${file}:${line}:${column}: ${JSON.stringify(result)}`);
  return matches[0];
}

export async function runIssue031AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue031_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();

  const cases = [
    {
      name: "dll-import-alias",
      id: "PG0101",
      path: "src/DllImportAlias.cs",
      line: 3,
      column: 3,
      text: [
        "using Interop = System.Runtime.InteropServices;",
        "public static class NativeMethods {",
        " [Interop.DllImport(\"not-present\")]",
        " public static extern int Invoke();",
        "}",
      ].join("\n"),
    },
    {
      name: "dll-import-suffix",
      id: "PG0101",
      path: "src/DllImportSuffix.cs",
      line: 3,
      column: 3,
      text: [
        "using System.Runtime.InteropServices;",
        "public static class NativeMethods {",
        " [DllImport(\"not-present\")]",
        " public static extern int Invoke();",
        "}",
      ].join("\n"),
    },
    {
      name: "dll-import-global",
      id: "PG0101",
      path: "src/DllImportGlobal.cs",
      line: 2,
      column: 3,
      text: [
        "public static class NativeMethods {",
        " [global::System.Runtime.InteropServices.DllImportAttribute(\"not-present\")]",
        " public static extern int Invoke();",
        "}",
      ].join("\n"),
    },
    {
      name: "unmanaged-callers-global",
      id: "PG0102",
      path: "src/UnmanagedCallers.cs",
      line: 2,
      column: 4,
      text: [
        "public static class NativeEntry {",
        "  [global::System.Runtime.InteropServices.UnmanagedCallersOnly]",
        "  public static void Invoke() { }",
        "}",
      ].join("\n"),
    },
    {
      name: "unmanaged-callers-alias",
      id: "PG0102",
      path: "src/UnmanagedCallersAlias.cs",
      line: 3,
      column: 3,
      text: [
        "using EntryPoint = System.Runtime.InteropServices.UnmanagedCallersOnlyAttribute;",
        "public static class NativeEntry {",
        " [EntryPoint]",
        " public static void Invoke() { }",
        "}",
      ].join("\n"),
    },
    {
      name: "unsafe-pointer-stackalloc",
      id: "PG0103",
      path: "src/UnsafeCode.cs",
      line: 1,
      column: 8,
      text: "public unsafe class UnsafeCode { public int* Allocate() => stackalloc int[1]; }",
    },
    {
      name: "unsafe-block",
      id: "PG0103",
      path: "src/UnsafeBlock.cs",
      line: 4,
      column: 3,
      text: [
        "public class UnsafeBlock {",
        " void Invoke() {",
        "  int value = 0;",
        "  unsafe { value++; }",
        " }",
        "}",
      ].join("\n"),
    },
    {
      name: "unsafe-pointer",
      id: "PG0103",
      path: "src/UnsafePointer.cs",
      line: 2,
      column: 2,
      text: ["public class UnsafePointer {", " int* value;", "}"].join("\n"),
    },
    {
      name: "unsafe-stackalloc",
      id: "PG0103",
      path: "src/UnsafeStackalloc.cs",
      line: 4,
      column: 17,
      text: [
        "using System;",
        "public class UnsafeStackalloc {",
        " public void Allocate() {",
        "  Span<int> x = stackalloc int[1];",
        " }",
        "}",
      ].join("\n"),
    },
    {
      name: "unsafe-fixed",
      id: "PG0103",
      path: "src/UnsafeFixed.cs",
      line: 3,
      column: 3,
      text: [
        "public class UnsafeFixed {",
        " void Pin() {",
        "  fixed (int* value = null) { }",
        " }",
        "}",
      ].join("\n"),
    },
    {
      name: "javascript-alias",
      id: "PG0104",
      path: "src/JavaScriptInterop.cs",
      line: 1,
      column: 12,
      text: [
        "using JS = System.Runtime.InteropServices.JavaScript;",
        "public static class BrowserCall { public static object Value => JS.JSHost.GlobalThis; }",
      ].join("\n"),
    },
    {
      name: "javascript-namespace-using",
      id: "PG0104",
      path: "src/JavaScriptUsing.cs",
      line: 1,
      column: 7,
      text: [
        "using System.Runtime.InteropServices.JavaScript;",
        "public static class BrowserCall { }",
      ].join("\n"),
    },
    {
      name: "javascript-static-using",
      id: "PG0104",
      path: "src/JavaScriptStaticUsing.cs",
      line: 1,
      column: 14,
      text: [
        "using static System.Runtime.InteropServices.JavaScript.JSHost;",
        "public static class BrowserCall { }",
      ].join("\n"),
    },
    {
      name: "javascript-qualified-member",
      id: "PG0104",
      path: "src/JavaScriptQualified.cs",
      line: 2,
      column: 25,
      text: [
        "public class BrowserCall {",
        " public object Value => System.Runtime.InteropServices.JavaScript.JSHost.GlobalThis;",
        "}",
      ].join("\n"),
    },
  ] as const;

  const caseEvidence = [];
  for (const testCase of cases) {
    const result = await compile(`Issue031_${testCase.name}`, [{
      path: testCase.path,
      text: testCase.text,
    }]);
    const diagnostic = requirePolicyDiagnostic(
      result,
      testCase.id,
      testCase.path,
      testCase.line,
      testCase.column,
    );
    caseEvidence.push({
      name: testCase.name,
      compileId: result.compileId,
      correlationId: result.correlationId,
      diagnostic,
      diagnosticCount: result.error?.diagnostics?.length,
      noBinaryResponse: !Object.hasOwn(result, "assembly") &&
        !Object.hasOwn(result, "pdb") &&
        !Object.hasOwn(result, "binaryProof"),
      policyDiagnosticCount: result.error?.diagnostics?.filter(item =>
        item.id === testCase.id).length,
    });
  }

  const representativeCases = ["PG0101", "PG0102", "PG0103", "PG0104"]
    .map(id => cases.find(testCase => testCase.id === id)!);
  const multiSources = representativeCases.map((testCase, index) => ({
    path: testCase.path,
    text: testCase.text + (index === 0 ? "\nMissingType broken;" : ""),
  }));
  const multi = await compile("Issue031_Deterministic", multiSources);
  const repeated = await compile("Issue031_Deterministic", multiSources);
  const reversed = await compile("Issue031_Deterministic", [...multiSources].reverse());
  const multiDiagnostics = multi.error?.diagnostics ?? [];
  const repeatedDiagnostics = repeated.error?.diagnostics ?? [];
  const reversedDiagnostics = reversed.error?.diagnostics ?? [];
  if (JSON.stringify(multiDiagnostics) !== JSON.stringify(repeatedDiagnostics) ||
      JSON.stringify(multiDiagnostics) !== JSON.stringify(reversedDiagnostics) ||
      !["PG0101", "PG0102", "PG0103", "PG0104", "CS0246"].every(id =>
        multiDiagnostics.some(diagnostic => diagnostic.id === id)))
    throw new Error(`Policy/Roslyn deterministic merge failed: ${JSON.stringify({
      multi, repeated, reversed,
    })}`);

  const malformed = await compile("Issue031_Malformed", [{
    path: "src/Malformed.cs",
    text: [
      "using System.Runtime.InteropServices.JavaScript",
      "public class Malformed {",
    ].join("\n"),
  }]);
  if (malformed.success !== false ||
      !malformed.error?.diagnostics?.some(diagnostic =>
        diagnostic.origin === "compiler" && diagnostic.severity === "error"))
    throw new Error(`Malformed source analysis was not safe: ${JSON.stringify(malformed)}`);

  const deferredFunctionPointer = await compile("Issue031_DeferredFunctionPointer", [{
    path: "src/DeferredFunctionPointer.cs",
    text: [
      "public static class DeferredFunctionPointer {",
      " public static delegate* unmanaged<void> Callback;",
      "}",
    ].join("\n"),
  }]);
  if (deferredFunctionPointer.success !== false ||
      deferredFunctionPointer.error?.diagnostics?.some(diagnostic =>
        diagnostic.id === "PG0103" || diagnostic.id === "PG0106") ||
      !deferredFunctionPointer.error?.diagnostics?.some(diagnostic =>
        diagnostic.origin === "compiler" && diagnostic.severity === "error"))
    throw new Error(
      `Function pointer was not left to issue 032: ${JSON.stringify(deferredFunctionPointer)}`,
    );

  const lookalikes = await compile("Issue031_Lookalikes", [{
    path: "src/Lookalikes.cs",
    text: [
      "using System;",
      "namespace UserCode {",
      " [AttributeUsage(AttributeTargets.All)]",
      " public sealed class DllImportAttribute : Attribute { public DllImportAttribute(string value) { } }",
      " [AttributeUsage(AttributeTargets.All)]",
      " public sealed class UnmanagedCallersOnlyAttribute : Attribute { }",
      " [DllImport(\"managed\")] public sealed class Example { }",
      " [UnmanagedCallersOnly] public sealed class Other { }",
      "}",
      "namespace System.Runtime.InteropServices.JavaScript {",
      " public static class JSHost { public static object GlobalThis => new object(); }",
      "}",
      "namespace Consumer {",
      " using JS = System.Runtime.InteropServices.JavaScript;",
      " public static class Use { public static object Value => JS.JSHost.GlobalThis; }",
      "}",
    ].join("\n"),
  }]);
  if (lookalikes.success !== true ||
      (lookalikes as { diagnostics?: Diagnostic[] }).diagnostics?.some(diagnostic =>
        diagnostic.id?.startsWith("PG01")))
    throw new Error(`User-defined lookalikes were rejected: ${JSON.stringify(lookalikes)}`);

  const clean = await compileSourcesThroughPersistentCompiler({
    assemblyName: "Issue031_CleanIssue030",
    sources: [
      { path: "tests/compiler/fixtures/cross-file/Game1.cs", text: game1Text },
      { path: "tests/compiler/fixtures/cross-file/Player.cs", text: playerText },
    ],
    primarySourcePath: "tests/compiler/fixtures/cross-file/Game1.cs",
  });
  if (clean.success !== true ||
      (clean.diagnostics as Diagnostic[]).length !== 0 ||
      !clean.binaryProof)
    throw new Error(`Issue-030 fixtures failed policy analysis: ${JSON.stringify(clean)}`);

  if (caseEvidence.some(evidence =>
        !evidence.noBinaryResponse ||
        (evidence.name !== "javascript-alias" &&
          evidence.policyDiagnosticCount !== 1)) ||
      new Set(caseEvidence.map(evidence => evidence.compileId)).size !== cases.length)
    throw new Error(`Policy failure emitted binary or reused identity: ${JSON.stringify(caseEvidence)}`);

  await invoke("issue031_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE031_PROOF=1",
      proofRuntimeReadiness,
      cases: caseEvidence,
      deterministicMerge: {
        firstCompileId: multi.compileId,
        repeatedCompileId: repeated.compileId,
        reversedCompileId: reversed.compileId,
        diagnostics: multiDiagnostics,
        repeatedIdentical: true,
        reversedIdentical: true,
      },
      malformed,
      deferredFunctionPointer,
      lookalikes,
      cleanIssue030: clean,
      assertions: {
        persistentBrowserWasmCompiler: true,
        exactPolicyLocations: true,
        noBinaryOnPolicyFailure: true,
        semanticLookalikesAllowed: true,
        roslynErrorsMerged: true,
        malformedSourceHandled: true,
        functionPointerNotAssignedPg0103: true,
        pg0106DeferredToIssue032: true,
        repeatedCompilationDeterministic: true,
        reversedSourceOrderDeterministic: true,
        cleanCrossFileRegression: true,
      },
    }),
  });
}

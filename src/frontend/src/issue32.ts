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
  file?: string;
  line?: number;
  column?: number;
}

interface Compilation {
  compileId?: string;
  correlationId?: string;
  success?: boolean;
  diagnostics?: Diagnostic[];
  binaryProof?: unknown;
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
}) as Promise<Compilation>;

function policyDiagnostics(result: Compilation): Diagnostic[] {
  return (result.error?.diagnostics ?? result.diagnostics ?? [])
    .filter(diagnostic => diagnostic.id?.startsWith("PG01"));
}

function requireDiagnostic(
  result: Compilation,
  expected: { id: string; path: string; line: number; column: number },
): Diagnostic {
  const matches = policyDiagnostics(result).filter(diagnostic =>
    diagnostic.id === expected.id &&
    diagnostic.file === expected.path &&
    diagnostic.line === expected.line &&
    diagnostic.column === expected.column);
  if (result.success !== false ||
      result.error?.code !== "COMPILE_FAILED" ||
      matches.length !== 1 ||
      matches[0].origin !== "playground" ||
      matches[0].severity !== "error" ||
      Object.hasOwn(result, "binaryProof"))
    throw new Error(`Missing exact ${expected.id}: ${JSON.stringify(result)}`);
  return matches[0];
}

export async function runIssue032AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue032_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();

  const cases = [
    {
      id: "PG0101", path: "src/PolicyDllImport.cs", line: 3, column: 3,
      text: [
        "using Interop = System.Runtime.InteropServices;",
        "public static class PolicyDllImport {",
        " [Interop.DllImport(\"not-present\")] public static extern int Call();",
        "}",
      ].join("\n"),
    },
    {
      id: "PG0102", path: "src/PolicyUnmanagedEntry.cs", line: 2, column: 3,
      text: [
        "public static class PolicyUnmanagedEntry {",
        " [System.Runtime.InteropServices.UnmanagedCallersOnly] public static void Call() { }",
        "}",
      ].join("\n"),
    },
    {
      id: "PG0103", path: "src/PolicyUnsafe.cs", line: 1, column: 8,
      text: "public unsafe class PolicyUnsafe { public int* Value; }",
    },
    {
      id: "PG0104", path: "src/PolicyJavaScript.cs", line: 1, column: 12,
      text: [
        "using JS = System.Runtime.InteropServices.JavaScript;",
        "public static class PolicyJavaScript { public static object Value => JS.JSHost.GlobalThis; }",
      ].join("\n"),
    },
    {
      id: "PG0105", path: "src/PolicyMarshal.cs", line: 3, column: 30,
      text: [
        "using System.Runtime.InteropServices;",
        "public static class PolicyMarshal {",
        " public static nint Value => Marshal.AllocHGlobal(1);",
        "}",
      ].join("\n"),
    },
    {
      id: "PG0106", path: "src/PolicyFunctionPointer.cs", line: 2, column: 16,
      text: [
        "public static class PolicyFunctionPointer {",
        " public static delegate* unmanaged[Cdecl]<void> Callback;",
        "}",
      ].join("\n"),
    },
  ] as const;

  const matrix = [];
  for (const testCase of cases) {
    const result = await compile(`Issue032_${testCase.id}`, [{
      path: testCase.path,
      text: testCase.text,
    }]);
    const diagnostic = requireDiagnostic(result, testCase);
    const ids = policyDiagnostics(result).map(item => item.id);
    if (testCase.id === "PG0106" && ids.includes("PG0103"))
      throw new Error(`Function pointer was mislabeled PG0103: ${JSON.stringify(result)}`);
    matrix.push({
      compileId: result.compileId,
      correlationId: result.correlationId,
      diagnostic,
      allPolicyIds: ids,
      noBinary: !result.binaryProof,
    });
  }

  const repeated = await compile("Issue032_PG0106", [{
    path: cases[5].path,
    text: cases[5].text,
  }]);
  const repeatedDiagnostic = requireDiagnostic(repeated, cases[5]);
  if (JSON.stringify(repeatedDiagnostic) !== JSON.stringify(matrix[5].diagnostic) ||
      repeated.compileId === matrix[5].compileId)
    throw new Error(`PG0106 repeat was not deterministic: ${JSON.stringify(repeated)}`);

  const marshalForms = await compile("Issue032_MarshalForms", [{
    path: "src/MarshalForms.cs",
    text: [
      "using System;",
      "using Interop = System.Runtime.InteropServices;",
      "using M = System.Runtime.InteropServices.Marshal;",
      "using static System.Runtime.InteropServices.Marshal;",
      "public static class MarshalForms {",
      " public static nint Qualified() => global::System.Runtime.InteropServices.Marshal.AllocHGlobal(1);",
      " public static nint NamespaceAlias() => Interop.Marshal.AllocHGlobal(1);",
      " public static Type TypeUse() => typeof(M);",
      " public static string NameUse() => nameof(M.AllocHGlobal);",
      " public static Action<nint> MemberGroup() => M.FreeHGlobal;",
      " public static nint ImportedMember() => AllocHGlobal(1);",
      "}",
    ].join("\n"),
  }]);
  const marshalFormDiagnostics = policyDiagnostics(marshalForms);
  const expectedMarshalLocations = [
    [3, 11],
    [4, 14],
    [6, 36],
    [7, 41],
    [8, 41],
    [9, 43],
    [10, 46],
    [11, 41],
  ];
  if (marshalForms.success !== false ||
      marshalFormDiagnostics.some(diagnostic => diagnostic.id !== "PG0105") ||
      JSON.stringify(marshalFormDiagnostics.map(diagnostic =>
        [diagnostic.line, diagnostic.column])) !== JSON.stringify(expectedMarshalLocations))
    throw new Error(`Marshal forms were not exact: ${JSON.stringify(marshalForms)}`);

  const mixed = await compile("Issue032_MixedFunctionPointer", [{
    path: "src/MixedFunctionPointer.cs",
    text: [
      "using Call = System.Runtime.CompilerServices.CallConvCdecl;",
      "public unsafe static class MixedFunctionPointer {",
      " [System.Runtime.InteropServices.UnmanagedCallersOnly]",
      " static void Target() { }",
      " public static void Invoke() {",
      "  delegate* unmanaged[Call]<void> callback = &Target;",
      "  callback();",
      " }",
      "}",
    ].join("\n"),
  }]);
  const mixedIds = policyDiagnostics(mixed).map(diagnostic => diagnostic.id);
  if (mixedIds.filter(id => id === "PG0102").length !== 1 ||
      mixedIds.filter(id => id === "PG0103").length !== 1 ||
      mixedIds.filter(id => id === "PG0106").length !== 1)
    throw new Error(`Mixed ownership was not exact: ${JSON.stringify(mixed)}`);

  const malformed = await compile("Issue032_MalformedFunctionPointer", [{
    path: "src/MalformedFunctionPointer.cs",
    text: "public class Broken { delegate* unmanaged[Cdecl]<void callback; }",
  }]);
  if (malformed.success !== false ||
      !malformed.error?.diagnostics?.some(diagnostic =>
        diagnostic.origin === "compiler" && diagnostic.severity === "error"))
    throw new Error(`Malformed input was not handled safely: ${JSON.stringify(malformed)}`);

  const unresolvedMarshal = await compile("Issue032_UnresolvedMarshalMember", [{
    path: "src/UnresolvedMarshalMember.cs",
    text: [
      "using System.Runtime.InteropServices;",
      "public class UnresolvedMarshalMember {",
      " object Value => Marshal.NotARealMember();",
      "}",
    ].join("\n"),
  }]);
  requireDiagnostic(unresolvedMarshal, {
    id: "PG0105",
    path: "src/UnresolvedMarshalMember.cs",
    line: 3,
    column: 18,
  });

  const managedFunctionPointer = await compile("Issue032_ManagedFunctionPointer", [{
    path: "src/ManagedFunctionPointer.cs",
    text: [
      "public static class ManagedFunctionPointer {",
      " public static delegate*<void> Callback;",
      "}",
    ].join("\n"),
  }]);
  if (managedFunctionPointer.success !== false ||
      policyDiagnostics(managedFunctionPointer).some(diagnostic =>
        diagnostic.id === "PG0106" || diagnostic.id === "PG0103") ||
      !managedFunctionPointer.error?.diagnostics?.some(diagnostic =>
        diagnostic.origin === "compiler" && diagnostic.severity === "error"))
    throw new Error(
      `Managed function pointer was over-classified: ${JSON.stringify(managedFunctionPointer)}`,
    );

  const lookalikes = await compile("Issue032_Lookalikes", [{
    path: "src/InteropLookalikes.cs",
    text: [
      "using System;",
      "using System.Runtime.InteropServices;",
      "namespace UserCode {",
      " public static class Marshal { public static int SizeOf<T>() => 1; }",
      " public static class Use {",
      "  public static int Value => Marshal.SizeOf<int>();",
      "  public static Type Type => typeof(Marshal);",
      " }",
      "}",
      "[StructLayout(LayoutKind.Sequential)]",
      "public struct LegitimateInterop { public GCHandle Handle; }",
    ].join("\n"),
  }]);
  if (lookalikes.success !== true || policyDiagnostics(lookalikes).length !== 0)
    throw new Error(`Lookalikes or legitimate interop were rejected: ${JSON.stringify(lookalikes)}`);

  const clean = await compile("Issue032_CleanIssue030", [
    { path: "tests/compiler/fixtures/cross-file/Game1.cs", text: game1Text },
    { path: "tests/compiler/fixtures/cross-file/Player.cs", text: playerText },
  ]);
  if (clean.success !== true || policyDiagnostics(clean).length !== 0 || !clean.binaryProof)
    throw new Error(`Issue-030 fixtures failed: ${JSON.stringify(clean)}`);

  await invoke("issue032_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE032_PROOF=1",
      proofRuntimeReadiness,
      requiredOperations: {
        sixCategories: matrix,
        repeated: {
          compileId: repeated.compileId,
          correlationId: repeated.correlationId,
          diagnostic: repeatedDiagnostic,
        },
        clean,
      },
      marshalForms: marshalFormDiagnostics,
      mixed: {
        diagnostics: policyDiagnostics(mixed),
        containsAddressOfAndInvocation: true,
      },
      malformed,
      unresolvedMarshal,
      managedFunctionPointer,
      lookalikes,
      assertions: {
        allSixCategoriesExact: true,
        requiredEightPersistentCompiles: true,
        noBinaryOnPolicyFailure: true,
        deterministicRepeat: true,
        marshalSemanticFormsCovered: true,
        unmanagedCallingConventionCovered: true,
        functionPointerOwnershipExact: true,
        mixedCategoriesExact: true,
        malformedSourceHandled: true,
        unresolvedMarshalMemberRejected: true,
        managedFunctionPointerNotOverclassified: true,
        userLookalikesAllowed: true,
        legitimateInteropAllowed: true,
        cleanIssue030HasZeroPolicyDiagnostics: true,
      },
    }),
  });
}

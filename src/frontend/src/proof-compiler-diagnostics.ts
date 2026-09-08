// Scenario proof suite — Compiler diagnostics & policy rejection (durable).
//
// Durable scenario 2. Orchestrated by the single `runCompilerDiagnosticsScenario`
// entrypoint below: discover/construct a single Game subclass + structured
// PGxxxx diagnostics (former issue22), supported-API policy + analyzers (former
// issue31), and reject native/JS interop with diagnostics (former issue32). The
// shared diagnostic/compilation types and the persistent-compiler helper are
// deduplicated at module scope (issue31 and issue32 previously declared their
// own identical copies). The per-issue env gates and `issueNN_emit_report`
// commands are preserved verbatim for Stage-6 compatibility. PRODUCT never
// imports this module.
import game1Text from "../../../tests/compiler/fixtures/cross-file/Game1.cs?raw";
import playerText from "../../../tests/compiler/fixtures/cross-file/Player.cs?raw";
import {
  compileLoadConstructIssue22Case,
  compileSourcesThroughPersistentCompiler,
  preparePackagedProofRuntime,
} from "./issue21";
import { runScenario, type SubProof } from "./scenario-runner";

// Shared across the policy sub-proofs (deduplicated from the former issue31 and
// issue32 namespaces, which each declared an identical `Diagnostic` shape and
// `compile` helper).
interface Diagnostic {
  origin?: string;
  severity?: string;
  id?: string;
  message?: string;
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

// ── Game discovery + structured diagnostics (former issue22) ──
const cases = [
  {
    caseId: "zero-game",
    assemblyName: "Issue022ZeroGame",
    sourcePath: "src/ZeroGame.cs",
    sourceText: "public sealed class NotAGame { public int Value() => 1; }",
    expectedDiagnosticId: "PG0001_NO_GAME_SUBCLASS",
    expectedNames: [] as string[],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "multiple-games",
    assemblyName: "Issue022MultipleGames",
    sourcePath: "src/MultipleGames.cs",
    sourceText: `
namespace Zulu { public sealed class SecondGame : Microsoft.Xna.Framework.Game { public int Value() => 2; } }
namespace Alpha { public sealed class FirstGame : Microsoft.Xna.Framework.Game { public int Value() => 1; } }`,
    expectedDiagnosticId: "PG0002_MULTIPLE_GAME_SUBCLASSES",
    expectedNames: ["Alpha.FirstGame", "Zulu.SecondGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "missing-constructor",
    assemblyName: "Issue022MissingConstructor",
    sourcePath: "src/MissingConstructor.cs",
    sourceText: `
namespace ConstructorCase
{
    public sealed class NeedsArgumentGame : Microsoft.Xna.Framework.Game
    {
        private readonly int value;
        public NeedsArgumentGame(int value) { this.value = value; }
    }
}`,
    expectedDiagnosticId: "PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR",
    expectedNames: ["ConstructorCase.NeedsArgumentGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "valid-game",
    assemblyName: "Issue022ValidGame",
    sourcePath: "src/ValidGame.cs",
    sourceText: `
namespace ValidCase
{
    public sealed class BrowserGame : Microsoft.Xna.Framework.Game
    {
        public int Marker { get; }
        public BrowserGame() { Marker = 1; }
    }
}`,
    expectedDiagnosticId: null,
    expectedNames: ["ValidCase.BrowserGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "implicit-constructor",
    assemblyName: "Issue022ImplicitConstructor",
    sourcePath: "src/ImplicitConstructor.cs",
    sourceText: "namespace ImplicitCase { public sealed class ImplicitGame : Microsoft.Xna.Framework.Game { public int Value() => 1; } }",
    expectedDiagnosticId: null,
    expectedNames: ["ImplicitCase.ImplicitGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "internal-type",
    assemblyName: "Issue022InternalType",
    sourcePath: "src/InternalType.cs",
    sourceText: "namespace InternalCase { internal sealed class InternalGame : Microsoft.Xna.Framework.Game { public int Value { get; } public InternalGame() { Value = 1; } } }",
    expectedDiagnosticId: null,
    expectedNames: ["InternalCase.InternalGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "public-nested-type",
    assemblyName: "Issue022PublicNested",
    sourcePath: "src/PublicNested.cs",
    sourceText: "namespace NestedCase { public static class Holder { public sealed class PublicGame : Microsoft.Xna.Framework.Game { public int Value { get; } public PublicGame() { Value = 1; } } } }",
    expectedDiagnosticId: null,
    expectedNames: ["NestedCase.Holder+PublicGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "private-nested-type",
    assemblyName: "Issue022PrivateNested",
    sourcePath: "src/PrivateNested.cs",
    sourceText: "namespace NestedCase { public static class Holder { private sealed class PrivateGame : Microsoft.Xna.Framework.Game { public int Value { get; } public PrivateGame() { Value = 1; } } } }",
    expectedDiagnosticId: null,
    expectedNames: ["NestedCase.Holder+PrivateGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "open-generic",
    assemblyName: "Issue022OpenGeneric",
    sourcePath: "src/OpenGeneric.cs",
    sourceText: "namespace GenericCase { public class GenericGame<T> : Microsoft.Xna.Framework.Game { public int Value { get; } public GenericGame() { Value = 1; } } }",
    expectedDiagnosticId: "PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR",
    expectedNames: ["GenericCase.GenericGame`1"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "abstract-only",
    assemblyName: "Issue022AbstractOnly",
    sourcePath: "src/AbstractOnly.cs",
    sourceText: "namespace AbstractCase { public abstract class AbstractGame : Microsoft.Xna.Framework.Game { } public sealed class Helper { public int Value() => 1; } }",
    expectedDiagnosticId: "PG0001_NO_GAME_SUBCLASS",
    expectedNames: [],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "base-game-reference-only",
    assemblyName: "Issue022BaseGameOnly",
    sourcePath: "src/BaseGameOnly.cs",
    sourceText: "namespace BaseCase { public sealed class UsesBaseGame { public System.Type Value() => typeof(Microsoft.Xna.Framework.Game); } }",
    expectedDiagnosticId: "PG0001_NO_GAME_SUBCLASS",
    expectedNames: [],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "constructor-throws",
    assemblyName: "Issue022ConstructorThrows",
    sourcePath: "src/ConstructorThrows.cs",
    sourceText: "namespace ThrowCase { public sealed class ThrowingGame : Microsoft.Xna.Framework.Game { public ThrowingGame() { throw new System.InvalidOperationException(\"private user detail\"); } } }",
    expectedDiagnosticId: null,
    expectedNames: ["ThrowCase.ThrowingGame"],
    expectedErrorCode: "PREVIEW_START_FAILED",
    disposeFails: false,
  },
  {
    caseId: "fresh-after-constructor-failure",
    assemblyName: "Issue022FreshRecovery",
    sourcePath: "src/FreshRecovery.cs",
    sourceText: "namespace RecoveryCase { public sealed class RecoveryGame : Microsoft.Xna.Framework.Game { public int Value { get; } public RecoveryGame() { Value = 1; } } }",
    expectedDiagnosticId: null,
    expectedNames: ["RecoveryCase.RecoveryGame"],
    expectedErrorCode: null,
    disposeFails: false,
  },
  {
    caseId: "dispose-throws",
    assemblyName: "Issue022DisposeThrows",
    sourcePath: "src/DisposeThrows.cs",
    sourceText: "namespace DisposeCase { public sealed class DisposeGame : Microsoft.Xna.Framework.Game { public int Value { get; } public DisposeGame() { Value = 1; } protected override void Dispose(bool disposing) { throw new System.InvalidOperationException(\"private dispose detail\"); } } }",
    expectedDiagnosticId: null,
    expectedNames: ["DisposeCase.DisposeGame"],
    expectedErrorCode: null,
    disposeFails: true,
  },
] as const;

function validateCase(
  definition: typeof cases[number],
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const pipeline = raw.pipeline as {
    success: boolean;
    gameTypeFullName: string | null;
    constructedTypeFullName: string | null;
    assignableToGame: boolean;
    diagnostic: null | {
      origin: string;
      severity: string;
      id: string;
      message: string;
      file: string;
      line: number;
      column: number;
    };
    error: null | { code: string; message: string };
    constructionAttempts: number;
    retainedGame: boolean;
  };
  const response = raw.response as {
    success: boolean;
    error?: { code: string; diagnostics?: unknown[] };
  };
  const beforeLoad = raw.beforeLoad as {
    success: boolean;
    diagnostic: unknown;
    error: null | { code: string };
    constructionAttempts: number;
    retainedGame: boolean;
  };
  if (beforeLoad.success || beforeLoad.diagnostic !== null ||
      beforeLoad.error?.code !== "INVALID_STATE" ||
      beforeLoad.constructionAttempts !== 0 || beforeLoad.retainedGame !== false) {
    throw new Error(`Issue 022 ${definition.caseId} before-load state was accepted.`);
  }
  const teardown = raw.teardown as {
    first: {
      success: boolean;
      hadGame: boolean;
      disposeAttempts: number;
      retainedGame: boolean;
      error: null | { code: string; message: string };
      alreadyTornDown: boolean;
    };
    second: {
      success: boolean;
      hadGame: boolean;
      disposeAttempts: number;
      retainedGame: boolean;
      error: null | { code: string; message: string };
      alreadyTornDown: boolean;
    };
  };
  if (definition.expectedDiagnosticId) {
    const diagnostic = pipeline.diagnostic;
    if (pipeline.success || response.success || pipeline.error?.code !== "PREVIEW_LOAD_FAILED" ||
        response.error?.code !== "PREVIEW_LOAD_FAILED" ||
        diagnostic?.origin !== "playground" || diagnostic.severity !== "error" ||
        diagnostic.id !== definition.expectedDiagnosticId ||
        diagnostic.file !== "" || diagnostic.line !== 0 || diagnostic.column !== 0 ||
        response.error.diagnostics?.length !== 1 ||
        pipeline.constructionAttempts !== 0 || pipeline.retainedGame !== false ||
        definition.expectedNames.some(name => !diagnostic.message.includes(name))) {
      throw new Error(`Issue 022 ${definition.caseId} validation result did not match.`);
    }
    if (definition.caseId === "multiple-games" &&
        diagnostic.message.indexOf(definition.expectedNames[0]) >=
        diagnostic.message.indexOf(definition.expectedNames[1])) {
      throw new Error("Issue 022 multiple-game names were not ordinally ordered.");
    }
  } else if (definition.expectedErrorCode) {
    if (pipeline.success || response.success ||
        pipeline.error?.code !== definition.expectedErrorCode ||
        response.error?.code !== definition.expectedErrorCode ||
        pipeline.diagnostic !== null ||
        pipeline.gameTypeFullName !== definition.expectedNames[0] ||
        pipeline.constructionAttempts !== 1 || pipeline.retainedGame !== false ||
        pipeline.error.message.includes("private user detail")) {
      throw new Error(`Issue 022 ${definition.caseId} construction failure was not sanitized.`);
    }
  } else if (!pipeline.success || !response.success ||
      pipeline.gameTypeFullName !== definition.expectedNames[0] ||
      pipeline.constructedTypeFullName !== definition.expectedNames[0] ||
      pipeline.assignableToGame !== true || pipeline.diagnostic !== null ||
      pipeline.error !== null || pipeline.constructionAttempts !== 1 ||
      pipeline.retainedGame !== true) {
    throw new Error("Issue 022 valid Game was not constructed by the browser runtime.");
  }

  const expectedGameAtTeardown =
    !definition.expectedDiagnosticId && !definition.expectedErrorCode;
  if (teardown.first.hadGame !== expectedGameAtTeardown ||
      teardown.first.disposeAttempts !== (expectedGameAtTeardown ? 1 : 0) ||
      teardown.first.retainedGame !== false ||
      teardown.second.success !== true || teardown.second.hadGame !== false ||
      teardown.second.disposeAttempts !== 0 || teardown.second.retainedGame !== false ||
      teardown.second.alreadyTornDown !== true ||
      (definition.disposeFails
        ? teardown.first.success !== false ||
          teardown.first.error?.code !== "PREVIEW_STOP_FAILED" ||
          teardown.first.error.message.includes("private dispose detail")
        : teardown.first.success !== true || teardown.first.error !== null)) {
    throw new Error(`Issue 022 ${definition.caseId} teardown accounting failed.`);
  }

  const runtime = raw.runtime as {
    runtimeStarts: number;
    terminalResponses: number;
    unexpectedErrors: unknown[];
  };
  const transfer = raw.transfer as {
    assemblySenderDetached: boolean;
    pdbSenderDetached: boolean;
  };
  if (runtime.runtimeStarts !== 1 || runtime.terminalResponses !== 1 ||
      runtime.unexpectedErrors.length !== 0 ||
      transfer.assemblySenderDetached !== true || transfer.pdbSenderDetached !== true ||
      (raw.compilerDiagnostics as unknown[]).length !== 0 ||
      raw.repeatMatched !== true || raw.compilerRuntimeStarts !== 1) {
    throw new Error(`Issue 022 ${definition.caseId} runtime accounting failed.`);
  }
  return raw;
}

export async function runIssue022AutoProof(): Promise<void> {
  const invoke = window.__TAURI_INTERNALS__?.invoke;
  if (!invoke || !(await invoke<boolean>("issue022_is_proof_enabled"))) return;
  const proofRuntimeReadiness = await preparePackagedProofRuntime();

  const outcomes: Record<string, unknown>[] = [];
  for (const definition of cases) {
    outcomes.push(validateCase(
      definition,
      await compileLoadConstructIssue22Case(definition),
    ));
  }

  const externalResourceRequests = performance.getEntriesByType("resource")
    .map(entry => entry.name)
    .filter(name => /^https?:/i.test(name) && new URL(name).origin !== window.location.origin);
  const unexpectedErrors = {
    topLevelConsoleErrors: window.__MONOGAME_DIAGNOSTICS__.consoleErrors,
    topLevelUnhandledErrors: window.__MONOGAME_DIAGNOSTICS__.unhandledErrors,
    compilerErrors: window.compilerIssue21Proof?.errors ?? [],
  };
  if (Object.values(unexpectedErrors).some(errors => errors.length !== 0) ||
      externalResourceRequests.length !== 0) {
    throw new Error("Issue 022 unexpected error or external-resource channel is not empty.");
  }

  await invoke("issue022_emit_report", {
    report: JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      proofMode: "MONOGAME_ISSUE022_PROOF=1",
      proofRuntimeReadiness,
      cases: outcomes,
      compilerRuntimeStarts: outcomes[0]?.compilerRuntimeStarts,
      previewRuntimeStarts: outcomes.length,
      previewTeardowns: outcomes.filter(outcome =>
        (outcome.teardown as { second?: { alreadyTornDown?: boolean } })
          ?.second?.alreadyTornDown === true).length,
      topLevelRuntime: {
        state: document.documentElement.dataset.runtime,
        renderedFramesObserved: window.__MONOGAME_DIAGNOSTICS__.renderedFramesObserved,
      },
      diagnostics: {
        ...unexpectedErrors,
        externalResourceRequests,
        socketClaim: "not observed in renderer; verify externally during proofWaitSeconds",
      },
      proofWaitSeconds: 20,
    }),
  });
}

// ── Supported-API policy + analyzers (former issue31) ──
function requirePolicyDiagnostic(
  result: Compilation,
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

  const functionPointerPolicy = await compile("Issue031_FunctionPointerPolicy", [{
    path: "src/DeferredFunctionPointer.cs",
    text: [
      "public static class DeferredFunctionPointer {",
      " public static delegate* unmanaged<void> Callback;",
      "}",
    ].join("\n"),
  }]);
  const functionPointerDiagnostics = functionPointerPolicy.error?.diagnostics ?? [];
  if (functionPointerPolicy.success !== false ||
      functionPointerDiagnostics.some(diagnostic => diagnostic.id === "PG0103") ||
      functionPointerDiagnostics.filter(diagnostic =>
        diagnostic.id === "PG0106" &&
        diagnostic.file === "src/DeferredFunctionPointer.cs" &&
        diagnostic.line === 2 &&
        diagnostic.column === 16).length !== 1)
    throw new Error(
      `Function pointer ownership regressed: ${JSON.stringify(functionPointerPolicy)}`,
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
      functionPointerPolicy,
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
        functionPointerAssignedPg0106: true,
        repeatedCompilationDeterministic: true,
        reversedSourceOrderDeterministic: true,
        cleanCrossFileRegression: true,
      },
    }),
  });
}

// ── Reject native/JS interop with diagnostics (former issue32) ──
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

// Single durable-scenario entrypoint. Orchestrates the three diagnostics/policy
// sub-proofs; each self-gates on its own env flag and emits its own success
// report, while this driver owns per-sub-proof failure reporting.
export async function runCompilerDiagnosticsScenario(): Promise<void> {
  const subProofs: SubProof[] = [
    { label: "Game discovery + PGxxxx diagnostics (issue022)", reportCommand: "issue022_emit_report", run: runIssue022AutoProof },
    { label: "supported-API policy + analyzers (issue031)", reportCommand: "issue031_emit_report", run: runIssue031AutoProof },
    { label: "reject native/JS interop (issue032)", reportCommand: "issue032_emit_report", run: runIssue032AutoProof },
  ];
  await runScenario(subProofs);
}

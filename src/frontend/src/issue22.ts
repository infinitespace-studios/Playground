import { compileLoadConstructIssue22Case } from "./issue21";

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

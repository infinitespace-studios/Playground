import { dotnet } from "./_framework/dotnet.js";

const status = document.querySelector("#status");
const pingButton = document.querySelector("#ping");
const compileButton = document.querySelector("#compile");
const diagnosticsButton = document.querySelector("#diagnostics");
const results = document.querySelector("#results");
const proofOutput = document.querySelector("#proof-state");

const proofState = {
  protocolVersion: 1,
  ready: false,
  startupAttempts: 0,
  successfulRuntimeStarts: 0,
  callInProgress: false,
  trustedClickCount: 0,
  pingCalls: [],
  compilations: [],
  diagnosticProof: null,
  error: null,
};

globalThis.compilerProof = proofState;

function renderState() {
  proofOutput.textContent = JSON.stringify(proofState, null, 2);
}

async function startRuntime() {
  proofState.startupAttempts += 1;
  renderState();

  const runtime = await dotnet.create();
  const config = runtime.getConfig();
  const assemblyExports = await runtime.getAssemblyExports(config.mainAssemblyName);
  const exports = assemblyExports.Playground.Compiler.CompilerExports;

  if (typeof exports.Ping !== "function" || typeof exports.Compile !== "function") {
    throw new Error("Required CompilerExports JSExport methods were not found.");
  }

  await runtime.runMain();
  globalThis.compilerProofCompile = requestJson => JSON.parse(exports.Compile(requestJson));
  proofState.successfulRuntimeStarts += 1;
  proofState.ready = true;
  status.dataset.state = "ready";
  status.textContent = "Ready: one .NET WebAssembly runtime is running.";
  pingButton.disabled = false;
  compileButton.disabled = false;
  diagnosticsButton.disabled = false;
  renderState();

  return exports;
}

const exportsPromise = startRuntime();

pingButton.addEventListener("click", async (event) => {
  if (!beginCall(event)) {
    return;
  }

  status.textContent = "Calling managed compiler context...";
  try {
    const exports = await exportsPromise;
    const proof = JSON.parse(exports.Ping());
    proofState.pingCalls.push({ trusted: event.isTrusted, ...proof });
    appendResult(
      `ping call=${proof.call}; runtime=${proof.runtimeIdentity}; ` +
      `Roslyn=${proof.roslynAssembly} ${proof.roslynAssemblyVersion}; trusted=${event.isTrusted}`);
    status.textContent = "Ping complete: persistent compiler context responded.";
  } catch (error) {
    showError(error);
  } finally {
    endCall();
  }
});

compileButton.addEventListener("click", async (event) => {
  if (!beginCall(event) || proofState.compilations.length >= 2) {
    return;
  }

  status.textContent = "Compiling deterministic valid source in browser WebAssembly...";
  try {
    const exports = await exportsPromise;
    const request = {
      protocolVersion: 1,
      sources: [{ path: "Foo.cs", text: "public class Foo { public int Bar() => 42; }" }],
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    };
    const response = JSON.parse(exports.Compile(JSON.stringify(request)));
    const assemblyBytes = response.assemblyBase64
      ? Uint8Array.from(atob(response.assemblyBase64), character => character.charCodeAt(0))
      : new Uint8Array();
    const pdbBytes = response.pdbBase64
      ? Uint8Array.from(atob(response.pdbBase64), character => character.charCodeAt(0))
      : new Uint8Array();
    const proof = {
      trusted: event.isTrusted,
      ...response,
      assemblyBase64: response.assemblyBase64 ? "[nonempty]" : null,
      pdbBase64: response.pdbBase64 ? "[nonempty]" : null,
      decodedAssemblyByteLength: assemblyBytes.byteLength,
      decodedPdbByteLength: pdbBytes.byteLength,
    };
    proofState.compilations.push(proof);

    if (!response.success) {
      throw new Error(`${response.error?.code ?? "COMPILE_FAILED"}: ${response.error?.message ?? "unknown error"}`);
    }

    appendResult(
      `compile assembly=${response.assemblyName}; DLL=${assemblyBytes.byteLength}; ` +
      `PDB=${pdbBytes.byteLength}; PE/CLI=${response.validity.hasCliHeader}; ` +
      `Foo.Bar=${response.validity.containsExpectedType && response.validity.containsExpectedMethod}; ` +
      `trusted=${event.isTrusted}`);
    status.textContent = proofState.compilations.length < 2
      ? "Compile complete. Activate compile again to prove a unique assembly name."
      : "Compile proof complete: two unique assemblies emitted from one runtime.";
  } catch (error) {
    showError(error);
  } finally {
    endCall();
  }
});

diagnosticsButton.addEventListener("click", async (event) => {
  if (!beginCall(event) || proofState.diagnosticProof) {
    return;
  }

  status.textContent = "Compiling structured diagnostic proof cases in browser WebAssembly...";
  try {
    const exports = await exportsPromise;
    proofState.diagnosticProof = runDiagnosticProof(exports);
    proofState.diagnosticProof.trusted = event.isTrusted;
    if (!Object.values(proofState.diagnosticProof.assertions).every(Boolean)) {
      throw new Error("One or more structured diagnostic proof assertions failed.");
    }

    appendResult(
      `diagnostics cases=${proofState.diagnosticProof.cases.length}; ` +
      `all assertions passed; trusted=${event.isTrusted}`);
    status.textContent = "Diagnostic proof complete: all structured cases passed.";
  } catch (error) {
    showError(error);
  } finally {
    endCall();
  }
});

function runDiagnosticProof(exports) {
  const settings = {
    languageVersion: "13.0",
    nullable: "disable",
    optimization: "debug",
    allowUnsafe: false,
    warningsAsErrors: false,
  };
  const definitions = [
    {
      name: "missing-semicolon-line-one",
      sources: [{
        path: "Syntax/MissingSemicolon.cs",
        text: "public class Foo { public int Bar() => 42 }",
      }],
      target: { id: "CS1002", severity: "error", file: "Syntax/MissingSemicolon.cs", line: 1, column: 43 },
      succeeds: false,
    },
    {
      name: "unbalanced-brace-at-eof",
      sources: [{
        path: "Syntax/UnbalancedBrace.cs",
        text: "public class Foo { public int Bar() => 42;",
      }],
      target: { id: "CS1513", severity: "error", file: "Syntax/UnbalancedBrace.cs", line: 1, column: 43 },
      succeeds: false,
    },
    {
      name: "unknown-type",
      sources: [{
        path: "Types/UnknownType.cs",
        text: "public class Foo { public MissingType Value; }",
      }],
      target: { id: "CS0246", severity: "error", file: "Types/UnknownType.cs", line: 1, column: 27 },
      succeeds: false,
    },
    {
      name: "two-files-crlf-utf16",
      sources: [
        { path: "Game/Game1.cs", text: "public class Game1 { public int Score => 1; }" },
        {
          path: "Game/Player.cs",
          text: "public class Player {\r\n    public int Score => 1;\r\n    public string Label = \"\uD83D\uDE00\"; public MissingType Value;\r\n}",
        },
      ],
      target: { id: "CS0246", severity: "error", file: "Game/Player.cs", line: 3, column: 40 },
      succeeds: false,
    },
    {
      name: "warning-only",
      sources: [{
        path: "Warnings/UnusedLocal.cs",
        text: "public class Foo { public void Bar() { int unused = 1; } }",
      }],
      target: { id: "CS0219", severity: "warning", file: "Warnings/UnusedLocal.cs", line: 1, column: 44 },
      succeeds: true,
    },
  ];

  const cases = definitions.map(definition => {
    const response = JSON.parse(exports.Compile(JSON.stringify({
      protocolVersion: 1,
      sources: definition.sources,
      settings,
    })));
    const target = response.diagnostics.find(diagnostic =>
      diagnostic.id === definition.target.id &&
      diagnostic.file === definition.target.file &&
      diagnostic.line === definition.target.line &&
      diagnostic.column === definition.target.column);
    return {
      name: definition.name,
      expected: { success: definition.succeeds, ...definition.target },
      actual: {
        success: response.success,
        target: target ?? null,
        diagnosticCount: response.diagnostics.length,
        diagnostics: response.diagnostics,
        hasAssembly: Boolean(response.assemblyBase64),
        hasPdb: Boolean(response.pdbBase64),
        assemblyByteLength: response.assemblyByteLength,
        pdbByteLength: response.pdbByteLength,
      },
      targetFound: Boolean(target),
      targetMessageNonempty: Boolean(target?.message),
      targetOriginCompiler: target?.origin === "compiler",
      targetSeverityMatches: target?.severity === definition.target.severity,
      resultMatches: response.success === definition.succeeds,
      binaryContractMatches: definition.succeeds
        ? Boolean(response.assemblyBase64 && response.pdbBase64)
        : !response.assemblyBase64 && !response.pdbBase64,
      diagnosticsSorted: response.diagnostics.every((diagnostic, index, diagnostics) =>
        index === 0 || compareDiagnostics(diagnostics[index - 1], diagnostic) <= 0),
    };
  });

  return {
    cases,
    assertions: {
      allTargetsFound: cases.every(item => item.targetFound),
      allMessagesNonempty: cases.every(item => item.targetMessageNonempty),
      allOriginsCompiler: cases.every(item => item.targetOriginCompiler),
      allSeveritiesMatch: cases.every(item => item.targetSeverityMatches),
      allResultsMatch: cases.every(item => item.resultMatches),
      binaryContract: cases.every(item => item.binaryContractMatches),
      deterministicSort: cases.every(item => item.diagnosticsSorted),
      diagnosticContract: cases.every(item => item.actual.diagnostics.every(diagnostic =>
        diagnostic.origin === "compiler" &&
        ["error", "warning", "info"].includes(diagnostic.severity) &&
        /^CS[0-9]+$/.test(diagnostic.id) &&
        Boolean(diagnostic.message) &&
        (diagnostic.file
          ? diagnostic.line >= 1 && diagnostic.column >= 1
          : diagnostic.line === 0 && diagnostic.column === 0))),
      warningSucceededWithBinaries: cases.find(item => item.name === "warning-only").actual.success &&
        cases.find(item => item.name === "warning-only").actual.hasAssembly &&
        cases.find(item => item.name === "warning-only").actual.hasPdb,
    },
  };
}

function compareDiagnostics(left, right) {
  return compareOrdinal(left.file, right.file) ||
    left.line - right.line ||
    left.column - right.column ||
    compareOrdinal(left.severity, right.severity) ||
    compareOrdinal(left.id, right.id);
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function beginCall(event) {
  if (!proofState.ready || proofState.callInProgress) {
    return false;
  }

  proofState.callInProgress = true;
  pingButton.disabled = true;
  compileButton.disabled = true;
  diagnosticsButton.disabled = true;
  if (event.isTrusted) {
    proofState.trustedClickCount += 1;
  }
  return true;
}

function endCall() {
  proofState.callInProgress = false;
  if (proofState.ready) {
    pingButton.disabled = false;
    compileButton.disabled = proofState.compilations.length >= 2;
    diagnosticsButton.disabled = Boolean(proofState.diagnosticProof);
  }
  renderState();
}

function appendResult(text) {
  const item = document.createElement("li");
  item.textContent = text;
  results.append(item);
}

function showError(error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  proofState.error = message;
  status.dataset.state = "error";
  status.textContent = `Compiler context error: ${message}`;
  console.error(error);
  renderState();
}

try {
  await exportsPromise;
} catch (error) {
  showError(error);
  throw error;
}

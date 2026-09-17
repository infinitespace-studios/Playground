import { initializeCompilerProofMode } from "./ProtocolEndpointsProof.js";

// PROOF-only compiler runtime extension.
//
// Deployed ONLY by the PROOF staging profile (see Playground.Compiler.csproj /
// stage-compiler.mjs). The PRODUCT compiler document never loads this module, so
// the shipped compiler-harness.js carries no proof globals, proof DOM/state,
// interactive ping/reference/diagnostic buttons, retention-behavior proof, or
// proof-mode handshake.
//
// This module assigns `globalThis.__playgroundCompilerExtension` BEFORE
// compiler-harness.js evaluates (the proof index.html lists it first).
// compiler-harness.js invokes the factory with a neutral `controls` surface and
// consults the returned `observe` / `bootstrap` hooks at its lifecycle sites, so
// every proof behavior that used to live inline in compiler-harness.js is
// preserved here.

globalThis.__playgroundCompilerExtension = controls => {
  const status = controls.status;
  const pingButton = document.querySelector("#ping");
  const compileButton = document.querySelector("#compile");
  const diagnosticsButton = document.querySelector("#diagnostics");
  const languageServicesButton = document.querySelector("#language-services");
  const directCompletionButton = document.querySelector("#direct-completion");
  const languageSessionButton = document.querySelector("#language-session");
  const results = document.querySelector("#results");
  const proofOutput = document.querySelector("#proof-state");
  // The issue-070 static page is intentionally loaded without the Workbench
  // parent iframe. Embedded proof runs still require the authenticated
  // bootstrap handshake; only a genuinely top-level proof page self-authorizes
  // so its diagnostic/completion controls can be exercised independently.
  const standaloneProofPage = window.parent === window;

  const proofState = {
    protocolVersion: 1,
    ready: false,
    startupAttempts: 0,
    successfulRuntimeStarts: 0,
    callInProgress: false,
    trustedClickCount: 0,
    pingCalls: [],
    compilations: [],
    referenceProof: null,
    diagnosticProof: null,
    languageServiceSpike: null,
    languageSessionProof: null,
    error: null,
  };

  globalThis.compilerProof = proofState;
  globalThis.compilerIssue21Proof = {
    runtimeStarts: 0,
    transfer: null,
    bootstrap: controls.bootstrapObservations,
    requests: [],
    errors: [],
    expectedProbeRejections: [],
  };

  let resolveProofAuthorization;
  const proofAuthorization = new Promise(resolve => { resolveProofAuthorization = resolve; });

  function renderState() {
    if (proofOutput) proofOutput.textContent = JSON.stringify(proofState, null, 2);
  }

  async function runRetentionBehaviorProof(exports) {
    const request = JSON.stringify({
      protocolVersion: 1,
      sources: [{ path: "src/RetentionProof.cs", text: "public sealed class RetentionProof { }" }],
      settings: {
        languageVersion: "13.0", nullable: "disable", optimization: "debug",
        allowUnsafe: false, warningsAsErrors: false,
      },
    });
    const owner1 = { compileId: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    const owner2 = { compileId: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    const owner3 = { compileId: crypto.randomUUID(), correlationId: crypto.randomUUID() };
    if (!exports.ConfigureNextRetentionTestLease(500)) throw new Error("Retention proof configuration failed.");
    const first = JSON.parse(exports.CompileAndRetain(
      owner1.compileId, owner1.correlationId, "RetentionProofOne", request));
    const firstState = JSON.parse(exports.GetRetentionState());
    const competing = JSON.parse(exports.CompileAndRetain(
      owner2.compileId, owner2.correlationId, "RetentionProofTwo", request));
    await exports.ConsumeAssembly(owner1.compileId, owner1.correlationId);
    const partialState = JSON.parse(exports.GetRetentionState());
    const firstAbort = exports.AbortRetained(owner1.compileId, owner1.correlationId);
    const repeatedAbort = exports.AbortRetained(owner1.compileId, owner1.correlationId);
    const abortedState = JSON.parse(exports.GetRetentionState());

    if (!exports.ConfigureNextRetentionTestLease(150)) throw new Error("Retention expiry proof configuration failed.");
    const expiring = JSON.parse(exports.CompileAndRetain(
      owner2.compileId, owner2.correlationId, "RetentionProofExpiry", request));
    await new Promise(resolve => window.setTimeout(resolve, 400));
    const expiredState = JSON.parse(exports.GetRetentionState());

    if (!exports.ConfigureNextRetentionTestLease(500)) throw new Error("Retention reuse proof configuration failed.");
    const subsequent = JSON.parse(exports.CompileAndRetain(
      owner3.compileId, owner3.correlationId, "RetentionProofReuse", request));
    const subsequentAbort = exports.AbortRetained(owner3.compileId, owner3.correlationId);
    const finalState = JSON.parse(exports.GetRetentionState());
    const passed = first.success && firstState.retainedCount === 1 && firstState.retainedBytes > 0 &&
      !competing.success && competing.error?.code === "INVALID_STATE" &&
      partialState.retainedCount === 1 && partialState.retainedBytes > 0 &&
      firstAbort && repeatedAbort && abortedState.retainedCount === 0 && abortedState.retainedBytes === 0 &&
      expiring.success && expiredState.retainedCount === 0 && expiredState.retainedBytes === 0 &&
      subsequent.success && subsequentAbort && finalState.retainedCount === 0 && finalState.retainedBytes === 0;
    if (!passed) throw new Error("Behavioral retention proof failed.");
    return {
      firstLeaseObserved: true,
      competingRejectedBeforeCompile: true,
      partialConsumptionAbortZeroized: true,
      repeatedAbortIdempotent: true,
      timerExpiredWithoutExportCleanup: true,
      subsequentLeaseSucceeded: true,
      finalRetainedCount: finalState.retainedCount,
      finalRetainedBytes: finalState.retainedBytes,
    };
  }

  function beginCall(event) {
    if (!proofState.ready || proofState.callInProgress) {
      return false;
    }
    proofState.callInProgress = true;
    if (pingButton) pingButton.disabled = true;
    if (compileButton) compileButton.disabled = true;
    if (diagnosticsButton) diagnosticsButton.disabled = true;
    if (languageServicesButton) languageServicesButton.disabled = true;
    if (directCompletionButton) directCompletionButton.disabled = true;
    if (languageSessionButton) languageSessionButton.disabled = true;
    if (event.isTrusted) {
      proofState.trustedClickCount += 1;
    }
    return true;
  }

  function endCall() {
    proofState.callInProgress = false;
    if (proofState.ready) {
      if (pingButton) pingButton.disabled = false;
      if (compileButton) compileButton.disabled = Boolean(proofState.referenceProof);
      if (diagnosticsButton) diagnosticsButton.disabled = Boolean(proofState.diagnosticProof);
      if (languageServicesButton) languageServicesButton.disabled = Boolean(proofState.languageServiceSpike);
      if (directCompletionButton) directCompletionButton.disabled = false;
      if (languageSessionButton) languageSessionButton.disabled = false;
    }
    renderState();
  }

  function appendResult(text) {
    const item = document.createElement("li");
    item.textContent = text;
    if (results) results.append(item);
  }

  function showError(error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    proofState.error = message;
    if (status) {
      status.dataset.state = "error";
      status.textContent = `Compiler context error: ${message}`;
    }
    console.error(error);
    renderState();
  }

  function compileProof(exports, definition, trusted) {
    const response = JSON.parse(exports.Compile(JSON.stringify({
      protocolVersion: 1,
      sources: [{ path: definition.path, text: definition.text }],
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    })));
    const assemblyBytes = response.assemblyBase64
      ? Uint8Array.from(atob(response.assemblyBase64), character => character.charCodeAt(0))
      : new Uint8Array();
    const pdbBytes = response.pdbBase64
      ? Uint8Array.from(atob(response.pdbBase64), character => character.charCodeAt(0))
      : new Uint8Array();
    if (!response.success) {
      const diagnostics = response.diagnostics
        .map(diagnostic => `${diagnostic.id}: ${diagnostic.message}`)
        .join("; ");
      throw new Error(
        `${definition.name}: ${response.error?.code ?? "COMPILE_FAILED"}: ` +
        `${response.error?.message ?? "unknown error"}; ${diagnostics}`);
    }
    return {
      name: definition.name,
      trusted,
      ...response,
      assemblyBase64: response.assemblyBase64 ? "[nonempty]" : null,
      pdbBase64: response.pdbBase64 ? "[nonempty]" : null,
      decodedAssemblyByteLength: assemblyBytes.byteLength,
      decodedPdbByteLength: pdbBytes.byteLength,
    };
  }

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

  pingButton?.addEventListener("click", async event => {
    if (!beginCall(event)) return;
    if (status) status.textContent = "Calling managed compiler context...";
    try {
      const exports = await controls.exportsPromise;
      const proof = JSON.parse(exports.Ping());
      proofState.pingCalls.push({ trusted: event.isTrusted, ...proof });
      appendResult(
        `ping call=${proof.call}; runtime=${proof.runtimeIdentity}; ` +
        `Roslyn=${proof.roslynAssembly} ${proof.roslynAssemblyVersion}; trusted=${event.isTrusted}`);
      if (status) status.textContent = "Ping complete: persistent compiler context responded.";
    } catch (error) {
      showError(error);
    } finally {
      endCall();
    }
  });

  compileButton?.addEventListener("click", async event => {
    if (!beginCall(event) || proofState.referenceProof) return;
    if (status) status.textContent = "Compiling deterministic valid source in browser WebAssembly...";
    try {
      const exports = await controls.exportsPromise;
      const definitions = [
        {
          name: "trivial",
          path: "Foo.cs",
          text: "public class Foo { public int Bar() => 42; }",
        },
        {
          name: "monogame-native",
          path: "Game1.cs",
          text: "using Microsoft.Xna.Framework; public class Foo : Game { }",
        },
      ];
      const proofs = definitions.map(definition =>
        compileProof(exports, definition, event.isTrusted));
      proofState.compilations.push(...proofs);
      proofState.referenceProof = {
        trusted: event.isTrusted,
        samples: proofs.map(proof => ({
          name: proof.name,
          success: proof.success,
          diagnosticCount: proof.diagnostics.length,
          assemblyByteLength: proof.assemblyByteLength,
          pdbByteLength: proof.pdbByteLength,
        })),
        assertions: {
          bothSucceeded: proofs.every(proof => proof.success),
          noDiagnostics: proofs.every(proof => proof.diagnostics.length === 0),
          binariesReturned: proofs.every(proof =>
            proof.decodedAssemblyByteLength > 0 && proof.decodedPdbByteLength > 0),
          uniqueAssemblies: new Set(proofs.map(proof => proof.assemblyName)).size === proofs.length,
        },
      };
      if (!Object.values(proofState.referenceProof.assertions).every(Boolean)) {
        throw new Error("Compiler reference proof assertions failed.");
      }

      appendResult(
        `references trivial=${proofs[0].success}; MonoGame.Game=${proofs[1].success}; ` +
        `DLLs=${proofs.map(proof => proof.decodedAssemblyByteLength).join("/")}; ` +
        `PDBs=${proofs.map(proof => proof.decodedPdbByteLength).join("/")}; ` +
        `trusted=${event.isTrusted}`);
      if (status) status.textContent = "Reference proof complete: trivial and MonoGame Game samples compiled.";
    } catch (error) {
      showError(error);
    } finally {
      endCall();
    }
  });

  languageServicesButton?.addEventListener("click", async event => {
    if (!beginCall(event) || proofState.languageServiceSpike) return;
    if (status) status.textContent = "Running Roslyn Workspaces/Features completion feasibility spike...";
    try {
      const exports = await controls.exportsPromise;
      proofState.languageServiceSpike = JSON.parse(await exports.RunLanguageServiceSpike());
      proofState.languageServiceSpike.trusted = event.isTrusted;
      appendResult(
        `IntelliSense spike success=${proofState.languageServiceSpike.success}; ` +
        `completionRequests=${proofState.languageServiceSpike.measurements?.completionRequestCount ?? 0}; ` +
        `recommendation=${proofState.languageServiceSpike.recommendation}; ` +
        `error=${proofState.languageServiceSpike.error ?? "none"}; trusted=${event.isTrusted}`);
      if (status) status.textContent = "IntelliSense feasibility spike complete.";
    } catch (error) {
      showError(error);
    } finally {
      endCall();
    }
  });

  directCompletionButton?.addEventListener("click", async event => {
    if (!beginCall(event)) return;
    if (status) status.textContent = "Running direct SemanticModel completion backend...";
    try {
      const exports = await controls.exportsPromise;
      const result = JSON.parse(exports.RunDirectCompletionBackendSpike());
      appendResult(
        `Direct completion success=${result.success}; expected=${result.expectedItem}; ` +
        `found=${result.items?.some(item => item.name === result.expectedItem)}; ` +
        `elapsedMs=${result.elapsedMs}; recommendation=${result.recommendation}; trusted=${event.isTrusted}`);
      if (status) status.textContent = "Direct completion backend proof complete.";
    } catch (error) {
      showError(error);
    } finally {
      endCall();
    }
  });

  languageSessionButton?.addEventListener("click", async event => {
    if (!beginCall(event) || proofState.languageSessionProof) return;
    if (status) status.textContent = "Running persistent direct-completion session proof...";
    try {
      const exports = await controls.exportsPromise;
      const sessionId = crypto.randomUUID();
      let sequence = 0;
      const call = (type, payload) => JSON.parse(exports.LanguageServiceHandle(JSON.stringify({
        protocolVersion: 1,
        correlationId: crypto.randomUUID(),
        type,
        payload,
      })));
      const gameText = "class Game { Player player = new Player(); void M() { player. } }";
      const playerText = "public class Player { public int Score; public void Jump() { } }";
      const gameUri = `playground-model://${sessionId}/Game.cs`;
      const playerUri = `playground-model://${sessionId}/Player.cs`;
      const open = call("language.session.open.request", { sessionId });
      const gameOpen = call("language.document.open.request", {
        sessionId, uri: gameUri, path: "Game.cs", version: 1, text: gameText,
      });
      const playerOpen = call("language.document.open.request", {
        sessionId, uri: playerUri, path: "Player.cs", version: 1, text: playerText,
      });
      const position = gameText.indexOf("player.") + "player.".length;
      const completion = call("language.completion.request", {
        sessionId, uri: gameUri, version: 1,
        position: { offset: position, line: 1, column: position + 1 },
      });
      const replaced = call("language.document.replace.request", {
        sessionId, uri: playerUri, path: "Player.cs", version: 2,
        text: `${playerText.slice(0, -2)} public int Health; }`,
      });
      const gameReplaced = call("language.document.replace.request", {
        sessionId, uri: gameUri, path: "Game.cs", version: 2,
        text: `${gameText} // newer generation`,
      });
      const stale = call("language.completion.request", {
        sessionId, uri: gameUri, version: 1,
        position: { offset: position, line: 1, column: position + 1 },
      });
      const items = completion.result?.success ? completion.result.data.items : [];
      let version = 3;
      const positiveFixtures = [
        { text: "class Game { Player player = new Player(); void M() { player./*cursor*/ } }", expected: "Score" },
        { text: "class Game { Player player = new Player(); void M() { player./*cursor*/ } }", expected: "Jump" },
        { text: "class Game { void M() { string value = \"x\"; value./*cursor*/ } }", expected: "ToString" },
        { text: "class Game { void M() { int value = 1; value./*cursor*/ } }", expected: "ToString" },
        { text: "class Game { Player player = new Player(); void M() { player./*cursor*/ } }", expected: "GetType" },
      ];
      const negativeFixtures = [
        { text: "class Game { void M() { missing./*cursor*/ } }", absent: "Score" },
        { text: "class Game { void M() { value./*cursor*/ } }", absent: "ToString" },
        { text: "class Game { void M() { } }", absent: "Score" },
        { text: "class Game { Player player = new Player(); void M() { player./*cursor*/ } }", absent: "NotARealMember" },
        { text: "class Game { void M() { string value = \"x\"; value./*cursor*/ } }", absent: "Score" },
      ];
      const runFixture = fixture => {
        const marker = "/*cursor*/";
        const text = fixture.text.replace(marker, "");
        const offset = fixture.text.indexOf(marker);
        const replacement = call("language.document.replace.request", {
          sessionId, uri: gameUri, path: "Game.cs", version: version++, text,
        });
        const result = replacement.result?.success
          ? call("language.completion.request", {
              sessionId, uri: gameUri, version: version - 1,
              position: { offset, line: 1, column: offset + 1 },
            })
          : replacement;
        const resultItems = result.result?.success ? result.result.data.items : [];
        return { result, found: resultItems.some(item => item.label === (fixture.expected ?? fixture.absent)), items: resultItems };
      };
      const positiveResults = positiveFixtures.map(runFixture);
      const negativeResults = negativeFixtures.map(runFixture);
      const updateTimes = [];
      const heapBefore = performance.memory?.usedJSHeapSize ?? null;
      for (let index = 0; index < 100; index += 1) {
        const text = `class Game { Player player = new Player(); void M() { player. } } // update-${index}`;
        const start = performance.now();
        call("language.document.replace.request", {
          sessionId, uri: gameUri, path: "Game.cs", version: version++, text,
        });
        updateTimes.push(performance.now() - start);
      }
      const heapAfter = performance.memory?.usedJSHeapSize ?? null;
      const sortedUpdates = [...updateTimes].sort((left, right) => left - right);
      const updateBenchmark = {
        count: updateTimes.length,
        p50Ms: sortedUpdates[Math.floor(sortedUpdates.length * 0.5)],
        p95Ms: sortedUpdates[Math.floor(sortedUpdates.length * 0.95)],
        heapBefore,
        heapAfter,
      };
      const closed = call("language.session.close.request", { sessionId });
      const assertions = {
        sessionAccepted: open.result?.success === true,
        bothDocumentsOpened: gameOpen.result?.success === true && playerOpen.result?.success === true,
        scoreFound: items.some(item => item.label === "Score"),
        replacementAccepted: replaced.result?.success === true && gameReplaced.result?.success === true,
        staleRejected: stale.result?.success === false && stale.result.error.code === "STALE_DOCUMENT_VERSION",
        positiveFixtures: positiveResults.every(result => result.result?.success === true && result.found),
        negativeFixtures: negativeResults.every(result => result.result?.success === true && !result.found),
        hundredUpdates: updateBenchmark.count === 100,
        sessionClosed: closed.result?.success === true,
      };
      proofState.languageSessionProof = {
        trusted: event.isTrusted, assertions, sequence, items,
        positiveResults, negativeResults, updateBenchmark,
      };
      if (!Object.values(assertions).every(Boolean)) throw new Error("Persistent language session proof failed.");
      appendResult(`Persistent session success=true; Score=true; positives=5; negatives=5; updates=100; staleRejected=true; trusted=${event.isTrusted}`);
      if (status) status.textContent = "Persistent completion session proof complete.";
    } catch (error) {
      showError(error);
    } finally {
      endCall();
    }
  });

  diagnosticsButton?.addEventListener("click", async event => {
    if (!beginCall(event) || proofState.diagnosticProof) return;
    if (status) status.textContent = "Compiling structured diagnostic proof cases in browser WebAssembly...";
    try {
      const exports = await controls.exportsPromise;
      proofState.diagnosticProof = runDiagnosticProof(exports);
      proofState.diagnosticProof.trusted = event.isTrusted;
      if (!Object.values(proofState.diagnosticProof.assertions).every(Boolean)) {
        throw new Error("One or more structured diagnostic proof assertions failed.");
      }

      appendResult(
        `diagnostics cases=${proofState.diagnosticProof.cases.length}; ` +
        `all assertions passed; trusted=${event.isTrusted}`);
      if (status) status.textContent = "Diagnostic proof complete: all structured cases passed.";
    } catch (error) {
      showError(error);
    } finally {
      endCall();
    }
  });

  return {
    observe: {
      onStartupAttempt() {
        proofState.startupAttempts += 1;
        renderState();
      },
      onReady() {
        proofState.ready = true;
        if (pingButton) pingButton.disabled = false;
        if (compileButton) compileButton.disabled = false;
        if (diagnosticsButton) diagnosticsButton.disabled = false;
        if (languageServicesButton) languageServicesButton.disabled = false;
        if (directCompletionButton) directCompletionButton.disabled = false;
        if (languageSessionButton) languageSessionButton.disabled = false;
        renderState();
      },
      onCompileTransfer(transfer) {
        globalThis.compilerIssue21Proof.transfer = transfer;
      },
      onCompileRequest(request) {
        globalThis.compilerIssue21Proof.requests.push(request);
      },
      onCompileAbort(abort) {
        globalThis.compilerIssue21Proof.lastAbort = abort;
      },
      onError(message) {
        proofState.error = message;
        renderState();
      },
    },
    bootstrap: {
      validateData(data) {
        return Object.hasOwn(data, "issue021Proof") && typeof data.issue021Proof === "boolean";
      },
      onBootstrap(data) {
        resolveProofAuthorization(data.issue021Proof);
      },
      endpointParams() {
        return {
          observer: {
            errors: globalThis.compilerIssue21Proof.errors,
            terminals: [],
            closes: [],
            duplicateControls: [],
          },
        };
      },
      async onRuntimeReady({ exports }) {
        proofState.successfulRuntimeStarts += 1;
        globalThis.compilerIssue21Proof.runtimeStarts += 1;
        // PROOF-only same-origin bridge for issue 073. PRODUCT never loads
        // this extension or exposes a language-service entry point.
        globalThis.compilerProofLanguageService = request =>
          JSON.parse(exports.LanguageServiceHandle(JSON.stringify(request)));
        globalThis.compilerProofLanguageFeatures = request =>
          JSON.parse(exports.LanguageFeatureHandle(JSON.stringify(request)));
        globalThis.compilerProofCompile = requestJson => JSON.parse(exports.Compile(requestJson));
        const proofAuthorized = standaloneProofPage ? true : await proofAuthorization;
        globalThis.compilerIssue21Proof.retention = await initializeCompilerProofMode(
          proofAuthorized,
          async () => {
            if (!exports.AuthorizeRetentionProof()) throw new Error("Retention proof authorization failed.");
            try {
              return await runRetentionBehaviorProof(exports);
            } finally {
              exports.CompleteRetentionProof();
            }
          },
        );
      },
    },
  };
};

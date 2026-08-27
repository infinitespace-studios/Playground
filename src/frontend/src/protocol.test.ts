import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  LIMITS,
  DEFAULT_TIMEOUTS_MS,
  MAX_TIMEOUTS_MS,
  PLAYGROUND_DIAGNOSTIC_IDS,
  PROTOCOL_ERROR_CODES,
  inspectClone,
  isCanonicalPath,
  isUuidV4,
  ProtocolPortClient,
  standaloneBuffer,
  validateBinaryPair,
  validateCompileRequest,
  validateCompileResponse,
  validatePreviewLoadRequest,
} from "./protocol.ts";
import { installPrivatePortBootstrap } from "../../shared/ProtocolRuntime.js";
import {
  createCompilerEndpoint,
  createPreviewEndpoint,
  createProofExpectationRegistry,
  initializeCompilerProofMode,
} from "../../shared/Issue21Endpoints.js";
import {
  createIssue21LoadController,
  verifyIssue21ProofOutcomes,
} from "./issue21-controller.ts";

const uuid = "00112233-4455-4677-8899-aabbccddeeff";
const compileId = "12345678-1234-4abc-8def-123456789abc";
const digest = "a".repeat(64);

test("normal UI controller succeeds without proof expectation access and disables repeat load", async () => {
  let expectationCalls = 0;
  let executeCalls = 0;
  let disabled = false;
  const statuses: Array<[string, string]> = [];
  const errors: unknown[] = [];
  const controller = createIssue21LoadController({
    execute: async () => {
      executeCalls += 1;
      return {
        value: { loaded: true },
        summary: { assemblySimpleName: "Issue021Foo", visibleSequencePointCount: 2 },
      };
    },
    setDisabled: value => { disabled = value; },
    setStatus: (state, text) => { statuses.push([state, text]); },
    reportError: error => { errors.push(error); },
  });
  const proof = verifyIssue21ProofOutcomes(false, () => {
    expectationCalls += 1;
    throw new Error("normal mode must not inspect proof expectations");
  });
  assert.deepEqual(proof, { expectedProbeRejections: [], assertionsPassed: true });
  assert.deepEqual(await controller.run(), { loaded: true });
  assert.equal(expectationCalls, 0);
  assert.equal(executeCalls, 1);
  assert.equal(controller.state, "loaded");
  assert.equal(disabled, true);
  assert.deepEqual(statuses.at(-1), ["ready", "Loaded Issue021Foo · 2 sequence points"]);
  assert.deepEqual(errors, []);
  await assert.rejects(controller.run(), /Preview is already loaded/);
  assert.equal(executeCalls, 1);
});

test("normal UI controller routes terminal failure to its error channel", async () => {
  const errors: unknown[] = [];
  const statuses: Array<[string, string]> = [];
  const controller = createIssue21LoadController({
    execute: async () => { throw new Error("PREVIEW_LOAD_FAILED: rejected"); },
    setDisabled() {},
    setStatus: (state, text) => { statuses.push([state, text]); },
    reportError: error => { errors.push(error); },
  });
  await assert.rejects(controller.run(), /PREVIEW_LOAD_FAILED/);
  assert.equal(controller.state, "idle");
  assert.equal(errors.length, 1);
  assert.deepEqual(statuses.at(-1), ["error", "PREVIEW_LOAD_FAILED: rejected"]);
});

test("proof outcome matching excludes the primary successful load", () => {
  const rejections = [
    { probePhase: "preMutationInvalid", expectedCode: "PREVIEW_LOAD_FAILED", observedCode: "PREVIEW_LOAD_FAILED" },
    { probePhase: "postMutationSecondLoad", expectedCode: "INVALID_STATE", observedCode: "INVALID_STATE" },
    { probePhase: "post-mutation-identity-mismatch", expectedCode: "PREVIEW_LOAD_FAILED", observedCode: "PREVIEW_LOAD_FAILED" },
  ];
  const result = verifyIssue21ProofOutcomes(true, () => ({
    expectedProbeRejections: rejections,
    preMutationObservedCode: "PREVIEW_LOAD_FAILED",
    postMutationObservedCode: "INVALID_STATE",
    taintFailure: "TIMEOUT",
    retryExpectationRemoved: true,
  }));
  assert.equal(result.assertionsPassed, true);
  assert.equal(result.expectedProbeRejections.length, 3);
});

function compileRequest() {
  return {
    protocolVersion: 1,
    correlationId: uuid,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: "Fixture",
      sources: [{ path: "src/Foo.cs", text: "class Foo {}" }],
      primarySourcePath: "src/Foo.cs",
      timeoutMs: 30_000,
      settings: {
        languageVersion: "13.0",
        nullable: "disable",
        optimization: "debug",
        allowUnsafe: false,
        warningsAsErrors: false,
      },
    },
  };
}

test("validates exact UUID, route, settings, paths, and timeout", () => {
  assert.equal(isUuidV4(uuid), true);
  assert.equal(isUuidV4(uuid.toUpperCase()), false);
  assert.equal(validateCompileRequest(compileRequest()).message.type, "compile.request");
  assert.throws(() => validateCompileRequest({ ...compileRequest(), protocolVersion: 2 }), /UNSUPPORTED/);
  assert.throws(() => validateCompileRequest({ ...compileRequest(), type: "preview.load" }), /UNKNOWN/);
  const bad = compileRequest();
  bad.payload.sources[0].path = "../Foo.cs";
  assert.throws(() => validateCompileRequest(bad), /MALFORMED/);
  assert.equal(isCanonicalPath("src/Foo.cs"), true);
  assert.equal(isCanonicalPath("/src/Foo.cs"), false);
});

test("rejects accessors, cycles, symbols, functions, views, SAB, and oversize", () => {
  const accessor = {};
  Object.defineProperty(accessor, "value", { get: () => 1, enumerable: true });
  assert.throws(() => inspectClone(accessor), /MALFORMED/);
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  assert.throws(() => inspectClone(cycle), /MALFORMED/);
  const aliased = {};
  assert.throws(() => inspectClone({ left: aliased, right: aliased }), /MALFORMED/);
  assert.throws(() => inspectClone({ [Symbol("x")]: 1 }), /MALFORMED/);
  assert.throws(() => inspectClone({ fn() {} }), /MALFORMED/);
  assert.throws(() => inspectClone(new Uint8Array(1)), /MALFORMED/);
  assert.throws(() => inspectClone(new SharedArrayBuffer(1)), /MALFORMED/);
  assert.throws(() => inspectClone({ text: "x".repeat(32 * 1024 * 1024) }), /MESSAGE_TOO_LARGE/);
  assert.throws(() => inspectClone({ text: "\ud800" }), /MALFORMED/);
});

test("rejects non-ArrayBuffer, aliases, detached, and bounded payloads", () => {
  assert.throws(() => validateBinaryPair(new Uint8Array(1), new ArrayBuffer(1)), /MALFORMED/);
  const alias = new ArrayBuffer(1);
  assert.throws(() => validateBinaryPair(alias, alias), /MALFORMED/);
  const detached = new ArrayBuffer(1);
  structuredClone(detached, { transfer: [detached] });
  assert.throws(() => validateBinaryPair(detached, new ArrayBuffer(1)), /MALFORMED/);
  assert.throws(() => validateBinaryPair(new ArrayBuffer(8 * 1024 * 1024 + 1), new ArrayBuffer(1)), /ASSEMBLY/);
  assert.throws(() => validateBinaryPair(new ArrayBuffer(7 * 1024 * 1024), new ArrayBuffer(6 * 1024 * 1024)), /BINARY/);
});

test("copies exact bytes and transfer detaches sender", () => {
  const exact = standaloneBuffer(new Uint8Array([9, 1, 2, 3, 9]).subarray(1, 4));
  const received = structuredClone({ exact }, { transfer: [exact] });
  assert.equal(exact.byteLength, 0);
  assert.deepEqual([...new Uint8Array(received.exact)], [1, 2, 3]);
});

test("validates preview identity, proof digests, and measured buffers", () => {
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "preview.load.request",
    payload: {
      previewId: uuid,
      compileId,
      assembly: new ArrayBuffer(1),
      pdb: new ArrayBuffer(1),
      binaryProof: {
        assemblySha256: digest, pdbSha256: digest, assemblyByteLength: 1, pdbByteLength: 1,
        assemblyName: "Fixture", sourcePaths: ["src/Foo.cs"], primarySourcePath: "src/Foo.cs",
      },
    },
  };
  assert.equal(validatePreviewLoadRequest(request, uuid).message, request);
  assert.throws(() => validatePreviewLoadRequest(request, compileId), /SOURCE/);
});

test("binds compile binary proof to ordered sources, primary path, and assembly identity", () => {
  const response = () => ({
    protocolVersion: 1,
    correlationId: uuid,
    type: "compile.response",
    result: {
      success: true,
      data: {
        compileId,
        assembly: new ArrayBuffer(1),
        pdb: new ArrayBuffer(1),
        diagnostics: [],
        binaryProof: {
          assemblySha256: digest, pdbSha256: digest,
          assemblyByteLength: 1, pdbByteLength: 1,
          assemblyName: "Good-Name",
          sourcePaths: ["aaa/Earlier.cs", "src/Foo.cs"],
          primarySourcePath: "src/Foo.cs",
        },
      },
    },
  });
  const identity = {
    assemblyName: "Good-Name",
    sourcePaths: ["aaa/Earlier.cs", "src/Foo.cs"],
    primarySourcePath: "src/Foo.cs",
  };
  assert.equal(validateCompileResponse(response(), uuid, compileId, identity).message.result.success, true);
  assert.throws(() => validateCompileResponse(response(), uuid, compileId, {
    ...identity, sourcePaths: ["src/Foo.cs", "aaa/Earlier.cs"],
  }), /SOURCE/);
  const undeclaredPrimary = response();
  undeclaredPrimary.result.data.binaryProof.primarySourcePath = "src/Missing.cs";
  assert.throws(() => validateCompileResponse(undeclaredPrimary, uuid, compileId, identity), /MALFORMED/);
});

function failedCompileResponse(code = "COMPILE_FAILED", extraError = {}) {
  return {
    protocolVersion: 1, correlationId: uuid, type: "compile.response",
    result: { success: false, error: { code, message: "safe", ...extraError } },
  };
}

test("matches assembly, diagnostic, error-detail, and error-code contract boundaries", () => {
  const badStart = compileRequest();
  badStart.payload.assemblyName = "1Bad";
  assert.throws(() => validateCompileRequest(badStart), /MALFORMED/);
  const validPunctuation = compileRequest();
  validPunctuation.payload.assemblyName = "Good-Name";
  assert.equal(validateCompileRequest(validPunctuation).message.payload.assemblyName, "Good-Name");
  const maximumName = compileRequest();
  maximumName.payload.assemblyName = "A" + "x".repeat(127);
  assert.equal(validateCompileRequest(maximumName).message.payload.assemblyName.length, 128);
  maximumName.payload.assemblyName += "x";
  assert.throws(() => validateCompileRequest(maximumName), /MALFORMED/);

  const invalidDiagnostic = failedCompileResponse("COMPILE_FAILED", {
    diagnostics: [{ origin: "compiler", severity: "error", id: "", message: "x", file: "src/Foo.cs", line: 0, column: 0 }],
  });
  assert.throws(() => validateCompileResponse(invalidDiagnostic, uuid, compileId), /MALFORMED/);
  const largeDetails = Object.fromEntries(
    Array.from({ length: 17 }, (_, index) => [`key${index}`, "x".repeat(1024)]));
  assert.throws(() => validateCompileResponse(
    failedCompileResponse("INTERNAL_ERROR", { details: largeDetails }), uuid, compileId), /MALFORMED/);
  assert.equal(validateCompileResponse(
    failedCompileResponse("ASSET_TOO_LARGE"), uuid, compileId).message.result.success, false);
  const maximumDetails = Object.fromEntries(
    Array.from({ length: 32 }, (_, index) => [`k${index}`, index === 0 ? "x".repeat(1024) : index]));
  assert.equal(validateCompileResponse(
    failedCompileResponse("INTERNAL_ERROR", { details: maximumDetails }), uuid, compileId).message.result.success, false);
  assert.throws(() => validateCompileResponse(failedCompileResponse("INTERNAL_ERROR", {
    details: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`k${index}`, index])),
  }), uuid, compileId), /MALFORMED/);
  assert.throws(() => validateCompileResponse(failedCompileResponse("INTERNAL_ERROR", {
    details: { key: "x".repeat(1025) },
  }), uuid, compileId), /MALFORMED/);
  assert.equal(PROTOCOL_ERROR_CODES.length, 32);
  assert.equal(PLAYGROUND_DIAGNOSTIC_IDS.length, 10);
  assert.equal(LIMITS.errorDetails, 16 * 1024);
  assert.equal(Object.isFrozen(LIMITS), true);
});

test("rejects nondeterministic diagnostics and invalid location/id combinations", () => {
  const response = failedCompileResponse("COMPILE_FAILED", {
    diagnostics: [
      { origin: "compiler", severity: "error", id: "CS0002", message: "b", file: "src/Z.cs", line: 1, column: 1 },
      { origin: "compiler", severity: "error", id: "CS0001", message: "a", file: "src/A.cs", line: 1, column: 1 },
    ],
  });
  assert.throws(() => validateCompileResponse(response, uuid, compileId), /MALFORMED/);
  for (const diagnostic of [
    { origin: "compiler", severity: "error", id: "CS0001", message: "x", file: "", line: 1, column: 0 },
    { origin: "compiler", severity: "error", id: "\n", message: "x", file: "", line: 0, column: 0 },
    { origin: "playground", severity: "error", id: "PG9999_BAD", message: "x", file: "", line: 0, column: 0 },
  ]) {
    assert.throws(() => validateCompileResponse(
      failedCompileResponse("COMPILE_FAILED", { diagnostics: [diagnostic] }), uuid, compileId), /MALFORMED/);
  }
  const maximumId = {
    origin: "compiler", severity: "error", id: "X".repeat(64),
    message: "x", file: "src/Foo.cs", line: 1, column: 1,
  };
  assert.equal(validateCompileResponse(
    failedCompileResponse("COMPILE_FAILED", { diagnostics: [maximumId] }), uuid, compileId).message.result.success, false);
  assert.throws(() => validateCompileResponse(failedCompileResponse("COMPILE_FAILED", {
    diagnostics: [{ ...maximumId, id: "X".repeat(65) }],
  }), uuid, compileId), /MALFORMED/);
});

test("runtime inventory conforms to normative TypeScript and protocol tables", async () => {
  const contracts = await readFile(new URL("../../shared/MessageContracts.ts", import.meta.url), "utf8");
  const protocol = await readFile(new URL("../../shared/Protocol.md", import.meta.url), "utf8");
  for (const code of PROTOCOL_ERROR_CODES) {
    assert.match(contracts, new RegExp(`\"${code}\"`));
    assert.equal(protocol.includes("| `" + code + "` |"), true);
  }
  for (const id of PLAYGROUND_DIAGNOSTIC_IDS) {
    assert.match(contracts, new RegExp(`\"${id}\"`));
    assert.equal(protocol.includes("`" + id + "`"), true);
  }
  assert.match(contracts, /interface BinaryProof/);
  assert.equal(protocol.includes("`BinaryProof` is a required immutable v1 object"), true);
  assert.equal(Object.isFrozen(DEFAULT_TIMEOUTS_MS), true);
  assert.equal(Object.isFrozen(MAX_TIMEOUTS_MS), true);
  for (const [type, timeout] of Object.entries(DEFAULT_TIMEOUTS_MS)) {
    assert.equal(protocol.includes(type), true);
    assert.equal(contracts.includes(`"${type}": ${timeout.toLocaleString("en-US").replace(/,/g, "_")}`) ||
      contracts.includes(`"${type}": ${timeout}`), true);
  }
});

function nextPortMessage(port: MessagePort) {
  port.start();
  return new Promise<unknown>(resolve => port.addEventListener("message", event => resolve(event.data), { once: true }));
}

test("actual endpoints sanitize malformed input and produce one terminal response", async () => {
  const compilerChannel = new MessageChannel();
  const compiler = createCompilerEndpoint({
    port: compilerChannel.port1,
    proof: { errors: [], terminals: [], closes: [] },
    execute: async () => ({ result: { success: false, error: { code: "COMPILE_FAILED", message: "safe" } } }),
  });
    compilerChannel.port1.addEventListener("message", compiler.handle);
    compilerChannel.port1.start();
    let responsePromise = nextPortMessage(compilerChannel.port2);
    compilerChannel.port2.postMessage(null);
    assert.equal((await responsePromise as { type: string }).type, "protocol.error");
    responsePromise = nextPortMessage(compilerChannel.port2);
    compilerChannel.port2.postMessage(compileRequest());
    const terminal = await responsePromise as { type: string; correlationId: string };
    assert.equal(terminal.type, "compile.response");
    assert.equal(terminal.correlationId, uuid);
    compiler.close("test");
    compilerChannel.port2.close();

    const previewChannel = new MessageChannel();
    const preview = createPreviewEndpoint({
      port: previewChannel.port1, previewId: uuid,
      proof: { errors: [], terminals: [], closes: [] },
      execute: async () => { throw new Error("MESSAGE_SOURCE_REJECTED"); },
    });
    previewChannel.port1.addEventListener("message", preview.handle);
    previewChannel.port1.start();
    responsePromise = nextPortMessage(previewChannel.port2);
    previewChannel.port2.postMessage(42);
    assert.equal((await responsePromise as { type: string }).type, "protocol.error");
    responsePromise = nextPortMessage(previewChannel.port2);
    const request = {
      protocolVersion: 1, correlationId: uuid, type: "preview.load.request",
      payload: {
        previewId: uuid, compileId, assembly: new ArrayBuffer(1), pdb: new ArrayBuffer(1),
        binaryProof: {
          assemblySha256: digest, pdbSha256: digest, assemblyByteLength: 1, pdbByteLength: 1,
          assemblyName: "Fixture", sourcePaths: ["src/Foo.cs"], primarySourcePath: "src/Foo.cs",
        },
      },
    };
    previewChannel.port2.postMessage(request, [request.payload.assembly, request.payload.pdb]);
    assert.equal((await responsePromise as { type: string }).type, "preview.load.response");
    assert.equal(preview.closed, true);
    previewChannel.port2.close();
  });

  test("production compiler endpoint reserves concurrent correlation before awaited work", async () => {
    const channel = new MessageChannel();
    const messages: Array<Record<string, any>> = [];
    let executeCalls = 0;
    let releaseExecute: (() => void) | undefined;
    const executeGate = new Promise<void>(resolve => { releaseExecute = resolve; });
    const proof = { errors: [], terminals: [], closes: [], duplicateControls: [] };
    const endpoint = createCompilerEndpoint({
      port: channel.port1,
      proof,
      execute: async () => {
        executeCalls += 1;
        await executeGate;
        return { result: { success: false, error: { code: "COMPILE_FAILED", message: "expected" } } };
      },
    });
    channel.port1.addEventListener("message", endpoint.handle);
    channel.port1.start();
    channel.port2.addEventListener("message", event => messages.push(event.data));
    channel.port2.start();
    channel.port2.postMessage(compileRequest());
    channel.port2.postMessage(compileRequest());
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(executeCalls, 1);
    assert.equal(endpoint.inFlight.has(uuid), true);
    assert.equal(messages.filter(message => message.type === "protocol.error").length, 1);
    releaseExecute?.();
    for (let index = 0; index < 50 && messages.length < 2; index++) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    const terminals = messages.filter(message =>
      message.type === "compile.response" && message.correlationId === uuid);
    const duplicate = messages.find(message => message.type === "protocol.error");
    assert.equal(terminals.length, 1);
    assert.notEqual(duplicate?.correlationId, uuid);
    assert.equal(duplicate?.payload.rejectedCorrelationId, uuid);
    assert.equal(duplicate?.payload.rejectedType, "compile.request");
    assert.equal(proof.terminals.length, 1);
    assert.equal(endpoint.inFlight.size, 0);
    assert.equal(endpoint.completed.has(uuid), true);
    endpoint.close("test");
    channel.port2.close();
  });

  test("normal compiler bootstrap mode is prompt and never invokes proof hooks", async () => {
    let hookCalls = 0;
    const started = performance.now();
    const normal = await initializeCompilerProofMode(false, async () => {
      hookCalls += 1;
      return { mutated: true };
    });
    assert.deepEqual(normal, { enabled: false });
    assert.equal(hookCalls, 0);
    assert.equal(performance.now() - started < 50, true);
    const proof = await initializeCompilerProofMode(true, async () => {
      hookCalls += 1;
      return { observed: true };
    });
    assert.deepEqual(proof, { enabled: true, observed: true });
    assert.equal(hookCalls, 1);
  });

function expectation(correlationId = uuid, phase = "probe", code = "INVALID_STATE") {
      return {
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        correlationId,
        requestType: "preview.load.request",
        responseType: "preview.load.response",
        probePhase: phase,
        expectedCode: code,
      };
    }

    test("proof rejection registry matches once by full authorized identity", () => {
      const expected: Array<Record<string, any>> = [];
      const unexpected: string[] = [];
      const registry = createProofExpectationRegistry({
        authorized: true,
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        expectedRejections: expected,
        unexpectedErrors: unexpected,
      });
      assert.equal(registry.register(expectation()), true);
      assert.equal(registry.consume({ ...expectation(), code: "INVALID_STATE" }), true);
      assert.equal(expected.length, 1);
      assert.deepEqual(unexpected, []);
      assert.equal(registry.size, 0);
      assert.equal(registry.consume({ ...expectation(), code: "INVALID_STATE" }), false);
      assert.deepEqual(unexpected, ["INVALID_STATE"]);
    });

    test("proof rejection registry treats wrong identity and normal mode as unexpected", () => {
      for (const changed of [
        { correlationId: compileId },
        { requestType: "compile.request" },
        { responseType: "compile.response" },
        { probePhase: "wrong-phase" },
        { code: "PREVIEW_LOAD_FAILED" },
      ]) {
        const unexpected: string[] = [];
        const registry = createProofExpectationRegistry({
          authorized: true,
          contextGeneration: compileId,
          portIdentity: "private-port-1",
          expectedRejections: [],
          unexpectedErrors: unexpected,
        });
        assert.equal(registry.register(expectation()), true);
        assert.equal(registry.consume({ ...expectation(), code: "INVALID_STATE", ...changed }), false);
        assert.equal(unexpected.length, 1);
        assert.equal(registry.remove(uuid), true);
      }
      const normalErrors: string[] = [];
      const normal = createProofExpectationRegistry({
        authorized: false,
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        expectedRejections: [],
        unexpectedErrors: normalErrors,
      });
      assert.equal(normal.register(expectation()), false);
      assert.equal(normal.consume({ ...expectation(), code: "INVALID_STATE" }), false);
      assert.deepEqual(normalErrors, ["INVALID_STATE"]);
    });

    test("proof expectation expires and a late rejection is unexpected", async () => {
      const expired: Array<Record<string, any>> = [];
      const unexpected: string[] = [];
      const registry = createProofExpectationRegistry({
        authorized: true,
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        expectedRejections: [],
        unexpectedErrors: unexpected,
        expiredExpectations: expired,
      });
      assert.equal(registry.register(expectation(), 100), true);
      await new Promise(resolve => setTimeout(resolve, 130));
      assert.equal(registry.size, 0);
      assert.equal(expired.length, 1);
      assert.equal(registry.consume({ ...expectation(), code: "INVALID_STATE" }), false);
      assert.deepEqual(unexpected, ["INVALID_STATE"]);
    });

    test("normal endpoint INVALID_STATE populates unexpected acceptance errors", async () => {
      const errors: string[] = [];
      const endpoint = createPreviewEndpoint({
        port: { postMessage() {}, close() {} },
        previewId: uuid,
        proof: { errors, terminals: [], closes: [] },
        execute: async () => { throw new Error("INVALID_STATE"); },
      });
      const assembly = new ArrayBuffer(1);
      const pdb = new ArrayBuffer(1);
      await endpoint.handle({
        data: {
          protocolVersion: 1, correlationId: uuid, type: "preview.load.request",
          payload: {
            previewId: uuid, compileId, assembly, pdb,
            binaryProof: {
              assemblySha256: digest, pdbSha256: digest,
              assemblyByteLength: 1, pdbByteLength: 1,
              assemblyName: "Fixture", sourcePaths: ["src/Foo.cs"], primarySourcePath: "src/Foo.cs",
            },
          },
        },
      });
      assert.deepEqual(errors, ["INVALID_STATE"]);
    });

    test("proof-authorized primary success does not consult rejection expectations", async () => {
      let consumeCalls = 0;
      let phaseCalls = 0;
      const posted: Array<Record<string, any>> = [];
      const endpoint = createPreviewEndpoint({
        port: {
          postMessage(message: Record<string, any>) { posted.push(message); },
          close() {},
        },
        previewId: uuid,
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        expectations: {
          consume() { consumeCalls += 1; return false; },
          phaseFor() { phaseCalls += 1; return undefined; },
        },
        proof: { errors: [], terminals: [], closes: [] },
        execute: async () => ({
          result: {
            success: true,
            data: {
              previewId: uuid,
              compileId,
              assemblyFullName: "Fixture, Version=0.0.0.0, Culture=neutral, PublicKeyToken=null",
              assemblySimpleName: "Fixture",
              assemblyByteLength: 1,
              pdbByteLength: 1,
              documentCount: 1,
              visibleSequencePointCount: 1,
              logicalPath: "src/Foo.cs",
              assemblySha256: digest,
              pdbSha256: digest,
              codeViewGuid: uuid,
              codeViewStamp: 1,
              portablePdbGuid: uuid,
              portablePdbStamp: 1,
            },
          },
        }),
      });
      await endpoint.handle({
        data: {
          protocolVersion: 1,
          correlationId: uuid,
          type: "preview.load.request",
          payload: {
            previewId: uuid,
            compileId,
            assembly: new ArrayBuffer(1),
            pdb: new ArrayBuffer(1),
            binaryProof: {
              assemblySha256: digest,
              pdbSha256: digest,
              assemblyByteLength: 1,
              pdbByteLength: 1,
              assemblyName: "Fixture",
              sourcePaths: ["src/Foo.cs"],
              primarySourcePath: "src/Foo.cs",
            },
          },
        },
      });
      assert.equal(posted.length, 1);
      assert.equal(posted[0].result.success, true);
      assert.equal(consumeCalls, 0);
      assert.equal(phaseCalls, 0);
    });

    test("authorized endpoint separates only its exactly registered rejection", async () => {
      const errors: string[] = [];
      const expected: Array<Record<string, any>> = [];
      const registry = createProofExpectationRegistry({
        authorized: true,
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        expectedRejections: expected,
        unexpectedErrors: errors,
      });
      assert.equal(registry.register(expectation(uuid, "second-load")), true);
      const endpoint = createPreviewEndpoint({
        port: { postMessage() {}, close() {} },
        previewId: uuid,
        proof: { errors, terminals: [], closes: [] },
        expectations: registry,
        contextGeneration: compileId,
        portIdentity: "private-port-1",
        execute: async () => { throw new Error("INVALID_STATE"); },
      });
      await endpoint.handle({
        data: {
          protocolVersion: 1, correlationId: uuid, type: "preview.load.request",
          payload: {
            previewId: uuid, compileId, assembly: new ArrayBuffer(1), pdb: new ArrayBuffer(1),
            binaryProof: {
              assemblySha256: digest, pdbSha256: digest,
              assemblyByteLength: 1, pdbByteLength: 1,
              assemblyName: "Fixture", sourcePaths: ["src/Foo.cs"], primarySourcePath: "src/Foo.cs",
            },
          },
        },
      });
      assert.deepEqual(errors, []);
      assert.equal(expected.length, 1);
      assert.equal(expected[0].probePhase, "second-load");
    });
function withPollutedPrototype<T>(key: string, value: unknown, action: () => T): T {
    Object.defineProperty(Object.prototype, key, {
      value, configurable: true, writable: true,
    });
    try {
      return action();
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
  }

  test("required fields must be own properties at every reachable schema layer", () => {
    const inheritedEnvelope = compileRequest();
    delete (inheritedEnvelope as Partial<typeof inheritedEnvelope>).correlationId;
    withPollutedPrototype("correlationId", uuid, () =>
      assert.throws(() => validateCompileRequest(inheritedEnvelope), /ENVELOPE/));

    const inheritedPayload = compileRequest();
    delete (inheritedPayload.payload as Partial<typeof inheritedPayload.payload>).assemblyName;
    withPollutedPrototype("assemblyName", "Polluted", () =>
      assert.throws(() => validateCompileRequest(inheritedPayload), /PAYLOAD/));

    const sparseSources = compileRequest();
    sparseSources.payload.sources = new Array(1) as typeof sparseSources.payload.sources;
    Object.defineProperty(Array.prototype, 0, {
      value: { path: "src/Polluted.cs", text: "class Polluted {}" },
      configurable: true,
    });
    try {
      assert.throws(() => validateCompileRequest(sparseSources), /PAYLOAD/);
    } finally {
      Reflect.deleteProperty(Array.prototype, "0");
    }

    const inheritedSource = compileRequest();
    delete (inheritedSource.payload.sources[0] as Partial<{ path: string }>).path;
    withPollutedPrototype("path", "src/Polluted.cs", () =>
      assert.throws(() => validateCompileRequest(inheritedSource), /PAYLOAD/));

    const inheritedSettings = compileRequest();
    delete (inheritedSettings.payload.settings as Partial<typeof inheritedSettings.payload.settings>).languageVersion;
    withPollutedPrototype("languageVersion", "13.0", () =>
      assert.throws(() => validateCompileRequest(inheritedSettings), /PAYLOAD/));

    const inheritedOptional = compileRequest();
    delete (inheritedOptional.payload as Partial<typeof inheritedOptional.payload>).settings;
    withPollutedPrototype("settings", { languageVersion: "polluted" }, () =>
      assert.equal(validateCompileRequest(inheritedOptional).message, inheritedOptional));

    const inheritedResult = failedCompileResponse();
    delete (inheritedResult.result as Partial<typeof inheritedResult.result>).success;
    withPollutedPrototype("success", false, () =>
      assert.throws(() => validateCompileResponse(inheritedResult, uuid, compileId), /PAYLOAD/));

    const inheritedError = failedCompileResponse();
    delete (inheritedError.result.error as Partial<typeof inheritedError.result.error>).code;
    withPollutedPrototype("code", "COMPILE_FAILED", () =>
      assert.throws(() => validateCompileResponse(inheritedError, uuid, compileId), /PAYLOAD/));

    const success = {
      protocolVersion: 1, correlationId: uuid, type: "compile.response",
      result: {
        success: true,
        data: {
          compileId, assembly: new ArrayBuffer(1), pdb: new ArrayBuffer(1), diagnostics: [],
          binaryProof: {
            assemblySha256: digest, pdbSha256: digest,
            assemblyByteLength: 1, pdbByteLength: 1, assemblyName: "Fixture",
            sourcePaths: ["src/Foo.cs"], primarySourcePath: "src/Foo.cs",
          },
        },
      },
    };
    delete (success.result.data.binaryProof as Partial<typeof success.result.data.binaryProof>).assemblyName;
    withPollutedPrototype("assemblyName", "Polluted", () =>
      assert.throws(() => validateCompileResponse(success, uuid, compileId), /PAYLOAD/));
  });

  test("production compiler endpoint rejects prototype-polluted required payload", async () => {
    const posted: Array<Record<string, any>> = [];
    let executeCalls = 0;
    const endpoint = createCompilerEndpoint({
      port: { postMessage(message: Record<string, any>) { posted.push(message); }, close() {} },
      proof: { errors: [], terminals: [], closes: [] },
      execute: async () => {
        executeCalls += 1;
        return { result: { success: false, error: { code: "COMPILE_FAILED", message: "unused" } } };
      },
    });
    const polluted = compileRequest();
    delete (polluted.payload as Partial<typeof polluted.payload>).assemblyName;
    const handling = withPollutedPrototype("assemblyName", "Polluted", () =>
      endpoint.handle({ data: polluted }));
    await handling;
    assert.equal(executeCalls, 0);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, "compile.response");
    assert.equal(posted[0].result.error.code, "MALFORMED_PAYLOAD");
    await endpoint.handle({ data: compileRequest() });
    assert.equal(executeCalls, 1);
    assert.equal(posted[1].correlationId, uuid);
    assert.equal(endpoint.completed.has(uuid), true);
  });

test("actual endpoint closes on sender detach failure", async () => {
  let closed = false;
  const fakePort = {
    postMessage() {},
    close() { closed = true; },
  };
  const endpoint = createCompilerEndpoint({
    port: fakePort,
    proof: { errors: [], terminals: [], closes: [] },
    execute: async () => ({
      result: { success: true, data: {} },
      transfer: [new ArrayBuffer(1)],
    }),
  });
  await endpoint.handle({ data: compileRequest() });
  assert.equal(closed, true);
  assert.equal(endpoint.closed, true);
});

test("post-terminal instrumentation failure cannot emit a second terminal", async () => {
    const posted: Array<Record<string, any>> = [];
    let closed = false;
    const endpoint = createCompilerEndpoint({
      port: {
        postMessage(message: Record<string, any>) { posted.push(message); },
        close() { closed = true; },
      },
      proof: { errors: [], terminals: [], closes: [] },
      execute: async () => ({
        result: { success: false, error: { code: "COMPILE_FAILED", message: "expected" } },
        afterPost: () => { throw new Error("instrumentation failure"); },
      }),
    });
    await endpoint.handle({ data: compileRequest() });
    assert.equal(posted.filter(message => message.type === "compile.response").length, 1);
    assert.equal(closed, true);
    assert.equal(endpoint.completed.has(uuid), true);
});

test("actual preview endpoint rejects aliased and detached binary requests before load", async () => {
    const posted: Array<{ result?: { success: boolean; error?: { code: string } } }> = [];
    let loadCalls = 0;
    const endpoint = createPreviewEndpoint({
      port: {
        postMessage(message: { result?: { success: boolean; error?: { code: string } } }) {
          posted.push(message);
        },
        close() {},
      },
      previewId: uuid,
      proof: { errors: [], terminals: [], closes: [] },
      execute: async () => {
        loadCalls += 1;
        return { result: { success: true, data: { previewId: uuid, compileId } } };
      },
    });
    const makeRequest = (assembly: ArrayBuffer, pdb: ArrayBuffer, correlationId: string) => ({
      protocolVersion: 1, correlationId, type: "preview.load.request",
      payload: {
        previewId: uuid, compileId, assembly, pdb,
        binaryProof: {
          assemblySha256: digest, pdbSha256: digest,
          assemblyByteLength: assembly.byteLength, pdbByteLength: pdb.byteLength,
          assemblyName: "Fixture", sourcePaths: ["src/Foo.cs"], primarySourcePath: "src/Foo.cs",
        },
      },
    });
    const alias = new ArrayBuffer(1);
    await endpoint.handle({ data: makeRequest(alias, alias, uuid) });
    const detached = new ArrayBuffer(1);
    structuredClone(detached, { transfer: [detached] });
    await endpoint.handle({ data: makeRequest(detached, new ArrayBuffer(1), compileId) });
    assert.equal(loadCalls, 0);
    assert.deepEqual(posted.map(message => message.result?.error?.code), ["MALFORMED_PAYLOAD", "MALFORMED_PAYLOAD"]);
});

test("invalid bootstrap does not consume valid bootstrap and parent traffic later closes port", () => {
  const originalWindow = globalThis.window;
  const fakeWindow = new EventTarget();
  Object.assign(globalThis, { window: fakeWindow });
  const expectedSource = {};
  const channel = new MessageChannel();
  let accepted = 0;
  try {
    const observations = installPrivatePortBootstrap({
      expectedSource, expectedOrigin: "app://localhost",
      onPort: () => { accepted += 1; },
    });
    const dispatch = (source: object, data: object, ports: MessagePort[]) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        source: { value: source }, origin: { value: "app://localhost" },
        data: { value: data }, ports: { value: ports },
      });
      fakeWindow.dispatchEvent(event);
    };
    dispatch({}, {}, []);
    dispatch(expectedSource, {
      type: "protocol.bootstrap", contextGeneration: uuid,
    }, [channel.port1]);
    assert.equal(accepted, 1);
    assert.equal(observations.invalidBootstrapMessages, 1);
    dispatch(expectedSource, { type: "late" }, []);
    assert.equal(observations.postBootstrapRejectedMessages, 1);
  } finally {
    channel.port2.close();
    Object.assign(globalThis, { window: originalWindow });
  }
});

test("correlated port settles once, discards late response, and closes on wrong type", async () => {
  const successChannel = new MessageChannel();
  const successClient = new ProtocolPortClient(successChannel.port1, uuid);
  successChannel.port2.onmessage = event => {
    successChannel.port2.postMessage({ protocolVersion: 1, correlationId: event.data.correlationId, type: "ok" });
  };
  const request = { protocolVersion: 1, correlationId: uuid, type: "request" };
  await successClient.request(request, "ok", value => value);
  successChannel.port2.postMessage({ protocolVersion: 1, correlationId: uuid, type: "ok" });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(successClient.observations.terminalResponses, 1);
  assert.equal(successClient.observations.discardedUnknownOrLate, 1);
  assert.throws(() => successClient.request(request, "ok", value => value), /DUPLICATE/);
  successClient.close(new Error("test complete"));
  successChannel.port2.close();

  const badChannel = new MessageChannel();
  const badClient = new ProtocolPortClient(badChannel.port1, compileId);
  badChannel.port2.onmessage = event => {
    badChannel.port2.postMessage({ protocolVersion: 1, correlationId: event.data.correlationId, type: "wrong" });
  };
  await assert.rejects(
    badClient.request({ ...request, correlationId: compileId }, "expected", value => value),
    /Wrong terminal/,
  );
  assert.equal(badClient.observations.closes, 1);
  badChannel.port2.close();
});

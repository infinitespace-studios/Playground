import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir } from "node:fs/promises";
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
  validatePreviewLifecycleEvent,
  validatePreviewOutputEvent,
  validatePreviewStartRequest,
  validatePreviewStartResponse,
  validatePreviewStopRequest,
  validatePreviewStopResponse,
} from "./protocol.ts";
import {
  PREVIEW_CSP,
  PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL,
  PREVIEW_DOCUMENT,
  PREVIEW_SANDBOX,
  ISSUE033_NO_WASM_EVAL_DOCUMENT,
} from "./preview-frame.ts";

import { installPrivatePortBootstrap } from "../../shared/ProtocolRuntime.js";
import {
  createCompilerEndpoint,
  createPreviewEndpoint,
  createProofExpectationRegistry,
  initializeCompilerProofMode,
} from "../../shared/Issue21Endpoints.js";
import {
  createPreviewStartExecutor,
  UnexpectedStartBoundaryError,
} from "../../shared/PreviewStartRuntime.js";
import { createPreviewStopExecutor } from "../../shared/PreviewStopRuntime.js";
import {
  createNativeOutputCapture,
  normalizeNativeOutputArguments,
  normalizeUnicodeScalars,
} from "../../shared/NativeOutputRuntime.js";
import {
  createIssue21LoadController,
  verifyIssue21ProofOutcomes,
} from "./issue21-controller.ts";
import {
  createIssue023RunController,
  withForcedPreviewRetirement,
} from "./issue23-controller.ts";
import { createIssue024RunStopController } from "./issue24-controller.ts";

const uuid = "00112233-4455-4677-8899-aabbccddeeff";
const compileId = "12345678-1234-4abc-8def-123456789abc";
const digest = "a".repeat(64);

test("supported API policy exactly inventories the pinned reference identities", async () => {
  const policy = await readFile(
    new URL("../../../docs/supported-api-policy.md", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(await readFile(
    new URL("../../../docs/reference-allowlist.json", import.meta.url),
    "utf8",
  )) as {
    schemaVersion: number;
    monogameCommitSha: string;
    assemblies: Array<{
      simpleName: string;
      version: string;
      publicKeyToken: string | null;
    }>;
  };
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(policy.includes(manifest.monogameCommitSha), true);
  const identityRows = [...policy.matchAll(
    /^\| `([^`]+)` \| `([^`]+)` \| (?:`([^`]+)`|none) \|$/gm,
  )].map(match => ({
    simpleName: match[1],
    version: match[2],
    publicKeyToken: match[3] ?? null,
  }));
  assert.deepEqual(identityRows, manifest.assemblies.map(assembly => ({
    simpleName: assembly.simpleName,
    version: assembly.version,
    publicKeyToken: assembly.publicKeyToken,
  })));
  for (const id of ["PG0101", "PG0102", "PG0103", "PG0104", "PG0105", "PG0106"]) {
    assert.equal(policy.includes(`| \`${id}\` |`), true);
    assert.equal(PLAYGROUND_DIAGNOSTIC_IDS.includes(id), true);
  }
  assert.match(policy, /not a security sandbox/i);
  assert.match(policy, /does \*\*not\*\* prove the meaning of strings/i);
  assert.match(policy, /`PG0106` owns unmanaged function-pointer syntax/i);
});

test("cross-file fixtures are canonical, reusable, and duplicate-safe", async () => {
  const root = new URL("../../../", import.meta.url);
  const gamePath = "tests/compiler/fixtures/cross-file/Game1.cs";
  const playerPath = "tests/compiler/fixtures/cross-file/Player.cs";
  const [game, player] = await Promise.all([
    readFile(new URL(gamePath, root), "utf8"),
    readFile(new URL(playerPath, root), "utf8"),
  ]);
  assert.match(game, /_player\.CrossFileValue\(\)/);
  assert.match(player, /CrossFileValue\(\) => 42/);
  const request = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "compile.request",
    payload: {
      compileId,
      assemblyName: "CrossFileFixture",
      sources: [
        { path: gamePath, text: game },
        { path: playerPath, text: player },
      ],
      primarySourcePath: gamePath,
    },
  };
  assert.doesNotThrow(() => validateCompileRequest(request));
  assert.doesNotThrow(() => validateCompileRequest({
    ...request,
    payload: { ...request.payload, sources: [...request.payload.sources].reverse() },
  }));
  assert.throws(() => validateCompileRequest({
    ...request,
    payload: {
      ...request.payload,
      sources: [
        request.payload.sources[0],
        { ...request.payload.sources[1], path: gamePath },
      ],
    },
  }), /MALFORMED_PAYLOAD/);
  const broken = player.replace(
    "public int CrossFileValue() => 42;",
    "public MissingType CrossFileValue() => null;",
  );
  assert.notEqual(broken, player);
  assert.equal(broken.split("\n").findIndex(line => line.includes("MissingType")) + 1, 5);
  assert.equal(broken.split("\n")[4].indexOf("MissingType") + 1, 12);
});

test("native output capture tees, normalizes, orders, and flushes once", () => {
  const tee: Array<[string, unknown[]]> = [];
  const emitted: Array<{ stream: string; category: string; text: string }> = [];
  const capture = createNativeOutputCapture({
    teeOut: (...args) => tee.push(["stdout", args]),
    teeErr: (...args) => tee.push(["stderr", args]),
  });
  const object = { toString: () => "object-value" };
  capture.print("first", 2, object);
  capture.printErr(null, undefined, false);
  assert.equal(normalizeNativeOutputArguments(["first", 2, object]), "first 2 object-value");
  assert.equal(capture.authenticate("generation-one"), true);
  assert.equal(capture.flush("wrong-generation", value => emitted.push(value)), false);
  assert.equal(capture.flush("generation-one", value => emitted.push(value)), true);
  assert.equal(capture.flush("generation-one", value => emitted.push(value)), false);
  capture.print("live");
  assert.deepEqual(tee, [
    ["stdout", ["first", "2", "object-value"]],
    ["stderr", ["null", "undefined", "false"]],
    ["stdout", ["live"]],
  ]);
  assert.deepEqual(emitted, [
    { stream: "stdout", category: "startup", text: "first 2 object-value" },
    { stream: "stderr", category: "startup", text: "null undefined false" },
    { stream: "stdout", category: "runtime", text: "live" },
  ]);
  const snapshot = capture.snapshot();
  assert.equal(snapshot.flushCalls, 1);
  assert.equal(snapshot.emittedMessages, 3);
  assert.equal(snapshot.bufferedMessages, 0);
});

test("native output replaces every malformed surrogate and preserves valid pairs", () => {
  const cases = [
    ["\uD800", "\uFFFD"],
    ["\uDC00", "\uFFFD"],
    ["\uD800A", "\uFFFDA"],
    ["\uDC00A", "\uFFFDA"],
    ["A\uD800", "A\uFFFD"],
    ["A\uDC00", "A\uFFFD"],
    ["A\uD800B", "A\uFFFDB"],
    ["A\uDC00B", "A\uFFFDB"],
    ["\uD800\uD800\uDC00\uDC00", "\uFFFD𐀀\uFFFD"],
    ["\uDC00\uDC00\uD800\uD800", "\uFFFD\uFFFD\uFFFD\uFFFD"],
    ["x\uD83D\uDE42y", "x🙂y"],
    ["\uD800\uD83D\uDE42\uDC00", "\uFFFD🙂\uFFFD"],
  ];
  for (const [input, expected] of cases)
    assert.equal(normalizeUnicodeScalars(input), expected);
  const converted = { toString: () => "left\uD800🙂\uDC00right" };
  assert.equal(
    normalizeNativeOutputArguments([converted]),
    "left\uFFFD🙂\uFFFDright",
  );

  const tee: string[][] = [];
  const emitted: string[] = [];
  const capture = createNativeOutputCapture({
    teeOut: (...args) => tee.push(args as string[]),
    teeErr() {},
  });
  capture.print("\uD800", converted);
  capture.authenticate("normalized-tee");
  capture.flush("normalized-tee", value => emitted.push(value.text));
  assert.deepEqual(tee, [["\uFFFD", "left\uFFFD🙂\uFFFDright"]]);
  assert.deepEqual(emitted, ["\uFFFD left\uFFFD🙂\uFFFDright"]);
});

test("native scalar splitting is exact at 16 KiB and aggregate 64 KiB boundaries", () => {
  const emitted: string[] = [];
  const capture = createNativeOutputCapture({ teeOut() {}, teeErr() {} });
  capture.print("🙂".repeat(4096));
  capture.print("🙂".repeat(4097));
  capture.authenticate("scalar-boundary");
  capture.flush("scalar-boundary", value => emitted.push(value.text));
  assert.deepEqual(emitted.map(text => [text.length, new TextEncoder().encode(text).byteLength]), [
    [8192, 16_384],
    [8192, 16_384],
    [2, 4],
  ]);
  assert.ok(emitted.every(text => normalizeUnicodeScalars(text) === text));

  const aggregate = createNativeOutputCapture({ teeOut() {}, teeErr() {} });
  for (let index = 0; index < 4; index += 1)
    aggregate.print("🙂".repeat(4096));
  aggregate.print("🙂");
  const snapshot = aggregate.snapshot();
  assert.equal(snapshot.acceptedPrePortMessages, 4);
  assert.equal(snapshot.acceptedPrePortUtf8Bytes, 65_536);
  assert.equal(snapshot.droppedOverflowMessages, 1);
  assert.equal(snapshot.droppedOverflowUtf8Bytes, 4);
});

test("native output buffer enforces byte/message bounds and scalar-safe chunks", () => {
  const emitted: Array<{ text: string }> = [];
  const capture = createNativeOutputCapture({
    teeOut() {},
    teeErr() {},
    limits: { messages: 2, utf8Bytes: 8, messageUtf8Bytes: 4 },
  });
  capture.print("🙂🙂");
  capture.printErr("x");
  capture.print("dropped");
  assert.equal(capture.authenticate("bounded"), true);
  assert.equal(capture.flush("bounded", value => emitted.push(value)), true);
  assert.deepEqual(emitted.map(value => value.text), ["🙂", "🙂"]);
  const snapshot = capture.snapshot();
  assert.equal(snapshot.acceptedPrePortMessages, 2);
  assert.equal(snapshot.acceptedPrePortUtf8Bytes, 8);
  assert.equal(snapshot.droppedOverflowMessages, 3);
  assert.equal(snapshot.droppedOverflowUtf8Bytes, 8);
});

test("native output rejects stale generations and post-retirement delivery but still tees", () => {
  const tee: string[] = [];
  const emitted: string[] = [];
  const capture = createNativeOutputCapture({
    teeOut: (...args) => tee.push(args.join(" ")),
    teeErr: (...args) => tee.push(args.join(" ")),
  });
  capture.print("queued");
  assert.equal(capture.authenticate("generation"), true);
  assert.equal(capture.retire("stale"), false);
  assert.equal(capture.flush("generation", value => emitted.push(value.text)), true);
  assert.equal(capture.retire("generation"), true);
  capture.printErr("retired");
  assert.deepEqual(emitted, ["queued"]);
  assert.deepEqual(tee, ["queued", "retired"]);
  assert.equal(capture.snapshot().rejectedAfterRetirement, 1);

  const hostile = new Proxy({}, { get() { throw new Error("hostile"); } });
  assert.equal(normalizeNativeOutputArguments([hostile, Symbol("s")]), "<unprintable> Symbol(s)");
});

test("normalized native payload validates without closing the authenticated port", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);
  const received: string[] = [];
  client.onOutputEvent(message => {
    validatePreviewOutputEvent(message, uuid, uuid);
    received.push(message.payload.text);
  });
  channel.port2.onmessage = event => channel.port2.postMessage({
    protocolVersion: 1,
    correlationId: event.data.correlationId,
    type: "preview.start.response",
    result: { success: true, data: { previewId: uuid, accepted: true } },
  });
  await client.request(
    startRequest(),
    "preview.start.response",
    value => validatePreviewStartResponse(value, uuid, uuid),
  );
  const capture = createNativeOutputCapture({ teeOut() {}, teeErr() {} });
  capture.print("A\uD800🙂\uDC00B");
  capture.authenticate("authenticated");
  let sequence = 0;
  capture.flush("authenticated", value => channel.port2.postMessage({
    protocolVersion: 1,
    correlationId: uuid,
    type: "preview.output",
    payload: {
      previewId: uuid,
      sequence: ++sequence,
      source: "native",
      stream: value.stream,
      category: value.category,
      text: value.text,
    },
  }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(received, ["A\uFFFD🙂\uFFFDB"]);
  assert.equal(client.isClosed, false);
  client.close("test complete");
  channel.port2.close();
});

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

test("normal issue023 controller reaches one production start and reports success or failure", async () => {
  const statuses: Array<[string, string]> = [];
  const disabled: boolean[] = [];
  const errors: unknown[] = [];
  let productionStarts = 0;
  const success = createIssue023RunController({
    start: async () => {
      productionStarts += 1;
      return { runAttempts: 1, proofMode: false };
    },
    setDisabled: value => { disabled.push(value); },
    setStatus: (state, text) => { statuses.push([state, text]); },
    reportError: error => { errors.push(error); },
  });
  assert.deepEqual(await success.run(), { runAttempts: 1, proofMode: false });
  assert.equal(productionStarts, 1);
  assert.equal(success.state, "running");
  assert.deepEqual(statuses.at(-1), ["ready", "Running clear-color Game in retained preview."]);
  assert.deepEqual(disabled, [true]);
  assert.deepEqual(errors, []);
  await assert.rejects(success.run(), /already active/);
  assert.equal(productionStarts, 1);

  const failure = createIssue023RunController({
    start: async () => { throw new Error("PREVIEW_START_FAILED: rejected"); },
    setDisabled: value => { disabled.push(value); },
    setStatus: (state, text) => { statuses.push([state, text]); },
    reportError: error => { errors.push(error); },
  });
  await assert.rejects(failure.run(), /PREVIEW_START_FAILED/);
  assert.equal(failure.state, "idle");
  assert.deepEqual(statuses.at(-1), ["error", "PREVIEW_START_FAILED: rejected"]);
  assert.equal(disabled.at(-1), false);
  assert.equal(errors.length, 1);
});

test("requester timeout immediately retires its preview and discards delayed completion", async () => {
  let retired = 0;
  const delayed = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("TIMEOUT")), 5));
  await assert.rejects(withForcedPreviewRetirement(delayed, () => { retired += 1; }), /TIMEOUT/);
  assert.equal(retired, 1);
});

test("run/stop controller coalesces concurrent stops and recovers controls", async () => {
  const runDisabled: boolean[] = [];
  const stopDisabled: boolean[] = [];
  const statuses: string[] = [];
  let stopCalls = 0;
  let release!: () => void;
  const stopping = new Promise<void>(resolve => { release = resolve; });
  const controller = createIssue024RunStopController({
    start: async () => ({ previewId: uuid }),
    stop: async () => { stopCalls++; await stopping; return { stopped: true }; },
    setRunDisabled: value => { runDisabled.push(value); },
    setStopDisabled: value => { stopDisabled.push(value); },
    setStatus: (_state, text) => { statuses.push(text); },
    reportError: () => {},
  });
  await controller.run();
  const first = controller.stop();
  const duplicate = controller.stop();
  assert.equal(first, duplicate);
  assert.equal(controller.state, "stopping");
  assert.equal(stopCalls, 1);
  release();
  assert.deepEqual(await first, { stopped: true });
  assert.equal(controller.state, "idle");
  assert.equal(runDisabled.at(-1), false);
  assert.equal(stopDisabled.at(-1), true);
  assert.equal(statuses.at(-1), "Preview stopped; editor controls recovered.");
});

test("restart waits for retirement and coalesces duplicate run requests", async () => {
  const order: string[] = [];
  let starts = 0;
  let releaseStop!: () => void;
  const stopping = new Promise<void>(resolve => { releaseStop = resolve; });
  const controller = createIssue024RunStopController({
    start: async () => {
      const preview = { id: ++starts };
      order.push(`start:${preview.id}`);
      return preview;
    },
    stop: async (preview, reason) => {
      order.push(`stop:${preview.id}:${reason}`);
      await stopping;
      order.push(`retired:${preview.id}`);
    },
    setRunDisabled() {},
    setStopDisabled() {},
    setStatus() {},
    reportError() {},
  });
  assert.deepEqual(await controller.run(), { id: 1 });
  const restart = controller.run();
  const duplicate = controller.run();
  assert.equal(restart, duplicate);
  assert.equal(starts, 1);
  assert.deepEqual(order, ["start:1", "stop:1:restart"]);
  releaseStop();
  assert.deepEqual(await restart, { id: 2 });
  assert.deepEqual(order, ["start:1", "stop:1:restart", "retired:1", "start:2"]);
});

test("rapid run stop run serializes startup cleanup and fresh start", async () => {
  let resolveFirst!: (preview: { id: number }) => void;
  const firstStart = new Promise<{ id: number }>(resolve => { resolveFirst = resolve; });
  let releaseStop!: () => void;
  const stopping = new Promise<void>(resolve => { releaseStop = resolve; });
  const order: string[] = [];
  let starts = 0;
  const controller = createIssue024RunStopController({
    start: () => {
      starts += 1;
      order.push(`start:${starts}`);
      return starts === 1 ? firstStart : Promise.resolve({ id: starts });
    },
    stop: async preview => {
      order.push(`stop:${preview.id}`);
      await stopping;
      order.push(`retired:${preview.id}`);
    },
    setRunDisabled() {},
    setStopDisabled() {},
    setStatus() {},
    reportError() {},
  });
  const run = controller.run();
  assert.equal(run, controller.run());
  const stop = controller.stop();
  assert.equal(stop, controller.stop());
  const restart = controller.run();
  assert.equal(restart, controller.run());
  resolveFirst({ id: 1 });
  await run;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(order, ["start:1", "stop:1"]);
  releaseStop();
  await stop;
  assert.deepEqual(await restart, { id: 2 });
  assert.deepEqual(order, ["start:1", "stop:1", "retired:1", "start:2"]);
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
  assert.equal(PLAYGROUND_DIAGNOSTIC_IDS.length, 16);
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

function startRequest(correlationId = uuid, previewId = uuid, timeoutMs = 10_000) {
  return {
    protocolVersion: 1,
    correlationId,
    type: "preview.start.request",
    payload: { previewId, timeoutMs },
  };
}

function stopRequest(correlationId = uuid, previewId = uuid) {
  return {
    protocolVersion: 1,
    correlationId,
    type: "preview.stop.request",
    payload: { previewId, reason: "user", timeoutMs: 2_000 },
  };
}

test("validates exact stop request and response contracts", () => {
  assert.equal(validatePreviewStopRequest(stopRequest(), uuid).message.type,
    "preview.stop.request");
  const response = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "preview.stop.response",
    result: {
      success: true,
      data: { previewId: uuid, accepted: true, alreadyStopped: false },
    },
  };
  assert.equal(validatePreviewStopResponse(response, uuid, uuid).message, response);
  assert.throws(
    () => validatePreviewStopRequest({
      ...stopRequest(), payload: { previewId: uuid, reason: "manual" },
    }, uuid),
    /MALFORMED_PAYLOAD/,
  );
  assert.throws(
    () => validatePreviewStopResponse({
      ...response,
      result: {
        success: true,
        data: { previewId: uuid, accepted: true, alreadyStopped: true },
      },
    }, uuid, uuid),
    /MALFORMED_PAYLOAD/,
  );
});

test("stop executor disposes once and emits one stopped completion", async () => {
  let state = "running";
  let stopCalls = 0;
  let records = 0;
  let sequence = 1;
  const execute = createPreviewStopExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => ({
      StopGame: () => {
        stopCalls++;
        return JSON.stringify({
          success: true, hadGame: true, disposeAttempts: 1,
          proofDisposeCount: 1, frameCount: 4,
        });
      },
      QueryStoppedGameProof: () => JSON.stringify({
        frameCount: 4, updateCount: 4, disposeCount: 1,
        callbackAfterDisposedCount: 0,
      }),
    }),
    createLifecycleEvent: (type, correlationId, extra = {}) => ({
      protocolVersion: 1,
      correlationId,
      type,
      payload: { previewId: uuid, sequence: ++sequence, ...extra },
    }),
    recordStop: () => { records++; },
  });
  const first = execute(stopRequest());
  const concurrent = execute(stopRequest(compileId));
  const [firstOutcome, concurrentOutcome] = await Promise.all([first, concurrent]);
  assert.equal(stopCalls, 1);
  assert.equal(state, "disposed");
  assert.equal(records, 2);
  assert.deepEqual(firstOutcome.events.map(event => event.type), ["preview.stopped"]);
  assert.equal(firstOutcome.events[0].payload.reason, "requested");
  assert.equal(concurrentOutcome.events, undefined);
  const already = await execute(stopRequest(crypto.randomUUID()));
  assert.deepEqual(already.result.data, {
    previewId: uuid, accepted: false, alreadyStopped: true,
  });
});

test("actual endpoint makes stop win during awaited start with one stopped event", async () => {
  const posted: Array<Record<string, any>> = [];
  let state = "loaded";
  let sequence = 0;
  let disposeCalls = 0;
  const exports = {
    RunLoadedGame: () => {
      throw new Error("RunLoadedGame must not execute after stop wins.");
    },
    StopGame: () => {
      disposeCalls++;
      return JSON.stringify({ success: true, disposeAttempts: 1 });
    },
    QueryStoppedGameProof: () => JSON.stringify({
      frameCount: 0, updateCount: 0, disposeCount: 1, callbackAfterDisposedCount: 0,
    }),
  };
  const lifecycleEvent = (type: string, correlationId: string, extra = {}) => ({
    protocolVersion: 1,
    correlationId,
    type,
    payload: { previewId: uuid, sequence: ++sequence, ...extra },
  });
  const executeStart = createPreviewStartExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => exports,
    createLifecycleEvent: lifecycleEvent,
    recordStart: () => {},
    recordFailureTeardown: () => {},
    recordUnexpected: () => {},
    beforeRunDelayMs: 150,
  });
  const executeStop = createPreviewStopExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => exports,
    createLifecycleEvent: lifecycleEvent,
    recordStop: () => {},
  });
  const endpoint = createPreviewEndpoint({
    port: {
      postMessage(message: Record<string, any>) { posted.push(message); },
      close() {},
    },
    previewId: uuid,
    proof: { errors: [], terminals: [], closes: [], events: [] },
    execute: async () => { throw new Error("INVALID_STATE"); },
    executeStart,
    executeStop,
  });
  const starting = endpoint.handle({ data: startRequest(uuid) });
  await new Promise(resolve => setTimeout(resolve, 10));
  const stopCorrelation = crypto.randomUUID();
  const stopping = endpoint.handle({ data: stopRequest(stopCorrelation) });
  await Promise.all([starting, stopping]);

  assert.equal(disposeCalls, 1);
  assert.equal(state, "disposed");
  assert.deepEqual(posted.map(message => message.type), [
    "preview.stop.response",
    "preview.stopped",
    "preview.start.response",
  ]);
  assert.equal(posted.filter(message => message.type === "preview.stopped").length, 1);
  assert.equal(posted.some(message => message.type === "preview.failed"), false);
  assert.equal(posted.at(-1)?.result.error.code, "CANCELLED");
  assert.equal(posted[1].payload.sequence, 1);
  assert.equal(posted[1].correlationId, stopCorrelation);
});

test("already-stopped stop posts response before retiring actual endpoint", async () => {
  const order: string[] = [];
  let state = "stopped";
  const executeStop = createPreviewStopExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => ({}),
    createLifecycleEvent: () => { throw new Error("must not emit"); },
    recordStop: () => {},
  });
  const endpoint = createPreviewEndpoint({
    port: {
      postMessage(message: Record<string, any>) { order.push(message.type); },
      close() { order.push("close"); },
    },
    previewId: uuid,
    proof: { errors: [], terminals: [], closes: [], events: [] },
    execute: async () => { throw new Error("INVALID_STATE"); },
    executeStop,
  });
  await endpoint.handle({ data: stopRequest() });
  assert.deepEqual(order, ["preview.stop.response"]);
  assert.equal(endpoint.closed, false);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.deepEqual(order, ["preview.stop.response", "close"]);
  assert.equal(endpoint.closed, true);
});

test("start validators reject wrong version, type, source, payload, and timeout", () => {
  assert.equal(validatePreviewStartRequest(startRequest(), uuid).message.type, "preview.start.request");
  assert.throws(
    () => validatePreviewStartRequest({ ...startRequest(), protocolVersion: 2 }, uuid),
    /UNSUPPORTED_PROTOCOL_VERSION/,
  );
  assert.throws(
    () => validatePreviewStartRequest({ ...startRequest(), type: "preview.stop.request" }, uuid),
    /MESSAGE_ROUTE_REJECTED/,
  );
  assert.throws(
    () => validatePreviewStartRequest(startRequest(uuid, compileId), uuid),
    /MESSAGE_SOURCE_REJECTED/,
  );
  assert.throws(
    () => validatePreviewStartRequest(startRequest(uuid, uuid, 99), uuid),
    /MALFORMED_PAYLOAD/,
  );
  assert.throws(
    () => validatePreviewStartRequest({
      ...startRequest(),
      payload: { ...startRequest().payload, extra: true },
    }, uuid),
    /MALFORMED_PAYLOAD/,
  );
});

test("actual start endpoint rejects wrong version, type, and preview identity before work", async () => {
  const cases = [
    {
      message: { ...startRequest(), protocolVersion: 2 },
      responseType: "protocol.error",
      code: "UNSUPPORTED_PROTOCOL_VERSION",
    },
    {
      message: { ...startRequest(), type: "preview.started" },
      responseType: "protocol.error",
      code: "MESSAGE_ROUTE_REJECTED",
    },
    {
      message: startRequest(uuid, compileId),
      responseType: "preview.start.response",
      code: "MESSAGE_SOURCE_REJECTED",
    },
  ];
  for (const item of cases) {
    const posted: Array<Record<string, any>> = [];
    let executions = 0;
    const endpoint = createPreviewEndpoint({
      port: {
        postMessage(message: Record<string, any>) { posted.push(message); },
        close() {},
      },
      previewId: uuid,
      proof: { errors: [], terminals: [], closes: [], events: [] },
      execute: async () => { executions += 1; throw new Error("INVALID_STATE"); },
      executeStart: async () => { executions += 1; throw new Error("INVALID_STATE"); },
    });
    await endpoint.handle({ data: item.message });
    assert.equal(executions, 0);
    assert.equal(posted.length, 1);
    assert.equal(posted[0].type, item.responseType);
    assert.equal(
      posted[0].result?.error?.code ?? posted[0].payload?.error?.code,
      item.code,
    );
  }
});

test("actual preview endpoint enforces start state, one execution, and response-event order", async () => {
  const posted: Array<Record<string, any>> = [];
  const proof = { errors: [], terminals: [], closes: [], events: [] };
  let loaded = false;
  let running = false;
  let starts = 0;
  const endpoint = createPreviewEndpoint({
    port: {
      postMessage(message: Record<string, any>) { posted.push(message); },
      close() {},
    },
    previewId: uuid,
    proof,
    execute: async () => {
      loaded = true;
      return { result: { success: true, data: { previewId: uuid, compileId } } };
    },
    executeStart: async (message: Record<string, any>) => {
      if (!loaded || running) throw new Error("INVALID_STATE");
      running = true;
      starts += 1;
      return {
        result: { success: true, data: { previewId: uuid, accepted: true } },
        events: [{
          protocolVersion: 1,
          correlationId: message.correlationId,
          type: "preview.started",
          payload: { previewId: uuid, sequence: 1 },
        }],
      };
    },
  });

  await endpoint.handle({ data: startRequest() });
  assert.equal(posted.at(-1)?.result.error.code, "INVALID_STATE");
  const secondCorrelation = "11112233-4455-4677-8899-aabbccddeeff";
  loaded = true;
  await endpoint.handle({ data: startRequest(secondCorrelation) });
  assert.deepEqual(posted.slice(-2).map(message => message.type),
    ["preview.start.response", "preview.started"]);
  assert.equal(starts, 1);
  assert.equal(posted.at(-1)?.correlationId, secondCorrelation);
  assert.equal(posted.at(-1)?.payload.sequence, 1);

  const thirdCorrelation = "21112233-4455-4677-8899-aabbccddeeff";
  await endpoint.handle({ data: startRequest(thirdCorrelation) });
  assert.equal(posted.at(-1)?.result.error.code, "INVALID_STATE");
  assert.equal(starts, 1);
});

test("concurrent duplicate start correlation executes once and receives one terminal", async () => {
  const posted: Array<Record<string, any>> = [];
  let starts = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const endpoint = createPreviewEndpoint({
    port: {
      postMessage(message: Record<string, any>) { posted.push(message); },
      close() {},
    },
    previewId: uuid,
    proof: { errors: [], terminals: [], closes: [], events: [], duplicateControls: [] },
    execute: async () => { throw new Error("INVALID_STATE"); },
    executeStart: async () => {
      starts += 1;
      await blocked;
      return { result: { success: true, data: { previewId: uuid, accepted: true } } };
    },
  });
  const first = endpoint.handle({ data: startRequest() });
  const duplicate = endpoint.handle({ data: startRequest() });
  await duplicate;
  release();
  await first;
  assert.equal(starts, 1);
  assert.equal(posted.filter(message => message.type === "preview.start.response").length, 1);
  assert.equal(posted.filter(message =>
    message.type === "protocol.error" &&
    message.payload.error.code === "DUPLICATE_CORRELATION_ID").length, 1);
});

test("distinct concurrent starts admit one and reject the other without a second Run", async () => {
  const posted: Array<Record<string, any>> = [];
  let lifecycle = "loaded";
  let runs = 0;
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const endpoint = createPreviewEndpoint({
    port: {
      postMessage(message: Record<string, any>) { posted.push(message); },
      close() {},
    },
    previewId: uuid,
    proof: { errors: [], terminals: [], closes: [], events: [] },
    execute: async () => { throw new Error("INVALID_STATE"); },
    executeStart: async () => {
      if (lifecycle !== "loaded") throw new Error("INVALID_STATE");
      lifecycle = "starting";
      runs += 1;
      await blocked;
      lifecycle = "running";
      return { result: { success: true, data: { previewId: uuid, accepted: true } } };
    },
  });
  const other = "31112233-4455-4677-8899-aabbccddeeff";
  const first = endpoint.handle({ data: startRequest() });
  await endpoint.handle({ data: startRequest(other) });
  release();
  await first;
  assert.equal(runs, 1);
  assert.equal(posted.find(message => message.correlationId === other)?.result.error.code,
    "INVALID_STATE");
});

test("synchronous start failure orders response, failed, stopped and disposes once", async () => {
  const posted: Array<Record<string, any>> = [];
  let disposeAttempts = 0;
  const endpoint = createPreviewEndpoint({
    port: {
      postMessage(message: Record<string, any>) { posted.push(message); },
      close() {},
    },
    previewId: uuid,
    proof: { errors: [], terminals: [], closes: [], events: [] },
    execute: async () => { throw new Error("INVALID_STATE"); },
    executeStart: async message => {
      disposeAttempts += 1;
      const error = { code: "PREVIEW_START_FAILED", message: "The game failed during preview startup." };
      return {
        result: { success: false, error },
        events: [
          {
            protocolVersion: 1, correlationId: message.correlationId,
            type: "preview.failed",
            payload: { previewId: uuid, sequence: 1, phase: "start", error },
          },
          {
            protocolVersion: 1, correlationId: message.correlationId,
            type: "preview.stopped",
            payload: { previewId: uuid, sequence: 2, reason: "failed" },
          },
        ],
        closeAfterResponse: true,
      };
    },
  });
  await endpoint.handle({ data: startRequest() });
  assert.deepEqual(posted.map(message => message.type),
    ["preview.start.response", "preview.failed", "preview.stopped"]);
  assert.deepEqual(posted.slice(1).map(message => message.payload.sequence), [1, 2]);
  assert.equal(posted.every(message => message.correlationId === uuid), true);
  assert.equal(posted.some(message => message.type === "preview.started"), false);
  assert.equal(disposeAttempts, 1);
});

test("start client discards terminal and lifecycle traffic arriving after timeout", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);
  channel.port2.onmessage = event => {
    setTimeout(() => {
      channel.port2.postMessage({
        protocolVersion: 1,
        correlationId: event.data.correlationId,
        type: "preview.start.response",
        result: { success: true, data: { previewId: uuid, accepted: true } },
      });
      channel.port2.postMessage({
        protocolVersion: 1,
        correlationId: event.data.correlationId,
        type: "preview.started",
        payload: { previewId: uuid, sequence: 1 },
      });
    }, 130);
  };
  await assert.rejects(client.request(
    startRequest(),
    "preview.start.response",
    value => validatePreviewStartResponse(value, uuid, uuid),
    [],
    100,
  ), /TIMEOUT/);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(client.observations.discardedUnknownOrLate, 2);
  assert.equal(client.observations.lifecycleEvents, 0);
  client.close("test");
  channel.port2.close();
});

test("start client accepts a delayed correlated event only after its terminal response", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);
  const order: string[] = [];
  const eventReceived = new Promise<void>(resolve => {
    client.onLifecycleEvent(message => {
      order.push(message.type);
      resolve();
    });
  });
  channel.port2.onmessage = event => {
    channel.port2.postMessage({
      protocolVersion: 1,
      correlationId: event.data.correlationId,
      type: "preview.start.response",
      result: { success: true, data: { previewId: uuid, accepted: true } },
    });
    setTimeout(() => channel.port2.postMessage({
      protocolVersion: 1,
      correlationId: event.data.correlationId,
      type: "preview.started",
      payload: { previewId: uuid, sequence: 1 },
    }), 20);
  };
  await client.request(
    startRequest(),
    "preview.start.response",
    value => validatePreviewStartResponse(value, uuid, uuid),
  );
  order.push("preview.start.response");
  await eventReceived;
  assert.deepEqual(order, ["preview.start.response", "preview.started"]);
  client.close("test");
  channel.port2.close();
});

test("first Draw failure wins over a duplicate Update surface and owns stopped", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);
  const received: string[] = [];
  client.onLifecycleEvent(message => received.push(
    `${message.type}:${message.correlationId}`));
  channel.port2.onmessage = event => {
    channel.port2.postMessage({
      protocolVersion: 1,
      correlationId: event.data.correlationId,
      type: "preview.start.response",
      result: { success: true, data: { previewId: uuid, accepted: true } },
    });
  };
  await client.request(
    startRequest(), "preview.start.response",
    value => validatePreviewStartResponse(value, uuid, uuid));
  channel.port2.postMessage({
    protocolVersion: 1, correlationId: uuid, type: "preview.started",
    payload: { previewId: uuid, sequence: 1 },
  });
  channel.port2.postMessage({
    protocolVersion: 1, correlationId: compileId, type: "preview.failed",
    payload: {
      previewId: uuid, sequence: 2, phase: "running",
      error: { code: "PREVIEW_RUNTIME_FAILED", message: "Draw failure" },
    },
  });
  channel.port2.postMessage({
    protocolVersion: 1,
    correlationId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    type: "preview.failed",
    payload: {
      previewId: uuid, sequence: 3, phase: "running",
      error: { code: "PREVIEW_RUNTIME_FAILED", message: "duplicate Update surface" },
    },
  });
  channel.port2.postMessage({
    protocolVersion: 1, correlationId: compileId, type: "preview.stopped",
    payload: { previewId: uuid, sequence: 4, reason: "failed" },
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(received, [
    `preview.started:${uuid}`,
    `preview.failed:${compileId}`,
    `preview.stopped:${compileId}`,
  ]);
  assert.equal(client.runtimeFailureCorrelation, compileId);
  assert.equal(client.observations.discardedUnknownOrLate, 1);
  client.close("test");
  channel.port2.close();
});

test("run controller recovers after production failure observation without stopping twice", async () => {
  let resolveFailure!: () => void;
  let starts = 0;
  let stops = 0;
  const controls: Array<[string, boolean]> = [];
  const failure = new Promise<void>(resolve => { resolveFailure = resolve; });
  const controller = createIssue024RunStopController({
    start: async () => ({ id: ++starts, failure }),
    stop: async () => { stops++; },
    observeFailure: preview => preview.failure,
    setRunDisabled: value => controls.push(["run", value]),
    setStopDisabled: value => controls.push(["stop", value]),
    setStatus() {},
    reportError(error) { throw error; },
  });
  await controller.run();
  resolveFailure();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(controller.state, "idle");
  assert.equal(stops, 0);
  assert.deepEqual(controls.slice(-2), [["run", false], ["stop", true]]);
  await controller.run();
  assert.equal(starts, 2);
});

test("validates correlated monotonic start lifecycle event shape", () => {
  const event = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "preview.started",
    payload: { previewId: uuid, sequence: 1 },
  };
  assert.equal(validatePreviewLifecycleEvent(event, uuid, uuid).message, event);
  assert.throws(
    () => validatePreviewLifecycleEvent({
      ...event, payload: { previewId: uuid, sequence: 0 },
    }, uuid, uuid),
    /MALFORMED_PAYLOAD/,
  );
  assert.throws(
    () => validatePreviewLifecycleEvent(event, compileId, uuid),
    /MESSAGE_SOURCE_REJECTED/,
  );
});

test("validates compatible output enums, additive fields, and UTF-8 byte limit", () => {
  const event = {
    protocolVersion: 1,
    correlationId: uuid,
    type: "preview.output",
    payload: {
      previewId: uuid,
      sequence: 1,
      source: "managed",
      stream: "stdout",
      category: "console",
      text: "",
    },
  };
  assert.equal(validatePreviewOutputEvent(event, uuid, uuid).message, event);
  assert.equal(validatePreviewOutputEvent({
    ...event,
    payload: { ...event.payload, stream: "stderr", text: "🙂".repeat(4096) },
  }, uuid, uuid).message.type, "preview.output");
  for (const source of ["managed", "native"]) {
    for (const category of ["console", "startup", "runtime", "content", "shader"]) {
      const compatible = {
        ...event,
        payload: {
          ...event.payload,
          source,
          category,
          additiveScalar: 42,
          additiveObject: { future: true },
        },
      };
      assert.equal(
        validatePreviewOutputEvent(compatible, uuid, uuid).message,
        compatible,
      );
    }
  }
  for (const payload of [
    { ...event.payload, source: "browser" },
    { ...event.payload, source: 1 },
    { ...event.payload, stream: "debug" },
    { ...event.payload, stream: false },
    { ...event.payload, category: "trace" },
    { ...event.payload, category: null },
    { ...event.payload, sequence: 1.5 },
    { ...event.payload, text: 1 },
    { ...event.payload, text: `${"🙂".repeat(4096)}x` },
  ]) {
    assert.throws(
      () => validatePreviewOutputEvent({ ...event, payload }, uuid, uuid),
      /MALFORMED_PAYLOAD/,
    );
  }
  assert.throws(
    () => validatePreviewOutputEvent(event, compileId, uuid),
    /MESSAGE_SOURCE_REJECTED/,
  );
});

test("port admits ordered output only for an accepted live preview", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);
  const received: string[] = [];
  client.onOutputEvent(message => {
    validatePreviewOutputEvent(message, uuid, uuid);
    received.push(message.payload.text);
  });
  channel.port2.onmessage = event => {
    channel.port2.postMessage({
      protocolVersion: 1,
      correlationId: event.data.correlationId,
      type: "preview.start.response",
      result: { success: true, data: { previewId: uuid, accepted: true } },
    });
    channel.port2.postMessage({
      protocolVersion: 1,
      correlationId: event.data.correlationId,
      type: "preview.output",
      payload: {
        previewId: uuid, sequence: 1, source: "managed",
        stream: "stdout", category: "console", text: "first",
      },
    });
    channel.port2.postMessage({
      protocolVersion: 1,
      correlationId: event.data.correlationId,
      type: "preview.output",
      payload: {
        previewId: uuid, sequence: 2, source: "managed",
        stream: "stderr", category: "console", text: "second",
      },
    });
  };
  await client.request(
    startRequest(),
    "preview.start.response",
    value => validatePreviewStartResponse(value, uuid, uuid),
  );
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(received, ["first", "second"]);
  assert.equal(client.observations.outputEvents, 2);
  channel.port2.postMessage({
    protocolVersion: 1, correlationId: uuid, type: "preview.output",
    payload: {
      previewId: uuid, sequence: 2, source: "managed",
      stream: "stdout", category: "console", text: "regressed",
    },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(received, ["first", "second"]);
  assert.equal(client.observations.discardedEventRegressions, 1);
  client.close("retired");
  channel.port2.postMessage({
    protocolVersion: 1, correlationId: uuid, type: "preview.output",
    payload: {
      previewId: uuid, sequence: 3, source: "managed",
      stream: "stdout", category: "console", text: "stale",
    },
  });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(received, ["first", "second"]);
  channel.port2.close();
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

test("production start executor retains a successful managed Game and emits started", async () => {
  let state = "loaded";
  let sequence = 0;
  const execute = createPreviewStartExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => ({
      RunLoadedGame: () => JSON.stringify({
        success: true, runAttempts: 1, retainedGame: true, disposed: false,
      }),
    }),
    createLifecycleEvent: (type, correlationId, extra = {}) => ({
      protocolVersion: 1, correlationId, type,
      payload: { previewId: uuid, sequence: ++sequence, ...extra },
    }),
    recordStart: () => {},
    recordFailureTeardown: () => {},
    recordUnexpected: () => {},
  });
  const outcome = await execute(startRequest(uuid, uuid));
  assert.equal(state, "running");
  assert.equal(outcome.result.success, true);
  assert.deepEqual(outcome.events.map(event => event.type), ["preview.started"]);
});

test("production start executor performs exact structured failure lifecycle", async () => {
  let state = "loaded";
  let sequence = 0;
  let teardownCalls = 0;
  const execute = createPreviewStartExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => ({
      RunLoadedGame: () => JSON.stringify({
        success: false,
        error: { code: "PREVIEW_START_FAILED", message: "Managed preview startup failed." },
      }),
      TeardownGame: () => {
        teardownCalls++;
        return JSON.stringify({ disposeAttempts: 1, retainedGame: false });
      },
    }),
    createLifecycleEvent: (type, requestCorrelationId, extra = {}) => ({
      protocolVersion: 1, correlationId: requestCorrelationId, type,
      payload: { previewId: uuid, sequence: ++sequence, ...extra },
    }),
    recordStart: () => {},
    recordFailureTeardown: () => {},
    recordUnexpected: () => {},
  });
  const outcome = await execute(startRequest(uuid, uuid));
  assert.equal(state, "disposed");
  assert.equal(teardownCalls, 1);
  assert.deepEqual(outcome.events.map(event => event.type), [
    "preview.failed", "preview.stopped",
  ]);
  assert.deepEqual(outcome.events.map(event => event.payload.sequence), [1, 2]);
});

test("production start executor classifies escaped boundary errors as unexpected", async () => {
  let state = "loaded";
  let unexpected = null;
  let teardownCalls = 0;
  const execute = createPreviewStartExecutor({
    getState: () => state,
    setState: value => { state = value; },
    getExports: async () => ({
      RunLoadedGame: () => { throw new Error("raw detail"); },
      TeardownGame: () => { teardownCalls++; return "{}"; },
    }),
    createLifecycleEvent: () => { throw new Error("must not emit lifecycle"); },
    recordStart: () => {},
    recordFailureTeardown: () => {},
    recordUnexpected: value => { unexpected = value; },
  });
  await assert.rejects(
    execute(startRequest(uuid, uuid)),
    UnexpectedStartBoundaryError,
  );
  assert.equal(state, "tainted");
  assert.equal(teardownCalls, 1);
  assert.deepEqual(unexpected, {
    category: "start-boundary", code: "INTERNAL_ERROR", name: "Error",
  });
});
test("issue 033 sandbox and CSP remain restrictive", async () => {
  const frontend = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const rust = await readFile(
    new URL("../../desktop/src-tauri/src/lib.rs", import.meta.url), "utf8");
  const config = await readFile(
    new URL("../../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8");
  const previewRuntime = await readFile(
    new URL("../../preview/wwwroot/preview.js", import.meta.url), "utf8");
  const issue21Runtime = await readFile(
    new URL("./issue21.ts", import.meta.url), "utf8");
  assert.equal(PREVIEW_SANDBOX, "allow-scripts");
  assert.match(frontend, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frontend, /allow-same-origin/);
  const csp = rust.match(/const PREVIEW_CSP: &str = "([^"]+)"/)?.[1] ?? "";
  assert.equal(csp, PREVIEW_CSP);
  assert.match(csp, /^default-src 'none';/);
  assert.match(csp, /script-src playground-preview: 'wasm-unsafe-eval'/);
  assert.match(csp, /frame-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /form-action 'none'/);
  for (const directive of ["img-src", "font-src", "media-src", "worker-src"]) {
    assert.match(csp, new RegExp(`${directive} 'none'`));
  }
  assert.doesNotMatch(csp, /https?:|\bdata:|\bblob:|\s\*\s|'unsafe-eval'|allow-same-origin/);
  assert.equal(
    PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL,
    PREVIEW_CSP.replace(" 'wasm-unsafe-eval'", ""));
  assert.doesNotMatch(PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL, /wasm-unsafe-eval/);
  assert.equal(
    PREVIEW_CSP.length - PREVIEW_CSP_WITHOUT_WASM_UNSAFE_EVAL.length,
    " 'wasm-unsafe-eval'".length);
  assert.equal(
    ISSUE033_NO_WASM_EVAL_DOCUMENT,
    PREVIEW_DOCUMENT.replace(" 'wasm-unsafe-eval'", ""));
  assert.doesNotMatch(PREVIEW_DOCUMENT, /issue033ForbiddenInlineProbeRan/);
  assert.doesNotMatch(ISSUE033_NO_WASM_EVAL_DOCUMENT, /issue033ForbiddenInlineProbeRan/);
  assert.match(config, /frame-src 'self' playground-preview:/);
  assert.match(previewRuntime, /withResourceLoader/);
  assert.match(previewRuntime, /credentials:\s*"omit"/);
  assert.match(previewRuntime, /ANIMATION_FRAME_TIMEOUT/);
  assert.match(issue21Runtime, /await requireVisiblePreviewFrame\(frame, bridge\)/);
  assert.match(issue21Runtime, /frame\.scrollIntoView/);
});

test("issue 034 commands are scoped to the local main webview", async () => {
  const root = new URL("../../desktop/src-tauri/", import.meta.url);
  const [configText, capabilityText, permission, build, rust, cargo, frontendPackage,
    issue034Source, capabilityEntries, permissionEntries] =
    await Promise.all([
      readFile(new URL("tauri.conf.json", root), "utf8"),
      readFile(new URL("capabilities/main.json", root), "utf8"),
      readFile(new URL("permissions/main.toml", root), "utf8"),
      readFile(new URL("build.rs", root), "utf8"),
      readFile(new URL("src/lib.rs", root), "utf8"),
      readFile(new URL("Cargo.toml", root), "utf8"),
      readFile(new URL("../package.json", import.meta.url), "utf8"),
      readFile(new URL("./issue34.ts", import.meta.url), "utf8"),
      readdir(new URL("capabilities/", root), { withFileTypes: true }),
      readdir(new URL("permissions/", root), { withFileTypes: true }),
    ]);
  const config = JSON.parse(configText);
  const capability = JSON.parse(capabilityText);
  const validateCapabilities = (
    files: Array<{ name: string; capability: Record<string, unknown> }>,
  ) => {
    assert.equal(files.length, 1);
    assert.equal(files[0].name, "main.json");
    const value = files[0].capability;
    assert.deepEqual(Object.keys(value).sort(),
      ["$schema", "description", "identifier", "local", "permissions", "windows"]);
    assert.equal(value.identifier, "main");
    assert.equal(value.local, true);
    assert.deepEqual(value.windows, ["main"]);
    assert.deepEqual(value.permissions, ["main-commands"]);
    assert.equal("remote" in value, false);
    assert.equal("webviews" in value, false);
    assert.doesNotMatch(JSON.stringify(value), /"\*"/);
  };
  validateCapabilities([{ name: "main.json", capability }]);
  for (const injected of [
    [
      { name: "main.json", capability },
      { name: "remote.json", capability },
    ],
    [{
      name: "main.json",
      capability: { ...capability, remote: { urls: ["https://example.invalid"] } },
    }],
    [{
      name: "main.json",
      capability: { ...capability, windows: ["*"] },
    }],
    [{
      name: "main.json",
      capability: { ...capability, webviews: ["main"] },
    }],
    [{
      name: "main.json",
      capability: { ...capability, local: false },
    }],
    [{
      name: "main.json",
      capability: { ...capability, permissions: ["main-commands", "core:default"] },
    }],
  ]) {
    assert.throws(() => validateCapabilities(injected));
  }
  assert.deepEqual(
    capabilityEntries.map(entry => [entry.name, entry.isFile()]),
    [["main.json", true]]);
  assert.deepEqual(
    permissionEntries.filter(entry => entry.isFile()).map(entry => entry.name),
    ["main.toml"]);
  assert.equal(permissionEntries.every(entry =>
    entry.name === "main.toml" && entry.isFile() ||
    entry.name === "autogenerated" && entry.isDirectory()), true);
  assert.equal(config.app.withGlobalTauri, false);
  assert.equal(config.app.windows[0].label, "main");
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.local, true);
  assert.deepEqual(capability.permissions, ["main-commands"]);
  const commandNames = (text: string) =>
    [...text.matchAll(/"([a-z][a-z0-9_]*)"/g)].map(match => match[1]);
  const manifestBlock = build.match(/const APP_COMMANDS: &\[&str\] = &\[(.*?)\];/s)?.[1] ?? "";
  const permissionBlock = permission.match(/commands\.allow = \[(.*?)\]/s)?.[1] ?? "";
  const handlerBlock = rust.match(/tauri::generate_handler!\[(.*?)\]\)/s)?.[1] ?? "";
  const manifestCommands = commandNames(manifestBlock).sort();
  const permissionCommands = commandNames(permissionBlock).sort();
  const handlerCommands = [...handlerBlock.matchAll(/^\s*([a-z][a-z0-9_]*),?\s*$/gm)]
    .map(match => match[1]).sort();
  const proofInventoryBlock =
    issue034Source.match(/ISSUE034_APPROVED_COMMANDS = \[(.*?)\] as const/s)?.[1] ?? "";
  const proofCommands = commandNames(proofInventoryBlock).sort();
  assert.equal(manifestCommands.length, 49);
  assert.deepEqual(manifestCommands, handlerCommands);
  assert.deepEqual(permissionCommands, handlerCommands);
  assert.deepEqual(proofCommands, handlerCommands);
  assert.match(permission, /issue034_trusted_marker/);
  assert.doesNotMatch(cargo,
    /tauri-plugin-(?:fs|shell|process|opener|dialog|clipboard-manager)/);
  assert.doesNotMatch(frontendPackage, /@tauri-apps\/api/);
});

// ── Issue 036: validate forged, malformed, and oversized protocol messages ──

test("036: missing protocolVersion is rejected as MISSING_PROTOCOL_VERSION", () => {
  assert.throws(() => validateCompileRequest({
    correlationId: uuid, type: "compile.request",
    payload: { compileId, assemblyName: "X", sources: [{ path: "a.cs", text: "x" }], primarySourcePath: "a.cs" },
  }), /MISSING_PROTOCOL_VERSION/);
});

test("036: unsupported protocolVersion is rejected", () => {
  for (const version of [0, 2, -1, 1.5, "1", null, true]) {
    const msg = {
      protocolVersion: version, correlationId: uuid, type: "compile.request",
      payload: { compileId, assemblyName: "X", sources: [{ path: "a.cs", text: "x" }], primarySourcePath: "a.cs" },
    };
    assert.throws(
      () => validateCompileRequest(msg),
      /UNSUPPORTED_PROTOCOL_VERSION|MALFORMED_ENVELOPE|MISSING_PROTOCOL_VERSION/,
      `version=${JSON.stringify(version)}`,
    );
  }
  // undefined value rejects at inspectClone level
  assert.throws(() => validateCompileRequest({
    protocolVersion: undefined, correlationId: uuid, type: "compile.request",
    payload: { compileId, assemblyName: "X", sources: [{ path: "a.cs", text: "x" }], primarySourcePath: "a.cs" },
  }), /MALFORMED/);
});

test("036: unknown message type is rejected as UNKNOWN_MESSAGE_TYPE", () => {
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, correlationId: uuid, type: "attack.forged",
    payload: {},
  }), /UNKNOWN_MESSAGE_TYPE/);
});

test("036: route mismatch type is rejected as MESSAGE_ROUTE_REJECTED", () => {
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, correlationId: uuid, type: "preview.load.request",
    payload: {},
  }), /MESSAGE_ROUTE_REJECTED/);
});

test("036: malformed envelope — missing correlationId", () => {
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, type: "compile.request",
    payload: { compileId, assemblyName: "X", sources: [{ path: "a.cs", text: "x" }], primarySourcePath: "a.cs" },
  }), /MALFORMED_ENVELOPE/);
});

test("036: malformed envelope — non-UUIDv4 correlationId", () => {
  for (const bad of ["not-uuid", "00000000-0000-0000-0000-000000000000", 42, null]) {
    assert.throws(() => validateCompileRequest({
      protocolVersion: 1, correlationId: bad, type: "compile.request",
      payload: { compileId, assemblyName: "X", sources: [{ path: "a.cs", text: "x" }], primarySourcePath: "a.cs" },
    }), /MALFORMED_ENVELOPE/);
  }
});

test("036: malformed envelope — non-object message", () => {
  for (const value of [null, undefined, 42, "string", true, []]) {
    assert.throws(() => validateCompileRequest(value as unknown), /MALFORMED/);
  }
});

test("036: malformed payload — wrong previewId is MESSAGE_SOURCE_REJECTED", () => {
  assert.throws(() => validatePreviewStartRequest({
    protocolVersion: 1, correlationId: uuid, type: "preview.start.request",
    payload: { previewId: compileId },
  }, uuid), /MESSAGE_SOURCE_REJECTED/);
});

test("036: oversized message exceeding 32 MiB is rejected", () => {
  const bigText = "x".repeat(2 * 1024 * 1024);
  const sources = [];
  for (let i = 0; i < 20; i++) {
    sources.push({ path: `file${i}.cs`, text: bigText });
  }
  assert.throws(() => inspectClone({
    protocolVersion: 1, correlationId: uuid, type: "compile.request",
    payload: { compileId, assemblyName: "Test", sources, primarySourcePath: "file0.cs" },
  }), /MESSAGE_TOO_LARGE|SOURCE_TOO_LARGE|TOO_MANY_SOURCE_FILES/);
});

test("036: oversized source file is rejected as SOURCE_TOO_LARGE", () => {
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, correlationId: uuid, type: "compile.request",
    payload: {
      compileId, assemblyName: "Test",
      sources: [{ path: "big.cs", text: "x".repeat(LIMITS.sourceFile + 1) }],
      primarySourcePath: "big.cs",
    },
  }), /SOURCE_TOO_LARGE/);
});

test("036: oversized assembly is rejected as ASSEMBLY_TOO_LARGE", () => {
  const bigAssembly = new ArrayBuffer(LIMITS.assembly + 1);
  const pdb = new ArrayBuffer(64);
  assert.throws(() => validateBinaryPair(bigAssembly, pdb), /ASSEMBLY_TOO_LARGE/);
});

test("036: oversized PDB is rejected as PDB_TOO_LARGE", () => {
  const assembly = new ArrayBuffer(64);
  const bigPdb = new ArrayBuffer(LIMITS.pdb + 1);
  assert.throws(() => validateBinaryPair(assembly, bigPdb), /PDB_TOO_LARGE/);
});

test("036: aggregate binary exceeding limit is BINARY_PAYLOAD_TOO_LARGE", () => {
  const assembly = new ArrayBuffer(LIMITS.assembly);
  const pdb = new ArrayBuffer(LIMITS.pdb);
  assert.throws(() => validateBinaryPair(assembly, pdb), /BINARY_PAYLOAD_TOO_LARGE/);
});

test("036: empty assembly or PDB is rejected as MALFORMED_PAYLOAD", () => {
  assert.throws(() => validateBinaryPair(new ArrayBuffer(0), new ArrayBuffer(64)), /MALFORMED_PAYLOAD/);
  assert.throws(() => validateBinaryPair(new ArrayBuffer(64), new ArrayBuffer(0)), /MALFORMED_PAYLOAD/);
});

test("036: aliased assembly === pdb is rejected as MALFORMED_PAYLOAD", () => {
  const buf = new ArrayBuffer(64);
  assert.throws(() => validateBinaryPair(buf, buf), /MALFORMED_PAYLOAD/);
});

test("036: SharedArrayBuffer is rejected by inspectClone", () => {
  if (typeof SharedArrayBuffer !== "undefined") {
    assert.throws(() => inspectClone({ shared: new SharedArrayBuffer(8) }), /MALFORMED_PAYLOAD/);
  }
});

test("036: typed array view in envelope is rejected", () => {
  const buffer = new ArrayBuffer(8);
  assert.throws(() => inspectClone({ view: new Uint8Array(buffer) }), /MALFORMED_PAYLOAD/);
});

test("036: DataView in envelope is rejected by inspectClone", () => {
  const buffer = new ArrayBuffer(8);
  assert.throws(() => inspectClone({ view: new DataView(buffer) }), /MALFORMED_PAYLOAD/);
});

test("036: cyclic object is rejected by inspectClone", () => {
  const cycle: Record<string, unknown> = { a: 1 };
  cycle.self = cycle;
  assert.throws(() => inspectClone(cycle), /MALFORMED_PAYLOAD/);
});

test("036: accessor property is rejected by inspectClone", () => {
  const obj = {};
  Object.defineProperty(obj, "trap", { get: () => "evil", enumerable: true });
  assert.throws(() => inspectClone(obj), /MALFORMED_PAYLOAD/);
});

test("036: symbol key is rejected by inspectClone", () => {
  const obj = { [Symbol("trap")]: "value" };
  assert.throws(() => inspectClone(obj), /MALFORMED_PAYLOAD/);
});

test("036: function value is rejected by inspectClone", () => {
  assert.throws(() => inspectClone({ fn: () => {} }), /MALFORMED_PAYLOAD/);
});

test("036: non-Object.prototype object is rejected", () => {
  class Evil { protocolVersion = 1; }
  assert.throws(() => inspectClone(new Evil()), /MALFORMED_PAYLOAD/);
});

test("036: duplicate correlation ID on endpoint is rejected without side effects", async () => {
  const channel = new MessageChannel();
  let loadCalls = 0;
  const endpoint = createPreviewEndpoint({
    port: channel.port2,
    previewId: uuid,
    execute: async () => {
      loadCalls += 1;
      return { result: { success: true, data: { previewId: uuid, compileId } } };
    },
  });
  channel.port2.addEventListener("message", endpoint.handle);
  channel.port2.start();
  const assembly = standaloneBuffer(new Uint8Array([77, 90, 0, 0]));
  const pdb = standaloneBuffer(new Uint8Array([66, 83, 74, 66]));
  const proofData = {
    assemblySha256: digest, pdbSha256: digest,
    assemblyByteLength: 4, pdbByteLength: 4,
    assemblyName: "Test", sourcePaths: ["a.cs"], primarySourcePath: "a.cs",
  };
  const request = {
    protocolVersion: 1, correlationId: uuid, type: "preview.load.request",
    payload: { previewId: uuid, compileId, assembly, pdb, binaryProof: proofData },
  };
  channel.port1.postMessage(request, [assembly, pdb]);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(loadCalls, 1);
  // Second message with same correlationId — should be rejected as duplicate
  const assembly2 = standaloneBuffer(new Uint8Array([77, 90, 0, 0]));
  const pdb2 = standaloneBuffer(new Uint8Array([66, 83, 74, 66]));
  const duplicateRequest = {
    ...request,
    payload: { ...request.payload, assembly: assembly2, pdb: pdb2 },
  };
  channel.port1.postMessage(duplicateRequest, [assembly2, pdb2]);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(loadCalls, 1); // execute must not be called again
  assert.equal(endpoint.completed.has(uuid), true);
  endpoint.close("test");
  channel.port1.close();
});

test("036: endpoint rejects forged envelope errors without crash or amplification", async () => {
  const channel = new MessageChannel();
  let loadCalls = 0;
  const proof = { errors: [] as string[], terminals: [] as string[], closes: [] as string[], events: [] as unknown[], duplicateControls: [] as string[] };
  const endpoint = createPreviewEndpoint({
    port: channel.port2,
    previewId: uuid,
    execute: async () => {
      loadCalls += 1;
      return { result: { success: true, data: { previewId: uuid, compileId } } };
    },
    proof,
  });
  channel.port2.addEventListener("message", endpoint.handle);
  channel.port2.start();

  // 1. Missing protocolVersion
  channel.port1.postMessage({ correlationId: uuid, type: "preview.load.request", payload: {} });
  await new Promise(resolve => setTimeout(resolve, 20));

  // 2. Wrong version
  channel.port1.postMessage({ protocolVersion: 99, correlationId: uuid, type: "preview.load.request", payload: {} });
  await new Promise(resolve => setTimeout(resolve, 20));

  // 3. Unknown type
  channel.port1.postMessage({ protocolVersion: 1, correlationId: uuid, type: "attack.evil", payload: {} });
  await new Promise(resolve => setTimeout(resolve, 20));

  // 4. Non-object
  channel.port1.postMessage("just a string");
  await new Promise(resolve => setTimeout(resolve, 20));

  // 5. Null
  channel.port1.postMessage(null);
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(loadCalls, 0); // No execute call from any forged message
  assert.equal(endpoint.closed, false); // Endpoint survived all attacks
  endpoint.close("test");
  channel.port1.close();
});

test("036: bootstrap rejects wrong source, wrong origin, missing ports, and bad data", () => {
  const originalWindow = globalThis.window;
  const fakeWindow = new EventTarget();
  Object.assign(globalThis, { window: fakeWindow });
  const expectedSource = {};
  const wrongSource = {};
  const channel = new MessageChannel();
  let accepted = 0;
  try {
    const observations = installPrivatePortBootstrap({
      expectedSource, expectedOrigin: "tauri://localhost",
      onPort: () => { accepted += 1; },
    });
    const dispatch = (source: object, origin: string, data: object, ports: MessagePort[]) => {
      const event = new Event("message");
      Object.defineProperties(event, {
        source: { value: source }, origin: { value: origin },
        data: { value: data }, ports: { value: ports },
      });
      fakeWindow.dispatchEvent(event);
    };
    // Wrong source
    dispatch(wrongSource, "tauri://localhost",
      { type: "protocol.bootstrap", contextGeneration: uuid }, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 1);

    // Wrong origin
    dispatch(expectedSource, "https://evil.example",
      { type: "protocol.bootstrap", contextGeneration: uuid }, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 2);

    // Missing contextGeneration
    dispatch(expectedSource, "tauri://localhost",
      { type: "protocol.bootstrap" }, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 3);

    // No ports
    dispatch(expectedSource, "tauri://localhost",
      { type: "protocol.bootstrap", contextGeneration: uuid }, []);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 4);

    // Wrong type
    dispatch(expectedSource, "tauri://localhost",
      { type: "evil.bootstrap", contextGeneration: uuid }, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 5);

    // Non-object data
    dispatch(expectedSource, "tauri://localhost",
      "just a string" as unknown as object, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 6);

    // Null data
    dispatch(expectedSource, "tauri://localhost", null as unknown as object, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 7);

    // Non-plain-object prototype
    const exotic = Object.create(EventTarget.prototype);
    exotic.type = "protocol.bootstrap";
    exotic.contextGeneration = uuid;
    dispatch(expectedSource, "tauri://localhost", exotic, [channel.port1]);
    assert.equal(accepted, 0);
    assert.equal(observations.invalidBootstrapMessages, 8);

    // Valid bootstrap still works after rejections
    const goodChannel = new MessageChannel();
    dispatch(expectedSource, "tauri://localhost",
      { type: "protocol.bootstrap", contextGeneration: uuid }, [goodChannel.port1]);
    assert.equal(accepted, 1);
    assert.equal(observations.acceptedBootstrapMessages, 1);

    // Post-bootstrap message from correct source closes port
    dispatch(expectedSource, "tauri://localhost", { type: "late.attack" }, []);
    assert.equal(observations.postBootstrapRejectedMessages, 1);

    goodChannel.port2.close();
  } finally {
    channel.port2.close();
    Object.assign(globalThis, { window: originalWindow });
  }
});

test("036: ProtocolPortClient rejects malformed port messages without crash", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);

  // Non-UUID correlation — closes client
  channel.port2.postMessage({ correlationId: "bad", type: "preview.load.response", result: {} });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(client.isClosed, true);
  assert.match(client.closeReason ?? "", /MALFORMED/);
  channel.port2.close();
});

test("036: ProtocolPortClient discards protocol.error control events without crashing", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);

  channel.port2.postMessage({
    protocolVersion: 1, correlationId: uuid, type: "protocol.error",
    payload: { error: { code: "UNSUPPORTED_PROTOCOL_VERSION", message: "test" } },
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(client.isClosed, false);
  assert.equal(client.observations.protocolControls, 1);
  assert.equal(client.controlEvents.length, 1);
  client.close("test");
  channel.port2.close();
});

test("036: endpoint issues protocol.error for wrong version then continues", async () => {
  const channel = new MessageChannel();
  const responses: unknown[] = [];
  channel.port1.addEventListener("message", event => responses.push(event.data));
  channel.port1.start();

  const endpoint = createPreviewEndpoint({
    port: channel.port2,
    previewId: uuid,
    execute: async () => ({
      result: { success: true, data: { previewId: uuid, compileId } },
    }),
  });
  channel.port2.addEventListener("message", endpoint.handle);
  channel.port2.start();

  // Send wrong version
  channel.port1.postMessage({
    protocolVersion: 99, correlationId: uuid, type: "preview.load.request", payload: {},
  });
  await new Promise(resolve => setTimeout(resolve, 30));

  // Expect a protocol.error response (not a terminal response)
  assert.equal(responses.length >= 1, true);
  const errorResponse = responses[0] as Record<string, unknown>;
  assert.equal(errorResponse.type, "protocol.error");
  assert.equal(
    ((errorResponse.payload as Record<string, unknown>)?.error as Record<string, unknown>)?.code,
    "UNSUPPORTED_PROTOCOL_VERSION",
  );

  // Endpoint is not closed — can still process valid requests
  assert.equal(endpoint.closed, false);
  endpoint.close("test");
  channel.port1.close();
});

test("036: unpaired surrogates in string values are rejected by utf8Length", () => {
  assert.throws(() => inspectClone({ text: "\uD800" }), /MALFORMED_PAYLOAD/);
  assert.throws(() => inspectClone({ text: "\uDC00" }), /MALFORMED_PAYLOAD/);
  assert.throws(() => inspectClone({ text: "valid\uD800trailing" }), /MALFORMED_PAYLOAD/);
});

test("036: stale response after timeout is discarded by ProtocolPortClient", async () => {
  const channel = new MessageChannel();
  const client = new ProtocolPortClient(channel.port1, uuid);

  const request = {
    protocolVersion: 1, correlationId: uuid, type: "preview.start.request",
    payload: { previewId: uuid },
  };
  const promise = client.request(request, "preview.start.response",
    value => validatePreviewStartResponse(value, uuid, uuid), [], 50);
  await assert.rejects(promise, /TIMEOUT/);

  // Late response arrives after timeout
  channel.port2.postMessage({
    protocolVersion: 1, correlationId: uuid, type: "preview.start.response",
    result: { success: true, data: { previewId: uuid, accepted: true } },
  });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(client.observations.discardedUnknownOrLate, 1);
  assert.equal(client.completed.has(uuid), true);
  client.close("test");
  channel.port2.close();
});

test("036: Infinity and NaN numbers are rejected by inspectClone", () => {
  assert.throws(() => inspectClone({ n: Infinity }), /MALFORMED_PAYLOAD/);
  assert.throws(() => inspectClone({ n: -Infinity }), /MALFORMED_PAYLOAD/);
  assert.throws(() => inspectClone({ n: NaN }), /MALFORMED_PAYLOAD/);
});

test("036: BigInt values are rejected by inspectClone", () => {
  assert.throws(() => inspectClone({ n: BigInt(42) }), /MALFORMED_PAYLOAD/);
});

test("036: sparse array is rejected by requireDenseOwnArray via validateCompileRequest", () => {
  const sparse = new Array(3);
  sparse[0] = { path: "a.cs", text: "x" };
  sparse[2] = { path: "b.cs", text: "y" };
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, correlationId: uuid, type: "compile.request",
    payload: { compileId, assemblyName: "Test", sources: sparse, primarySourcePath: "a.cs" },
  }), /MALFORMED_PAYLOAD/);
});

test("036: path traversal in source paths is rejected", () => {
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, correlationId: uuid, type: "compile.request",
    payload: {
      compileId, assemblyName: "Test",
      sources: [{ path: "../etc/passwd", text: "x" }],
      primarySourcePath: "../etc/passwd",
    },
  }), /MALFORMED_PAYLOAD/);
});

test("036: oversized output text is rejected as MALFORMED_PAYLOAD", () => {
  assert.throws(() => validatePreviewOutputEvent({
    protocolVersion: 1, correlationId: uuid, type: "preview.output",
    payload: {
      previewId: uuid, sequence: 1, source: "managed",
      stream: "stdout", category: "console",
      text: "x".repeat(LIMITS.outputText + 1),
    },
  }, uuid, uuid), /MALFORMED_PAYLOAD/);
});

test("036: timeout above maximum is rejected", () => {
  assert.throws(() => validateCompileRequest({
    protocolVersion: 1, correlationId: uuid, type: "compile.request",
    payload: {
      compileId, assemblyName: "Test",
      sources: [{ path: "a.cs", text: "x" }],
      primarySourcePath: "a.cs",
      timeoutMs: MAX_TIMEOUTS_MS["compile.request"] + 1,
    },
  }), /MALFORMED_PAYLOAD/);
});

test("036: message size uses actual ArrayBuffer.byteLength, not JSON approximation", () => {
  const smallBuf = new ArrayBuffer(64);
  const observation = inspectClone({ binary: smallBuf });
  assert.equal(observation.binaryCount, 1);
  assert.ok(observation.measuredBytes >= 64);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  createLanguageServiceClient,
  createLanguageServiceEndpoint,
} from "../../shared/LanguageServiceProtocol.js";
import { validateCompileRequest } from "./protocol.ts";

const sessionId = "11111111-1111-4111-8111-111111111111";
const uri = "playground-model://folder-sha256-demo/Game.cs";
const source = {
  sessionId,
  uri,
  path: "Game.cs",
  version: 1,
  text: "class Game { Player player = new Player(); }",
};

function request(type: string, payload: unknown, number: number) {
  return {
    protocolVersion: 1,
    correlationId: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    type,
    payload,
  };
}

test("language session/document trace is idempotent and orders completion items", async () => {
  const endpoint = createLanguageServiceEndpoint({
    complete: () => [
      { label: "ToString", kind: "method" },
      { label: "Score", kind: "field" },
    ],
  });
  const opened = await endpoint.handle(request("language.session.open.request", { sessionId }, 1));
  assert.equal(opened.result.success, true);
  const document = await endpoint.handle(request("language.document.open.request", source, 2));
  assert.equal(document.result.success, true);
  const repeated = await endpoint.handle(request("language.document.open.request", source, 3));
  assert.equal(repeated.result.success, true);

  const completion = await endpoint.handle(request("language.completion.request", {
    sessionId,
    uri,
    version: 1,
    position: { offset: source.text.length, line: 1, column: source.text.length + 1 },
  }, 4));
  assert.equal(completion.result.success, true);
  assert.deepEqual(completion.result.data.items.map(item => item.label), ["Score", "ToString"]);
});

test("stale and conflicting document versions are rejected", async () => {
  const endpoint = createLanguageServiceEndpoint();
  await endpoint.handle(request("language.session.open.request", { sessionId }, 10));
  await endpoint.handle(request("language.document.open.request", source, 11));

  const advanced = await endpoint.handle(request("language.document.replace.request", {
    ...source, version: 2, text: "new version",
  }, 12));
  assert.equal(advanced.result.success, true);

  const stale = await endpoint.handle(request("language.document.replace.request", {
    ...source, version: 1, text: "old",
  }, 13));
  assert.equal(stale.result.success, false);
  assert.equal(stale.result.error.code, "STALE_DOCUMENT_VERSION");

  const conflict = await endpoint.handle(request("language.document.replace.request", {
    ...source, version: 2, text: "different",
  }, 14));
  assert.equal(conflict.result.success, false);
  assert.equal(conflict.result.error.code, "DOCUMENT_VERSION_CONFLICT");

  const staleCompletion = await endpoint.handle(request("language.completion.request", {
    sessionId, uri, version: 1, position: { offset: 1, line: 1, column: 2 },
  }, 15));
  assert.equal(staleCompletion.result.success, false);
  assert.equal(staleCompletion.result.error.code, "STALE_DOCUMENT_VERSION");
});

test("malformed, oversized, duplicate, and preview-route traffic is rejected", async () => {
  const endpoint = createLanguageServiceEndpoint();
  const missingVersion = await endpoint.handle({
    correlationId: sessionId,
    type: "language.session.open.request",
    payload: { sessionId },
  });
  assert.equal(missingVersion.type, "protocol.error");
  assert.equal(missingVersion.payload.error.code, "MISSING_PROTOCOL_VERSION");

  const oversized = await endpoint.handle(request("language.document.open.request", {
    ...source, text: "x".repeat(1024 * 1024 + 1),
  }, 20));
  assert.equal(oversized.type, "protocol.error");
  assert.equal(oversized.payload.error.code, "DOCUMENT_TEXT_TOO_LARGE");

  const endpoint2 = createLanguageServiceEndpoint();
  const first = await endpoint2.handle(request("language.session.open.request", { sessionId }, 21));
  assert.equal(first.result.success, true);
  const duplicate = await endpoint2.handle(request("language.session.open.request", { sessionId }, 21));
  assert.equal(duplicate.type, "protocol.error");
  assert.equal(duplicate.payload.error.code, "DUPLICATE_CORRELATION_ID");

  assert.throws(() => validateCompileRequest(request(
    "language.completion.request",
    { sessionId, uri, version: 1, position: { offset: 0, line: 1, column: 1 } },
    22,
  )), /UNKNOWN_MESSAGE_TYPE|MESSAGE_ROUTE_REJECTED/);
});

test("client suppresses a late completion after a newer request", async () => {
  const endpoint = createLanguageServiceEndpoint({ complete: () => [{ label: "Score", kind: "field" }] });
  const originalSend = async message => endpoint.handle(message);
  const delayed = [];
  const client = createLanguageServiceClient({
    sessionId,
    send: message => message.type === "language.completion.request"
      ? new Promise(resolve => delayed.push({ message, resolve }))
      : originalSend(message),
  });
  await client.open();
  await client.openDocument(source);

  const first = client.complete(uri, 1, { offset: 1, line: 1, column: 2 });
  const second = client.complete(uri, 1, { offset: 2, line: 1, column: 3 });
  assert.equal(delayed.length, 2);
  delayed[1].resolve(await endpoint.handle(delayed[1].message));
  delayed[0].resolve(await endpoint.handle(delayed[0].message));

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.superseded, true);
  assert.equal(secondResult.superseded, false);
  assert.equal(secondResult.result.result.success, true);
});

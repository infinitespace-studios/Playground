// Backend-neutral language-service protocol prototype (issue 071).
//
// This module is deliberately separate from ProtocolEndpoints.js: the existing
// compiler/preview transport does not accept language-service message types.
// A later compiler-context integration can adopt these envelopes after the
// direct SemanticModel backend is wired behind a trusted compiler route.

export const LANGUAGE_PROTOCOL_VERSION = 1;
export const LANGUAGE_LIMITS = Object.freeze({
  maxDocuments: 256,
  maxSessionBytes: 8 * 1024 * 1024,
  maxDocumentBytes: 1 * 1024 * 1024,
  maxUriBytes: 512,
  maxPathBytes: 512,
  maxCompletionItems: 100,
  maxCompletionLabelBytes: 256,
  maxCompletionDetailBytes: 512,
  maxCompletionRequestTimeoutMs: 2000,
  minTimeoutMs: 100,
});

export const LANGUAGE_REQUEST_TYPES = Object.freeze([
  "language.session.open.request",
  "language.session.close.request",
  "language.document.open.request",
  "language.document.replace.request",
  "language.document.close.request",
  "language.completion.request",
]);

export const LANGUAGE_RESPONSE_TYPES = Object.freeze([
  "language.session.open.response",
  "language.session.close.response",
  "language.document.open.response",
  "language.document.replace.response",
  "language.document.close.response",
  "language.completion.response",
]);

const requestTypes = new Set(LANGUAGE_REQUEST_TYPES);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

function error(code, message, details) {
  const result = { code, message };
  if (details) result.details = details;
  return result;
}

function fail(code, message, details) {
  throw Object.assign(new Error(code), { protocolMessage: message, details });
}

function bytes(value, limit, code = "FIELD_TOO_LARGE") {
  if (typeof value !== "string") fail("MALFORMED_PAYLOAD", "Expected a string.");
  const length = encoder.encode(value).byteLength;
  if (length > limit) fail(code, `String exceeds the ${limit}-byte limit.`);
  return length;
}

function object(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail("MALFORMED_PAYLOAD", "Expected a plain object.");
  }
  return value;
}

function own(value, fields) {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) fail("MALFORMED_PAYLOAD", `Missing ${field}.`);
  }
}

function uuid(value, field) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    fail("MALFORMED_PAYLOAD", `${field} must be a canonical UUIDv4.`);
  }
}

function version(value, field = "version") {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail("MALFORMED_PAYLOAD", `${field} must be a positive safe integer.`);
  }
}

function canonicalPath(value, field) {
  bytes(value, LANGUAGE_LIMITS.maxPathBytes);
  if (!value || value.startsWith("/") || value.endsWith("/") || value.includes("\\") ||
      value.includes(":") || value.includes("%") || value.includes("?") || value.includes("#") ||
      value.split("/").some(segment => segment === "" || segment === "." || segment === "..")) {
    fail("MALFORMED_PAYLOAD", `${field} must be a canonical relative path.`);
  }
}

function documentUri(value) {
  bytes(value, LANGUAGE_LIMITS.maxUriBytes);
  if (!value.startsWith("playground-model://") || value.includes("\\") || value.includes("..")) {
    fail("MALFORMED_PAYLOAD", "uri must be a stable playground-model URI.");
  }
}

function text(value) {
  return bytes(value, LANGUAGE_LIMITS.maxDocumentBytes, "DOCUMENT_TEXT_TOO_LARGE");
}

function timeout(value) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < LANGUAGE_LIMITS.minTimeoutMs ||
      value > LANGUAGE_LIMITS.maxCompletionRequestTimeoutMs) {
    fail("MALFORMED_PAYLOAD", "timeoutMs is outside the language-service range.");
  }
}

function snapshot(value, requireSession = true) {
  object(value);
  own(value, ["uri", "path", "version", "text"]);
  documentUri(value.uri);
  canonicalPath(value.path, "path");
  version(value.version);
  text(value.text);
  return value;
}

function validateSessionPayload(type, payload) {
  object(payload);
  if (type === "language.session.open.request") {
    own(payload, ["sessionId"]);
    uuid(payload.sessionId, "sessionId");
    if (payload.documents !== undefined) {
      if (!Array.isArray(payload.documents) || payload.documents.length > LANGUAGE_LIMITS.maxDocuments) {
        fail("TOO_MANY_DOCUMENTS", "Too many documents in session open.");
      }
      const seen = new Set();
      let total = 0;
      for (const document of payload.documents) {
        snapshot(document, false);
        if (seen.has(document.uri)) fail("DOCUMENT_VERSION_CONFLICT", "Duplicate document URI.");
        seen.add(document.uri);
        total += encoder.encode(document.text).byteLength;
      }
      if (total > LANGUAGE_LIMITS.maxSessionBytes) fail("LANGUAGE_SESSION_CONFLICT", "Session text exceeds its aggregate limit.");
    }
    return payload;
  }
  own(payload, ["sessionId"]);
  uuid(payload.sessionId, "sessionId");
  if (type === "language.session.close.request") return payload;

  if (type === "language.document.open.request" || type === "language.document.replace.request") {
    own(payload, ["sessionId", "uri", "path", "version", "text"]);
    uuid(payload.sessionId, "sessionId");
    return snapshot(payload);
  }
  if (type === "language.document.close.request") {
    own(payload, ["sessionId", "uri", "version"]);
    uuid(payload.sessionId, "sessionId");
    documentUri(payload.uri);
    version(payload.version);
    return payload;
  }
  if (type === "language.completion.request") {
    own(payload, ["sessionId", "uri", "version", "position"]);
    uuid(payload.sessionId, "sessionId");
    documentUri(payload.uri);
    version(payload.version);
    object(payload.position);
    own(payload.position, ["offset", "line", "column"]);
    if (!Number.isSafeInteger(payload.position.offset) || payload.position.offset < 0 ||
        !Number.isSafeInteger(payload.position.line) || payload.position.line < 1 ||
        !Number.isSafeInteger(payload.position.column) || payload.position.column < 1) {
      fail("MALFORMED_PAYLOAD", "position must contain non-negative offset and positive line/column.");
    }
    timeout(payload.timeoutMs);
    return payload;
  }
  fail("UNKNOWN_MESSAGE_TYPE", `Unknown language request type: ${type}.`);
}

export function validateLanguageRequest(value) {
  object(value);
  if (!Object.hasOwn(value, "protocolVersion")) fail("MISSING_PROTOCOL_VERSION", "protocolVersion is required.");
  own(value, ["correlationId", "type", "payload"]);
  if (value.protocolVersion !== LANGUAGE_PROTOCOL_VERSION) {
    fail(value.protocolVersion === undefined ? "MISSING_PROTOCOL_VERSION" : "UNSUPPORTED_PROTOCOL_VERSION", "Unsupported language protocol version.");
  }
  uuid(value.correlationId, "correlationId");
  if (typeof value.type !== "string" || !requestTypes.has(value.type)) {
    fail("UNKNOWN_MESSAGE_TYPE", "Unknown language-service message type.");
  }
  validateSessionPayload(value.type, value.payload);
  return value;
}

function responseTypeFor(requestType) {
  return requestType.replace(".request", ".response");
}

function response(request, data) {
  return {
    protocolVersion: LANGUAGE_PROTOCOL_VERSION,
    correlationId: request.correlationId,
    type: responseTypeFor(request.type),
    result: { success: true, data },
  };
}

function failure(request, protocolError) {
  return {
    protocolVersion: LANGUAGE_PROTOCOL_VERSION,
    correlationId: request.correlationId,
    type: responseTypeFor(request.type),
    result: { success: false, error: protocolError },
  };
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length > LANGUAGE_LIMITS.maxCompletionItems) {
    fail("TOO_MANY_COMPLETION_ITEMS", "Completion result exceeds the item limit.");
  }
  const seen = new Set();
  return items.map(raw => {
    object(raw);
    own(raw, ["label", "kind"]);
    bytes(raw.label, LANGUAGE_LIMITS.maxCompletionLabelBytes);
    if (typeof raw.kind !== "string") fail("MALFORMED_PAYLOAD", "Completion kind must be a string.");
    if (raw.detail !== undefined) bytes(raw.detail, LANGUAGE_LIMITS.maxCompletionDetailBytes);
    if (raw.sortText !== undefined) bytes(raw.sortText, LANGUAGE_LIMITS.maxCompletionLabelBytes);
    if (seen.has(raw.label)) fail("MALFORMED_PAYLOAD", "Completion labels must be unique.");
    seen.add(raw.label);
    return { label: raw.label, kind: raw.kind, ...(raw.detail === undefined ? {} : { detail: raw.detail }), ...(raw.sortText === undefined ? {} : { sortText: raw.sortText }) };
  }).sort((left, right) =>
    (left.sortText ?? left.label).localeCompare(right.sortText ?? right.label) ||
    left.label.localeCompare(right.label) || left.kind.localeCompare(right.kind));
}

export function createLanguageServiceEndpoint({ complete = null } = {}) {
  const sessions = new Map();
  const completed = new Set();
  const generations = new Map();

  function sessionKey(sessionId, uri) { return `${sessionId}\u0000${uri}`; }
  function bump(sessionId, uri) {
    const key = sessionKey(sessionId, uri);
    const next = (generations.get(key) ?? 0) + 1;
    generations.set(key, next);
    return next;
  }
  function currentGeneration(sessionId, uri) { return generations.get(sessionKey(sessionId, uri)) ?? 0; }
  function storedSnapshot(document) {
    return { uri: document.uri, path: document.path, version: document.version, text: document.text };
  }
  function sessionOrFail(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) throw Object.assign(new Error("LANGUAGE_SESSION_NOT_FOUND"), { protocolMessage: "Language session was not opened." });
    return session;
  }
  function documentOrFail(session, uri) {
    const document = session.documents.get(uri);
    if (!document) throw Object.assign(new Error("DOCUMENT_NOT_FOUND"), { protocolMessage: "Language document was not opened." });
    return document;
  }
  function applyDocument(session, payload, replace) {
    const existing = session.documents.get(payload.uri);
    if (!existing && replace) throw Object.assign(new Error("DOCUMENT_NOT_FOUND"), { protocolMessage: "Language document was not opened." });
    if (!existing && session.documents.size >= LANGUAGE_LIMITS.maxDocuments) {
      throw Object.assign(new Error("TOO_MANY_DOCUMENTS"), { protocolMessage: "Language session document limit exceeded." });
    }
    const currentBytes = [...session.documents.values()]
      .reduce((total, document) => total + encoder.encode(document.text).byteLength, 0);
    const nextBytes = currentBytes - (existing ? encoder.encode(existing.text).byteLength : 0) + encoder.encode(payload.text).byteLength;
    if (nextBytes > LANGUAGE_LIMITS.maxSessionBytes) {
      throw Object.assign(new Error("LANGUAGE_SESSION_CONFLICT"), { protocolMessage: "Language session text exceeds its aggregate limit." });
    }
    if (existing) {
      if (payload.version < existing.version) throw Object.assign(new Error("STALE_DOCUMENT_VERSION"), { protocolMessage: "Document version is stale.", details: { currentVersion: existing.version, requestedVersion: payload.version } });
      if (payload.version === existing.version) {
        if (existing.text !== payload.text || existing.path !== payload.path) throw Object.assign(new Error("DOCUMENT_VERSION_CONFLICT"), { protocolMessage: "Document version conflicts with stored text." });
        return existing;
      }
    }
    const next = { uri: payload.uri, path: payload.path, version: payload.version, text: payload.text };
    session.documents.set(payload.uri, next);
    bump(session.id, payload.uri);
    return next;
  }

  async function handle(raw) {
    let request;
    try { request = validateLanguageRequest(raw); }
    catch (caught) {
      const code = caught?.message && /^[A-Z_]+$/.test(caught.message) ? caught.message : "MALFORMED_PAYLOAD";
      return { type: "protocol.error", protocolVersion: LANGUAGE_PROTOCOL_VERSION, correlationId: crypto.randomUUID(), payload: { error: error(code, caught.protocolMessage ?? "Language request rejected.", caught.details), rejectedCorrelationId: raw?.correlationId, rejectedType: raw?.type } };
    }
    if (completed.has(request.correlationId)) {
      return { type: "protocol.error", protocolVersion: LANGUAGE_PROTOCOL_VERSION, correlationId: crypto.randomUUID(), payload: { error: error("DUPLICATE_CORRELATION_ID", "Request correlation ID was already observed."), rejectedCorrelationId: request.correlationId, rejectedType: request.type } };
    }
    completed.add(request.correlationId);
    try {
      const payload = request.payload;
      if (request.type === "language.session.open.request") {
        const existing = sessions.get(payload.sessionId);
        if (existing) {
          if (payload.documents?.some(document => {
            const current = existing.documents.get(document.uri);
            return current && (current.version !== document.version || current.text !== document.text);
          })) throw Object.assign(new Error("LANGUAGE_SESSION_CONFLICT"), { protocolMessage: "Session already exists with different documents." });
          return response(request, { sessionId: payload.sessionId, accepted: true });
        }
        const session = { id: payload.sessionId, documents: new Map() };
        sessions.set(payload.sessionId, session);
        for (const document of payload.documents ?? []) applyDocument(session, document, false);
        return response(request, { sessionId: payload.sessionId, accepted: true });
      }
      if (request.type === "language.session.close.request") {
        sessions.delete(payload.sessionId);
        return response(request, { sessionId: payload.sessionId, accepted: true });
      }
      const session = sessionOrFail(payload.sessionId);
      if (request.type === "language.document.open.request") return response(request, storedSnapshot(applyDocument(session, payload, false)));
      if (request.type === "language.document.replace.request") return response(request, storedSnapshot(applyDocument(session, payload, true)));
      if (request.type === "language.document.close.request") {
        const existing = session.documents.get(payload.uri);
        if (existing && payload.version < existing.version) throw Object.assign(new Error("STALE_DOCUMENT_VERSION"), { protocolMessage: "Document version is stale." });
        session.documents.delete(payload.uri);
        bump(session.id, payload.uri);
        return response(request, { sessionId: payload.sessionId, uri: payload.uri, version: payload.version, accepted: true });
      }
      if (request.type === "language.completion.request") {
        const document = documentOrFail(session, payload.uri);
        if (payload.version !== document.version) throw Object.assign(new Error("STALE_DOCUMENT_VERSION"), { protocolMessage: "Completion requested for a stale document version.", details: { currentVersion: document.version, requestedVersion: payload.version } });
        const generation = bump(session.id, payload.uri);
        if (!complete) throw Object.assign(new Error("COMPLETION_UNAVAILABLE"), { protocolMessage: "No completion backend is installed." });
        const items = normalizeItems(await complete({ sessionId: session.id, document: storedSnapshot(document), position: payload.position }));
        if (generation !== currentGeneration(session.id, payload.uri)) throw Object.assign(new Error("LANGUAGE_REQUEST_SUPERSEDED"), { protocolMessage: "A newer document request superseded this completion." });
        return response(request, { sessionId: session.id, uri: document.uri, version: document.version, items, isIncomplete: false });
      }
      throw new Error("UNKNOWN_MESSAGE_TYPE");
    } catch (caught) {
      const code = caught?.message && /^[A-Z_]+$/.test(caught.message) ? caught.message : "INTERNAL_ERROR";
      return failure(request, error(code, caught.protocolMessage ?? "Language request failed.", caught.details));
    }
  }
  return { handle, sessions, completed };
}

export function createLanguageServiceClient({ send, sessionId }) {
  uuid(sessionId, "sessionId");
  let sequence = 0;
  const latest = new Map();
  const request = (type, payload) => send({ protocolVersion: LANGUAGE_PROTOCOL_VERSION, correlationId: crypto.randomUUID(), type, payload });
  return {
    sessionId,
    open(documents = []) { return request("language.session.open.request", { sessionId, documents }); },
    close() { return request("language.session.close.request", { sessionId }); },
    openDocument(document) { return request("language.document.open.request", { sessionId, ...document }); },
    replaceDocument(document) { return request("language.document.replace.request", { sessionId, ...document }); },
    closeDocument(uri, version) { return request("language.document.close.request", { sessionId, uri, version }); },
    async complete(uri, version, position) {
      const key = `${uri}\u0000${version}`;
      const requestNumber = ++sequence;
      latest.set(uri, requestNumber);
      const result = await request("language.completion.request", { sessionId, uri, version, position });
      if (latest.get(uri) !== requestNumber) return { superseded: true, result: null };
      return { superseded: false, result };
    },
  };
}

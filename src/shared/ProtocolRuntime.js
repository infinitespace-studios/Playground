export const PROTOCOL_VERSION = 1;
export const LIMITS = Object.freeze({
  message: 32 * 1024 * 1024,
  sourceFiles: 64,
  sourceFile: 1024 * 1024,
  sourceAggregate: 4 * 1024 * 1024,
  path: 512,
  assemblyName: 128,
  assembly: 8 * 1024 * 1024,
  pdb: 8 * 1024 * 1024,
  binaryAggregate: 12 * 1024 * 1024,
  diagnostics: 2000,
  diagnosticId: 64,
  diagnosticMessage: 4096,
  outputText: 16 * 1024,
  errorMessage: 1024,
  errorDetails: 16 * 1024,
  errorDetailEntries: 32,
  errorDetailKey: 64,
  errorDetailString: 1024,
  rejectedType: 128,
  assets: 256,
  asset: 16 * 1024 * 1024,
  assetAggregate: 24 * 1024 * 1024,
  minTimeout: 100,
});
export const DEFAULT_TIMEOUTS_MS = Object.freeze({
  "compile.request": 10000, "compile.cancel.request": 2000,
  "asset.mount.request": 10000, "preview.load.request": 10000,
  "preview.start.request": 10000, "preview.stop.request": 2000,
});
export const MAX_TIMEOUTS_MS = Object.freeze({
  "compile.request": 30000, "compile.cancel.request": 2000,
  "asset.mount.request": 10000, "preview.load.request": 10000,
  "preview.start.request": 10000, "preview.stop.request": 2000,
});
export const PROTOCOL_ERROR_CODES = Object.freeze([
  "MISSING_PROTOCOL_VERSION", "UNSUPPORTED_PROTOCOL_VERSION", "MALFORMED_ENVELOPE",
  "MALFORMED_PAYLOAD", "UNKNOWN_MESSAGE_TYPE", "MESSAGE_SOURCE_REJECTED",
  "MESSAGE_ROUTE_REJECTED", "DUPLICATE_CORRELATION_ID", "INVALID_STATE", "TIMEOUT",
  "CANCELLED", "MESSAGE_TOO_LARGE", "FIELD_TOO_LARGE", "SOURCE_TOO_LARGE",
  "TOO_MANY_SOURCE_FILES", "TOO_MANY_DIAGNOSTICS", "ASSEMBLY_TOO_LARGE",
  "PDB_TOO_LARGE", "BINARY_PAYLOAD_TOO_LARGE", "TOO_MANY_ASSETS", "ASSET_TOO_LARGE",
  "ASSET_TOTAL_TOO_LARGE", "ASSET_PATH_INVALID", "ASSET_PATH_DUPLICATE",
  "DUPLICATE_MOUNT_ID", "ASSET_PATH_ALREADY_MOUNTED", "COMPILE_FAILED",
  "PREVIEW_LOAD_FAILED", "PREVIEW_START_FAILED", "PREVIEW_STOP_FAILED",
  "PREVIEW_RUNTIME_FAILED", "INTERNAL_ERROR",
]);
export const PLAYGROUND_DIAGNOSTIC_IDS = Object.freeze([
  "PG0001_NO_GAME_SUBCLASS", "PG0002_MULTIPLE_GAME_SUBCLASSES",
  "PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR", "PG0004_UNSUPPORTED_ASSEMBLY",
  "PG0005_UNSUPPORTED_NAMESPACE", "PG0006_UNSUPPORTED_API",
  "PG0007_DLLIMPORT_NOT_ALLOWED", "PG0008_UNMANAGED_CALLERS_ONLY_NOT_ALLOWED",
  "PG0009_UNSAFE_NATIVE_CALL_NOT_ALLOWED", "PG0010_CONTENT_PLATFORM_MISMATCH",
  "PG0101", "PG0102", "PG0103", "PG0104",
]);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();
const errorCodes = new Set(PROTOCOL_ERROR_CODES);
const playgroundIds = new Set(PLAYGROUND_DIAGNOSTIC_IDS);
const messageTypes = new Set([
  "compile.request", "compile.cancel.request", "asset.mount.request",
  "preview.load.request", "preview.start.request", "preview.stop.request",
  "compile.response", "compile.cancel.response", "asset.mount.response",
  "preview.load.response", "preview.start.response", "preview.stop.response",
  "preview.started", "preview.stopped", "preview.exited", "preview.failed",
  "preview.output", "protocol.error",
]);

export function isUuidV4(value) {
  return typeof value === "string" && uuidPattern.test(value);
}

export function utf8Length(value) {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  return encoder.encode(value).byteLength;
}

export function isCanonicalPath(path) {
  if (typeof path !== "string" || path.length === 0 || path.normalize("NFC") !== path ||
      path.startsWith("/") || path.endsWith("/") || /[\\:%?#\u0000-\u001f\u007f]/u.test(path)) {
    return false;
  }
  return path.split("/").every(segment => segment !== "" && segment !== "." && segment !== "..");
}

export function inspectClone(value) {
  const active = new Set();
  const objects = new Set();
  const binaries = new Set();
  let bytes = 0;
  let base64FieldCount = 0;
  let dataUrlCount = 0;

  const visit = item => {
    if (item === null) { bytes += 1; return; }
    if (typeof item === "string") {
      bytes += utf8Length(item);
      if (/^data:/iu.test(item)) dataUrlCount += 1;
      return;
    }
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error("MALFORMED_PAYLOAD");
      bytes += 8;
      return;
    }
    if (typeof item === "boolean") { bytes += 1; return; }
    if (typeof item === "undefined" || typeof item === "function" ||
        typeof item === "symbol" || typeof item === "bigint") {
      throw new Error("MALFORMED_PAYLOAD");
    }
    if (item instanceof ArrayBuffer) {
      if (item.byteLength === 0 || binaries.has(item)) throw new Error("MALFORMED_PAYLOAD");
      binaries.add(item);
      bytes += item.byteLength;
      return;
    }
    if (typeof SharedArrayBuffer !== "undefined" && item instanceof SharedArrayBuffer) {
      throw new Error("MALFORMED_PAYLOAD");
    }
    if (ArrayBuffer.isView(item) || active.has(item) || objects.has(item)) throw new Error("MALFORMED_PAYLOAD");
    const prototype = Object.getPrototypeOf(item);
    if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) {
      throw new Error("MALFORMED_PAYLOAD");
    }
    if (Object.getOwnPropertySymbols(item).length !== 0) throw new Error("MALFORMED_PAYLOAD");
    active.add(item);
    objects.add(item);
    bytes += 16;
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== "string" || !descriptor || !Object.hasOwn(descriptor, "value")) {
        throw new Error("MALFORMED_PAYLOAD");
      }
      bytes += utf8Length(key) + 8;
      if (/base64/iu.test(key)) base64FieldCount += 1;
      visit(descriptor.value);
    }
    active.delete(item);
  };
  visit(value);
  if (bytes > LIMITS.message) throw new Error("MESSAGE_TOO_LARGE");
  return { measuredBytes: bytes, binaryCount: binaries.size, base64FieldCount, dataUrlCount };
}

function requireObject(value, code = "MALFORMED_PAYLOAD") {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error(code);
  }
  return value;
}

function requireOwn(value, fields, code = "MALFORMED_PAYLOAD") {
  for (const field of fields) {
    if (!Object.hasOwn(value, field)) throw new Error(code);
  }
}

function rejectUnexpected(value, fields, code = "MALFORMED_PAYLOAD") {
  const allowed = new Set(fields);
  if (Object.keys(value).some(field => !allowed.has(field))) throw new Error(code);
}

function ownOptional(value, field) {
  return Object.hasOwn(value, field) ? value[field] : undefined;
}

function requireDenseOwnArray(value) {
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) throw new Error("MALFORMED_PAYLOAD");
  }
}

function validateEnvelope(value, expectedType, expectedCorrelationId) {
  const observation = inspectClone(value);
  const message = requireObject(value, "MALFORMED_ENVELOPE");
  if (!Object.hasOwn(message, "protocolVersion")) throw new Error("MISSING_PROTOCOL_VERSION");
  requireOwn(message, ["correlationId", "type"], "MALFORMED_ENVELOPE");
  if (!Number.isInteger(message.protocolVersion)) throw new Error("MALFORMED_ENVELOPE");
  if (message.protocolVersion !== PROTOCOL_VERSION) throw new Error("UNSUPPORTED_PROTOCOL_VERSION");
  if (!isUuidV4(message.correlationId)) throw new Error("MALFORMED_ENVELOPE");
  if (typeof message.type !== "string" || utf8Length(message.type) > LIMITS.rejectedType) {
    throw new Error("MALFORMED_ENVELOPE");
  }
  if (!messageTypes.has(message.type)) throw new Error("UNKNOWN_MESSAGE_TYPE");
  if (message.type !== expectedType) throw new Error("MESSAGE_ROUTE_REJECTED");
  if (expectedCorrelationId !== undefined && message.correlationId !== expectedCorrelationId) {
    throw new Error("MESSAGE_SOURCE_REJECTED");
  }
  return { message, observation };
}

function validateTimeout(value, maximum) {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < LIMITS.minTimeout || value > maximum) throw new Error("MALFORMED_PAYLOAD");
}

function validateSettings(value) {
  if (value === undefined) return;
  const settings = requireObject(value);
  requireOwn(settings, [
    "languageVersion", "nullable", "optimization", "allowUnsafe", "warningsAsErrors",
  ]);
  if (settings.languageVersion !== "13.0" || settings.nullable !== "disable" ||
      settings.optimization !== "debug" || settings.allowUnsafe !== false ||
      settings.warningsAsErrors !== false) {
    throw new Error("MALFORMED_PAYLOAD");
  }
}

function validateSources(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.sourceFiles) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  requireDenseOwnArray(value);
  const paths = new Set();
  let aggregate = 0;
  for (const raw of value) {
    const source = requireObject(raw);
    requireOwn(source, ["path", "text"]);
    if (!isCanonicalPath(source.path) || utf8Length(source.path) > LIMITS.path ||
        typeof source.text !== "string" || source.text.length === 0) {
      throw new Error("MALFORMED_PAYLOAD");
    }
    if (paths.has(source.path)) throw new Error("MALFORMED_PAYLOAD");
    paths.add(source.path);
    const length = utf8Length(source.text);
    if (length > LIMITS.sourceFile) throw new Error("SOURCE_TOO_LARGE");
    aggregate += length;
    if (aggregate > LIMITS.sourceAggregate) throw new Error("SOURCE_TOO_LARGE");
  }
}

export function validateCompileRequest(value) {
  const { message, observation } = validateEnvelope(value, "compile.request");
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["payload"], "MALFORMED_ENVELOPE");
  const payload = requireObject(message.payload);
  requireOwn(payload, ["compileId", "assemblyName", "sources", "primarySourcePath"]);
  if (!isUuidV4(payload.compileId) || typeof payload.assemblyName !== "string" ||
      payload.assemblyName.length === 0 ||
      utf8Length(payload.assemblyName) > LIMITS.assemblyName ||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(payload.assemblyName)) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  validateSources(payload.sources);
  if (typeof payload.primarySourcePath !== "string" ||
      !payload.sources.some(source => source.path === payload.primarySourcePath)) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  validateSettings(ownOptional(payload, "settings"));
  validateTimeout(ownOptional(payload, "timeoutMs"), MAX_TIMEOUTS_MS["compile.request"]);
  return { message, observation };
}

export function validateBinaryPair(assembly, pdb) {
  if (!(assembly instanceof ArrayBuffer) || !(pdb instanceof ArrayBuffer) ||
      assembly === pdb || assembly.byteLength === 0 || pdb.byteLength === 0) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  if (assembly.byteLength > LIMITS.assembly) throw new Error("ASSEMBLY_TOO_LARGE");
  if (pdb.byteLength > LIMITS.pdb) throw new Error("PDB_TOO_LARGE");
  if (assembly.byteLength + pdb.byteLength > LIMITS.binaryAggregate) {
    throw new Error("BINARY_PAYLOAD_TOO_LARGE");
  }
}

function diagnosticSortKey(diagnostic) {
  return [diagnostic.file, diagnostic.line, diagnostic.column, diagnostic.severity, diagnostic.id];
}

function compareDiagnostic(left, right) {
  const a = diagnosticSortKey(left);
  const b = diagnosticSortKey(right);
  for (let index = 0; index < a.length; index++) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

function validateDiagnostic(raw) {
  const diagnostic = requireObject(raw);
  requireOwn(diagnostic, ["origin", "severity", "id", "message", "file", "line", "column"]);
  if (!["compiler", "playground"].includes(diagnostic.origin) ||
      !["error", "warning", "info"].includes(diagnostic.severity) ||
      typeof diagnostic.id !== "string" || !/^[\x20-\x7e]{1,64}$/.test(diagnostic.id) ||
      (diagnostic.origin === "playground" && !playgroundIds.has(diagnostic.id)) ||
      typeof diagnostic.message !== "string" || diagnostic.message.length === 0 ||
      utf8Length(diagnostic.message) > LIMITS.diagnosticMessage ||
      typeof diagnostic.file !== "string" ||
      !Number.isSafeInteger(diagnostic.line) || diagnostic.line < 0 ||
      !Number.isSafeInteger(diagnostic.column) || diagnostic.column < 0) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  if (diagnostic.file !== "" && (!isCanonicalPath(diagnostic.file) || utf8Length(diagnostic.file) > LIMITS.path)) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  if ((diagnostic.file === "") !== (diagnostic.line === 0 && diagnostic.column === 0) ||
      (diagnostic.file !== "" && (diagnostic.line < 1 || diagnostic.column < 1))) {
    throw new Error("MALFORMED_PAYLOAD");
  }
}

function validateDiagnostics(value) {
  if (!Array.isArray(value) || value.length > LIMITS.diagnostics) throw new Error("MALFORMED_PAYLOAD");
  requireDenseOwnArray(value);
  value.forEach(validateDiagnostic);
  for (let index = 1; index < value.length; index++) {
    if (compareDiagnostic(value[index - 1], value[index]) > 0) throw new Error("MALFORMED_PAYLOAD");
  }
}

function validateError(raw) {
  const error = requireObject(raw);
  requireOwn(error, ["code", "message"]);
  if (!errorCodes.has(error.code) || typeof error.message !== "string" ||
      error.message.length === 0 || utf8Length(error.message) > LIMITS.errorMessage) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  const optionalDetails = ownOptional(error, "details");
  if (optionalDetails !== undefined) {
    const details = requireObject(optionalDetails);
    const entries = Object.entries(details);
    if (entries.length > LIMITS.errorDetailEntries ||
        inspectClone(details).measuredBytes > LIMITS.errorDetails ||
        entries.some(([key, value]) => key.length === 0 || utf8Length(key) > LIMITS.errorDetailKey ||
          !["string", "number", "boolean"].includes(typeof value) && value !== null ||
          typeof value === "string" && utf8Length(value) > LIMITS.errorDetailString ||
          typeof value === "number" && !Number.isFinite(value))) {
      throw new Error("MALFORMED_PAYLOAD");
    }
  }
  const optionalDiagnostics = ownOptional(error, "diagnostics");
  if (optionalDiagnostics !== undefined) {
    validateDiagnostics(optionalDiagnostics);
  }
}

function validateBinaryProof(raw, assembly, pdb) {
  const proof = requireObject(raw);
  requireOwn(proof, [
    "assemblySha256", "pdbSha256", "assemblyByteLength", "pdbByteLength",
    "assemblyName", "sourcePaths", "primarySourcePath",
  ]);
  if (!/^[0-9a-f]{64}$/.test(proof.assemblySha256) ||
      !/^[0-9a-f]{64}$/.test(proof.pdbSha256) ||
      proof.assemblyByteLength !== assembly.byteLength ||
      proof.pdbByteLength !== pdb.byteLength ||
      typeof proof.assemblyName !== "string" || proof.assemblyName.length === 0 ||
      utf8Length(proof.assemblyName) > LIMITS.assemblyName ||
      !/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(proof.assemblyName) ||
      !Array.isArray(proof.sourcePaths) || proof.sourcePaths.length === 0 ||
      proof.sourcePaths.length > LIMITS.sourceFiles) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  requireDenseOwnArray(proof.sourcePaths);
  const paths = new Set();
  for (const path of proof.sourcePaths) {
    if (!isCanonicalPath(path) || utf8Length(path) > LIMITS.path || paths.has(path)) {
      throw new Error("MALFORMED_PAYLOAD");
    }
    paths.add(path);
  }
  if (!paths.has(proof.primarySourcePath)) throw new Error("MALFORMED_PAYLOAD");
  return proof;
}

export function validateCompileResponse(value, correlationId, compileId, expectedBinaryIdentity) {
  const { message, observation } = validateEnvelope(value, "compile.response", correlationId);
  requireOwn(message, ["result"], "MALFORMED_ENVELOPE");
  const result = requireObject(message.result);
  requireOwn(result, ["success"]);
  if (typeof result.success !== "boolean") throw new Error("MALFORMED_PAYLOAD");
  if (!result.success) {
    if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
    requireOwn(result, ["error"]);
    validateError(result.error);
    return { message, observation };
  }
  requireOwn(result, ["data"]);
  const data = requireObject(result.data);
  requireOwn(data, ["compileId", "assembly", "pdb", "diagnostics", "binaryProof"]);
  if (data.compileId !== compileId) throw new Error("MESSAGE_SOURCE_REJECTED");
  validateDiagnostics(data.diagnostics);
  validateBinaryPair(data.assembly, data.pdb);
  if (observation.binaryCount !== 2) throw new Error("MALFORMED_PAYLOAD");
  const proof = validateBinaryProof(data.binaryProof, data.assembly, data.pdb);
  if (expectedBinaryIdentity &&
      (proof.assemblyName !== expectedBinaryIdentity.assemblyName ||
       proof.primarySourcePath !== expectedBinaryIdentity.primarySourcePath ||
       proof.sourcePaths.length !== expectedBinaryIdentity.sourcePaths.length ||
       proof.sourcePaths.some((path, index) => path !== expectedBinaryIdentity.sourcePaths[index]))) {
    throw new Error("MESSAGE_SOURCE_REJECTED");
  }
  return { message, observation };
}

export function validatePreviewLoadRequest(value, previewId) {
  const { message, observation } = validateEnvelope(value, "preview.load.request");
  requireOwn(message, ["payload"], "MALFORMED_ENVELOPE");
  const payload = requireObject(message.payload);
  requireOwn(payload, ["previewId", "compileId", "assembly", "pdb", "binaryProof"]);
  if (payload.previewId !== previewId || !isUuidV4(payload.compileId)) throw new Error("MESSAGE_SOURCE_REJECTED");
  validateTimeout(ownOptional(payload, "timeoutMs"), MAX_TIMEOUTS_MS["preview.load.request"]);
  validateBinaryPair(payload.assembly, payload.pdb);
  if (observation.binaryCount !== 2) throw new Error("MALFORMED_PAYLOAD");
  validateBinaryProof(payload.binaryProof, payload.assembly, payload.pdb);
  return { message, observation };
}

export function validatePreviewLoadResponse(value, correlationId, previewId, compileId) {
  const { message, observation } = validateEnvelope(value, "preview.load.response", correlationId);
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["result"], "MALFORMED_ENVELOPE");
  const result = requireObject(message.result);
  requireOwn(result, ["success"]);
  if (typeof result.success !== "boolean") throw new Error("MALFORMED_PAYLOAD");
  if (!result.success) {
    requireOwn(result, ["error"]);
    validateError(result.error);
    return { message, observation };
  }
  requireOwn(result, ["data"]);
  const data = requireObject(result.data);
  requireOwn(data, ["previewId", "compileId"]);
  if (data.previewId !== previewId || data.compileId !== compileId) throw new Error("MESSAGE_SOURCE_REJECTED");
  return { message, observation };
}

export function validatePreviewStartRequest(value, previewId) {
  const { message, observation } = validateEnvelope(value, "preview.start.request");
  rejectUnexpected(message, ["protocolVersion", "correlationId", "type", "payload"], "MALFORMED_ENVELOPE");
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["payload"], "MALFORMED_ENVELOPE");
  const payload = requireObject(message.payload);
  requireOwn(payload, ["previewId"]);
  if (Object.keys(payload).some(key => key !== "previewId" && key !== "timeoutMs")) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  if (payload.previewId !== previewId) throw new Error("MESSAGE_SOURCE_REJECTED");
  validateTimeout(ownOptional(payload, "timeoutMs"), MAX_TIMEOUTS_MS["preview.start.request"]);
  return { message, observation };
}

export function validatePreviewStartResponse(value, correlationId, previewId) {
  const { message, observation } = validateEnvelope(value, "preview.start.response", correlationId);
  rejectUnexpected(message, ["protocolVersion", "correlationId", "type", "result"], "MALFORMED_ENVELOPE");
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["result"], "MALFORMED_ENVELOPE");
  const result = requireObject(message.result);
  requireOwn(result, ["success"]);
  if (typeof result.success !== "boolean") throw new Error("MALFORMED_PAYLOAD");
  if (!result.success) {
    requireOwn(result, ["error"]);
    validateError(result.error);
    return { message, observation };
  }
  requireOwn(result, ["data"]);
  const data = requireObject(result.data);
  requireOwn(data, ["previewId", "accepted"]);
  if (Object.keys(data).some(key => key !== "previewId" && key !== "accepted")) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  if (data.previewId !== previewId) throw new Error("MESSAGE_SOURCE_REJECTED");
  if (data.accepted !== true) throw new Error("MALFORMED_PAYLOAD");
  return { message, observation };
}

export function validatePreviewStopRequest(value, previewId) {
  const { message, observation } = validateEnvelope(value, "preview.stop.request");
  rejectUnexpected(message, ["protocolVersion", "correlationId", "type", "payload"], "MALFORMED_ENVELOPE");
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["payload"], "MALFORMED_ENVELOPE");
  const payload = requireObject(message.payload);
  requireOwn(payload, ["previewId", "reason"]);
  rejectUnexpected(payload, ["previewId", "reason", "timeoutMs"]);
  if (payload.previewId !== previewId) throw new Error("MESSAGE_SOURCE_REJECTED");
  if (!["user", "restart", "exit-cleanup", "failure-cleanup"].includes(payload.reason)) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  validateTimeout(ownOptional(payload, "timeoutMs"), MAX_TIMEOUTS_MS["preview.stop.request"]);
  return { message, observation };
}

export function validatePreviewStopResponse(value, correlationId, previewId) {
  const { message, observation } = validateEnvelope(value, "preview.stop.response", correlationId);
  rejectUnexpected(message, ["protocolVersion", "correlationId", "type", "result"], "MALFORMED_ENVELOPE");
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["result"], "MALFORMED_ENVELOPE");
  const result = requireObject(message.result);
  requireOwn(result, ["success"]);
  if (typeof result.success !== "boolean") throw new Error("MALFORMED_PAYLOAD");
  if (!result.success) {
    requireOwn(result, ["error"]);
    validateError(result.error);
    return { message, observation };
  }
  requireOwn(result, ["data"]);
  const data = requireObject(result.data);
  requireOwn(data, ["previewId", "accepted", "alreadyStopped"]);
  rejectUnexpected(data, ["previewId", "accepted", "alreadyStopped"]);
  if (data.previewId !== previewId) throw new Error("MESSAGE_SOURCE_REJECTED");
  if (typeof data.accepted !== "boolean" || typeof data.alreadyStopped !== "boolean" ||
      data.accepted === data.alreadyStopped) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  return { message, observation };
}

export function validatePreviewLifecycleEvent(value, previewId, expectedCorrelationId) {
  const expectedType = value?.type;
  if (!["preview.started", "preview.failed", "preview.stopped"].includes(expectedType)) {
    throw new Error("MESSAGE_ROUTE_REJECTED");
  }
  const { message, observation } =
    validateEnvelope(value, expectedType, expectedCorrelationId);
  rejectUnexpected(message, ["protocolVersion", "correlationId", "type", "payload"], "MALFORMED_ENVELOPE");
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["payload"], "MALFORMED_ENVELOPE");
  const payload = requireObject(message.payload);
  if (expectedType === "preview.started") {
    requireOwn(payload, ["previewId", "sequence"]);
    rejectUnexpected(payload, ["previewId", "sequence"]);
  } else if (expectedType === "preview.failed") {
    requireOwn(payload, ["previewId", "sequence", "phase", "error"]);
    rejectUnexpected(payload, ["previewId", "sequence", "phase", "error"]);
    if (!["load", "start", "running", "stop"].includes(payload.phase)) {
      throw new Error("MALFORMED_PAYLOAD");
    }
    validateError(payload.error);
  } else {
    requireOwn(payload, ["previewId", "sequence", "reason"]);
    rejectUnexpected(payload, ["previewId", "sequence", "reason"]);
    if (!["requested", "forced", "failed", "exited"].includes(payload.reason)) {
      throw new Error("MALFORMED_PAYLOAD");
    }
  }
  if (payload.previewId !== previewId) throw new Error("MESSAGE_SOURCE_REJECTED");
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  return { message, observation };
}

export function validatePreviewOutputEvent(value, previewId, expectedCorrelationId) {
  const { message, observation } =
    validateEnvelope(value, "preview.output", expectedCorrelationId);
  rejectUnexpected(
    message,
    ["protocolVersion", "correlationId", "type", "payload"],
    "MALFORMED_ENVELOPE",
  );
  if (observation.binaryCount !== 0) throw new Error("MALFORMED_PAYLOAD");
  requireOwn(message, ["payload"], "MALFORMED_ENVELOPE");
  const payload = requireObject(message.payload);
  requireOwn(payload, ["previewId", "sequence", "source", "stream", "category", "text"]);
  if (payload.previewId !== previewId) throw new Error("MESSAGE_SOURCE_REJECTED");
  if (!Number.isSafeInteger(payload.sequence) || payload.sequence < 1 ||
      !["managed", "native"].includes(payload.source) ||
      !["stdout", "stderr"].includes(payload.stream) ||
      !["console", "startup", "runtime", "content", "shader"].includes(payload.category) ||
      typeof payload.text !== "string" ||
      utf8Length(payload.text) > LIMITS.outputText) {
    throw new Error("MALFORMED_PAYLOAD");
  }
  return { message, observation };
}

export function standaloneBuffer(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error("MALFORMED_PAYLOAD");
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function sha256(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength === 0) throw new Error("MALFORMED_PAYLOAD");
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export class ProtocolPortClient {
  constructor(port, portIdentity = crypto.randomUUID()) {
    this.port = port;
    this.portIdentity = portIdentity;
    this.completed = new Set();
    this.pending = new Map();
    this.observations = {
      receivedPortMessages: 0,
      discardedUnknownOrLate: 0,
      terminalResponses: 0,
      closes: 0,
      senderDetachFailures: 0,
      lifecycleEvents: 0,
      outputEvents: 0,
      discardedEventRegressions: 0,
      protocolControls: 0,
    };
    this.eventListeners = new Set();
    this.outputListeners = new Set();
    this.controlEvents = [];
    this.lifecycleEligible = new Set();
    this.runtimeFailureCorrelation = null;
    this.isClosed = false;
    this.closeReason = null;
    this.lastSequence = 0;
    port.addEventListener("message", event => this.#receive(event.data));
    port.start();
  }

  request(message, responseType, validate, transfer = [], timeoutMs = 10000) {
    inspectClone(message);
    if (this.pending.has(message.correlationId) || this.completed.has(message.correlationId)) {
      throw new Error("DUPLICATE_CORRELATION_ID");
    }
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        this.pending.delete(message.correlationId);
        this.completed.add(message.correlationId);
        reject(new Error("TIMEOUT"));
      }, timeoutMs);
      this.pending.set(message.correlationId, { responseType, validate, resolve, reject, timer });
      try {
        this.port.postMessage(message, transfer);
      } catch (error) {
        this.close(error);
        return;
      }
      if (transfer.some(buffer => buffer.byteLength !== 0)) {
        this.observations.senderDetachFailures += 1;
        this.close(new Error("Sender buffer did not detach."));
      }
    });
  }

  #receive(value) {
    this.observations.receivedPortMessages += 1;
    try {
      inspectClone(value);
      if (!isUuidV4(value?.correlationId)) throw new Error("MALFORMED_ENVELOPE");
      if (value.type === "protocol.error") {
        this.observations.protocolControls += 1;
        this.controlEvents.push(value);
        return;
      }
      if (value.type === "preview.started" || value.type === "preview.failed" ||
          value.type === "preview.stopped" || value.type === "preview.output") {
        if (value.type === "preview.failed" && value.payload?.phase === "running" &&
            !this.lifecycleEligible.has(value.correlationId) &&
            this.runtimeFailureCorrelation === null && this.lifecycleEligible.size > 0) {
          this.runtimeFailureCorrelation = value.correlationId;
          this.lifecycleEligible.add(value.correlationId);
        }
        if (!this.lifecycleEligible.has(value.correlationId)) {
          this.observations.discardedUnknownOrLate += 1;
          return;
        }
        if (value.type === "preview.output") {
          const validated = validatePreviewOutputEvent(value, value.payload?.previewId);
          if (validated.message.payload.sequence <= this.lastSequence) {
            this.observations.discardedEventRegressions += 1;
            return;
          }
          this.lastSequence = validated.message.payload.sequence;
          this.observations.outputEvents += 1;
          for (const listener of this.outputListeners) listener(validated.message);
          return;
        }
        const validated = validatePreviewLifecycleEvent(value, value.payload?.previewId);
        if (validated.message.payload.sequence <= this.lastSequence) {
          this.observations.discardedEventRegressions += 1;
          return;
        }
        this.lastSequence = validated.message.payload.sequence;
        this.observations.lifecycleEvents += 1;
        for (const listener of this.eventListeners) listener(validated.message);
        return;
      }
      const pending = this.pending.get(value.correlationId);
      if (!pending) {
        this.observations.discardedUnknownOrLate += 1;
        return;
      }
      if (value.type !== pending.responseType) throw new Error("Wrong terminal response type.");
      const validated = pending.validate(value);
      if (value.type === "preview.start.response") {
        this.lifecycleEligible.add(value.correlationId);
      }
      if (value.type === "preview.stop.response") {
        this.lifecycleEligible.add(value.correlationId);
      }
      globalThis.clearTimeout(pending.timer);
      this.pending.delete(value.correlationId);
      this.completed.add(value.correlationId);
      this.observations.terminalResponses += 1;
      pending.resolve(validated);
    } catch (error) {
      this.close(error);
    }
  }

  onLifecycleEvent(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onOutputEvent(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this.outputListeners.add(listener);
    return () => this.outputListeners.delete(listener);
  }

  retransmitForDuplicateCheck(message) {
    inspectClone(message);
    this.port.postMessage(message);
  }

  close(reason) {
    if (this.isClosed) return;
    this.isClosed = true;
    this.closeReason = reason instanceof Error ? reason.message : String(reason);
    this.observations.closes += 1;
    this.port.close();
    for (const pending of this.pending.values()) {
      globalThis.clearTimeout(pending.timer);
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

export function installPrivatePortBootstrap({ expectedSource, expectedOrigin, validateData = () => true, onPort }) {
  const observations = {
    windowMessagesObserved: 0,
    invalidBootstrapMessages: 0,
    acceptedBootstrapMessages: 0,
    postBootstrapWindowMessages: 0,
    postBootstrapRejectedMessages: 0,
    portIdentity: crypto.randomUUID(),
  };
  let accepted = false;
  let acceptedPort = null;
  const listener = event => {
    observations.windowMessagesObserved += 1;
    if (accepted) {
      observations.postBootstrapWindowMessages += 1;
      if (event.source === expectedSource) {
        observations.postBootstrapRejectedMessages += 1;
        acceptedPort.close();
      }
      return;
    }
    const data = event.data;
    const valid = event.source === expectedSource && event.origin === expectedOrigin &&
      data !== null && typeof data === "object" && Object.getPrototypeOf(data) === Object.prototype &&
      data.type === "protocol.bootstrap" && isUuidV4(data.contextGeneration) &&
      event.ports.length === 1 && event.ports[0] instanceof MessagePort && validateData(data);
    if (!valid) {
      observations.invalidBootstrapMessages += 1;
      return;
    }
    accepted = true;
    acceptedPort = event.ports[0];
    observations.acceptedBootstrapMessages += 1;
    onPort(event.ports[0], data);
  };
  window.addEventListener("message", listener);
  return observations;
}

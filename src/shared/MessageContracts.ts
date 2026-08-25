/**
 * Wire contracts for protocol version 1.
 *
 * Runtime validation, limits, routing, and lifecycle semantics are normative in
 * Protocol.md. Length and UUID constraints cannot be fully represented by
 * TypeScript and must be validated at each receiving boundary.
 */

export const PROTOCOL_VERSION = 1 as const;
export type ProtocolVersion = typeof PROTOCOL_VERSION;

type LowerHex = "8" | "9" | "a" | "b";
export type UuidV4 =
  `${string}-${string}-4${string}-${LowerHex}${string}-${string}`;
export type CorrelationId = UuidV4;
export type PreviewId = UuidV4;
export type CompileId = UuidV4;
export type AssetMountId = UuidV4;

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface CompilerDiagnostic {
  readonly origin: "compiler";
  readonly severity: DiagnosticSeverity;
  readonly id: string;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export type PlaygroundDiagnosticId =
  | "PG0001_NO_GAME_SUBCLASS"
  | "PG0002_MULTIPLE_GAME_SUBCLASSES"
  | "PG0003_MISSING_PUBLIC_PARAMETERLESS_CONSTRUCTOR"
  | "PG0004_UNSUPPORTED_ASSEMBLY"
  | "PG0005_UNSUPPORTED_NAMESPACE"
  | "PG0006_UNSUPPORTED_API"
  | "PG0007_DLLIMPORT_NOT_ALLOWED"
  | "PG0008_UNMANAGED_CALLERS_ONLY_NOT_ALLOWED"
  | "PG0009_UNSAFE_NATIVE_CALL_NOT_ALLOWED"
  | "PG0010_CONTENT_PLATFORM_MISMATCH";

export interface PlaygroundDiagnostic {
  readonly origin: "playground";
  readonly severity: DiagnosticSeverity;
  readonly id: PlaygroundDiagnosticId;
  readonly message: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export type Diagnostic = CompilerDiagnostic | PlaygroundDiagnostic;

export type ProtocolErrorCode =
  | "MISSING_PROTOCOL_VERSION"
  | "UNSUPPORTED_PROTOCOL_VERSION"
  | "MALFORMED_ENVELOPE"
  | "MALFORMED_PAYLOAD"
  | "UNKNOWN_MESSAGE_TYPE"
  | "MESSAGE_SOURCE_REJECTED"
  | "MESSAGE_ROUTE_REJECTED"
  | "DUPLICATE_CORRELATION_ID"
  | "INVALID_STATE"
  | "TIMEOUT"
  | "CANCELLED"
  | "MESSAGE_TOO_LARGE"
  | "FIELD_TOO_LARGE"
  | "SOURCE_TOO_LARGE"
  | "TOO_MANY_SOURCE_FILES"
  | "TOO_MANY_DIAGNOSTICS"
  | "ASSEMBLY_TOO_LARGE"
  | "PDB_TOO_LARGE"
  | "BINARY_PAYLOAD_TOO_LARGE"
  | "TOO_MANY_ASSETS"
  | "ASSET_TOO_LARGE"
  | "ASSET_TOTAL_TOO_LARGE"
  | "ASSET_PATH_INVALID"
  | "ASSET_PATH_DUPLICATE"
  | "DUPLICATE_MOUNT_ID"
  | "ASSET_PATH_ALREADY_MOUNTED"
  | "COMPILE_FAILED"
  | "PREVIEW_LOAD_FAILED"
  | "PREVIEW_START_FAILED"
  | "PREVIEW_STOP_FAILED"
  | "PREVIEW_RUNTIME_FAILED"
  | "INTERNAL_ERROR";

export type ErrorDetailValue = string | number | boolean | null;
export type ErrorDetails = Readonly<Record<string, ErrorDetailValue>>;

export interface ProtocolError {
  readonly code: ProtocolErrorCode;
  readonly message: string;
  readonly details?: ErrorDetails;
  readonly diagnostics?: readonly Diagnostic[];
}

export type ProtocolResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: ProtocolError };

export interface RequestOptions {
  readonly timeoutMs?: number;
}

export interface SourceFile {
  readonly path: string;
  readonly text: string;
}

export interface CompilationSettings {
  readonly languageVersion: "13.0";
  readonly nullable: "disable";
  readonly optimization: "debug";
  readonly allowUnsafe: false;
  readonly warningsAsErrors: false;
}

export interface CompileRequestPayload extends RequestOptions {
  readonly compileId: CompileId;
  readonly assemblyName: string;
  readonly sources: readonly SourceFile[];
  readonly settings?: CompilationSettings;
}

export interface CompileResponseData {
  readonly compileId: CompileId;
  readonly assembly: ArrayBuffer;
  readonly pdb: ArrayBuffer;
  readonly diagnostics: readonly Diagnostic[];
}

export interface CompileCancelRequestPayload extends RequestOptions {
  readonly targetCorrelationId: CorrelationId;
  readonly compileId: CompileId;
}

export interface CompileCancelResponseData {
  readonly compileId: CompileId;
  readonly accepted: boolean;
  readonly alreadyCompleted: boolean;
}

export interface AssetFile {
  readonly path: string;
  readonly bytes: ArrayBuffer;
}

export interface AssetMountRequestPayload extends RequestOptions {
  readonly previewId: PreviewId;
  readonly mountId: AssetMountId;
  readonly assets: readonly AssetFile[];
}

export interface AssetMountResponseData {
  readonly previewId: PreviewId;
  readonly mountId: AssetMountId;
  readonly mountedFileCount: number;
  readonly mountedByteLength: number;
}

export interface PreviewLoadRequestPayload extends RequestOptions {
  readonly previewId: PreviewId;
  readonly compileId: CompileId;
  readonly assembly: ArrayBuffer;
  readonly pdb: ArrayBuffer;
}

export interface PreviewLoadResponseData {
  readonly previewId: PreviewId;
  readonly compileId: CompileId;
}

export interface PreviewStartRequestPayload extends RequestOptions {
  readonly previewId: PreviewId;
}

export interface PreviewStartResponseData {
  readonly previewId: PreviewId;
  readonly accepted: true;
}

export interface PreviewStopRequestPayload extends RequestOptions {
  readonly previewId: PreviewId;
  readonly reason: "user" | "restart" | "exit-cleanup" | "failure-cleanup";
}

export interface PreviewStopResponseData {
  readonly previewId: PreviewId;
  readonly accepted: boolean;
  readonly alreadyStopped: boolean;
}

export interface PreviewStartedPayload {
  readonly previewId: PreviewId;
  readonly sequence: number;
}

export interface PreviewStoppedPayload {
  readonly previewId: PreviewId;
  readonly sequence: number;
  readonly reason: "requested" | "forced" | "failed" | "exited";
}

export interface PreviewExitedPayload {
  readonly previewId: PreviewId;
  readonly sequence: number;
  readonly exitCode: number;
}

export interface PreviewFailedPayload {
  readonly previewId: PreviewId;
  readonly sequence: number;
  readonly phase: "load" | "start" | "running" | "stop";
  readonly error: ProtocolError;
}

export interface PreviewOutputPayload {
  readonly previewId: PreviewId;
  readonly sequence: number;
  readonly source: "managed" | "native";
  readonly stream: "stdout" | "stderr";
  readonly category:
    | "console"
    | "startup"
    | "runtime"
    | "content"
    | "shader";
  readonly text: string;
}

export interface ProtocolErrorPayload {
  readonly error: ProtocolError;
  readonly rejectedCorrelationId?: CorrelationId;
  readonly rejectedType?: string;
}

export interface RequestPayloadByType {
  readonly "compile.request": CompileRequestPayload;
  readonly "compile.cancel.request": CompileCancelRequestPayload;
  readonly "asset.mount.request": AssetMountRequestPayload;
  readonly "preview.load.request": PreviewLoadRequestPayload;
  readonly "preview.start.request": PreviewStartRequestPayload;
  readonly "preview.stop.request": PreviewStopRequestPayload;
}

export interface ResponseDataByType {
  readonly "compile.response": CompileResponseData;
  readonly "compile.cancel.response": CompileCancelResponseData;
  readonly "asset.mount.response": AssetMountResponseData;
  readonly "preview.load.response": PreviewLoadResponseData;
  readonly "preview.start.response": PreviewStartResponseData;
  readonly "preview.stop.response": PreviewStopResponseData;
}

export interface EventPayloadByType {
  readonly "preview.started": PreviewStartedPayload;
  readonly "preview.stopped": PreviewStoppedPayload;
  readonly "preview.exited": PreviewExitedPayload;
  readonly "preview.failed": PreviewFailedPayload;
  readonly "preview.output": PreviewOutputPayload;
  readonly "protocol.error": ProtocolErrorPayload;
}

export type RequestType = keyof RequestPayloadByType;
export type ResponseType = keyof ResponseDataByType;
export type EventType = keyof EventPayloadByType;
export type MessageType = RequestType | ResponseType | EventType;

export interface RequestEnvelope<T extends RequestType> {
  readonly protocolVersion: ProtocolVersion;
  readonly correlationId: CorrelationId;
  readonly type: T;
  readonly payload: RequestPayloadByType[T];
}

export interface ResponseEnvelope<T extends ResponseType> {
  readonly protocolVersion: ProtocolVersion;
  readonly correlationId: CorrelationId;
  readonly type: T;
  readonly result: ProtocolResult<ResponseDataByType[T]>;
}

export interface EventEnvelope<T extends EventType> {
  readonly protocolVersion: ProtocolVersion;
  readonly correlationId: CorrelationId;
  readonly type: T;
  readonly payload: EventPayloadByType[T];
}

export type CompileRequest = RequestEnvelope<"compile.request">;
export type CompileCancelRequest =
  RequestEnvelope<"compile.cancel.request">;
export type AssetMountRequest = RequestEnvelope<"asset.mount.request">;
export type PreviewLoadRequest = RequestEnvelope<"preview.load.request">;
export type PreviewStartRequest = RequestEnvelope<"preview.start.request">;
export type PreviewStopRequest = RequestEnvelope<"preview.stop.request">;

export type CompileResponse = ResponseEnvelope<"compile.response">;
export type CompileCancelResponse =
  ResponseEnvelope<"compile.cancel.response">;
export type AssetMountResponse = ResponseEnvelope<"asset.mount.response">;
export type PreviewLoadResponse = ResponseEnvelope<"preview.load.response">;
export type PreviewStartResponse = ResponseEnvelope<"preview.start.response">;
export type PreviewStopResponse = ResponseEnvelope<"preview.stop.response">;

export type PreviewStarted = EventEnvelope<"preview.started">;
export type PreviewStopped = EventEnvelope<"preview.stopped">;
export type PreviewExited = EventEnvelope<"preview.exited">;
export type PreviewFailed = EventEnvelope<"preview.failed">;
export type PreviewOutput = EventEnvelope<"preview.output">;
export type ProtocolErrorEvent = EventEnvelope<"protocol.error">;

export type MessageByType = {
  readonly [T in RequestType]: RequestEnvelope<T>;
} & {
  readonly [T in ResponseType]: ResponseEnvelope<T>;
} & {
  readonly [T in EventType]: EventEnvelope<T>;
};

export type ProtocolMessage = MessageByType[keyof MessageByType];

export const PROTOCOL_LIMITS = {
  maxMessageBytes: 32 * 1024 * 1024,
  maxSourceFiles: 64,
  maxSourceFileBytes: 1 * 1024 * 1024,
  maxAggregateSourceBytes: 4 * 1024 * 1024,
  maxAssemblyBytes: 8 * 1024 * 1024,
  maxPdbBytes: 8 * 1024 * 1024,
  maxAssemblyAndPdbBytes: 12 * 1024 * 1024,
  maxAssets: 256,
  maxAssetBytes: 16 * 1024 * 1024,
  maxAggregateAssetBytes: 24 * 1024 * 1024,
  maxPathUtf8Bytes: 512,
  maxRejectedTypeUtf8Bytes: 128,
  maxAssemblyNameUtf8Bytes: 128,
  maxDiagnosticCount: 2_000,
  maxDiagnosticIdUtf8Bytes: 64,
  maxDiagnosticMessageUtf8Bytes: 4 * 1024,
  maxOutputTextUtf8Bytes: 16 * 1024,
  maxErrorMessageUtf8Bytes: 1 * 1024,
  maxErrorDetailsUtf8Bytes: 16 * 1024,
  maxErrorDetailEntries: 32,
  maxErrorDetailKeyUtf8Bytes: 64,
  maxErrorDetailStringUtf8Bytes: 1 * 1024,
  minTimeoutMs: 100,
  maxCompileTimeoutMs: 30_000,
  maxCancelTimeoutMs: 2_000,
  maxAssetMountTimeoutMs: 10_000,
  maxPreviewLoadTimeoutMs: 10_000,
  maxPreviewStartTimeoutMs: 10_000,
  maxPreviewStopTimeoutMs: 2_000,
} as const;

export const PROTOCOL_DEFAULT_TIMEOUTS_MS = {
  "compile.request": 10_000,
  "compile.cancel.request": 2_000,
  "asset.mount.request": 10_000,
  "preview.load.request": 10_000,
  "preview.start.request": 10_000,
  "preview.stop.request": 2_000,
} as const satisfies Readonly<Record<RequestType, number>>;

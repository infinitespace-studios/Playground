import type {
  CompileRequest, CompileResponse, PreviewLoadRequest, PreviewLoadResponse,
  PreviewStartRequest, PreviewStartResponse, PreviewStarted, PreviewFailed, PreviewStopped,
} from "./MessageContracts";
export const PROTOCOL_VERSION: 1;
export const LIMITS: Readonly<Record<string, number>>;
export const DEFAULT_TIMEOUTS_MS: Readonly<Record<string, number>>;
export const MAX_TIMEOUTS_MS: Readonly<Record<string, number>>;
export const PROTOCOL_ERROR_CODES: readonly string[];
export const PLAYGROUND_DIAGNOSTIC_IDS: readonly string[];
export function isUuidV4(value: unknown): value is string;
export function utf8Length(value: unknown): number;
export function isCanonicalPath(value: unknown): value is string;
export function inspectClone(value: unknown): { measuredBytes: number; binaryCount: number; base64FieldCount: number; dataUrlCount: number };
export function validateCompileRequest(value: unknown): { message: CompileRequest; observation: ReturnType<typeof inspectClone> };
export function validateCompileResponse(value: unknown, correlationId: string, compileId: string, expectedBinaryIdentity?: { assemblyName: string; sourcePaths: readonly string[]; primarySourcePath: string }): { message: CompileResponse; observation: ReturnType<typeof inspectClone> };
export function validatePreviewLoadRequest(value: unknown, previewId: string): { message: PreviewLoadRequest; observation: ReturnType<typeof inspectClone> };
export function validatePreviewLoadResponse(value: unknown, correlationId: string, previewId: string, compileId: string): { message: PreviewLoadResponse; observation: ReturnType<typeof inspectClone> };
export function validatePreviewStartRequest(value: unknown, previewId: string): { message: PreviewStartRequest; observation: ReturnType<typeof inspectClone> };
export function validatePreviewStartResponse(value: unknown, correlationId: string, previewId: string): { message: PreviewStartResponse; observation: ReturnType<typeof inspectClone> };
export function validatePreviewLifecycleEvent(value: unknown, previewId: string, expectedCorrelationId?: string): { message: PreviewStarted | PreviewFailed | PreviewStopped; observation: ReturnType<typeof inspectClone> };
export function validateBinaryPair(assembly: unknown, pdb: unknown): void;
export function standaloneBuffer(bytes: Uint8Array): ArrayBuffer;
export function sha256(buffer: ArrayBuffer): Promise<string>;
export class ProtocolPortClient {
  constructor(port: MessagePort, portIdentity?: string);
  readonly portIdentity: string;
  readonly completed: Set<string>;
  readonly pending: Map<string, unknown>;
  readonly observations: Record<string, number>;
  readonly controlEvents: unknown[];
  readonly lifecycleEligible: Set<string>;
  readonly isClosed: boolean;
  readonly closeReason: string | null;
  request(message: { correlationId: string }, responseType: string, validate: (value: unknown) => unknown, transfer?: ArrayBuffer[], timeoutMs?: number): Promise<unknown>;
  onLifecycleEvent(listener: (message: PreviewStarted | PreviewFailed | PreviewStopped) => void): () => void;
  retransmitForDuplicateCheck(message: unknown): void;
  close(reason: unknown): void;
}
export function installPrivatePortBootstrap(options: { expectedSource: Window; expectedOrigin: string; validateData?(data: any): boolean; onPort(port: MessagePort, data: any): void }): Record<string, number | string>;

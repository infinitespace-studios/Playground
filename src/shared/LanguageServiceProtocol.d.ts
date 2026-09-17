export const LANGUAGE_PROTOCOL_VERSION: 1;
export const LANGUAGE_LIMITS: Readonly<Record<string, number>>;
export const LANGUAGE_REQUEST_TYPES: readonly string[];
export const LANGUAGE_RESPONSE_TYPES: readonly string[];
export function validateLanguageRequest(value: unknown): unknown;
export function createLanguageServiceEndpoint(options?: {
  complete?: ((input: {
    sessionId: string;
    document: {
      uri: string;
      path: string;
      version: number;
      text: string;
    };
    position: { offset: number; line: number; column: number };
  }) => readonly { label: string; kind: string; detail?: string; sortText?: string }[] | Promise<readonly { label: string; kind: string; detail?: string; sortText?: string }[]> ) | null;
}): {
  handle(value: unknown): Promise<unknown>;
  sessions: Map<string, unknown>;
  completed: Set<string>;
};
export function createLanguageServiceClient(options: {
  send(message: unknown): Promise<any>;
  sessionId: string;
}): {
  sessionId: string;
  open(documents?: readonly unknown[]): Promise<any>;
  close(): Promise<any>;
  openDocument(document: unknown): Promise<any>;
  replaceDocument(document: unknown): Promise<any>;
  closeDocument(uri: string, version: number): Promise<any>;
  complete(uri: string, version: number, position: { offset: number; line: number; column: number }): Promise<any>;
};

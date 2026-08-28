export const NATIVE_OUTPUT_BUFFER_LIMITS: Readonly<{
  messages: number;
  utf8Bytes: number;
  messageUtf8Bytes: number;
}>;
export function normalizeUnicodeScalars(value: string): string;
export function normalizeNativeOutputArguments(args: Iterable<unknown> | ArrayLike<unknown>): string;
export function createNativeOutputCapture(options?: {
  teeOut?: (...args: unknown[]) => void;
  teeErr?: (...args: unknown[]) => void;
  limits?: typeof NATIVE_OUTPUT_BUFFER_LIMITS;
}): {
  print(...args: unknown[]): void;
  printErr(...args: unknown[]): void;
  authenticate(generation: string): boolean;
  flush(
    generation: string,
    emit: (item: { stream: "stdout" | "stderr"; category: "startup" | "runtime"; text: string }) => void,
  ): boolean;
  retire(generation: string): boolean;
  snapshot(): Readonly<Record<string, unknown>>;
};

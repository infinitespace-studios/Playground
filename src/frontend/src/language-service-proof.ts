// PROOF-only Monaco integration for issue 073.
//
// PRODUCT never imports this module. It bridges the persistent Monaco models
// to the proof compiler's same-origin LanguageServiceHandle, exercising the
// issue-071 client/session semantics without promoting the backend to PRODUCT.
import * as monaco from "monaco-editor";
import { createLanguageServiceClient } from "../../shared/LanguageServiceProtocol.js";
import { compilerFrame, ensureContexts } from "./compiler-context";
import { editor, output, project } from "./app";

interface ProofCompilerWindow extends Window {
  compilerProofLanguageService?: (request: unknown) => unknown;
}

interface TrackedDocument {
  uri: string;
  path: string;
  version: number;
  text: string;
}

let installed = false;
let client: ReturnType<typeof createLanguageServiceClient> | null = null;
let sessionKey = "";
let sessionId = "";
let tracked = new Map<string, TrackedDocument>();
let modelSources = new Map<string, string>();
let syncTimer: number | null = null;
let syncInFlight: Promise<void> | null = null;
let syncAgain = false;
let failureReported = false;

// Browser proof fallback for Open Folder. Native dialogs are unavailable under
// Vite, so issue 073 supplies a deterministic two-file project for Monaco and
// language-service synchronization tests. PRODUCT never imports this module.
(globalThis as typeof globalThis & {
  __PLAYGROUND_BROWSER_PROJECT_FIXTURE__?: () => {
    root: string;
    folderName: string;
    csFiles: Array<{ relativePath: string; absolutePath: string; content: string }>;
    contentFiles: never[];
    contentRootExists: boolean;
    manifestText: string;
  };
}).__PLAYGROUND_BROWSER_PROJECT_FIXTURE__ = () => ({
  root: "browser-proof://issue073-project",
  folderName: "Issue073BrowserProject",
  csFiles: [
    {
      relativePath: "Game1.cs",
      absolutePath: "browser-proof://issue073-project/Game1.cs",
      content: "public class Game1 { private Player player = new Player(); void Test() { player. } }",
    },
    {
      relativePath: "Player.cs",
      absolutePath: "browser-proof://issue073-project/Player.cs",
      content: "public class Player { public int Score; public void Jump() { } }",
    },
  ],
  contentFiles: [],
  contentRootExists: false,
  manifestText: JSON.stringify({ name: "Issue073BrowserProject", schemaVersion: 1, contentProfile: "Web" }),
});

function stableScratchUri(): string {
  return "playground-model://scratch/Game1.cs";
}

function sourceSnapshot(): Array<{ uri: string; path: string; text: string }> {
  if (project.hasProject()) {
    return project.getSources().map(source => ({
      uri: project.modelKeyFor(source.path) ?? `playground-model://project/${encodeURIComponent(source.path)}`,
      path: source.path,
      text: source.text,
    }));
  }
  return [{ uri: stableScratchUri(), path: "Game1.cs", text: editor.getValue() }];
}

function reportFailure(error: unknown): void {
  if (failureReported) return;
  failureReported = true;
  const message = error instanceof Error ? error.message : String(error);
  output.appendContentError("LANGUAGE_SERVICE_UNAVAILABLE", `C# completion is unavailable: ${message}`);
}

async function ensureClient(): Promise<ReturnType<typeof createLanguageServiceClient>> {
  const nextKey = project.identity() ?? "scratch";
  if (client && sessionKey === nextKey) return client;

  await ensureContexts(true, true);
  const child = compilerFrame.contentWindow as ProofCompilerWindow | null;
  const service = child?.compilerProofLanguageService;
  if (!service) throw new Error("The PROOF compiler language-service bridge is unavailable.");

  if (client) {
    try { await client.close(); } catch { /* stale proof session is being replaced */ }
  }
  sessionKey = nextKey;
  sessionId = crypto.randomUUID();
  tracked = new Map();
  modelSources = new Map();
  client = createLanguageServiceClient({
    sessionId,
    send: async request => service(request),
  });
  failureReported = false;
  return client;
}

async function syncDocuments(): Promise<void> {
  if (syncInFlight) {
    syncAgain = true;
    return syncInFlight;
  }
  syncInFlight = (async () => {
    const languageClient = await ensureClient();
    const desired = sourceSnapshot();
    modelSources = new Map(desired.map(document => [document.uri, document.path]));
    if (tracked.size === 0) {
      const initial = desired.map(document => ({ ...document, version: 1 }));
      await languageClient.open(initial);
      tracked = new Map(initial.map(document => [document.uri, document]));
    } else {
      for (const [uri, previous] of tracked) {
        if (!modelSources.has(uri)) {
          await languageClient.closeDocument(uri, previous.version);
          tracked.delete(uri);
        }
      }
      for (const document of desired) {
        const previous = tracked.get(document.uri);
        if (!previous) {
          const next = { ...document, version: 1 };
          await languageClient.openDocument(next);
          tracked.set(document.uri, next);
        } else if (previous.text !== document.text || previous.path !== document.path) {
          const next = { ...document, version: previous.version + 1 };
          await languageClient.replaceDocument(next);
          tracked.set(document.uri, next);
        }
      }
    }
  })().finally(() => {
    syncInFlight = null;
    if (syncAgain) {
      syncAgain = false;
      void syncDocuments().catch(reportFailure);
    }
  });
  return syncInFlight;
}

function scheduleSync(): void {
  if (syncTimer !== null) window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(() => {
    syncTimer = null;
    void syncDocuments().catch(reportFailure);
  }, 50);
}

function completionKind(kind: string): monaco.languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind;
  return ({
    class: kinds.Class,
    method: kinds.Method,
    property: kinds.Property,
    field: kinds.Field,
    keyword: kinds.Keyword,
    namespace: kinds.Module,
    variable: kinds.Variable,
  } as Record<string, monaco.languages.CompletionItemKind>)[kind] ?? kinds.Reference;
}

export function installProofLanguageService(): void {
  if (installed) return;
  installed = true;

  editor.onDidChangeContent(scheduleSync);
  project.subscribe(scheduleSync);

  editor.registerCompletionProvider({
    triggerCharacters: ["."],
    provideCompletionItems: async (model, position, _context, token) => {
      if (token.isCancellationRequested) return { suggestions: [] };
      try {
        await syncDocuments();
        if (token.isCancellationRequested) return { suggestions: [] };
        const uri = project.hasProject() ? model.uri.toString() : stableScratchUri();
        const document = tracked.get(uri);
        if (!document || !client) return { suggestions: [] };
        const response = await client.complete(uri, document.version, {
          offset: model.getOffsetAt(position),
          line: position.lineNumber,
          column: position.column,
        });
        if (response.superseded || token.isCancellationRequested) return { suggestions: [] };
        if (!response.result?.result?.success) return { suggestions: [] };
        const word = model.getWordUntilPosition(position);
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        };
        return {
          suggestions: response.result.result.data.items.map((item: { label: string; kind: string; sortText?: string; detail?: string }) => ({
            label: item.label,
            kind: completionKind(item.kind),
            insertText: item.label,
            filterText: item.label,
            sortText: item.sortText ?? item.label,
            detail: item.detail ?? "C# completion",
            range,
          })),
        };
      } catch (error) {
        reportFailure(error);
        return { suggestions: [] };
      }
    },
  });
}

export default installProofLanguageService;

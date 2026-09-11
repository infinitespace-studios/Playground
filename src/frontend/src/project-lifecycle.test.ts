// Durable feature tests — project lifecycle: open / save / dirty-state / identity.
//
// Stage-4 durable scenario 7 (feature-test layer). This consolidates and
// REPLACES the historical `issue051.test.ts` and `project-identity.test.ts`
// coverage and ADDS the previously-missing open→edit→SAVE and Save-All
// atomicity/dirty-clear behavior, all against the responsibility-named
// production module `project-manager.ts` (formerly issue051.ts) with mocked
// Tauri commands. No native package is required; runs under `node --test`.
//
// The packaged first-run-warning phase (former issue037, in
// proof-project-lifecycle.ts) is the OTHER half of durable scenario 7 and runs
// only in the packaged proof harness. Together, these two layers cover
// open/save/dirty-state/identity plus first-run acknowledgement.

import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetProjectManagerState,
  folderProjectIdentity,
  installProjectManager,
  parseManifest,
  serializeManifest,
  PROJECT_SCHEMA_VERSION,
  type ProjectManagerApi,
  type ProjectManagerHooks,
} from "./project-manager.ts";

// ---- Mock Tauri shell ----

interface WrittenFile {
  path: string;
  content: string;
}

interface MockShellOptions {
  cancelPicker?: boolean;
  readProject?: unknown;
  readProjectThrows?: string;
  writeThrowsForPath?: string;
}

interface MockShell {
  written: WrittenFile[];
  setCancelPicker: (cancel: boolean) => void;
  setWriteFailure: (path: string | null) => void;
  restore: () => void;
}

function defaultProject() {
  return {
    root: "/tmp/playground-project",
    folderName: "playground-project",
    csFiles: [
      {
        relativePath: "Game1.cs",
        absolutePath: "/tmp/playground-project/Game1.cs",
        content: "class Game1 {}",
      },
      {
        relativePath: "Player.cs",
        absolutePath: "/tmp/playground-project/Player.cs",
        content: "class Player {}",
      },
    ],
    contentFiles: [],
    manifestText: null,
  };
}

function installMockShell(options: MockShellOptions = {}): MockShell {
  const originalWindow = (globalThis as { window?: unknown }).window;
  const written: WrittenFile[] = [];
  let cancelPicker = options.cancelPicker ?? false;
  let writeFailurePath = options.writeThrowsForPath ?? null;

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args?: Record<string, unknown>) => {
          switch (command) {
            case "project_pick_folder":
              return cancelPicker ? null : "/tmp/playground-project";
            case "project_read":
              if (options.readProjectThrows) throw new Error(options.readProjectThrows);
              return options.readProject ?? defaultProject();
            case "workspace_write_file": {
              const path = String(args?.path);
              if (writeFailurePath && path === writeFailurePath) {
                throw new Error(`disk full writing ${path}`);
              }
              written.push({ path, content: String(args?.content) });
              return null;
            }
            default:
              throw new Error(`unexpected command: ${command}`);
          }
        },
      },
    },
  });

  return {
    written,
    setCancelPicker: cancel => { cancelPicker = cancel; },
    setWriteFailure: path => { writeFailurePath = path; },
    restore: () => {
      if (originalWindow === undefined) {
        Reflect.deleteProperty(globalThis, "window");
      } else {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: originalWindow,
        });
      }
    },
  };
}

interface Harness {
  project: ProjectManagerApi;
  editorContent: () => string;
  setEditorContent: (content: string) => void;
  dirtyStates: boolean[];
  explorer: () => ReadonlyArray<{ relativePath: string; dirty: boolean; active: boolean }>;
  errors: Array<{ title: string; message: string }>;
}

function installHarness(): Harness {
  let editorContent = "scratch";
  const dirtyStates: boolean[] = [];
  let explorerEntries: ReadonlyArray<{ relativePath: string; dirty: boolean; active: boolean }> = [];
  const errors: Array<{ title: string; message: string }> = [];

  const hooks: ProjectManagerHooks = {
    setEditorContent: content => { editorContent = content; },
    getEditorContent: () => editorContent,
    renderExplorer: entries => { explorerEntries = entries; },
    setDirtyIndicator: dirty => { dirtyStates.push(dirty); },
    showError: (title, message) => { errors.push({ title, message }); },
  };

  return {
    project: installProjectManager(hooks),
    editorContent: () => editorContent,
    setEditorContent: content => { editorContent = content; },
    dirtyStates,
    explorer: () => explorerEntries,
    errors,
  };
}

// ---- Identity (consolidated from project-identity.test.ts) ----

test("project identities are stable, distinct, valid, and path-redacted", async () => {
  const first = await folderProjectIdentity("/Users/example/Projects/My Game");
  const repeated = await folderProjectIdentity("/Users/example/Projects/My Game");
  const second = await folderProjectIdentity("/Users/example/Projects/Other Game");

  assert.equal(first, repeated);
  assert.notEqual(first, second);
  assert.match(first, /^folder-sha256-[a-f0-9]{64}$/);
  assert.doesNotMatch(first, /Users|Projects|My Game/);
  assert.ok(first.length <= 256);
});

test("Windows path separator and casing differences produce one identity", async () => {
  const backslash = await folderProjectIdentity("C:\\Users\\Example\\MyGame");
  const slash = await folderProjectIdentity("c:/users/example/mygame");
  const extended = await folderProjectIdentity("\\\\?\\C:\\USERS\\EXAMPLE\\MYGAME");

  assert.equal(backslash, slash);
  assert.equal(backslash, extended);
});

test("an empty project root is rejected", async () => {
  await assert.rejects(folderProjectIdentity(""), /empty root path/);
});

// ---- Open + dirty-state (consolidated from issue051.test.ts) ----

test("open publishes a stable identity, loads files, and starts clean", async () => {
  __resetProjectManagerState();
  const shell = installMockShell();
  try {
    const h = installHarness();
    assert.equal(await h.project.openFolder(), true);
    assert.equal(h.project.hasProject(), true);
    assert.equal(h.project.identity(), await folderProjectIdentity("/tmp/playground-project"));
    assert.equal(h.editorContent(), "class Game1 {}");
    assert.equal(h.explorer().length, 2);
    assert.equal(h.project.isDirty(), false);
    assert.equal(h.dirtyStates.at(-1), false);
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

test("editing marks the workspace dirty and a cancelled re-open preserves edits", async () => {
  __resetProjectManagerState();
  const shell = installMockShell();
  try {
    const h = installHarness();
    assert.equal(await h.project.openFolder(), true);

    h.setEditorContent("class Game1 { /* edited */ }");
    h.project.syncActiveBuffer();
    assert.equal(h.project.isDirty(), true);
    assert.equal(h.dirtyStates.at(-1), true);

    // A cancelled folder picker must not disturb the open project or its edits.
    shell.setCancelPicker(true);
    assert.equal(await h.project.openFolder(), false);
    assert.equal(h.project.hasProject(), true);
    assert.equal(h.project.isDirty(), true);
    assert.equal(h.project.getSources()[0].text, "class Game1 { /* edited */ }");
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

test("closing a project clears identity, sources, dirty-state, and explorer", async () => {
  __resetProjectManagerState();
  const shell = installMockShell();
  try {
    const h = installHarness();
    await h.project.openFolder();
    h.setEditorContent("class Game1 { /* edited */ }");
    h.project.syncActiveBuffer();

    h.project.closeProject();
    assert.equal(h.project.hasProject(), false);
    assert.equal(h.project.identity(), null);
    assert.equal(h.project.isDirty(), false);
    assert.equal(h.project.getContent(), null);
    assert.deepEqual(h.project.getSources(), []);
    assert.deepEqual(h.explorer(), []);
    assert.equal(h.dirtyStates.at(-1), false);
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

// ---- Save behavior (NEW durable coverage) ----

test("Save All writes only dirty .cs files and clears their dirty flags", async () => {
  __resetProjectManagerState();
  const shell = installMockShell();
  try {
    const h = installHarness();
    await h.project.openFolder();

    h.setEditorContent("class Game1 { int x; }");
    h.project.syncActiveBuffer();
    assert.equal(h.project.isDirty(), true);

    assert.equal(await h.project.saveAll(), true);
    // Only the edited Game1.cs was written (Player.cs was untouched); the
    // manifest was created-on-first-save because none existed on disk.
    const csWrites = shell.written.filter(w => w.path.endsWith(".cs"));
    assert.equal(csWrites.length, 1);
    assert.equal(csWrites[0].path, "/tmp/playground-project/Game1.cs");
    assert.equal(csWrites[0].content, "class Game1 { int x; }");
    assert.ok(shell.written.some(w => w.path.endsWith("playground.json")));
    // Issue 057: the created-on-first-save manifest carries no preview block.
    const manifestWrite = shell.written.find(w => w.path.endsWith("playground.json"));
    assert.ok(manifestWrite);
    assert.equal(manifestWrite.content.includes("preview"), false);

    // Dirty state cleared after a successful save.
    assert.equal(h.project.isDirty(), false);
    assert.equal(h.dirtyStates.at(-1), false);

    // A second Save All with no edits is a no-op write (manifest already on disk).
    const writesBefore = shell.written.length;
    assert.equal(await h.project.saveAll(), true);
    assert.equal(shell.written.length, writesBefore);
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

test("issue 057: Save All never writes a preview block back for a legacy on-disk manifest", async () => {
  __resetProjectManagerState();
  const legacyProject = {
    ...defaultProject(),
    manifestText: JSON.stringify({
      name: "Legacy",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      contentProfile: "Web",
      preview: { width: 800, height: 480 },
    }),
  };
  const shell = installMockShell({ readProject: legacyProject });
  try {
    const h = installHarness();
    // Opens without error despite the vestigial preview block.
    assert.equal(await h.project.openFolder(), true);

    h.setEditorContent("class Game1 { int y; }");
    h.project.syncActiveBuffer();
    assert.equal(await h.project.saveAll(), true);

    // Save All canonicalizes the legacy manifest exactly once and does not
    // re-emit the removed preview block.
    const manifestWrites = shell.written.filter(w => w.path.endsWith("playground.json"));
    assert.equal(manifestWrites.length, 1);
    assert.equal(manifestWrites[0].content.includes("preview"), false);
    assert.deepEqual(JSON.parse(manifestWrites[0].content), {
      name: "Legacy",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      contentProfile: "Web",
    });

    // Once normalized, a second Save All with no edits is a no-op.
    const writesBefore = shell.written.length;
    assert.equal(await h.project.saveAll(), true);
    assert.equal(shell.written.length, writesBefore);
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

test("a failed write during Save All is atomic: no dirty flag is cleared", async () => {
  __resetProjectManagerState();
  const shell = installMockShell();
  try {
    const h = installHarness();
    await h.project.openFolder();

    // Edit both files, then make the SECOND file's write fail.
    h.setEditorContent("class Game1 { int a; }");
    h.project.syncActiveBuffer();
    h.project.switchTo("Player.cs");
    h.setEditorContent("class Player { int b; }");
    h.project.syncActiveBuffer();
    assert.equal(h.project.isDirty(), true);

    shell.setWriteFailure("/tmp/playground-project/Player.cs");
    assert.equal(await h.project.saveAll(), false);

    // Save All aborted: the workspace is still dirty (PRD 8.6 atomicity).
    assert.equal(h.project.isDirty(), true);
    assert.ok(h.errors.some(e => e.title === "Save All failed"));
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

// ---- Manifest identity/schema (project identity persistence surface) ----

test("manifest round-trips and rejects a newer schemaVersion without touching disk", async () => {
  const manifest = parseManifest(
    JSON.stringify({ name: "Demo", schemaVersion: PROJECT_SCHEMA_VERSION, contentProfile: "Web" }),
    "fallback-folder",
  );
  assert.equal(manifest.name, "Demo");
  assert.equal(manifest.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(manifest.contentProfile, "Web");
  const serialized = serializeManifest(manifest);
  const reparsed = parseManifest(serialized, "fallback-folder");
  assert.equal(reparsed.name, "Demo");
  // Issue 057: the reduced schema carries no preview block.
  assert.equal(Object.hasOwn(manifest as object, "preview"), false);
  assert.equal(serialized.includes("preview"), false);

  assert.throws(
    () => parseManifest(JSON.stringify({ name: "X", schemaVersion: PROJECT_SCHEMA_VERSION + 1 }), "f"),
    /newer than this application supports/,
  );
});

test("issue 057: a legacy on-disk preview block parses but is never re-emitted", async () => {
  const manifest = parseManifest(
    JSON.stringify({
      name: "Legacy",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      contentProfile: "Web",
      preview: { width: 640, height: 360 },
    }),
    "fallback-folder",
  );
  // Opens/parses successfully, ignoring the vestigial block.
  assert.equal(manifest.name, "Legacy");
  assert.equal(manifest.contentProfile, "Web");
  assert.equal(Object.hasOwn(manifest as object, "preview"), false);
  // Serialization drops the legacy block entirely.
  const serialized = serializeManifest(manifest);
  assert.equal(serialized.includes("preview"), false);
  assert.equal(serialized.includes("640"), false);
  assert.equal(serialized.includes("360"), false);
});

test("a project whose folder has no .cs files is rejected on open", async () => {
  __resetProjectManagerState();
  const emptyProject = { ...defaultProject(), csFiles: [] };
  const shell = installMockShell({ readProject: emptyProject });
  try {
    const h = installHarness();
    assert.equal(await h.project.openFolder(), false);
    assert.equal(h.project.hasProject(), false);
    assert.ok(h.errors.some(e => e.title === "No C# files"));
  } finally {
    shell.restore();
    __resetProjectManagerState();
  }
});

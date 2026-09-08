import assert from "node:assert/strict";
import test from "node:test";
import {
  __resetIssue051State,
  folderProjectIdentity,
  installIssue051ProjectManager,
} from "./issue051.ts";

test("folder dirty state is published, survives a cancelled replacement, and clears on close", async () => {
  __resetIssue051State();

  const originalWindow = globalThis.window;
  let cancelNextPicker = false;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      __TAURI_INTERNALS__: {
        invoke: async (command: string) => {
          if (command === "issue051_pick_folder") {
            if (cancelNextPicker) return null;
            return "/tmp/playground-project";
          }
          if (command === "issue051_read_project") {
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
          throw new Error(`unexpected command: ${command}`);
        },
      },
    },
  });

  try {
    let editorContent = "scratch";
    const dirtyStates: boolean[] = [];
    let explorerEntries: ReadonlyArray<{
      relativePath: string;
      dirty: boolean;
      active: boolean;
    }> = [];

    const project = installIssue051ProjectManager({
      setEditorContent: content => { editorContent = content; },
      getEditorContent: () => editorContent,
      renderExplorer: entries => { explorerEntries = entries; },
      setDirtyIndicator: dirty => { dirtyStates.push(dirty); },
      showError: (_title, message) => { throw new Error(message); },
    });

    assert.equal(await project.openFolder(), true);
    assert.equal(project.hasProject(), true);
    assert.equal(
      project.identity(),
      await folderProjectIdentity("/tmp/playground-project"),
    );
    assert.equal(editorContent, "class Game1 {}");
    assert.equal(explorerEntries.length, 2);
    assert.equal(dirtyStates.at(-1), false);

    editorContent = "class Game1 { /* edited */ }";
    project.syncActiveBuffer();
    assert.equal(project.isDirty(), true);
    assert.equal(dirtyStates.at(-1), true);

    cancelNextPicker = true;
    assert.equal(await project.openFolder(), false);
    assert.equal(project.hasProject(), true);
    assert.equal(project.isDirty(), true);
    assert.equal(project.getSources()[0].text, "class Game1 { /* edited */ }");

    project.closeProject();
    assert.equal(project.hasProject(), false);
    assert.equal(project.identity(), null);
    assert.equal(project.isDirty(), false);
    assert.equal(project.getContent(), null);
    assert.deepEqual(project.getSources(), []);
    assert.deepEqual(explorerEntries, []);
    assert.equal(dirtyStates.at(-1), false);
  } finally {
    __resetIssue051State();
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, "window");
    } else {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  }
});

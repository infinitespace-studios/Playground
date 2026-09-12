// Deterministic unit tests for the file-rail asset inventory view model
// (issue 064). Pure, DOM-free: they exercise `buildAssetInventory` so a
// regression in the recursive folder/file hierarchy, folder-before-file
// ordering, deterministic lexical sorting, or the honest empty states fails CI
// rather than only being caught by manual GUI inspection.
//
// The model exposes NO per-file metadata (no kind, size, count, or profile), so
// these tests assert on structure and ordering only.
//
// Runs under `node --test` with no dependencies.

import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAssetInventory,
  type AssetFolderNode,
  type AssetNode,
  type ProjectContentSnapshot,
  type RawContentFile,
} from "./asset-inventory.ts";

function file(relativePath: string): RawContentFile {
  return { relativePath };
}

function snapshot(overrides: Partial<ProjectContentSnapshot> = {}): ProjectContentSnapshot {
  return {
    hasProject: true,
    contentRootExists: true,
    contentFiles: [],
    ...overrides,
  };
}

/** The populated root, or fail the test. */
function root(snap: ProjectContentSnapshot): AssetFolderNode {
  const inv = buildAssetInventory(snap);
  assert.equal(inv.state, "populated");
  if (inv.state !== "populated") throw new Error("unreachable");
  return inv.root;
}

/** Find a direct child folder by name (or fail). */
function folder(node: AssetFolderNode, name: string): AssetFolderNode {
  const child = node.children.find(c => c.type === "folder" && c.name === name);
  assert.ok(child && child.type === "folder", `expected folder "${name}"`);
  return child as AssetFolderNode;
}

/** The names of a folder's children, in emitted order. */
function childNames(node: AssetFolderNode): string[] {
  return node.children.map((c: AssetNode) => c.name);
}

// ---------------------------------------------------------------------------
// Honest, distinct empty states.
// ---------------------------------------------------------------------------
test("scratch mode (no folder) reports no-project", () => {
  assert.deepEqual(
    buildAssetInventory(snapshot({ hasProject: false, contentRootExists: false })),
    { state: "no-project" },
  );
});

test("folder project without a Content directory reports no-content-dir", () => {
  assert.deepEqual(
    buildAssetInventory(snapshot({ contentRootExists: false })),
    { state: "no-content-dir" },
  );
});

test("folder project with an empty Content directory reports empty-content", () => {
  assert.deepEqual(
    buildAssetInventory(snapshot({ contentRootExists: true, contentFiles: [] })),
    { state: "empty-content" },
  );
});

test("no-content-dir and empty-content are distinct states", () => {
  const noDir = buildAssetInventory(snapshot({ contentRootExists: false }));
  const emptyDir = buildAssetInventory(snapshot({ contentRootExists: true, contentFiles: [] }));
  assert.notEqual(noDir.state, emptyDir.state);
});

// ---------------------------------------------------------------------------
// Recursive Content hierarchy: one root, nested folders, filenames only.
// ---------------------------------------------------------------------------
test("populated inventory has a single Content root", () => {
  const r = root(snapshot({ contentFiles: [file("tile.xnb")] }));
  assert.equal(r.type, "folder");
  assert.equal(r.name, "Content");
  assert.equal(r.path, "Content");
});

test("root-level files are leaf children of Content", () => {
  const r = root(snapshot({ contentFiles: [file("tile.xnb"), file("hero.png")] }));
  const files = r.children.filter(c => c.type === "file");
  assert.deepEqual(files.map(f => f.name), ["hero.png", "tile.xnb"]);
  assert.equal(r.children.every(c => c.type === "file"), true);
  // A leaf carries its filename and a rooted display path, nothing else.
  const tile = r.children.find(c => c.name === "tile.xnb")!;
  assert.deepEqual({ ...tile }, { type: "file", name: "tile.xnb", path: "Content/tile.xnb" });
});

test("nested folders/subfolders are created recursively", () => {
  const r = root(
    snapshot({
      contentFiles: [
        file("textures/player.png"),
        file("textures/enemies/goblin.png"),
        file("audio/blip.wav"),
      ],
    }),
  );
  const textures = folder(r, "textures");
  assert.equal(textures.path, "Content/textures");
  const enemies = folder(textures, "enemies");
  assert.equal(enemies.path, "Content/textures/enemies");
  const goblin = enemies.children[0];
  assert.deepEqual({ ...goblin }, {
    type: "file",
    name: "goblin.png",
    path: "Content/textures/enemies/goblin.png",
  });
});

// ---------------------------------------------------------------------------
// Folders before files, deterministic lexical order, at every level.
// ---------------------------------------------------------------------------
test("folders sort before files at the root", () => {
  const r = root(
    snapshot({
      contentFiles: [
        file("zzz.png"), // a root file that lexically sorts after folders
        file("audio/tone.wav"),
        file("textures/player.png"),
      ],
    }),
  );
  assert.deepEqual(childNames(r), ["audio", "textures", "zzz.png"]);
  assert.deepEqual(
    r.children.map(c => c.type),
    ["folder", "folder", "file"],
  );
});

test("folders sort before files within a nested folder too", () => {
  const r = root(
    snapshot({
      contentFiles: [
        file("assets/readme.png"),        // file directly under assets
        file("assets/sub/inner.png"),     // subfolder under assets
        file("assets/audio/clip.wav"),    // another subfolder under assets
      ],
    }),
  );
  const assets = folder(r, "assets");
  // Folders (audio, sub) first in lexical order, then the file (readme.png).
  assert.deepEqual(childNames(assets), ["audio", "sub", "readme.png"]);
});

test("both categories sort deterministically regardless of input order", () => {
  // Deliberately unsorted input to prove the model sorts, not the source order.
  const r = root(
    snapshot({
      contentFiles: [
        file("textures/player.png"),
        file("audio/tone.wav"),
        file("textures/enemy.png"),
        file("audio/blip.xnb"),
        file("audio/aaa.wav"),
      ],
    }),
  );
  const audio = folder(r, "audio");
  assert.deepEqual(childNames(audio), ["aaa.wav", "blip.xnb", "tone.wav"]);
  const textures = folder(r, "textures");
  assert.deepEqual(childNames(textures), ["enemy.png", "player.png"]);
  // Sibling folders themselves are lexical: audio before textures.
  assert.deepEqual(
    r.children.filter(c => c.type === "folder").map(c => c.name),
    ["audio", "textures"],
  );
});

// ---------------------------------------------------------------------------
// Path normalisation.
// ---------------------------------------------------------------------------
test("backslash paths are normalised to forward slashes", () => {
  const r = root(snapshot({ contentFiles: [file("textures\\player.png")] }));
  const textures = folder(r, "textures");
  assert.equal(textures.path, "Content/textures");
  assert.equal(textures.children[0].name, "player.png");
  assert.equal(textures.children[0].path, "Content/textures/player.png");
});

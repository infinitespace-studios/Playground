// Tests for the asset-import pure logic (issue 066) and the controller flow.
//
// The pure module (`asset-import.ts`) is covered directly; the controller
// (`asset-import-controller.ts`) is exercised with injected hooks + a fake
// confirmation so the confirm→sequential-import→refresh path and the drag/drop
// bridge run deterministically with no browser dialog.
//
// Runs under `node --test` with no dependencies.

import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  baseName,
  classifySources,
  defaultFolderForExtension,
  extensionOf,
  importSequentially,
  positionInRect,
  validateDestination,
  type ImportInvoker,
  type ImportRequest,
} from "./asset-import.ts";
import {
  installAssetImport,
  sanitizeDragDropPayload,
  DRAG_DROP_PHASES,
  type AssetImportHooks,
  type DragDropPayload,
} from "./asset-import-controller.ts";
import type { ImportPlan } from "./asset-import.ts";

// ---------------------------------------------------------------------------
// Pure mapping / classification.
// ---------------------------------------------------------------------------

test("maps recognized extensions to visible default folders", () => {
  assert.equal(defaultFolderForExtension("png"), "Textures");
  assert.equal(defaultFolderForExtension("jpg"), "Textures");
  assert.equal(defaultFolderForExtension("jpeg"), "Textures");
  assert.equal(defaultFolderForExtension("bmp"), "Textures");
  assert.equal(defaultFolderForExtension("wav"), "Audio");
  assert.equal(defaultFolderForExtension("xnb"), "Precompiled");
  // Case-insensitive.
  assert.equal(defaultFolderForExtension("PNG"), "Textures");
  // Unsupported.
  assert.equal(defaultFolderForExtension("fbx"), null);
  assert.equal(defaultFolderForExtension("txt"), null);
});

test("baseName and extensionOf handle Windows and POSIX paths", () => {
  assert.equal(baseName("/home/a/player.png"), "player.png");
  assert.equal(baseName("C:\\art\\enemy.wav"), "enemy.wav");
  assert.equal(baseName("bare.png"), "bare.png");
  assert.equal(baseName("/trailing/slash/"), "");
  assert.equal(extensionOf("player.png"), "png");
  assert.equal(extensionOf("archive.tar.gz"), "gz");
  assert.equal(extensionOf("noext"), null);
  assert.equal(extensionOf(".hidden"), null);
  assert.equal(extensionOf("trailing."), null);
});

test("classifySources separates candidates, folders, URLs, and unsupported", () => {
  const plan = classifySources([
    "/img/player.png",
    "C:\\audio\\blip.wav",
    "/models/ship.fbx", // unsupported
    "/some/folder/", // folder (trailing slash → empty basename)
    "https://example.com/a.png", // URL
    "/data/level.xnb",
  ]);
  assert.equal(plan.candidates.length, 3);
  assert.deepEqual(
    plan.candidates.map(c => c.defaultDestination),
    ["Textures/player.png", "Audio/blip.wav", "Precompiled/level.xnb"],
  );
  assert.equal(plan.rejections.length, 3);
  assert.match(plan.rejections[0].reason, /Unsupported type "\.fbx"/);
  assert.match(plan.rejections[1].reason, /Folders are not supported/);
  assert.match(plan.rejections[2].reason, /URLs are not supported/);
});

test("classifySources preserves order and keeps mixed batches honest", () => {
  const plan = classifySources(["/a.wav", "/b.doc", "/c.png"]);
  assert.deepEqual(plan.candidates.map(c => c.fileName), ["a.wav", "c.png"]);
  assert.deepEqual(plan.rejections.map(r => r.fileName), ["b.doc"]);
});

// ---------------------------------------------------------------------------
// Destination validation (mirrors the Rust command's rules).
// ---------------------------------------------------------------------------

test("validateDestination accepts supported relative paths", () => {
  assert.equal(validateDestination("Textures/player.png"), null);
  assert.equal(validateDestination("Audio/sub/blip.wav"), null);
  assert.equal(validateDestination("Precompiled/level.xnb"), null);
});

test("validateDestination rejects unsafe paths like the Rust command", () => {
  for (const bad of [
    "",
    "/etc/passwd.png",
    "\\win\\a.png",
    "C:/x.png",
    "../escape.png",
    "a/../../escape.png",
    "./local.png",
    "a//b.png",
    ".hidden.png",
    "sub/.hidden/x.png",
    "notes.txt",
    "noextension",
    "weird*name.png",
    "CON.png",
    "dir/CON/x.png",
    "sub /file.png",
    " leading.png",
    "trailingdot.png.",
  ]) {
    assert.notEqual(validateDestination(bad), null, `must reject ${JSON.stringify(bad)}`);
  }
  // Oversized destination.
  assert.notEqual(validateDestination(`${"a".repeat(1024)}.png`), null);
});

// ---------------------------------------------------------------------------
// positionInRect hit-test.
// ---------------------------------------------------------------------------

test("positionInRect gates the drop affordance", () => {
  const rect = { left: 0, top: 0, right: 100, bottom: 200 };
  assert.equal(positionInRect(50, 100, rect), true);
  assert.equal(positionInRect(0, 0, rect), true); // inclusive edges
  assert.equal(positionInRect(100, 200, rect), true);
  assert.equal(positionInRect(150, 100, rect), false); // right of rail
  assert.equal(positionInRect(50, 250, rect), false); // below rail
});

// ---------------------------------------------------------------------------
// Sequential import — accurate mixed results; one failure never misreports.
// ---------------------------------------------------------------------------

function req(destination: string, fileName = destination): ImportRequest {
  return { sourcePath: `/src/${fileName}`, fileName, destination };
}

test("importSequentially aggregates imported/conflict/error accurately", async () => {
  const calls: string[] = [];
  const invoke: ImportInvoker = async request => {
    calls.push(request.destination);
    if (request.destination === "Textures/ok.png") {
      return { status: "imported", relativePath: request.destination, byteLength: 10, sha256: "abc" };
    }
    if (request.destination === "Textures/dupe.png") {
      return { status: "conflict", relativePath: request.destination };
    }
    if (request.destination === "Audio/boom.wav") {
      throw new Error("native failure");
    }
    return { status: "imported", relativePath: request.destination, byteLength: 1, sha256: "d" };
  };
  const summary = await importSequentially(
    [req("Textures/ok.png"), req("Textures/dupe.png"), req("Audio/boom.wav"), req("Precompiled/x.xnb")],
    invoke,
  );
  // Sequential (order preserved).
  assert.deepEqual(calls, [
    "Textures/ok.png",
    "Textures/dupe.png",
    "Audio/boom.wav",
    "Precompiled/x.xnb",
  ]);
  assert.equal(summary.imported, 2);
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.errors, 1);
  // One failure does not misreport the others.
  assert.equal(summary.outcomes[0].status, "imported");
  assert.equal(summary.outcomes[1].status, "conflict");
  assert.equal(summary.outcomes[2].status, "error");
  assert.equal(summary.outcomes[3].status, "imported");
});

// ---------------------------------------------------------------------------
// Controller flow — picker + drop through a fake confirmation.
// ---------------------------------------------------------------------------

interface Recorder {
  imports: Array<{ sourcePath: string; destination: string }>;
  refreshed: number;
  errors: Array<{ title: string; message: string }>;
  statuses: string[];
}

function makeHooks(
  overrides: Partial<AssetImportHooks> & { plan?: (plan: ImportPlan) => ImportRequest[] | null },
): { hooks: AssetImportHooks; rec: Recorder } {
  const rec: Recorder = { imports: [], refreshed: 0, errors: [], statuses: [] };
  const hooks: AssetImportHooks = {
    hasProject: overrides.hasProject ?? (() => true),
    pickImportFiles: overrides.pickImportFiles ?? (async () => null),
    importAsset:
      overrides.importAsset ??
      (async (sourcePath, destination) => {
        rec.imports.push({ sourcePath, destination });
        return { status: "imported", relativePath: destination, byteLength: 1, sha256: "x" };
      }),
    refreshContent:
      overrides.refreshContent ??
      (async () => {
        rec.refreshed++;
      }),
    showError:
      overrides.showError ??
      ((title, message) => {
        rec.errors.push({ title, message });
      }),
    showStatus:
      overrides.showStatus ??
      (message => {
        rec.statuses.push(message);
      }),
    // A deterministic confirmation: confirm every candidate at its default
    // destination (or run the injected plan transform).
    confirmDestinations:
      overrides.confirmDestinations ??
      (async plan =>
        overrides.plan
          ? overrides.plan(plan)
          : plan.candidates.map(c => ({
              sourcePath: c.sourcePath,
              fileName: c.fileName,
              destination: c.defaultDestination,
            }))),
  };
  return { hooks, rec };
}

// A capable in-memory fake DOM host. It records structure (children, tag,
// className, attributes) so tests can assert WHERE the import button lands and
// WHICH element receives `data-drop-active`, without jsdom. Only the surface the
// controller touches is implemented.
class FakeEl {
  tag: string;
  className = "";
  textContent = "";
  hidden = false;
  value = "";
  type = "";
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  rect: { left: number; top: number; right: number; bottom: number } | null = {
    left: 0,
    top: 0,
    right: 1000,
    bottom: 1000,
  };

  constructor(tag: string) {
    this.tag = tag;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = value;
  }

  append(...children: FakeEl[]): void {
    for (const c of children) this.appendChild(c);
  }

  appendChild(child: FakeEl): FakeEl {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeEl[]): void {
    this.children.length = 0;
    this.append(...children);
  }

  addEventListener(): void {}
  removeEventListener(): void {}

  querySelector(selector: string): FakeEl | null {
    const matches = (node: FakeEl): boolean => {
      if (selector.startsWith(".")) {
        return node.className.split(/\s+/).includes(selector.slice(1));
      }
      if (selector.startsWith("#")) return node.attributes.id === selector.slice(1);
      return node.tag === selector;
    };
    const walk = (node: FakeEl): FakeEl | null => {
      for (const child of node.children) {
        if (matches(child)) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }

  focus(): void {}
  showModal(): void {}
  close(): void {}
  remove(): void {}

  getBoundingClientRect() {
    return this.rect ?? { left: 0, top: 0, right: 0, bottom: 0 };
  }

  /** Test helper: recursively collect descendants matching a class name. */
  collect(className: string): FakeEl[] {
    const out: FakeEl[] = [];
    const walk = (node: FakeEl): void => {
      for (const child of node.children) {
        if (child.className.split(/\s+/).includes(className)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

/** Build a fake host mirroring index.html's asset-browser header structure. */
function makeAssetBrowserHost(): FakeEl {
  const host = new FakeEl("section");
  host.setAttribute("id", "asset-browser");
  host.className = "asset-browser";
  const header = new FakeEl("div");
  header.className = "asset-browser-header";
  const heading = new FakeEl("h2");
  heading.className = "label";
  heading.setAttribute("id", "asset-browser-heading");
  heading.textContent = "Assets";
  header.appendChild(heading);
  host.appendChild(header);
  return host;
}

function fakeDoc(host: FakeEl) {
  return {
    getElementById: (id: string) => (id === "asset-browser" ? host : null),
    createElement: (tag: string) => new FakeEl(tag),
    body: new FakeEl("body"),
  } as unknown as Parameters<typeof installAssetImport>[1];
}

// A no-op DOM host: the controller only needs getElementById/createElement to
// return inert elements. We supply a tiny stub so no rail wiring is exercised.
function stubDoc() {
  return fakeDoc(makeAssetBrowserHost());
}

test("openPicker classifies, confirms, imports sequentially, and refreshes", async () => {
  const { hooks, rec } = makeHooks({
    pickImportFiles: async () => ["/img/player.png", "/audio/blip.wav", "/x.fbx"],
  });
  const target: { __playgroundAssetDrop__?: (json: string) => void } = {};
  const api = installAssetImport(hooks, stubDoc(), target);
  await api.openPicker();
  // The unsupported .fbx is dropped; two candidates import at defaults.
  assert.deepEqual(rec.imports, [
    { sourcePath: "/img/player.png", destination: "Textures/player.png" },
    { sourcePath: "/audio/blip.wav", destination: "Audio/blip.wav" },
  ]);
  assert.equal(rec.refreshed, 1);
  assert.equal(rec.errors.length, 0);
});

test("openPicker cancellation writes nothing and does not refresh", async () => {
  const { hooks, rec } = makeHooks({ pickImportFiles: async () => null });
  const api = installAssetImport(hooks, stubDoc(), {});
  await api.openPicker();
  assert.equal(rec.imports.length, 0);
  assert.equal(rec.refreshed, 0);
});

test("openPicker without a project surfaces an error and imports nothing", async () => {
  const { hooks, rec } = makeHooks({
    hasProject: () => false,
    pickImportFiles: async () => ["/img/player.png"],
  });
  const api = installAssetImport(hooks, stubDoc(), {});
  await api.openPicker();
  assert.equal(rec.imports.length, 0);
  assert.equal(rec.errors.length, 1);
});

test("dialog cancellation (null confirm) writes nothing but still refreshes only when importing", async () => {
  const { hooks, rec } = makeHooks({
    pickImportFiles: async () => ["/img/player.png"],
    confirmDestinations: async () => null, // user cancelled the dialog
  });
  const api = installAssetImport(hooks, stubDoc(), {});
  await api.openPicker();
  assert.equal(rec.imports.length, 0);
  assert.equal(rec.refreshed, 0);
});

test("drag/drop bridge imports only when the drop lands on the rail", async () => {
  const { hooks, rec } = makeHooks({});
  const target: { __playgroundAssetDrop__?: (json: string) => void } = {};
  const api = installAssetImport(hooks, stubDoc(), target);
  assert.equal(typeof target.__playgroundAssetDrop__, "function");

  // A drop over the rail (stub rect is 0..1000) imports.
  await api.handleDragDrop({ phase: "drop", x: 10, y: 10, paths: ["/img/a.png"] } as DragDropPayload);
  assert.deepEqual(rec.imports, [{ sourcePath: "/img/a.png", destination: "Textures/a.png" }]);
  assert.equal(rec.refreshed, 1);

  // The installed global hook parses JSON and dispatches; a malformed payload is
  // ignored (no throw).
  target.__playgroundAssetDrop__?.("not json");
  target.__playgroundAssetDrop__?.(JSON.stringify({ phase: "leave" }));
});

test("mixed import batch reports conflict + error without misreporting", async () => {
  const { hooks, rec } = makeHooks({
    pickImportFiles: async () => ["/a.png", "/b.wav", "/c.xnb"],
    importAsset: async (sourcePath, destination) => {
      if (destination === "Audio/b.wav") return { status: "conflict", relativePath: destination };
      if (destination === "Precompiled/c.xnb") throw new Error("disk full");
      return { status: "imported", relativePath: destination, byteLength: 1, sha256: "z" };
    },
  });
  const api = installAssetImport(hooks, stubDoc(), {});
  await api.openPicker();
  // Still refreshed once (rail reflects the one file that did import).
  assert.equal(rec.refreshed, 1);
  // A mixed batch reports through showError with a per-file detail.
  assert.equal(rec.errors.length, 1);
  assert.match(rec.errors[0].message, /1 imported/);
  assert.match(rec.errors[0].message, /already existed/);
  assert.match(rec.errors[0].message, /1 failed/);
  assert.match(rec.errors[0].message, /disk full/);
});

// ---------------------------------------------------------------------------
// Heading semantics: the "Import assets…" button is a SIBLING of the <h2>,
// appended into the header container, never nested inside the heading.
// ---------------------------------------------------------------------------

test("import button is a sibling of the h2 heading, not nested inside it", () => {
  const host = makeAssetBrowserHost();
  installAssetImport(makeHooks({}).hooks, fakeDoc(host), {});

  const header = host.querySelector(".asset-browser-header")!;
  const heading = host.querySelector("#asset-browser-heading")!;
  const button = host.collect("asset-import-action")[0];
  assert.ok(button, "the import button is rendered");

  // The button lives directly under the header container…
  assert.ok(header.children.includes(button), "button is a child of the header container");
  // …as a SIBLING of the heading, and is NOT nested inside the <h2>.
  assert.equal(heading.children.length, 0, "heading has no nested children");
  assert.ok(!heading.collect("asset-import-action").length, "button is not inside the heading");

  // Accessible labeling is preserved: the heading keeps its id (the section's
  // aria-labelledby target) and its text.
  assert.equal(heading.attributes.id, "asset-browser-heading");
  assert.equal(heading.textContent, "Assets");
  assert.equal(
    button.attributes["aria-label"],
    "Import assets into the project Content folder",
  );
  assert.equal(button.tag, "button");
  assert.equal(button.type, "button");
});

// ---------------------------------------------------------------------------
// Drop affordance: the controller flags the SAME element the CSS selector
// targets. This is the deterministic static/DOM assertion tying the target and
// CSS selector so the dashed outline/background is actually applied.
// ---------------------------------------------------------------------------

test("drag-over flags #asset-browser with data-drop-active matching the CSS selector", async () => {
  const host = makeAssetBrowserHost();
  const api = installAssetImport(makeHooks({}).hooks, fakeDoc(host), {});

  // Enter/over the rail sets the attribute on the asset-browser element itself.
  await api.handleDragDrop({ phase: "enter", x: 10, y: 10 } as DragDropPayload);
  assert.equal(host.attributes["data-drop-active"], "true");
  assert.equal(host.attributes.id, "asset-browser", "the flagged element is #asset-browser");

  // Leaving clears it.
  await api.handleDragDrop({ phase: "leave" } as DragDropPayload);
  assert.equal(host.attributes["data-drop-active"], "false");

  // The shipped stylesheet targets exactly that element+attribute pair, so the
  // dashed outline/background is guaranteed to apply. Assert the selector exists
  // and is NOT the stale `.rail[...]` form that never matched.
  const cssPath = fileURLToPath(new URL("./style.css", import.meta.url));
  const css = readFileSync(cssPath, "utf8");
  assert.match(
    css,
    /#asset-browser\[data-drop-active="true"\]\s*\{[^}]*outline:[^}]*dashed[^}]*\}/,
    "CSS must style #asset-browser[data-drop-active=true] with a dashed outline",
  );
  assert.doesNotMatch(
    css,
    /\.rail\[data-drop-active/,
    "the stale .rail[data-drop-active] selector must be gone",
  );
});

test("index.html wraps the heading in an asset-browser-header container", () => {
  const htmlPath = fileURLToPath(new URL("../index.html", import.meta.url));
  const html = readFileSync(htmlPath, "utf8");
  // The section keeps its accessible name target…
  assert.match(html, /id="asset-browser"[^>]*aria-labelledby="asset-browser-heading"/);
  // …and the heading now lives inside the header container.
  assert.match(
    html,
    /<div class="asset-browser-header">\s*<h2 class="label" id="asset-browser-heading">Assets<\/h2>/,
  );
});

// ---------------------------------------------------------------------------
// Hardened drop-payload validation: malformed phase/paths/coordinates can
// neither throw nor reach classifySources.
// ---------------------------------------------------------------------------

test("sanitizeDragDropPayload accepts only known phases", () => {
  for (const phase of DRAG_DROP_PHASES) {
    assert.deepEqual(sanitizeDragDropPayload({ phase }), { phase });
  }
  for (const bad of ["start", "dropped", "", "DROP", 3, null, undefined]) {
    assert.equal(sanitizeDragDropPayload({ phase: bad }), null, `reject phase ${JSON.stringify(bad)}`);
  }
  // Non-object payloads are rejected outright.
  for (const bad of [null, undefined, 42, "drop", [], true]) {
    assert.equal(sanitizeDragDropPayload(bad), null);
  }
});

test("sanitizeDragDropPayload requires finite coordinates and string-array paths", () => {
  // Finite coordinates pass; NaN/Infinity/non-number reject.
  assert.deepEqual(sanitizeDragDropPayload({ phase: "over", x: 1.5, y: -2 }), {
    phase: "over",
    x: 1.5,
    y: -2,
  });
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "10", null]) {
    assert.equal(sanitizeDragDropPayload({ phase: "over", x: bad }), null, `reject x ${bad}`);
    assert.equal(sanitizeDragDropPayload({ phase: "over", y: bad }), null, `reject y ${bad}`);
  }
  // paths must be an array of strings; any non-string entry rejects the payload.
  assert.deepEqual(sanitizeDragDropPayload({ phase: "drop", paths: ["/a.png", "/b.wav"] }), {
    phase: "drop",
    paths: ["/a.png", "/b.wav"],
  });
  for (const bad of ["/a.png", 5, {}, null, ["/a.png", 5], [{}], [null]]) {
    assert.equal(sanitizeDragDropPayload({ phase: "drop", paths: bad }), null, `reject paths ${JSON.stringify(bad)}`);
  }
});

test("global drop hook ignores malformed payloads without throwing or importing", async () => {
  const classifyingHost = makeAssetBrowserHost();
  const { hooks, rec } = makeHooks({});
  const target: { __playgroundAssetDrop__?: (json: string) => void } = {};
  installAssetImport(hooks, fakeDoc(classifyingHost), target);
  const hook = target.__playgroundAssetDrop__!;

  // None of these may throw or trigger an import (they never reach classifySources).
  hook("not json at all");
  hook(JSON.stringify({ phase: "bogus", paths: ["/x.png"] }));
  hook(JSON.stringify({ phase: "drop", x: "NaNish", paths: ["/x.png"] }));
  hook(JSON.stringify({ phase: "drop", paths: ["/x.png", 42] }));
  hook(JSON.stringify({ phase: "drop", paths: "/x.png" }));
  hook(JSON.stringify({ phase: "drop", x: Number.POSITIVE_INFINITY, paths: ["/x.png"] }));
  hook(JSON.stringify(null));
  hook(JSON.stringify(42));

  // Let any accidentally-scheduled async work settle.
  await Promise.resolve();
  assert.equal(rec.imports.length, 0, "no malformed payload imported anything");
  assert.equal(rec.errors.length, 0, "no malformed payload surfaced an error");

  // A well-formed drop over the rail still works through the hardened hook.
  hook(JSON.stringify({ phase: "drop", x: 10, y: 10, paths: ["/img/ok.png"] }));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(rec.imports, [{ sourcePath: "/img/ok.png", destination: "Textures/ok.png" }]);
});

test("handleDragDrop drop branch filters non-string paths defensively", async () => {
  const { hooks, rec } = makeHooks({});
  const api = installAssetImport(hooks, stubDoc(), {});
  // A direct caller sneaks a non-string into paths; it is filtered out and only
  // the valid string path imports (classifySources never sees the non-string).
  await api.handleDragDrop({
    phase: "drop",
    x: 10,
    y: 10,
    paths: ["/img/a.png", 123 as unknown as string, "/audio/b.wav"],
  } as DragDropPayload);
  assert.deepEqual(rec.imports, [
    { sourcePath: "/img/a.png", destination: "Textures/a.png" },
    { sourcePath: "/audio/b.wav", destination: "Audio/b.wav" },
  ]);
});

// Deterministic DOM-renderer tests for the file-rail asset browser (issue 064).
//
// The pure view model has its own tests (`asset-inventory.test.ts`); THIS file
// covers the DOM layer (`asset-browser.ts`) so a regression in the emitted
// markup fails CI rather than only being caught by manual GUI inspection.
//
// No jsdom, no new dependency: `installAssetBrowser` takes an injectable
// document, and this file drives it with a tiny in-memory fake DOM that records
// exactly the structure/attributes the renderer produces. We assert on:
//   - honest static LIST semantics (`ul`/`li`, no tree/treeitem/aria-expanded),
//   - a single Content root with nested folders and filenames only,
//   - NO per-file metadata (no kind tag, size, count, or profile line),
//   - accessible folder-list names,
//   - the three distinct empty states, and
//   - full stale replacement when re-rendering.
//
// Runs under `node --test` with no dependencies.

import assert from "node:assert/strict";
import test from "node:test";
import {
  installAssetBrowser,
  type RenderDocument,
  type RenderElement,
} from "./asset-browser.ts";
import type { ProjectContentSnapshot, RawContentFile } from "./asset-inventory.ts";

// ---------------------------------------------------------------------------
// Tiny in-memory fake DOM (only what the renderer touches).
// ---------------------------------------------------------------------------

class FakeElement implements RenderElement {
  className = "";
  textContent = "";
  readonly dataset: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  parent: FakeElement | null = null;
  readonly tag: string;

  constructor(tag: string) {
    this.tag = tag;
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  append(...children: RenderElement[]): void {
    for (const child of children) this.appendChild(child);
  }

  appendChild(child: RenderElement): RenderElement {
    const node = child as FakeElement;
    // A document fragment is a transparent container: append its children, not
    // the fragment itself (mirrors real DOM behaviour).
    if (node.tag === "#fragment") {
      for (const grandchild of [...node.children]) this.appendChild(grandchild);
      return child;
    }
    node.parent = this;
    this.children.push(node);
    return child;
  }

  replaceChildren(...children: RenderElement[]): void {
    this.children.length = 0;
    this.append(...children);
  }

  querySelector(selector: string): RenderElement | null {
    if (!selector.startsWith(".")) throw new Error(`unsupported selector: ${selector}`);
    const wanted = selector.slice(1);
    const walk = (node: FakeElement): FakeElement | null => {
      for (const child of node.children) {
        if (child.className.split(/\s+/).includes(wanted)) return child;
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
  }

  remove(): void {
    if (!this.parent) return;
    const index = this.parent.children.indexOf(this);
    if (index >= 0) this.parent.children.splice(index, 1);
    this.parent = null;
  }

  /** Test helper: recursively collect descendants matching a class name. */
  collect(className: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.className.split(/\s+/).includes(className)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  /** Test helper: recursively collect descendants with a given tag. */
  collectTag(tag: string): FakeElement[] {
    const out: FakeElement[] = [];
    const walk = (node: FakeElement): void => {
      for (const child of node.children) {
        if (child.tag === tag) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }
}

class FakeDocument implements RenderDocument {
  private readonly byId = new Map<string, FakeElement>();

  constructor() {
    const host = new FakeElement("section");
    host.attributes.id = "asset-browser";
    this.byId.set("asset-browser", host);
  }

  get host(): FakeElement {
    return this.byId.get("asset-browser")!;
  }

  /** The renderer's owned body element (created lazily on first install). */
  get body(): FakeElement {
    return this.host.querySelector(".asset-browser-body") as FakeElement;
  }

  getElementById(id: string): RenderElement | null {
    return this.byId.get(id) ?? null;
  }

  createElement(tag: string): RenderElement {
    return new FakeElement(tag);
  }

  createDocumentFragment(): RenderElement {
    return new FakeElement("#fragment");
  }
}

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

// ---------------------------------------------------------------------------
// Static list semantics (NOT an interactive tree).
// ---------------------------------------------------------------------------
test("renders a static nested list (ul/li), never tree/treeitem semantics", () => {
  const doc = new FakeDocument();
  const browser = installAssetBrowser(doc);
  browser.render(
    snapshot({
      contentFiles: [file("textures/player.png"), file("tile.xnb")],
    }),
  );

  // An outer list with an accessible name, plus a nested list per folder.
  const lists = doc.body.collectTag("ul");
  assert.ok(lists.length >= 2, "expected an outer list plus nested folder lists");
  const outer = doc.body.collect("asset-tree");
  assert.equal(outer.length, 1);
  assert.equal(outer[0].tag, "ul");
  assert.equal(outer[0].attributes["aria-label"], "Project Content assets");

  // Folder + file nodes are list items.
  for (const f of doc.body.collect("asset-folder")) assert.equal(f.tag, "li");
  for (const f of doc.body.collect("asset-file")) assert.equal(f.tag, "li");

  // No fake interactive tree semantics anywhere.
  const everything = [...doc.body.collectTag("li"), ...doc.body.collectTag("ul")];
  for (const node of everything) {
    assert.equal(node.attributes.role, undefined, "no tree/treeitem/group roles");
    assert.equal(node.attributes["aria-expanded"], undefined, "no fake collapsibility");
    assert.equal(node.attributes["aria-level"], undefined, "no tree levels");
  }
});

// ---------------------------------------------------------------------------
// One Content root, nested folders, filenames only.
// ---------------------------------------------------------------------------
test("renders one Content root containing nested folders and filenames only", () => {
  const doc = new FakeDocument();
  installAssetBrowser(doc).render(
    snapshot({
      contentFiles: [
        file("textures/player.png"),
        file("textures/enemies/goblin.png"),
        file("audio/blip.wav"),
        file("tile.xnb"),
      ],
    }),
  );

  // Exactly one Content root, whose label is the folder name only.
  const rootLabels = doc.body
    .collect("asset-folder-name")
    .filter(n => n.textContent === "Content");
  assert.equal(rootLabels.length, 1);

  // Folder labels are plain names (no paths, counts, or metadata).
  const folderNames = doc.body.collect("asset-folder-name").map(n => n.textContent);
  assert.deepEqual(folderNames.sort(), ["Content", "audio", "enemies", "textures"]);

  // File items show the filename only — no kind tag, size, or extra text.
  const fileNames = doc.body.collect("asset-name").map(n => n.textContent).sort();
  assert.deepEqual(fileNames, ["blip.wav", "goblin.png", "player.png", "tile.xnb"]);

  // Each file item has exactly one child span (the name) and no metadata spans.
  for (const item of doc.body.collect("asset-file")) {
    assert.equal(item.children.length, 1);
    assert.equal(item.children[0].className, "asset-name");
  }
});

test("no metadata is rendered: no kind tags, sizes, counts, or profile line", () => {
  const doc = new FakeDocument();
  installAssetBrowser(doc).render(
    snapshot({ contentFiles: [file("audio/tone.wav"), file("tile.xnb")] }),
  );
  assert.equal(doc.body.collect("asset-kind-tag").length, 0, "no kind tags");
  assert.equal(doc.body.collect("asset-size").length, 0, "no byte sizes");
  assert.equal(doc.body.collect("asset-summary").length, 0, "no asset count");
  assert.equal(doc.body.collect("asset-profile").length, 0, "no profile line");

  // Belt-and-braces: no rendered text carries a bracketed kind tag like [IMG].
  const allText = doc.body
    .collect("asset-name")
    .concat(doc.body.collect("asset-folder-name"))
    .map(n => n.textContent)
    .join(" | ");
  assert.doesNotMatch(allText, /\[(IMG|SND|XNB|BIN)\]/i);
});

// ---------------------------------------------------------------------------
// Accessible names: nested folder lists are named by their path.
// ---------------------------------------------------------------------------
test("nested folder lists carry an accessible name (their rooted path)", () => {
  const doc = new FakeDocument();
  installAssetBrowser(doc).render(
    snapshot({ contentFiles: [file("textures/player.png"), file("textures/enemies/goblin.png")] }),
  );
  const nested = doc.body.collect("asset-folder-children");
  const names = nested.map(n => n.attributes["aria-label"]);
  assert.ok(names.includes("Content"));
  assert.ok(names.includes("Content/textures"));
  assert.ok(names.includes("Content/textures/enemies"));
});

// ---------------------------------------------------------------------------
// Folders before files, deterministic order, as emitted into the DOM.
// ---------------------------------------------------------------------------
test("emitted DOM order lists folders before files at each level", () => {
  const doc = new FakeDocument();
  installAssetBrowser(doc).render(
    snapshot({
      contentFiles: [file("zzz.png"), file("audio/tone.wav"), file("textures/player.png")],
    }),
  );
  // The Content root's direct children, in DOM order.
  const contentList = doc.body
    .collect("asset-folder-children")
    .find(n => n.attributes["aria-label"] === "Content")!;
  const order = contentList.children.map(c =>
    c.className.includes("asset-folder") ? `dir:${c.collect("asset-folder-name")[0].textContent}` : `file:${c.collect("asset-name")[0].textContent}`,
  );
  assert.deepEqual(order, ["dir:audio", "dir:textures", "file:zzz.png"]);
});

// ---------------------------------------------------------------------------
// Honest, distinct empty states.
// ---------------------------------------------------------------------------
test("each empty state renders its own honest message and no list", () => {
  const cases: Array<[Partial<ProjectContentSnapshot>, RegExp]> = [
    [{ hasProject: false, contentRootExists: false }, /Open a folder project/],
    [{ contentRootExists: false }, /no Content folder/],
    [{ contentRootExists: true, contentFiles: [] }, /no recognised assets/],
  ];
  for (const [override, pattern] of cases) {
    const doc = new FakeDocument();
    installAssetBrowser(doc).render(snapshot(override));
    const empty = doc.body.collect("asset-browser-empty");
    assert.equal(empty.length, 1);
    assert.match(empty[0].textContent, pattern);
    assert.equal(doc.body.collect("asset-tree").length, 0, "no list in an empty state");
  }
});

// ---------------------------------------------------------------------------
// Stale replacement: re-rendering fully replaces prior content.
// ---------------------------------------------------------------------------
test("re-rendering fully replaces prior content (no stale assets survive)", () => {
  const doc = new FakeDocument();
  const browser = installAssetBrowser(doc);

  browser.render(snapshot({ contentFiles: [file("textures/player.png")] }));
  assert.equal(doc.body.collect("asset-file").length, 1);
  assert.equal(doc.body.collect("asset-name")[0].textContent, "player.png");

  // Switch to a different project's inventory.
  browser.render(snapshot({ contentFiles: [file("audio/blip.xnb")] }));
  const files = doc.body.collect("asset-name");
  assert.equal(files.length, 1);
  assert.equal(files[0].textContent, "blip.xnb");

  // Switch to scratch mode: the list must be gone entirely.
  browser.render(snapshot({ hasProject: false, contentRootExists: false }));
  assert.equal(doc.body.collect("asset-file").length, 0);
  assert.equal(doc.body.collect("asset-tree").length, 0);
  assert.equal(doc.body.collect("asset-browser-empty").length, 1);
});

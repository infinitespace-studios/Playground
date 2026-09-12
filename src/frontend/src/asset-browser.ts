// Asset browser — renders the project's discovered `Content/` inventory into
// the file rail host created by issue 059 (`#asset-browser`). Issue 064.
//
// This is the DOM layer over the pure `asset-inventory.ts` view model. It
// renders:
//   - honest, distinct empty states (scratch / no Content folder / empty
//     Content folder), and
//   - a conventional recursive file-explorer hierarchy: one `Content` root,
//     arbitrarily nested folders/subfolders, and filenames only.
//
// It shows NO per-file metadata — no kind tag, byte size, asset count, or
// profile/validation state. Just folder and file names, like a plain file
// explorer.
//
// Accessibility note: the inventory is a read-only listing, not an interactive
// widget. It therefore uses honest static list semantics — plain nested
// `<ul>`/`<li>` (whose implicit `list`/`listitem` roles need no ARIA), with the
// top list given an accessible name. It deliberately does NOT use
// `tree`/`treeitem`/`group`/`aria-expanded`/`aria-level`: nothing here is
// collapsible or focusable, and claiming an interactive tree that cannot be
// operated would be a lie to assistive tech. Folder-vs-file is conveyed
// structurally (a folder item owns a nested list) and by a text label class,
// not by color alone.
//
// It moves no file bytes and never asserts an XNB is valid.

import {
  buildAssetInventory,
  type AssetFolderNode,
  type AssetInventory,
  type AssetNode,
  type ProjectContentSnapshot,
} from "./asset-inventory.ts";

const EMPTY_MESSAGES: Record<
  Exclude<AssetInventory["state"], "populated">,
  string
> = {
  "no-project": "Open a folder project to browse its Content assets.",
  "no-content-dir": "This project has no Content folder.",
  "empty-content": "This project's Content folder has no recognised assets.",
};

// ---------------------------------------------------------------------------
// Minimal DOM surface.
//
// The renderer depends only on this narrow slice of the DOM. Injecting a
// document factory lets deterministic tests drive it with a tiny in-memory
// fake (no jsdom, no new dependency) and assert on the emitted list semantics
// and accessible names. The real `document` satisfies this shape structurally
// (we cast it once at the call site).
// ---------------------------------------------------------------------------

export interface RenderElement {
  className: string;
  textContent: string;
  readonly dataset: Record<string, string>;
  setAttribute(name: string, value: string): void;
  append(...children: RenderElement[]): void;
  appendChild(child: RenderElement): RenderElement;
  replaceChildren(...children: RenderElement[]): void;
  querySelector(selector: string): RenderElement | null;
  remove(): void;
}

export interface RenderDocument {
  getElementById(id: string): RenderElement | null;
  createElement(tag: string): RenderElement;
  createDocumentFragment(): RenderElement;
}

/** Render a single file node as a static list item (`listitem`). */
function renderFile(doc: RenderDocument, node: { name: string }): RenderElement {
  const item = doc.createElement("li");
  item.className = "asset-file";
  const name = doc.createElement("span");
  name.className = "asset-name";
  name.textContent = node.name;
  item.appendChild(name);
  return item;
}

/**
 * Render a folder node as a static list item containing a name label and a
 * nested static list of its children (folders first, then files). No
 * `tree`/`group`/`aria-expanded` semantics: it is a plain, non-collapsible
 * nested list. The nested list carries an accessible name so screen readers
 * announce which folder the children belong to.
 */
function renderFolder(doc: RenderDocument, node: AssetFolderNode): RenderElement {
  const item = doc.createElement("li");
  item.className = "asset-folder";

  const label = doc.createElement("span");
  label.className = "asset-folder-name";
  label.textContent = node.name;
  item.appendChild(label);

  const childList = doc.createElement("ul");
  childList.className = "asset-folder-children";
  childList.setAttribute("aria-label", node.path);
  for (const child of node.children) {
    childList.appendChild(renderNode(doc, child));
  }
  item.appendChild(childList);
  return item;
}

function renderNode(doc: RenderDocument, node: AssetNode): RenderElement {
  return node.type === "folder" ? renderFolder(doc, node) : renderFile(doc, node);
}

export interface AssetBrowserApi {
  /** Re-render the rail from a fresh project content snapshot. */
  render: (snapshot: ProjectContentSnapshot) => void;
}

/**
 * Install the asset browser into the rail host. Returns a `render` hook the
 * project manager calls whenever its content inventory changes (open/close and,
 * for later import issues, after an import re-reads the project). Rendering is
 * idempotent and fully replaces prior content, so switching projects (or back
 * to scratch) can never leave stale assets on screen.
 *
 * `doc` is injectable for deterministic DOM-renderer tests; production callers
 * omit it and the real document is used.
 */
export function installAssetBrowser(
  doc: RenderDocument = document as unknown as RenderDocument,
): AssetBrowserApi {
  const host = doc.getElementById("asset-browser");
  if (!host) throw new Error("Asset browser host (#asset-browser) is missing.");

  // Reuse the heading; own a body element beneath it that we fully rebuild.
  const legacyEmpty = doc.getElementById("asset-browser-empty");
  if (legacyEmpty) legacyEmpty.remove();

  let body = host.querySelector(".asset-browser-body");
  if (!body) {
    body = doc.createElement("div");
    body.className = "asset-browser-body";
    host.appendChild(body);
  }
  const bodyEl = body;

  function renderEmpty(state: Exclude<AssetInventory["state"], "populated">): void {
    const message = doc.createElement("p");
    message.className = "asset-browser-empty";
    message.textContent = EMPTY_MESSAGES[state];
    bodyEl.replaceChildren(message);
  }

  function render(snapshot: ProjectContentSnapshot): void {
    const inventory = buildAssetInventory(snapshot);
    if (inventory.state !== "populated") {
      renderEmpty(inventory.state);
      return;
    }

    // Static nested list rooted at the single `Content` folder. Plain
    // `<ul>`/`<li>` carry implicit `list`/`listitem` roles; the outer list is
    // given an accessible name. No interactive tree semantics (nothing collapses
    // or takes focus).
    const list = doc.createElement("ul");
    list.className = "asset-tree";
    list.setAttribute("aria-label", "Project Content assets");
    list.appendChild(renderFolder(doc, inventory.root));

    bodyEl.replaceChildren(list);
  }

  return { render };
}

export default installAssetBrowser;

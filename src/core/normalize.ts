// core/normalize.ts — post-parse cleanup so layout sees predictable trees.

import type { Block, DefinitionItem, Inline, ListItem, TDoc } from "./ast.js";
import { inlineText } from "./ast.js";
import type { Diagnostics } from "./diagnostics.js";
import { buildFootnoteIndex } from "./footnotes.js";
import { isKnownContainer } from "../teml/directives.js";

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const withKids =
      "children" in n ? ({ ...n, children: mergeText(n.children) } as Inline) : n;
    const prev = out[out.length - 1];
    if (withKids.type === "text" && prev?.type === "text") prev.value += withKids.value;
    else out.push(withKids);
  }
  return out;
}

function normalizeListItem(item: ListItem): ListItem {
  const blocks = normalizeBlocks(item.blocks);
  const out: ListItem = { blocks };
  if (item.checked === true || item.checked === false) out.checked = item.checked;
  return out;
}

function normalizeBlocks(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const n = normalizeBlock(b);
    if (n == null) continue;
    if (Array.isArray(n)) out.push(...n);
    else out.push(n);
  }
  return coalesceDefinitionContainers(out);
}

function definitionItemFromContainer(
  b: Extract<Block, { type: "container" }>,
): DefinitionItem | null {
  if (b.name !== "definition") return null;
  const termStr = b.attrs.term;
  if (!termStr) return null;
  return {
    term: [{ type: "text", value: termStr }],
    definitions: [normalizeBlocks(b.children)],
  };
}

/** Merge adjacent :::definition{term="..."} containers into one definitionList. */
function coalesceDefinitionContainers(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let pending: DefinitionItem[] | null = null;

  const flush = () => {
    if (pending?.length) {
      out.push({ type: "definitionList", items: pending });
      pending = null;
    }
  };

  for (const b of blocks) {
    if (b.type === "container" && b.name === "definition") {
      const item = definitionItemFromContainer(b);
      if (item) {
        if (!pending) pending = [];
        pending.push(item);
        continue;
      }
    }
    flush();
    out.push(b);
  }
  flush();
  return out;
}

function normalizeBlock(b: Block): Block | Block[] | null {
  switch (b.type) {
    case "paragraph": {
      const children = mergeText(b.children);
      if (inlineText(children).trim() === "") return null;
      const first = children[0];
      const last = children[children.length - 1];
      if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");
      if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");
      return { ...b, children };
    }
    case "heading":
      return { ...b, children: mergeText(b.children) };
    case "list":
      return { ...b, items: b.items.map(normalizeListItem) };
    case "quote":
      return { ...b, children: normalizeBlocks(b.children) };
    case "table":
      return {
        ...b,
        rows: b.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => mergeText(cell)),
        })),
      };
    case "definitionList":
      return {
        ...b,
        items: b.items.map((item) => ({
          term: mergeText(item.term),
          definitions: item.definitions.map((def) => normalizeBlocks(def)),
        })),
      };
    case "footnoteDefinition":
      return { ...b, id: b.id.trim(), children: normalizeBlocks(b.children) };
    case "container": {
      if (b.name === "footnote") {
        const id = b.attrs.id;
        if (!id) return null;
        return { type: "footnoteDefinition", id, children: normalizeBlocks(b.children) };
      }
      let children = normalizeBlocks(b.children);
      let attrs = b.attrs;
      if (b.name === "card" && !attrs.title && children[0]?.type === "heading") {
        const h = children[0];
        if (h.level >= 2) {
          attrs = { ...attrs, title: inlineText(h.children) };
          children = children.slice(1);
        }
      }
      const normalized: Block = { ...b, attrs, children };
      if (!isKnownContainer(b.name) && children.length === 1) {
        return children[0];
      }
      return normalized;
    }
    default:
      return b;
  }
}

export function normalize(docNode: TDoc, diags?: Diagnostics): TDoc {
  const blocks = normalizeBlocks(docNode.blocks);
  if (diags) buildFootnoteIndex(blocks, diags);
  return { meta: docNode.meta, blocks };
}

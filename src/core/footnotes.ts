// core/footnotes.ts — footnote indexing, validation, and layout ordering (M6.5).

import type { Block, Inline } from "./ast.js";
import type { Diagnostics } from "./diagnostics.js";

export type FootnoteIndex = {
  /** Document-order number (1-based) for each definition id. */
  order: Map<string, number>;
  /** Definition blocks keyed by id. */
  definitions: Map<string, Extract<Block, { type: "footnoteDefinition" }>>;
};

function walkInlines(nodes: Inline[], visit: (n: Inline) => void): void {
  for (const n of nodes) {
    visit(n);
    if (
      n.type === "bold" ||
      n.type === "italic" ||
      n.type === "underline" ||
      n.type === "strike" ||
      n.type === "link" ||
      n.type === "span"
    ) {
      walkInlines(n.children, visit);
    }
  }
}

function walkBlocks(blocks: Block[], visitBlock: (b: Block) => void, visitRef?: (id: string) => void): void {
  for (const b of blocks) {
    visitBlock(b);
    switch (b.type) {
      case "paragraph":
      case "heading":
        if (visitRef) {
          walkInlines(b.children, (n) => {
            if (n.type === "footnoteRef") visitRef(n.id);
          });
        }
        break;
      case "list":
        for (const item of b.items) walkBlocks(item.blocks, visitBlock, visitRef);
        break;
      case "quote":
      case "footnoteDefinition":
        walkBlocks(b.children, visitBlock, visitRef);
        break;
      case "container":
        walkBlocks(b.children, visitBlock, visitRef);
        break;
      case "definitionList":
        for (const item of b.items) {
          if (visitRef) {
            walkInlines(item.term, (n) => {
              if (n.type === "footnoteRef") visitRef(n.id);
            });
          }
          for (const def of item.definitions) walkBlocks(def, visitBlock, visitRef);
        }
        break;
      case "table":
        if (visitRef) {
          for (const row of b.rows) {
            for (const cell of row.cells) {
              walkInlines(cell, (n) => {
                if (n.type === "footnoteRef") visitRef(n.id);
              });
            }
          }
        }
        break;
    }
  }
}

/** Collect footnote definitions and assign deterministic numbers by first reference order. */
export function buildFootnoteIndex(blocks: Block[], diags: Diagnostics): FootnoteIndex {
  const definitions = new Map<string, Extract<Block, { type: "footnoteDefinition" }>>();
  const defIds = new Set<string>();

  walkBlocks(blocks, (b) => {
    if (b.type !== "footnoteDefinition") return;
    const id = b.id;
    if (defIds.has(id)) {
      diags.warn("footnote-duplicate", `duplicate footnote definition '${id}'`);
    } else {
      defIds.add(id);
      definitions.set(id, b);
    }
  });

  const order = new Map<string, number>();
  const seenRefs = new Set<string>();
  let num = 0;

  walkBlocks(blocks, () => {}, (id) => {
    if (!definitions.has(id)) {
      diags.warn("footnote-missing", `footnote reference '${id}' has no definition`);
      return;
    }
    if (!seenRefs.has(id)) {
      seenRefs.add(id);
      num++;
      order.set(id, num);
    }
  });

  for (const id of definitions.keys()) {
    if (!order.has(id)) {
      num++;
      order.set(id, num);
      diags.warn("footnote-unreferenced", `footnote definition '${id}' is never referenced`);
    }
  }

  return { order, definitions };
}

export function footnoteNumber(index: FootnoteIndex, id: string): number | undefined {
  return index.order.get(id);
}

/** Ordered footnote ids for appendix rendering. */
export function footnoteAppendixOrder(index: FootnoteIndex): string[] {
  return [...index.order.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([id]) => id);
}

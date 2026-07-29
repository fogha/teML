import type { Block, Diagnostics, Inline, SanitizeOpts, TDoc } from "../core/index.js";
import {
  normalizeFragment as normalizeBlocksAtGraft,
  type NormalizeFragmentContext,
} from "../core/normalize.js";
import { htmlToDoc } from "../html/index.js";
import { parseMarkdown } from "../markdown/parse.js";
import { parseTeml } from "../teml/parse.js";
import type { DocFormat } from "./protocol.js";

export type ParsedMutationFragment = { ok: true; blocks: Block[] } | { ok: false; error: string };

/** Parse structural markup through the same frontend, sanitizer, and
 * normalizer used by a complete `render`. Fragment metadata is intentionally
 * discarded: mutations alter document blocks, never session-wide metadata. */
export function parseMutationFragment(
  markup: string,
  format: DocFormat | undefined,
  sanitize: SanitizeOpts,
  diags: Diagnostics,
  context: NormalizeFragmentContext = {},
): ParsedMutationFragment {
  try {
    const ctx = { sanitize };
    let raw: TDoc;
    switch (format ?? "teml") {
      case "html":
        raw = htmlToDoc(markup, { sanitize }, diags);
        break;
      case "markdown":
        raw = parseMarkdown(markup, diags, ctx);
        break;
      case "teml":
        raw = parseTeml(markup, diags, ctx);
        break;
    }
    const blocks = normalizeBlocksAtGraft(raw.blocks, diags, context);
    return blocks.length > 0
      ? { ok: true, blocks }
      : { ok: false, error: "fragment produced no document blocks" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: message };
  }
}

export function countBlocks(blocks: readonly Block[]): number {
  let count = 0;
  for (const block of blocks) {
    count += 1;
    switch (block.type) {
      case "list":
        for (const item of block.items) count += countBlocks(item.blocks);
        break;
      case "quote":
      case "container":
      case "footnoteDefinition":
        count += countBlocks(block.children);
        break;
      case "definitionList":
        for (const item of block.items) {
          for (const definition of item.definitions) count += countBlocks(definition);
        }
        break;
      default:
        break;
    }
  }
  return count;
}

function containsFootnoteReference(inlines: readonly Inline[]): boolean {
  return inlines.some(
    (inline) =>
      inline.type === "footnoteRef" ||
      ("children" in inline && containsFootnoteReference(inline.children)),
  );
}

export function containsFootnoteContent(blocks: readonly Block[]): boolean {
  for (const block of blocks) {
    if (block.type === "footnoteDefinition") return true;
    switch (block.type) {
      case "heading":
      case "paragraph":
        if (containsFootnoteReference(block.children)) return true;
        break;
      case "table":
        if (block.rows.some((row) => row.cells.some((cell) => containsFootnoteReference(cell)))) {
          return true;
        }
        break;
      case "list":
        if (block.items.some((item) => containsFootnoteContent(item.blocks))) return true;
        break;
      case "quote":
      case "container":
        if (containsFootnoteContent(block.children)) return true;
        break;
      case "definitionList":
        if (
          block.items.some(
            (item) =>
              containsFootnoteReference(item.term) ||
              item.definitions.some((definition) => containsFootnoteContent(definition)),
          )
        ) {
          return true;
        }
        break;
      default:
        break;
    }
  }
  return false;
}

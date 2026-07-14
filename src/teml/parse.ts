// teml/parse.ts — remark pipeline frontend; parseTeml is the stable seam (Milestone 3).
// Sanitization happens in mdast-to-tdoc at ingestion (S-1).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkFrontmatter from "remark-frontmatter";
import remarkDirective from "remark-directive";
import type { Root } from "mdast";
import type { Inline } from "../core/ast.js";
import { Diagnostics } from "../core/index.js";
import type { TDoc } from "../core/index.js";
import { mdastInlinesFromFragment, mdastToTDoc, type ParseContext } from "./mdast-to-tdoc.js";

export { parseAttrs } from "./directives.js";
export type { ParseContext };

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkDirective);

/** Parse TeML/Markdown source to an mdast Root (exploratory / shared seam). */
export function parseToMdast(source: string): Root {
  return processor.parse(source.replace(/\r\n?/g, "\n")) as Root;
}

export function parseTeml(
  source: string,
  diags: Diagnostics = new Diagnostics(),
  ctx: ParseContext = {},
): TDoc {
  return mdastToTDoc(parseToMdast(source), diags, ctx);
}

/** Parse an inline fragment (used by tests and legacy call sites). */
export function parseInline(src: string, diags: Diagnostics, _line?: number, ctx: ParseContext = {}): Inline[] {
  return mdastInlinesFromFragment(src, diags, ctx);
}

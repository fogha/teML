// markdown/parse.ts — CommonMark + GFM frontend (no TeML directives/frontmatter).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { Diagnostics } from "../core/diagnostics.js";
import type { TDoc } from "../core/ast.js";
import { mdastToTDoc, type ParseContext } from "../teml/mdast-to-tdoc.js";

const processor = unified().use(remarkParse).use(remarkGfm);

/** Parse Markdown source to mdast (no TeML extensions). */
export function parseMarkdownToMdast(source: string): Root {
  return processor.parse(source.replace(/\r\n?/g, "\n")) as Root;
}

export function parseMarkdown(
  source: string,
  diags: Diagnostics = new Diagnostics(),
  ctx: ParseContext = {},
): TDoc {
  return mdastToTDoc(parseMarkdownToMdast(source), diags, ctx);
}

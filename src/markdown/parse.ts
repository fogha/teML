// markdown/parse.ts — CommonMark + GFM frontend (no TeML directives/frontmatter).

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";
import { Diagnostics } from "../core/diagnostics.js";
import type { TDoc } from "../core/ast.js";
import {
  delimiterRunFallback,
  hasPathologicalDelimiterRun,
  hasPathologicalNesting,
  isStackOverflow,
  parserOverflowFallback,
  pathologicalNestingFallback,
} from "../core/limits.js";
import { mdastToTDoc, type ParseContext } from "../teml/mdast-to-tdoc.js";

const processor = unified().use(remarkParse).use(remarkGfm);

/** Parse Markdown source to mdast (no TeML extensions). */
export function parseMarkdownToMdast(source: string): Root {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (hasPathologicalNesting(normalized) || hasPathologicalDelimiterRun(normalized)) {
    return {
      type: "root",
      children: [{ type: "code", lang: null, meta: null, value: normalized }],
    };
  }
  try {
    return processor.parse(normalized) as Root;
  } catch (error) {
    if (!isStackOverflow(error)) throw error;
    return {
      type: "root",
      children: [{ type: "code", lang: null, meta: null, value: normalized }],
    };
  }
}

export function parseMarkdown(
  source: string,
  diags: Diagnostics = new Diagnostics(),
  ctx: ParseContext = {},
): TDoc {
  const normalized = source.replace(/\r\n?/g, "\n");
  // Deeply chained blockquote/list nesting makes remark-parse's per-line
  // container-continuation check cost superlinear time; see core/limits.ts.
  if (hasPathologicalNesting(normalized)) return pathologicalNestingFallback(normalized, diags);
  if (hasPathologicalDelimiterRun(normalized)) return delimiterRunFallback(normalized, diags);
  try {
    return mdastToTDoc(processor.parse(normalized) as Root, diags, ctx);
  } catch (error) {
    if (!isStackOverflow(error)) throw error;
    return parserOverflowFallback(normalized, diags);
  }
}

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
import {
  delimiterRunFallback,
  hasPathologicalDelimiterRun,
  hasPathologicalNesting,
  isStackOverflow,
  parserOverflowFallback,
  pathologicalNestingFallback,
} from "../core/limits.js";
import { sanitizeText } from "../core/sanitize.js";
import { mdastInlinesFromFragment, mdastToTDoc, type ParseContext } from "./mdast-to-tdoc.js";

export { parseAttrs } from "./directives.js";
export type { ParseContext };

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkFrontmatter, ["yaml"])
  .use(remarkDirective);

// remark-directive's container tokenizer re-validates the whole open-container
// stack per line, so deeply nested `:::` fences cost O(depth) per line inside
// the nest — O(depth^2) overall. A hostile document with a few thousand nested
// fences (tens of KB) can burn tens of seconds of CPU. `parseTeml` guards
// against this with a cheap pre-scan (see maxContainerNesting) before handing
// source to the directive-aware processor; `parseToMdast` is the raw/exploratory
// seam and does not apply the guard.
const MAX_CONTAINER_NESTING = 24;
const FENCE_LINE = /^ {0,3}(:{3,})(.*)$/;

// Same pipeline minus remark-directive, used as a safe fallback for documents
// that fail the nesting check: `:::` fences are left as plain text instead of
// being parsed as containers.
const safeProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);

/**
 * Cheap O(n) scan for the deepest concurrently-open `:::`-fence nesting,
 * without invoking the real (expensive) directive parser. A bare fence line
 * (just colons) closes the innermost open fence; any other fence line opens
 * one. This mirrors the fence-matching remark-directive performs closely
 * enough to bound worst-case parse cost, even though it isn't fence-length-
 * aware and can't see inside code fences.
 */
export function maxContainerNesting(source: string): number {
  let depth = 0;
  let max = 0;
  for (const line of source.split("\n")) {
    const m = FENCE_LINE.exec(line);
    if (!m) continue;
    if (m[2].trim() === "") {
      if (depth > 0) depth -= 1;
    } else {
      depth += 1;
      if (depth > max) max = depth;
    }
  }
  return max;
}

/**
 * Parse TeML/Markdown source to an mdast Root (exploratory / shared seam).
 * Applies the same input guards as `parseTeml`: this is a public entry point,
 * so it cannot assume a caller has already vetted the source. Hostile shapes
 * degrade to a literal code node rather than being parsed.
 */
export function parseToMdast(source: string): Root {
  const normalized = source.replace(/\r\n?/g, "\n");
  if (hasPathologicalNesting(normalized) || hasPathologicalDelimiterRun(normalized)) {
    return literalRoot(normalized);
  }
  const chosen =
    maxContainerNesting(normalized) > MAX_CONTAINER_NESTING ? safeProcessor : processor;
  try {
    return chosen.parse(normalized) as Root;
  } catch (error) {
    if (!isStackOverflow(error)) throw error;
    return literalRoot(normalized);
  }
}

function literalRoot(source: string): Root {
  return { type: "root", children: [{ type: "code", lang: null, meta: null, value: source }] };
}

export function parseTeml(
  source: string,
  diags: Diagnostics = new Diagnostics(),
  ctx: ParseContext = {},
): TDoc {
  const normalized = source.replace(/\r\n?/g, "\n");
  // Checked before the container-fence guard: this covers the (cheaper to
  // trigger, format-agnostic) blockquote/list chaining attack that doesn't
  // involve `:::` fences at all — see core/limits.ts.
  if (hasPathologicalNesting(normalized)) return pathologicalNestingFallback(normalized, diags);
  if (hasPathologicalDelimiterRun(normalized)) return delimiterRunFallback(normalized, diags);
  if (maxContainerNesting(normalized) > MAX_CONTAINER_NESTING) {
    diags.warn(
      "container-nesting-too-deep",
      `container nesting exceeds ${MAX_CONTAINER_NESTING} levels; ':::' fences were treated as plain text for this document to avoid excessive parse cost`,
    );
    return mdastToTDoc(safeProcessor.parse(normalized) as Root, diags, ctx);
  }
  try {
    return mdastToTDoc(processor.parse(normalized) as Root, diags, ctx);
  } catch (error) {
    // The pre-scans above cover the shapes that are cheap to trigger, but the
    // parser's own recursion is the backstop for anything they miss.
    if (!isStackOverflow(error)) throw error;
    return parserOverflowFallback(normalized, diags);
  }
}

/** Parse an inline fragment (used by tests and legacy call sites). */
export function parseInline(
  src: string,
  diags: Diagnostics,
  _line?: number,
  ctx: ParseContext = {},
): Inline[] {
  if (hasPathologicalNesting(src) || hasPathologicalDelimiterRun(src)) {
    diags.warn(
      "pathological-inline-rejected",
      "inline fragment nests markup implausibly deeply; kept as literal text",
    );
    return [{ type: "text", value: sanitizeText(src) }];
  }
  try {
    return mdastInlinesFromFragment(src, diags, ctx);
  } catch (error) {
    if (!isStackOverflow(error)) throw error;
    diags.warn(
      "parse-overflow-rejected",
      "inline fragment nests markup too deeply for the parser; kept as literal text",
    );
    return [{ type: "text", value: sanitizeText(src) }];
  }
}

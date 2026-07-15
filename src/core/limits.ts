// core/limits.ts — pre-parse guard against input shapes that make
// remark-parse/micromark's per-line container-continuation check cost
// superlinear time, applied by both teml/parse.ts and markdown/parse.ts
// before source ever reaches `unified().parse()`.
//
// Deeply chained blockquote (`>`) and/or indented-list nesting makes
// micromark re-validate the whole open-container stack for every line
// inside the nest, so cost grows with nesting depth per line. A single
// chain of ~800 one-item-per-level nested lists (~640KB, well within a
// plausible document size) measured several CPU-seconds to parse; mixing
// in blockquote prefixes reproduces the same cost. Neither containers nor
// list/blockquote nesting this deep occur in real documents, so we detect
// it cheaply (one O(n) scan, no parsing) and refuse the expensive path.

import type { Diagnostics } from "./diagnostics.js";
import type { TDoc } from "./ast.js";
import { sanitizeText } from "./sanitize.js";

const LEADING_PREFIX = /^[ \t>]*/;

/**
 * Estimate how deeply a line's blockquote/indentation prefix nests, without
 * running the real (expensive) parser. Counts leading '>' characters as one
 * nesting level each and leading whitespace columns as one level per 2
 * columns (the minimum a nested list item can indent by). Overcounting is
 * safe — it only makes the guard more conservative.
 */
function linePrefixWeight(line: string): number {
  const prefix = LEADING_PREFIX.exec(line)![0];
  let quotes = 0;
  let spaces = 0;
  for (const ch of prefix) {
    if (ch === ">") quotes += 1;
    else spaces += 1;
  }
  return quotes + Math.floor(spaces / 2);
}

/** Generous ceiling: no legitimately authored document nests blockquotes
 * and/or lists anywhere near this deep. */
const MAX_PREFIX_WEIGHT = 60;

export function hasPathologicalNesting(source: string): boolean {
  for (const line of source.split("\n")) {
    if (linePrefixWeight(line) > MAX_PREFIX_WEIGHT) return true;
  }
  return false;
}

/**
 * Safe fallback for documents that fail `hasPathologicalNesting`: render the
 * raw source as a single literal code block instead of handing it to
 * remark-parse. Structure is lost, but the alternative is tens of seconds
 * (or more) of blocked CPU for a hostile document.
 */
export function pathologicalNestingFallback(source: string, diags: Diagnostics): TDoc {
  diags.warn(
    "pathological-nesting-rejected",
    "document contains implausibly deep blockquote/list nesting; rendered as plain text to avoid excessive parse cost",
  );
  return { meta: {}, blocks: [{ type: "codeBlock", value: sanitizeText(source, "code") }] };
}

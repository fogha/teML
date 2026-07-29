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
 * A long unbroken run of the same emphasis delimiter nests one emphasis node
 * per pair, so `"**".repeat(5000)` builds a ~5000-deep tree and overflows the
 * stack *inside* micromark — before any of our own recursion runs. `***`
 * (bold italic), `___` (thematic break) and `~~~` (code fence) are the longest
 * runs with a legitimate reading, so a 64-char run is already far past
 * anything authored. Counting delimiters per paragraph instead would flag
 * legitimate delimiter-dense content such as a long table of bold cells.
 */
const DELIMITER_RUN = /([*_~])\1{63,}/;

export function hasPathologicalDelimiterRun(source: string): boolean {
  return DELIMITER_RUN.test(source);
}

/**
 * Render source as one literal code block instead of parsing it. Shared by
 * every guard that refuses an input shape, so degradation looks the same
 * however it was triggered.
 */
export function literalSourceFallback(
  source: string,
  diags: Diagnostics,
  code: string,
  message: string,
): TDoc {
  diags.warn(code, message);
  return { meta: {}, blocks: [{ type: "codeBlock", value: sanitizeText(source, "code") }] };
}

export function delimiterRunFallback(source: string, diags: Diagnostics): TDoc {
  return literalSourceFallback(
    source,
    diags,
    "pathological-delimiters-rejected",
    "document contains an implausibly long run of emphasis delimiters; rendered as plain text to avoid excessive parse cost",
  );
}

/** Last-resort degradation for an input that exhausted the stack inside the
 * parser despite the pre-scans above. */
export function parserOverflowFallback(source: string, diags: Diagnostics): TDoc {
  return literalSourceFallback(
    source,
    diags,
    "parse-overflow-rejected",
    "document nests inline markup too deeply for the parser; rendered as plain text",
  );
}

/** True for the stack exhaustion a pathologically nested document triggers
 * inside remark/micromark. Any other error is a real bug and must propagate. */
export function isStackOverflow(error: unknown): boolean {
  return error instanceof RangeError && /call stack/i.test(error.message);
}

/**
 * Safe fallback for documents that fail `hasPathologicalNesting`: render the
 * raw source as a single literal code block instead of handing it to
 * remark-parse. Structure is lost, but the alternative is tens of seconds
 * (or more) of blocked CPU for a hostile document.
 */
export function pathologicalNestingFallback(source: string, diags: Diagnostics): TDoc {
  return literalSourceFallback(
    source,
    diags,
    "pathological-nesting-rejected",
    "document contains implausibly deep blockquote/list nesting; rendered as plain text to avoid excessive parse cost",
  );
}

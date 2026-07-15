// layout/hits.ts — maps a clicked (row, col) back to the focusable widget
// that rendered there (M-interactive follow-up: mouse support).
//
// Threaded through LayoutOpts.hits as one shared mutable array, the same
// pattern already used for opts.diags: every layout function that recurses
// into children is responsible for shifting whatever hits its children
// recorded by however many extra lines *it* prepends before splicing the
// recursive result into its own output. See shiftHits().
//
// Column position is intentionally not tracked in v1: if two widgets land
// on the same absolute row (e.g. side-by-side grid columns), the first one
// recorded wins. Keyboard Tab navigation (interactive/focus.ts) is
// unaffected by any of this — it walks the AST directly.

import type { Block } from "../core/index.js";
import { isFocusableLeaf } from "../teml/directives.js";
import type { Line } from "../render/styledLine.js";
import type { LayoutOpts } from "./opts.js";

export type WidgetHit = { id: string; row: number; height: number };

/**
 * True visual row count of a Line[] array. Usually equal to lines.length,
 * but a hard line-break within a wrapped paragraph survives as a literal
 * "\n" *inside* one span's text (see layout/wrap.ts's toWords — it only
 * splits on runs of spaces, not newlines) rather than as a separate array
 * entry, so a single Line can render as more than one physical terminal
 * row. Row-offset bookkeeping must count that, or every hit after such a
 * paragraph ends up off by however many embedded breaks preceded it.
 */
export function visualHeight(lines: readonly Line[]): number {
  let rows = 0;
  for (const line of lines) {
    rows += 1;
    for (const span of line) {
      for (let i = 0; i < span.text.length; i++) if (span.text.charCodeAt(i) === 10) rows += 1;
    }
  }
  return rows;
}

/**
 * Record a freshly-laid-out focusable leaf at row 0, relative to its own
 * output. Ancestors shift it to an absolute row as layout unwinds, via
 * shiftHits.
 */
export function recordWidgetHit(
  opts: LayoutOpts,
  b: Extract<Block, { type: "leaf" }>,
  lines: readonly Line[],
): void {
  if (!opts.hits || !isFocusableLeaf(b.name)) return;
  const id = b.attrs.id?.trim();
  if (!id) return;
  opts.hits.push({ id, row: 0, height: visualHeight(lines) });
}

/**
 * Shift every hit added since index `hitStart` down by `rowOffset` rows.
 * Call this right after recursing into children, once you know how many
 * lines you're about to prepend ahead of their output (e.g. a card's title
 * bar, a details header, a preceding sibling block).
 */
export function shiftHits(opts: LayoutOpts, hitStart: number, rowOffset: number): void {
  if (!opts.hits || rowOffset === 0) return;
  for (let i = hitStart; i < opts.hits.length; i++) {
    const h = opts.hits[i]!;
    opts.hits[i] = { ...h, row: h.row + rowOffset };
  }
}

/** Find the widget id whose recorded row range contains `row`, if any. */
export function widgetAtRow(hits: readonly WidgetHit[], row: number): string | undefined {
  return hits.find((h) => row >= h.row && row < h.row + h.height)?.id;
}

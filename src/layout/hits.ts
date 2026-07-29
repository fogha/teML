// layout/hits.ts — derives terminal-cell regions for focusable widgets from
// the final styled lines. Widget spans carry an internal `style.widgetId`
// tag; collecting after layout means grid joins, indentation, wrapping,
// clipping, CJK widths, and embedded newlines are already reflected in the
// same coordinate space a host sees.

import type { Line } from "../render/styledLine.js";
import { cellWidth, graphemes, type MeasureOpts } from "./measure.js";

export type WidgetHit = {
  id: string;
  row: number;
  colStart: number;
  colEnd: number;
  kind?: "widget" | "radioOption" | "textareaContent" | "scroll";
  value?: string;
};

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

/** Collect one exact cell interval per physical row occupied by a widget. */
export function collectWidgetHits(lines: readonly Line[], opts?: MeasureOpts): WidgetHit[] {
  const hits: WidgetHit[] = [];
  let row = 0;
  let col = 0;
  let active: WidgetHit | null = null;

  const closeActive = (): void => {
    if (!active) return;
    const previous = hits[hits.length - 1];
    // wrapSpans recreates inter-word spaces with an empty style. Rejoin
    // fragments of the same widget on one row across those spaces, while
    // preserving real grid gutters because the next region has another id.
    if (
      previous &&
      previous.id === active.id &&
      previous.row === active.row &&
      previous.kind === active.kind &&
      previous.value === active.value
    ) {
      previous.colEnd = active.colEnd;
    } else {
      hits.push(active);
    }
    active = null;
  };

  for (const line of lines) {
    col = 0;
    for (const span of line) {
      const segments = span.text.split("\n");
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        if (segmentIndex > 0) {
          closeActive();
          row += 1;
          col = 0;
        }
        const text = segments[segmentIndex]!;
        const width = graphemes(text).reduce((sum, grapheme) => sum + cellWidth(grapheme, opts), 0);
        const id = span.style.interactiveId ?? span.style.widgetId;
        const kind = span.style.interactiveKind;
        const value = span.style.interactiveValue;
        if (id && width > 0) {
          if (
            !active ||
            active.id !== id ||
            active.row !== row ||
            active.colEnd !== col ||
            active.kind !== kind ||
            active.value !== value
          ) {
            closeActive();
            active = {
              id,
              row,
              colStart: col,
              colEnd: col + width,
              ...(kind ? { kind } : {}),
              ...(value !== undefined ? { value } : {}),
            };
          } else {
            active.colEnd += width;
          }
        } else if (!id) {
          closeActive();
        }
        col += width;
      }
    }
    closeActive();
    row += 1;
  }
  return hits;
}

/** Resolve exact 2D containment in terminal-cell coordinates. */
export function widgetAt(hits: readonly WidgetHit[], row: number, col: number): string | undefined {
  return hits.find((hit) => hit.row === row && col >= hit.colStart && col < hit.colEnd)?.id;
}

export function hitAt(hits: readonly WidgetHit[], row: number, col: number): WidgetHit | undefined {
  return hits.find((hit) => hit.row === row && col >= hit.colStart && col < hit.colEnd);
}

/** @deprecated Use widgetAt with a terminal-cell column. */
export function widgetAtRow(hits: readonly WidgetHit[], row: number): string | undefined {
  return hits.find((hit) => hit.row === row)?.id;
}

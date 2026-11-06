// layout/measure.ts — R-5. Cell-width measurement via Intl.Segmenter + string-width.

import stringWidth from "string-width";

export type MeasureOpts = { ambiguousWide?: boolean };

const seg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;

export function* graphemeIterator(s: string): Generator<string> {
  if (PRINTABLE_ASCII.test(s)) {
    for (const character of s) yield character;
    return;
  }
  if (seg) {
    for (const item of seg.segment(s)) yield item.segment;
    return;
  }
  for (const character of s) yield character;
}

export function graphemes(s: string): string[] {
  return Array.from(graphemeIterator(s));
}

function widthOpts(opts?: MeasureOpts): { ambiguousIsNarrow: boolean } {
  return { ambiguousIsNarrow: !(opts?.ambiguousWide ?? false) };
}

export function cellWidth(s: string, opts?: MeasureOpts): number {
  if (PRINTABLE_ASCII.test(s)) return s.length;
  return stringWidth(s, widthOpts(opts));
}

/** Truncate to at most `max` cells, appending `ellipsis` if truncated. */
export function truncateToWidth(
  s: string,
  max: number,
  ellipsis = "…",
  opts?: MeasureOpts,
): string {
  if (cellWidth(s, opts) <= max) return s;
  const ew = cellWidth(ellipsis, opts);
  const budget = Math.max(0, max - ew);
  let out = "";
  let w = 0;
  for (const g of graphemes(s)) {
    const gw = cellWidth(g, opts);
    if (w + gw > budget) break;
    out += g;
    w += gw;
  }
  return out + ellipsis;
}

/** Pad with spaces on the right to exactly `width` cells. */
export function padEnd(s: string, width: number, opts?: MeasureOpts): string {
  const w = cellWidth(s, opts);
  if (w >= width) return s;
  return s + " ".repeat(width - w);
}

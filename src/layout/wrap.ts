// layout/wrap.ts — styled spans, lines, and width-aware word wrapping (R-6).

import { cellWidth, graphemes, type MeasureOpts } from "./measure.js";
import type { Line, Span } from "../render/styledLine.js";

export type { Span, Line };

type Word = { parts: Span[]; width: number };

function toWords(spans: Span[], opts?: MeasureOpts): Word[] {
  const words: Word[] = [];
  let cur: Span[] = [];
  const flush = () => {
    if (cur.length) {
      words.push({ parts: cur, width: cur.reduce((w, s) => w + cellWidth(s.text, opts), 0) });
      cur = [];
    }
  };
  for (const span of spans) {
    const pieces = span.text.split(/( +)/);
    for (const piece of pieces) {
      if (piece === "") continue;
      if (/^ +$/.test(piece)) flush();
      else cur.push({ text: piece, style: span.style });
    }
  }
  flush();
  return words;
}

/** Stand-in for a grapheme too wide to render in the available cells; matches
 * the marker `truncateToWidth` uses. */
const OVERSIZED = "…";

function breakWord(word: Word, width: number, opts?: MeasureOpts): Word[] {
  const out: Word[] = [];
  let parts: Span[] = [];
  let w = 0;
  for (const span of word.parts) {
    for (const raw of graphemes(span.text)) {
      // A grapheme wider than the whole line (a CJK character at width 1) can
      // never fit. Placing it anyway would emit a line over the caller's cell
      // budget, which every downstream slice-by-width consumer relies on.
      let g = raw;
      let gw = cellWidth(g, opts);
      if (gw > width) {
        g = OVERSIZED;
        gw = cellWidth(g, opts);
        if (gw > width) continue;
      }
      if (w + gw > width && w > 0) {
        out.push({ parts, width: w });
        parts = [];
        w = 0;
      }
      const last = parts[parts.length - 1];
      if (last && last.style === span.style) last.text += g;
      else parts.push({ text: g, style: span.style });
      w += gw;
    }
  }
  if (parts.length) out.push({ parts, width: w });
  return out;
}

/** Wrap inline spans to `width` cells. Never returns an empty array. */
export function wrapSpans(spans: Span[], width: number, opts?: MeasureOpts): Line[] {
  const w = Math.max(1, width);
  const lines: Line[] = [];
  let cur: Span[] = [];
  let curW = 0;
  const flush = () => {
    lines.push(cur);
    cur = [];
    curW = 0;
  };
  const place = (word: Word) => {
    const sep = curW > 0 ? 1 : 0;
    if (curW + sep + word.width > w && curW > 0) flush();
    if (word.width > w) {
      for (const piece of breakWord(word, w, opts)) {
        if (curW > 0) flush();
        cur = piece.parts.slice();
        curW = piece.width;
        if (curW >= w) flush();
      }
      return;
    }
    if (curW > 0) {
      cur.push({ text: " ", style: {} });
      curW += 1;
    }
    cur.push(...word.parts.map((p) => ({ ...p })));
    curW += word.width;
  };
  for (const word of toWords(spans, opts)) place(word);
  if (cur.length || lines.length === 0) lines.push(cur);
  return lines;
}

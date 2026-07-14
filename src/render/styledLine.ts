// render/styledLine.ts — styled line primitives (Milestone 2).

import type { Style } from "../terminal/theme.js";
import { cellWidth, type MeasureOpts } from "../layout/measure.js";

export type Span = { text: string; style: Style };
export type Line = Span[];

export function lineWidth(line: Line, opts?: MeasureOpts): number {
  return line.reduce((w, s) => w + cellWidth(s.text, opts), 0);
}

/** Pad a line to a target cell width with optional trailing style. */
export function padLine(line: Line, width: number, style: Style = {}, opts?: MeasureOpts): Line {
  const w = lineWidth(line, opts);
  if (w >= width) return line;
  return [...line, { text: " ".repeat(width - w), style }];
}

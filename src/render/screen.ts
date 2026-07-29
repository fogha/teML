import { cellWidth, graphemes, type MeasureOpts } from "../layout/measure.js";
import type { Line, Span } from "./styledLine.js";

export type ScreenFrame = {
  cols: number;
  rows: number;
  lines: Line[];
};

export type ScreenOp = { type: "clear" } | { type: "row"; row: number; line: Line };

export function physicalLines(lines: readonly Line[]): Line[] {
  const out: Line[] = [];
  for (const line of lines) {
    let current: Line = [];
    for (const span of line) {
      const parts = span.text.split("\n");
      for (let i = 0; i < parts.length; i++) {
        if (parts[i] !== "") current.push({ ...span, text: parts[i]! });
        if (i < parts.length - 1) {
          out.push(current);
          current = [];
        }
      }
    }
    out.push(current);
  }
  return out;
}

function clipSpan(span: Span, budget: number, opts?: MeasureOpts): { span: Span; used: number } {
  if (budget <= 0) return { span: { ...span, text: "" }, used: 0 };
  let text = "";
  let used = 0;
  for (const grapheme of graphemes(span.text)) {
    const width = cellWidth(grapheme, opts);
    if (used + width > budget) break;
    text += grapheme;
    used += width;
  }
  return { span: { ...span, text }, used };
}

export function clipLine(line: Line, cols: number, opts?: MeasureOpts): Line {
  const out: Line = [];
  let used = 0;
  for (const span of line) {
    const clipped = clipSpan(span, cols - used, opts);
    if (clipped.span.text !== "") out.push(clipped.span);
    used += clipped.used;
    if (used >= cols) break;
  }
  if (used < cols) out.push({ text: " ".repeat(cols - used), style: {} });
  return out;
}

export function linesToScreen(
  lines: readonly Line[],
  cols: number,
  rows: number,
  opts?: MeasureOpts,
): ScreenFrame {
  const safeCols = Math.max(1, Math.trunc(cols));
  const safeRows = Math.max(1, Math.trunc(rows));
  const physical = physicalLines(lines);
  const frameLines: Line[] = [];
  for (let row = 0; row < safeRows; row++) {
    frameLines.push(clipLine(physical[row] ?? [], safeCols, opts));
  }
  return { cols: safeCols, rows: safeRows, lines: frameLines };
}

function styleSignature(style: Span["style"]): string {
  return Object.entries(style)
    .filter(
      ([key, value]) =>
        !["widgetId", "interactiveId", "interactiveKind", "interactiveValue"].includes(key) &&
        value !== undefined,
    )
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}:${String(value)}`)
    .join(";");
}

function lineSignature(line: Line): string {
  return line.map((span) => `${styleSignature(span.style)}\0${span.text}`).join("\x01");
}

export function diffFrames(previous: ScreenFrame | null, next: ScreenFrame): ScreenOp[] {
  const fullPaint = previous == null || previous.cols !== next.cols || previous.rows !== next.rows;
  const ops: ScreenOp[] = fullPaint ? [{ type: "clear" }] : [];
  for (let row = 0; row < next.rows; row++) {
    if (
      fullPaint ||
      lineSignature(previous!.lines[row] ?? []) !== lineSignature(next.lines[row] ?? [])
    ) {
      ops.push({ type: "row", row, line: next.lines[row] ?? [] });
    }
  }
  return ops;
}

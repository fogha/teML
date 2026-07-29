import { cellWidth, graphemes, type MeasureOpts } from "./measure.js";

export const DEFAULT_TEXTAREA_ROWS = 4;
export const MAX_TEXTAREA_ROWS = 100;

export type TextareaVisualLine = {
  start: number;
  end: number;
  /** True when the line ends immediately before a newline grapheme. */
  hardBreak: boolean;
  width: number;
};

export function textareaRows(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return DEFAULT_TEXTAREA_ROWS;
  return Math.max(1, Math.min(MAX_TEXTAREA_ROWS, parsed));
}

/** Hard-wrap text by terminal cells while retaining grapheme offsets into the
 * canonical value. Newline graphemes delimit visual lines but are not drawn. */
export function textareaVisualLines(
  value: string,
  contentWidth: number,
  opts?: MeasureOpts,
): TextareaVisualLine[] {
  const chars = graphemes(value);
  const width = Math.max(1, contentWidth);
  const lines: TextareaVisualLine[] = [];
  let start = 0;
  let cells = 0;

  const push = (end: number, hardBreak: boolean): void => {
    lines.push({ start, end, hardBreak, width: cells });
  };

  for (let index = 0; index < chars.length; index++) {
    const char = chars[index]!;
    if (char === "\n") {
      push(index, true);
      start = index + 1;
      cells = 0;
      continue;
    }
    const charWidth = Math.max(0, cellWidth(char, opts));
    if (index > start && cells + charWidth > width) {
      push(index, false);
      start = index;
      cells = 0;
    }
    cells += charWidth;
  }
  push(chars.length, false);
  return lines;
}

export function graphemeToTextareaVisual(
  value: string,
  offset: number,
  lines: readonly TextareaVisualLine[],
  opts?: MeasureOpts,
): { line: number; col: number } {
  const chars = graphemes(value);
  const cursor = Math.max(0, Math.min(chars.length, Math.trunc(offset)));
  for (let line = 0; line < lines.length; line++) {
    const visual = lines[line]!;
    const isLast = line === lines.length - 1;
    if (cursor < visual.end || (cursor === visual.end && (visual.hardBreak || isLast))) {
      const col = chars
        .slice(visual.start, cursor)
        .reduce((sum, char) => sum + cellWidth(char, opts), 0);
      return { line, col };
    }
  }
  const last = lines[lines.length - 1] ?? { width: 0 };
  return { line: Math.max(0, lines.length - 1), col: last.width };
}

export function textareaVisualToGrapheme(
  value: string,
  line: number,
  col: number,
  lines: readonly TextareaVisualLine[],
  opts?: MeasureOpts,
): number {
  const visual = lines[Math.max(0, Math.min(lines.length - 1, Math.trunc(line)))];
  if (!visual) return 0;
  const chars = graphemes(value);
  const target = Math.max(0, Math.trunc(col));
  let cells = 0;
  for (let index = visual.start; index < visual.end; index++) {
    const width = cellWidth(chars[index]!, opts);
    if (target < cells + width) return index;
    cells += width;
  }
  return visual.end;
}

export function keepTextareaCursorVisible(
  offset: number,
  cursorLine: number,
  total: number,
  rows: number,
): number {
  const visible = Math.max(1, rows);
  const max = Math.max(0, total - visible);
  const current = Math.max(0, Math.min(max, offset));
  if (cursorLine < current) return Math.max(0, Math.min(max, cursorLine));
  if (cursorLine >= current + visible) return Math.min(max, cursorLine - visible + 1);
  return current;
}

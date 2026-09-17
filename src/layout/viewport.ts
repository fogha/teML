// layout/viewport.ts — pure terminal-viewport row math, shared by the
// Reader (reader/session.ts) and the interactive engine (interactive/session.ts).
// No terminal I/O and no document model; the only renderer dependency is the
// `Line` shape for slicing. Living here — not under reader/ — keeps the
// interactive engine from depending on the Reader layer.

import type { Line } from "../render/styledLine.js";

/** Largest scroll offset that keeps at least one row visible. */
export function maxScrollRow(totalRows: number, visibleRows: number): number {
  return Math.max(0, totalRows - Math.max(1, visibleRows));
}

export function clampScrollRow(scrollRow: number, totalRows: number, visibleRows: number): number {
  return Math.max(0, Math.min(maxScrollRow(totalRows, visibleRows), Math.trunc(scrollRow)));
}

export function scrollByLine(
  scrollRow: number,
  delta: number,
  totalRows: number,
  visibleRows: number,
): number {
  return clampScrollRow(scrollRow + delta, totalRows, visibleRows);
}

export function scrollByPage(
  scrollRow: number,
  direction: 1 | -1,
  totalRows: number,
  visibleRows: number,
): number {
  const overlap = visibleRows > 2 ? 1 : 0;
  return scrollByLine(
    scrollRow,
    direction * Math.max(1, visibleRows - overlap),
    totalRows,
    visibleRows,
  );
}

export function scrollToRow(targetRow: number, totalRows: number, visibleRows: number): number {
  return clampScrollRow(targetRow, totalRows, visibleRows);
}

export function ensureRowVisible(
  scrollRow: number,
  targetRow: number,
  totalRows: number,
  visibleRows: number,
): number {
  if (targetRow < scrollRow) return scrollToRow(targetRow, totalRows, visibleRows);
  if (targetRow >= scrollRow + visibleRows) {
    return scrollToRow(targetRow - visibleRows + 1, totalRows, visibleRows);
  }
  return clampScrollRow(scrollRow, totalRows, visibleRows);
}

export function sliceDocumentLines(
  lines: readonly Line[],
  scrollRow: number,
  visibleRows: number,
): Line[] {
  return lines.slice(scrollRow, scrollRow + Math.max(1, visibleRows));
}

import type { Line } from "../render/styledLine.js";
import type { ReaderModel, ViewportSize } from "./model.js";

export function visibleBodyRows(size: ViewportSize): number {
  return Math.max(1, size.rows - Math.max(0, size.statusRows));
}

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

export function statusText(model: ReaderModel, totalRows: number, visibleRows: number): string {
  const endRow = Math.min(totalRows, model.scrollRow + visibleRows);
  const percent =
    totalRows <= visibleRows
      ? 100
      : Math.round((model.scrollRow / Math.max(1, totalRows - visibleRows)) * 100);
  const position =
    totalRows === 0 ? "0/0" : `${Math.min(totalRows, model.scrollRow + 1)}-${endRow}/${totalRows}`;
  const mode = model.mode === "document" ? "" : ` · ${model.mode}`;
  const message = model.message ? ` · ${model.message}` : "";
  return `${model.title || model.currentPath} · ${percent}% · ${position}${mode}${message}`;
}

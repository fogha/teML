// reader/viewport.ts — Reader-specific viewport helpers. The shared terminal
// row math (maxScrollRow, clampScrollRow, scrollByLine, scrollByPage,
// scrollToRow, ensureRowVisible, sliceDocumentLines) lives in
// layout/viewport.js so the interactive engine can reuse it without depending
// on the Reader layer.

import { sanitizeLabel } from "../core/sanitize.js";
import type { ReaderModel, ViewportSize } from "./model.js";

export function visibleBodyRows(size: ViewportSize): number {
  return Math.max(1, size.rows - Math.max(0, size.statusRows));
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
  // The title, path and message are display labels. `currentPath` stays raw in
  // the model because navigation resolves it, so sanitizing belongs here rather
  // than at assignment.
  const label = sanitizeLabel(model.title || model.currentPath);
  const message = model.message ? ` · ${sanitizeLabel(model.message)}` : "";
  return `${label} · ${percent}% · ${position}${mode}${message}`;
}

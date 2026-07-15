// layout/dashboard.ts — grid, metric, progress, event, details, figure layouts.

import type { Block } from "../core/index.js";
import type { Span, Line } from "../render/styledLine.js";
import { lineWidth, padLine } from "../render/styledLine.js";
import { mergeStyle, resolveRole } from "../terminal/theme.js";
import type { LayoutOpts } from "./opts.js";
import { cellWidth, truncateToWidth, type MeasureOpts } from "./measure.js";
import { shiftHits, visualHeight } from "./hits.js";
import { wrapSpans } from "./wrap.js";

export type LayoutBlockFn = (b: Block, opts: LayoutOpts, indent: number) => Line[];
export type LayoutBlocksFn = (
  blocks: Block[],
  opts: LayoutOpts,
  blankBetween: boolean,
  indent: number,
) => Line[];

const MIN_GRID_CELL = 18;

function measureOpts(opts: LayoutOpts): MeasureOpts {
  return { ambiguousWide: opts.caps.ambiguousWide };
}

function clampBoundedInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function parseNonNegative(raw: string | undefined, fallback: number): number {
  const n = raw == null || raw.trim() === "" ? NaN : Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function clampLine(line: Line, maxW: number, m: MeasureOpts): Line {
  const w = lineWidth(line, m);
  if (w <= maxW) return line;
  const plain = line.map((s) => s.text).join("");
  const style = line.find((s) => s.text.trim())?.style ?? {};
  return [{ text: truncateToWidth(plain, maxW, "…", m), style }];
}

function fitCellLine(line: Line, colW: number, m: MeasureOpts): Line {
  if (lineWidth(line, m) <= colW) return padLine(line, colW, {}, m);
  return clampLine(line, colW, m);
}

/** Deterministic column width distribution with optional remainder cells. */
export function gridColumnWidths(available: number, cols: number, gap: number): number[] {
  if (cols <= 0) return [];
  const gaps = Math.max(0, cols - 1) * gap;
  const budget = Math.max(cols, available - gaps);
  const base = Math.floor(budget / cols);
  let remainder = budget - base * cols;
  const widths: number[] = [];
  for (let i = 0; i < cols; i++) {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;
    widths.push(Math.max(1, base + extra));
  }
  return widths;
}

function effectiveGridColumns(requested: number, outerW: number, gap: number): number {
  let cols = requested;
  while (cols > 1) {
    const widths = gridColumnWidths(outerW, cols, gap);
    const minCell = Math.min(...widths);
    if (minCell >= MIN_GRID_CELL) break;
    cols--;
  }
  return Math.max(1, cols);
}

function joinGridRow(cells: Line[][], colWidths: number[], gap: number, m: MeasureOpts): Line[] {
  const rowH = Math.max(1, ...cells.map((c) => c.length));
  const out: Line[] = [];
  for (let r = 0; r < rowH; r++) {
    const spans: Span[] = [];
    for (let c = 0; c < cells.length; c++) {
      if (c > 0) spans.push({ text: " ".repeat(gap), style: {} });
      const cellLine = cells[c]![r] ?? [];
      spans.push(...fitCellLine(cellLine, colWidths[c]!, m));
    }
    out.push(spans);
  }
  return out;
}

function clampPhysicalLines(lines: Line[], outerW: number, indent: number, m: MeasureOpts): Line[] {
  const max = Math.max(1, outerW);
  return lines.map((line) => {
    const prefixed = indent > 0 ? [{ text: " ".repeat(indent), style: {} }, ...line] : line;
    return clampLine(prefixed, max, m);
  });
}

export function layoutGrid(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
  layoutBlockFn: LayoutBlockFn,
): Line[] {
  const m = measureOpts(opts);
  const outerW = Math.max(1, opts.width - indent);
  const requested = clampBoundedInt(b.attrs.columns, 1, 4, 2);
  const gap = clampBoundedInt(b.attrs.gap, 1, 4, 2);
  const cols = effectiveGridColumns(requested, outerW, gap);
  const colWidths = gridColumnWidths(outerW, cols, gap);

  const children = b.children;
  if (!children.length) return [];

  const out: Line[] = [];
  let visualRow = 0;
  for (let i = 0; i < children.length; i += cols) {
    const rowBlocks = children.slice(i, i + cols);
    const rowWidths = colWidths.slice(0, rowBlocks.length);
    const hitStart = opts.hits?.length ?? 0;
    const cellLines = rowBlocks.map((child, ci) => {
      const cellW = rowWidths[ci]!;
      const cellOpts: LayoutOpts = { ...opts, width: cellW };
      return layoutBlockFn(child, cellOpts, 0);
    });
    // Hit-testing doesn't disambiguate columns (v1): widgets in different
    // cells of the same row-group land on the same recorded row.
    shiftHits(opts, hitStart, visualRow);
    const rowLines = joinGridRow(cellLines, rowWidths, gap, m);
    out.push(...rowLines);
    visualRow += visualHeight(rowLines);
  }

  return clampPhysicalLines(out, opts.width, indent, m);
}

export function layoutMetric(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { theme, diags } = opts;
  const m = measureOpts(opts);
  const innerW = Math.max(1, opts.width - indent);
  const pad = " ".repeat(indent);

  const label = b.attrs.label?.trim() || "Metric";
  const value = b.attrs.value?.trim() || "—";
  const change = b.attrs.change?.trim() ?? "";
  const role = b.attrs.role?.trim();

  const muted = resolveRole(theme, "muted", diags);
  const valueStyle = mergeStyle({ bold: true }, role ? resolveRole(theme, role, diags) : {});

  const labelLine = wrapSpans([{ text: label, style: muted }], innerW, m)[0] ?? [];
  const valueSpans: Span[] = [{ text: value, style: valueStyle }];
  if (change) {
    valueSpans.push({ text: " ", style: {} });
    valueSpans.push({ text: change, style: muted });
  }
  const valueLine = wrapSpans(valueSpans, innerW, m)[0] ?? [];

  const lines: Line[] = [
    [{ text: pad, style: {} }, ...clampLine(labelLine, innerW, m)],
    [{ text: pad, style: {} }, ...clampLine(valueLine, innerW, m)],
  ];
  return clampPhysicalLines(lines, opts.width, 0, m);
}

export function layoutProgress(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { theme, caps, diags } = opts;
  const m = measureOpts(opts);
  const innerW = Math.max(1, opts.width - indent);
  const pad = " ".repeat(indent);

  const label = b.attrs.label?.trim() || "Progress";
  let max = parseNonNegative(b.attrs.max, 100);
  if (max <= 0) max = 100;
  let value = parseNonNegative(b.attrs.value, 0);
  value = Math.min(max, Math.max(0, value));

  const pct = Math.round((value / max) * 100);
  const pctStr = `${pct}%`;
  const role = b.attrs.role?.trim();
  const muted = resolveRole(theme, "muted", diags);
  const roleStyle = role ? resolveRole(theme, role, diags) : muted;
  const fillCh = caps.unicode ? "█" : "#";
  const emptyCh = caps.unicode ? "░" : "-";

  const headerSpans: Span[] = [
    { text: label, style: muted },
    { text: " ", style: {} },
    { text: pctStr, style: roleStyle },
  ];
  const headerLine = wrapSpans(headerSpans, innerW, m)[0] ?? [];

  let barLine: Line = [];
  const barW = innerW;
  if (barW >= 1) {
    const filled = barW <= 2 ? (pct > 0 ? 1 : 0) : Math.min(barW, Math.round((pct / 100) * barW));
    const empty = Math.max(0, barW - filled);
    barLine = [{ text: fillCh.repeat(filled) + emptyCh.repeat(empty), style: roleStyle }];
  }

  const lines: Line[] = [
    [{ text: pad, style: {} }, ...clampLine(headerLine, innerW, m)],
    [{ text: pad, style: {} }, ...clampLine(barLine, innerW, m)],
  ];
  return clampPhysicalLines(lines, opts.width, 0, m);
}

export function layoutEvent(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { theme, caps, diags } = opts;
  const m = measureOpts(opts);
  const innerW = Math.max(1, opts.width - indent);
  const pad = " ".repeat(indent);

  const time = b.attrs.time?.trim() ?? "";
  const title = b.attrs.title?.trim() || "Event";
  const detail = b.attrs.detail?.trim() ?? "";
  const role = b.attrs.role?.trim();

  const muted = resolveRole(theme, "muted", diags);
  const titleStyle = mergeStyle({ bold: true }, role ? resolveRole(theme, role, diags) : {});
  const marker = caps.unicode ? "●" : "*";

  const headParts: Span[] = [];
  if (time) {
    headParts.push({ text: time, style: muted });
    headParts.push({ text: " ", style: {} });
  }
  headParts.push({ text: marker, style: titleStyle });
  headParts.push({ text: " ", style: {} });
  headParts.push({ text: title, style: titleStyle });

  const headLine = wrapSpans(headParts, innerW, m)[0] ?? [];
  const lines: Line[] = [[{ text: pad, style: {} }, ...clampLine(headLine, innerW, m)]];

  if (detail) {
    const markerCol = time
      ? cellWidth(time, m) + 1 + cellWidth(marker, m) + 1
      : cellWidth(marker, m) + 1;
    const detailIndent = Math.min(innerW - 1, markerCol);
    const detailW = Math.max(1, innerW - detailIndent);
    const detailLines = wrapSpans([{ text: detail, style: muted }], detailW, m);
    for (const dl of detailLines) {
      lines.push([
        { text: pad, style: {} },
        { text: " ".repeat(detailIndent), style: {} },
        ...clampLine(dl, detailW, m),
      ]);
    }
  }

  return clampPhysicalLines(lines, opts.width, 0, m);
}

export function layoutDetails(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
  layoutBlocksFn: LayoutBlocksFn,
): Line[] {
  const { theme, caps, diags } = opts;
  const m = measureOpts(opts);
  const innerW = Math.max(1, opts.width - indent);
  const pad = " ".repeat(indent);

  const summary = b.attrs.summary?.trim() || "Details";
  const open = b.attrs.open?.trim().toLowerCase() !== "false";
  const muted = resolveRole(theme, "muted", diags);
  const marker = caps.unicode ? (open ? "▼" : "▶") : open ? "v" : ">";

  const headerLine =
    wrapSpans(
      [
        { text: marker, style: muted },
        { text: " ", style: {} },
        { text: summary, style: mergeStyle(muted, { bold: true }) },
      ],
      innerW,
      m,
    )[0] ?? [];

  const lines: Line[] = [[{ text: pad, style: {} }, ...clampLine(headerLine, innerW, m)]];

  if (open) {
    const bodyIndent = indent + 2;
    const hitStart = opts.hits?.length ?? 0;
    const body = layoutBlocksFn(
      b.children,
      { ...opts, width: Math.max(1, opts.width - 2) },
      true,
      bodyIndent,
    );
    shiftHits(opts, hitStart, 1); // account for the summary/header line above the body
    lines.push(...body);
  }

  return clampPhysicalLines(lines, opts.width, 0, m);
}

export function layoutFigure(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
  layoutBlocksFn: LayoutBlocksFn,
): Line[] {
  const { theme, diags } = opts;
  const m = measureOpts(opts);
  const innerW = Math.max(1, opts.width - indent);
  const pad = " ".repeat(indent);
  const muted = resolveRole(theme, "muted", diags);

  const lines = layoutBlocksFn(b.children, opts, true, indent);
  const caption = b.attrs.caption?.trim();
  const prefix = "Figure:";
  const captionText = caption ? `${prefix} ${caption}` : prefix;
  const captionLine = wrapSpans([{ text: captionText, style: muted }], innerW, m)[0] ?? [];
  lines.push([{ text: pad, style: {} }, ...clampLine(captionLine, innerW, m)]);

  return clampPhysicalLines(lines, opts.width, 0, m);
}

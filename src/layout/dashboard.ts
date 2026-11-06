// layout/dashboard.ts — grid, metric, progress, event, details, figure layouts.

import type { Block } from "../core/index.js";
import type { Span, Line } from "../render/styledLine.js";
import { lineWidth, padLine } from "../render/styledLine.js";
import { mergeStyle, resolveRole } from "../terminal/theme.js";
import type { LayoutOpts } from "./opts.js";
import { cellWidth, truncateToWidth, type MeasureOpts } from "./measure.js";
import { wrapSpans } from "./wrap.js";
import { boxMetrics, boxedField } from "./interactive.js";
import { physicalLines, clipLine } from "../render/screen.js";

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

/** Geometry for unframed groups: width includes padding, never a focus gutter. */
function groupMetrics(opts: LayoutOpts, indent: number, attrs: Record<string, string>) {
  const available = Math.max(1, opts.width - indent);
  const width = Math.min(available, clampBoundedInt(attrs.width, 1, 10_000, available));
  const paddingX = Math.min(
    Math.floor((width - 1) / 2),
    clampBoundedInt(attrs.padding, 0, 4, opts.fields?.paddingX ?? 0),
  );
  const paddingY = clampBoundedInt(attrs.padding, 0, 2, opts.fields?.paddingY ?? 0);
  const marginY = clampBoundedInt(attrs.margin, 0, 4, opts.fields?.marginY ?? 0);
  const align = attrs.align ?? opts.fields?.align;
  const free = available - width;
  const offsetX = align === "end" ? free : align === "center" ? Math.floor(free / 2) : 0;
  return {
    contentWidth: Math.max(1, width - 2 * paddingX),
    paddingX,
    offsetX,
    top: marginY + paddingY,
  };
}

function composeGroup(
  lines: Line[],
  opts: LayoutOpts,
  indent: number,
  metrics: ReturnType<typeof groupMetrics>,
): Line[] {
  const m = measureOpts(opts);
  const blank = () => Array.from({ length: metrics.top }, (): Line => []);
  const prefix = " ".repeat(indent + metrics.offsetX + metrics.paddingX);
  return [
    ...blank(),
    ...lines.map((line) => {
      // Clip only when necessary; retain each span's style and pointer metadata.
      const content =
        lineWidth(line, m) > metrics.contentWidth ? clipLine(line, metrics.contentWidth, m) : line;
      return [
        { text: prefix, style: {} },
        ...content,
        { text: " ".repeat(metrics.paddingX), style: {} },
      ];
    }),
    ...blank(),
  ];
}

export function layoutGrid(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
  layoutBlockFn: LayoutBlockFn,
  semanticStartFn: () => number,
  shiftSemanticRowsFn: (start: number, offset: number) => void,
): Line[] {
  const m = measureOpts(opts);
  const metrics = groupMetrics(opts, indent, b.attrs);
  const box = boxMetrics(opts, indent, false, b.attrs);
  const requested = clampBoundedInt(b.attrs.columns, 1, 4, 2);
  const gap = clampBoundedInt(b.attrs.gap, 1, 4, 2);
  const framed = b.attrs.frame !== undefined && b.attrs.frame.toLowerCase() !== "false";
  const gridWidth = framed ? box.contentWidth : metrics.contentWidth;
  const top = framed ? box.marginY + box.paddingY + 1 + (b.attrs.title ? 1 : 0) : metrics.top;
  const cols = effectiveGridColumns(requested, gridWidth, gap);
  const colWidths = gridColumnWidths(gridWidth, cols, gap);
  if (!b.children.length) return [];
  const out: Line[] = [];
  for (let i = 0; i < b.children.length; i += cols) {
    const rowBlocks = b.children.slice(i, i + cols);
    const rowWidths = colWidths.slice(0, rowBlocks.length);
    const cells = rowBlocks.map((child, ci) => {
      const start = semanticStartFn();
      const lines = physicalLines(layoutBlockFn(child, { ...opts, width: rowWidths[ci]! }, 0));
      shiftSemanticRowsFn(start, out.length + top);
      return lines;
    });
    out.push(...joinGridRow(cells, rowWidths, gap, m));
  }
  return framed
    ? boxedField(opts, indent, false, b.attrs.title, out, {}, b.attrs)
    : composeGroup(out, opts, indent, metrics);
}

export function layoutRow(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
  layoutBlockFn: LayoutBlockFn,
  semanticStartFn: () => number,
  shiftSemanticRowsFn: (start: number, offset: number) => void,
): Line[] {
  const m = measureOpts(opts);
  const metrics = groupMetrics(opts, indent, b.attrs);
  const available = metrics.contentWidth;
  const gap = clampBoundedInt(b.attrs.gap, 0, 4, 1);
  const out: Line[] = [];
  let cells: Line[][] = [];
  let widths: number[] = [];
  let used = 0;
  let labels: boolean[] = [];
  let baselines: number[] = [];
  const flush = () => {
    if (!cells.length) return;
    const baseline = Math.max(0, ...baselines);
    const aligned = cells.map((lines, index) =>
      labels[index] && lines.length === 1
        ? [...Array.from({ length: baseline }, (): Line => []), ...lines]
        : lines,
    );
    out.push(...joinGridRow(aligned, widths, gap, m));
    cells = [];
    widths = [];
    labels = [];
    baselines = [];
    used = 0;
  };
  for (const child of b.children) {
    const start = semanticStartFn();
    const raw = physicalLines(layoutBlockFn(child, { ...opts, width: available }, 0));
    const first = raw.findIndex((line) => lineWidth(line, m) > 0);
    let last = raw.length - 1;
    while (last >= 0 && lineWidth(raw[last]!, m) === 0) last--;
    const lines = first < 0 ? raw.slice(0, 1) : raw.slice(first, last + 1);
    const width = Math.max(1, ...lines.map((line) => lineWidth(line, m)));
    if (cells.length && used + gap + width > available) flush();
    shiftSemanticRowsFn(start, out.length + metrics.top - Math.max(0, first));
    cells.push(lines);
    widths.push(width);
    labels.push(child.type === "paragraph");
    const field = child.type === "leaf" && ["input", "textarea", "button"].includes(child.name);
    const fieldBox = field
      ? boxMetrics({ ...opts, width: available }, 0, false, child.attrs)
      : undefined;
    baselines.push(fieldBox?.showBox ? 1 + fieldBox.paddingY : 0);
    used += (cells.length > 1 ? gap : 0) + width;
  }
  flush();
  return composeGroup(out, opts, indent, metrics);
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
    const body = layoutBlocksFn(
      b.children,
      { ...opts, width: Math.max(1, opts.width - 2) },
      true,
      bodyIndent,
    );
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

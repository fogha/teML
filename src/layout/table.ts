// layout/table.ts — table column sizing and layout (M6).

import { inlineText, type Align, type Block, type Inline } from "../core/index.js";
import type { Span, Line } from "../render/styledLine.js";
import { lineWidth } from "../render/styledLine.js";
import { resolveRole } from "../terminal/theme.js";
import { inlineToSpans } from "./inline.js";
import type { LayoutOpts } from "./opts.js";
import { cellWidth, truncateToWidth, type MeasureOpts } from "./measure.js";
import { wrapSpans } from "./wrap.js";

export const COLUMN_FLOOR = 5;

const B = {
  u: {
    tl: "┌",
    tr: "┐",
    bl: "└",
    br: "┘",
    h: "─",
    v: "│",
    t: "┬",
    m: "┼",
    b: "┴",
    ml: "├",
    mr: "┤",
  },
  a: {
    tl: "+",
    tr: "+",
    bl: "+",
    br: "+",
    h: "-",
    v: "|",
    t: "+",
    m: "+",
    b: "+",
    ml: "+",
    mr: "+",
  },
};

/**
 * Deterministic column width distribution (design doc §9.1 / M6).
 * `available` is the total cell-content width budget (excluding border chrome).
 */
export function columnWidths(
  minW: number[],
  maxW: number[],
  available: number,
  floor = COLUMN_FLOOR,
): number[] {
  const n = minW.length;
  if (n === 0) return [];
  if (available <= 0) return minW.map(() => Math.max(1, floor));

  const sumMax = maxW.reduce((a, x) => a + x, 0);
  if (sumMax <= available) return maxW.map((w, i) => Math.max(1, w, minW[i]!));

  const sumMin = minW.reduce((a, x) => a + x, 0);
  if (sumMin <= available) {
    const remainder = available - sumMin;
    const flex = maxW.map((mx, i) => Math.max(0, mx - minW[i]!));
    const totalFlex = flex.reduce((a, x) => a + x, 0);
    if (totalFlex <= 0) return minW.map((w) => Math.max(1, w));

    const widths = minW.map((w) => Math.max(1, w));
    const fractions: number[] = [];
    let assigned = 0;
    for (let i = 0; i < n; i++) {
      const share = (flex[i]! / totalFlex) * remainder;
      const add = Math.floor(share);
      fractions[i] = share - add;
      widths[i]! += add;
      assigned += add;
    }
    const left = remainder - assigned;
    const order = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) => fractions[b]! - fractions[a]! || a - b,
    );
    for (let k = 0; k < left; k++) widths[order[k % n]!]!++;
    return widths;
  }

  const widths = minW.map((w) => Math.max(1, w));
  const sum = () => widths.reduce((a, x) => a + x, 0);
  while (sum() > available) {
    const peak = Math.max(...widths);
    if (peak <= floor) break;
    let idx = 0;
    for (let i = 1; i < n; i++) {
      if (widths[i]! > widths[idx]!) idx = i;
    }
    widths[idx]!--;
  }
  return widths.map((w) => Math.max(1, w));
}

function measureOpts(opts: LayoutOpts): MeasureOpts {
  return { ambiguousWide: opts.caps.ambiguousWide };
}

function borders(caps: LayoutOpts["caps"]) {
  return caps.unicode ? B.u : B.a;
}

function alignPad(line: Line, colW: number, align: Align, m: MeasureOpts): Line {
  const w = lineWidth(line, m);
  if (w > colW) return truncateLine(line, colW, m);
  if (w === colW) return line;
  const pad = colW - w;
  if (align === "right") return [{ text: " ".repeat(pad), style: {} }, ...line];
  if (align === "center") {
    const left = Math.floor(pad / 2);
    return [
      { text: " ".repeat(left), style: {} },
      ...line,
      { text: " ".repeat(pad - left), style: {} },
    ];
  }
  return [...line, { text: " ".repeat(pad), style: {} }];
}

function truncateLine(line: Line, colW: number, m: MeasureOpts): Line {
  const plain = line.map((s) => s.text).join("");
  const style = line.find((s) => s.text.trim())?.style ?? {};
  return [{ text: truncateToWidth(plain, colW, "…", m), style }];
}

function cellLines(
  inlines: Inline[],
  colW: number,
  opts: LayoutOpts,
  header: boolean,
  m: MeasureOpts,
): Line[] {
  const spans = inlineToSpans(inlines, opts, header ? { bold: true } : {});
  if (colW < COLUMN_FLOOR) {
    const plain = inlineText(inlines);
    const style = header ? { bold: true } : {};
    return [[{ text: truncateToWidth(plain, colW, "…", m), style }]];
  }
  const wrapped = wrapSpans(spans, colW, m);
  return wrapped.length ? wrapped : [[]];
}

function tableRule(
  l: string,
  mid: string,
  r: string,
  widths: number[],
  indent: number,
  H: string,
  borderStyle: Span["style"],
  outerW?: number,
  m?: MeasureOpts,
): Line {
  let text = l + widths.map((w) => H.repeat(w + 2)).join(mid) + r;
  if (outerW != null && m) {
    const max = Math.max(1, outerW - indent);
    if (cellWidth(text, m) > max) text = truncateToWidth(text, max, "…", m);
  }
  return [
    { text: " ".repeat(indent), style: {} },
    { text, style: borderStyle },
  ];
}

/** Shrink column content widths until border chrome fits outerW. */
function enforceViewport(widths: number[], outerW: number, cols: number): number[] {
  const chrome = cols * 3 + 1;
  const w = widths.map((x) => Math.max(1, x));
  const total = () => w.reduce((a, x) => a + x, 0) + chrome;
  while (total() > outerW) {
    const peak = Math.max(...w);
    if (peak <= 1) break;
    let idx = 0;
    for (let i = 1; i < w.length; i++) {
      if (w[i]! > w[idx]!) idx = i;
    }
    w[idx]!--;
  }
  return w;
}

function clampRow(line: Line, outerW: number, indent: number, m: MeasureOpts): Line {
  const w = lineWidth(line, m);
  const max = Math.max(1, outerW);
  if (w <= max) return line;
  const plain = line.map((s) => s.text).join("");
  const style = line.find((s) => s.text.trim())?.style ?? {};
  return [
    { text: " ".repeat(indent), style: {} },
    { text: truncateToWidth(plain, max, "…", m), style },
  ];
}

export function layoutTable(
  b: Extract<Block, { type: "table" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { width, theme, caps, diags } = opts;
  const m = measureOpts(opts);
  const borderStyle = resolveRole(theme, "border", diags);
  const bd = borders(caps);
  const outerW = Math.max(1, width - indent);
  const cols = Math.max(0, ...b.rows.map((r) => r.cells.length));
  if (cols === 0) return [];

  const cellTextAt = (cells: Inline[][], c: number) => inlineText(cells[c] ?? []);
  const minW = Array.from({ length: cols }, (_, c) =>
    Math.max(1, Math.min(...b.rows.map((r) => cellWidth(cellTextAt(r.cells, c), m) || 1))),
  );
  const maxW = Array.from({ length: cols }, (_, c) =>
    Math.max(1, ...b.rows.map((r) => cellWidth(cellTextAt(r.cells, c), m))),
  );
  const chrome = cols * 3 + 1;
  const avail = Math.max(cols, outerW - chrome);
  const widths = enforceViewport(columnWidths(minW, maxW, avail), outerW, cols);

  const H = bd.h;
  const V = bd.v;
  const lines: Line[] = [tableRule(bd.tl, bd.t, bd.tr, widths, indent, H, borderStyle, outerW, m)];

  b.rows.forEach((row, ri) => {
    const perCell = row.cells.map((cell, c) => cellLines(cell, widths[c]!, opts, row.header, m));
    const rowH = Math.max(1, ...perCell.map((cl) => cl.length));
    const alignAt = (c: number): Align => b.align[c] ?? null;

    for (let li = 0; li < rowH; li++) {
      const spans: Span[] = [{ text: V + " ", style: borderStyle }];
      for (let c = 0; c < cols; c++) {
        const cellLine = perCell[c]![li] ?? [];
        spans.push(...alignPad(cellLine, widths[c]!, alignAt(c), m));
        spans.push({ text: c < cols - 1 ? ` ${V} ` : " " + V, style: borderStyle });
      }
      lines.push(clampRow([{ text: " ".repeat(indent), style: {} }, ...spans], outerW, indent, m));
    }

    if (row.header && ri === 0) {
      lines.push(tableRule(bd.ml, bd.m, bd.mr, widths, indent, H, borderStyle, outerW, m));
    }
  });

  lines.push(tableRule(bd.bl, bd.b, bd.br, widths, indent, H, borderStyle, outerW, m));
  return lines;
}

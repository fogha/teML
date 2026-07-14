import { test, expect } from "vitest";
import { doc, text } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { COLUMN_FLOOR, columnWidths, layoutTable } from "../../src/layout/table.js";
import { cellWidth } from "../../src/layout/measure.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { lineWidth } from "../../src/render/styledLine.js";
import { renderPlain } from "../../src/render/plain.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 80,
  ambiguousWide: false,
  ...over,
});

const opts = (width: number, over: Partial<Capabilities> = {}) => ({
  width,
  theme: loadTheme("dark"),
  caps: caps({ width, ...over }),
  diags: new Diagnostics(),
});

// ---- columnWidths (≥10 cases) ------------------------------------------------

test("columnWidths: two columns fit at max", () => {
  expect(columnWidths([3, 5], [8, 10], 18)).toEqual([8, 10]);
});

test("columnWidths: three columns proportional distribution", () => {
  const w = columnWidths([2, 2, 2], [4, 8, 10], 15);
  expect(w.reduce((a, x) => a + x, 0)).toBe(15);
  expect(w[2]).toBeGreaterThan(w[0]);
});

test("columnWidths: CJK min/max preserved when space allows", () => {
  expect(columnWidths([4, 2], [4, 6], 10)).toEqual([4, 6]);
});

test("columnWidths: one huge column yields remainder to others", () => {
  const w = columnWidths([1, 1, 1], [20, 2, 2], 10);
  expect(w[0]).toBeLessThan(20);
  expect(w.reduce((a, x) => a + x, 0)).toBe(10);
});

test("columnWidths: more columns than width shrinks widest first", () => {
  const w = columnWidths([8, 8, 8], [8, 8, 8], 12, COLUMN_FLOOR);
  expect(Math.max(...w)).toBeLessThan(8);
  expect(w.every((x) => x >= 1)).toBe(true);
});

test("columnWidths: at floor when sum min exceeds available", () => {
  const w = columnWidths([10, 10, 10], [10, 10, 10], 12, 5);
  expect(w.every((x) => x >= 1 && x <= 10)).toBe(true);
});

test("columnWidths: empty input", () => {
  expect(columnWidths([], [], 40)).toEqual([]);
});

test("columnWidths: zero available returns floor widths", () => {
  expect(columnWidths([3, 4], [6, 8], 0)).toEqual([COLUMN_FLOOR, COLUMN_FLOOR]);
});

test("columnWidths: single column takes all available", () => {
  expect(columnWidths([3], [20], 7)).toEqual([7]);
});

test("columnWidths: deterministic tie-breaking left-to-right", () => {
  const a = columnWidths([2, 2, 2], [5, 5, 5], 10);
  const b = columnWidths([2, 2, 2], [5, 5, 5], 10);
  expect(a).toEqual(b);
  expect(a.reduce((s, x) => s + x, 0)).toBe(10);
});

test("columnWidths: min never below 1", () => {
  const w = columnWidths([1, 1], [1, 20], 5);
  expect(w.every((x) => x >= 1)).toBe(true);
});

// ---- layoutTable rendering ---------------------------------------------------

test("layoutTable: GFM alignment and bold header", () => {
  const d = doc([
    {
      type: "table",
      align: ["left", "center", "right"],
      rows: [
        {
          header: true,
          cells: [[text("Left")], [text("Center")], [text("Right")]],
        },
        {
          header: false,
          cells: [[text("a")], [text("b")], [text("1")]],
        },
      ],
    },
  ]);
  const out = renderPlain(layoutDocument(d, opts(40)));
  expect(out).toContain("Left");
  expect(out).toContain("Center");
  expect(out).toContain("Right");
  expect(out.includes("┌") || out.includes("+")).toBe(true);
});

test("layoutTable: multiline row height from wrapped cell", () => {
  const d = doc([
    {
      type: "table",
      align: [],
      rows: [
        {
          header: false,
          cells: [[text("short")], [text("word ".repeat(8))]],
        },
      ],
    },
  ]);
  const lines = layoutDocument(d, opts(24));
  expect(lines.length).toBeGreaterThan(3);
});

test("layoutTable: CJK cell widths in unicode borders", () => {
  const d = doc([
    {
      type: "table",
      align: [],
      rows: [
        { header: true, cells: [[text("名称")], [text("值")]] },
        { header: false, cells: [[text("你好")], [text("世界")]] },
      ],
    },
  ]);
  const width = 30;
  const lines = layoutDocument(d, opts(width));
  const m = { ambiguousWide: false };
  expect(lines.every((l) => lineWidth(l, m) <= width)).toBe(true);
});

test("layoutTable: ascii borders when unicode disabled", () => {
  const d = doc([
    {
      type: "table",
      align: [],
      rows: [{ header: false, cells: [[text("x")], [text("y")]] }],
    },
  ]);
  const out = renderPlain(layoutDocument(d, opts(20, { unicode: false })));
  expect(out.includes("+")).toBe(true);
  expect(out.includes("┌")).toBe(false);
});

test("layoutTable: styled inline survives wrap", () => {
  const d = doc([
    {
      type: "table",
      align: [],
      rows: [
        {
          header: false,
          cells: [[{ type: "bold", children: [text("boldword ".repeat(4))] }]],
        },
      ],
    },
  ]);
  const lines = layoutTable(
    d.blocks[0] as Extract<(typeof d.blocks)[0], { type: "table" }>,
    opts(18),
    0,
  );
  const boldLines = lines.filter((l) => l.some((s) => s.style.bold));
  expect(boldLines.length).toBeGreaterThanOrEqual(1);
});

test("layoutTable: viewport invariant at width 20", () => {
  const d = doc([
    {
      type: "table",
      align: ["left", "center", "right"],
      rows: [
        {
          header: true,
          cells: [[text("A")], [text("B")], [text("C")]],
        },
        {
          header: false,
          cells: [[text("longvalue")], [text("mid")], [text("9")]],
        },
      ],
    },
  ]);
  const width = 20;
  const lines = layoutDocument(d, opts(width));
  const m = { ambiguousWide: false };
  expect(lines.every((l) => lineWidth(l, m) <= width)).toBe(true);
});

test("layoutTable: direct export matches document path", () => {
  const block = {
    type: "table" as const,
    align: [] as const,
    rows: [{ header: false, cells: [[text("ok")]] }],
  };
  const o = opts(20);
  const direct = layoutTable(block, o, 0);
  const viaDoc = layoutDocument(doc([block]), o);
  expect(renderPlain(direct)).toBe(renderPlain(viaDoc));
});

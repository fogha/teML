import { test, expect } from "vitest";
import { doc, text } from "../../src/core/ast.js"; // text() builds a plain inline text node
import { Diagnostics } from "../../src/core/diagnostics.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { widgetAt, type WidgetHit } from "../../src/layout/hits.js";
import { renderPlain } from "../../src/render/plain.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import type { LayoutOpts } from "../../src/layout/opts.js";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 40,
  ambiguousWide: false,
  ...over,
});

function opts(over: Partial<LayoutOpts> = {}): LayoutOpts {
  return {
    width: 40,
    theme: loadTheme("dark"),
    caps: caps(),
    diags: new Diagnostics(),
    hits: [],
    ...over,
  };
}

/** Assert every row a hit claims actually contains that widget's rendered text. */
function assertHitsMatchLines(
  lines: ReturnType<typeof layoutDocument>,
  hits: WidgetHit[],
  expectFragment: (id: string) => string,
): void {
  const plainLines = renderPlain(lines).split("\n");
  for (const h of hits) {
    expect(plainLines[h.row] ?? "").toContain(expectFragment(h.id));
  }
}

test("top-level widgets each get their own row", () => {
  const d = doc([
    { type: "leaf", name: "button", attrs: { id: "a", label: "A" } },
    { type: "leaf", name: "button", attrs: { id: "b", label: "B" } },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  assertHitsMatchLines(lines, o.hits!, (id) => (id === "a" ? "[ A ]" : "[ B ]"));
  expect(widgetAt(o.hits!, 0, 0)).toBe("a");
  // row 1 is the blank separator between top-level blocks
  expect(widgetAt(o.hits!, 1, 0)).toBeUndefined();
  expect(widgetAt(o.hits!, 2, 0)).toBe("b");
});

test("a widget inside a card is offset by the title bar", () => {
  const d = doc([
    {
      type: "container",
      name: "card",
      attrs: { title: "T" },
      children: [{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }],
    },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  assertHitsMatchLines(lines, o.hits!, () => "[ Go ]");
  expect(o.hits).toEqual([{ id: "go", row: 1, colStart: 2, colEnd: 10 }]);
});

test("widgets in a bullet list each land on their own row", () => {
  const d = doc([
    {
      type: "list",
      ordered: false,
      start: 1,
      items: [
        { blocks: [{ type: "paragraph", children: [text("intro")] }] },
        { blocks: [{ type: "leaf", name: "checkbox", attrs: { id: "c1", label: "One" } }] },
        { blocks: [{ type: "leaf", name: "checkbox", attrs: { id: "c2", label: "Two" } }] },
      ],
    },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  assertHitsMatchLines(lines, o.hits!, (id) => (id === "c1" ? "One" : "Two"));
  expect(widgetAt(o.hits!, 0, 2)).toBeUndefined(); // "intro" row
  expect(widgetAt(o.hits!, 1, 2)).toBe("c1");
  expect(widgetAt(o.hits!, 2, 2)).toBe("c2");
});

test("a widget inside an open details block is offset by the summary line", () => {
  const d = doc([
    {
      type: "container",
      name: "details",
      attrs: { summary: "More", open: "true" },
      children: [{ type: "leaf", name: "input", attrs: { id: "f", label: "Field" } }],
    },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  expect(o.hits).toEqual([{ id: "f", row: 1, colStart: 0, colEnd: 13 }]);
  assertHitsMatchLines(lines, o.hits!, () => "Field:");
});

test("a closed details block records no hits for its hidden body", () => {
  const d = doc([
    {
      type: "container",
      name: "details",
      attrs: { summary: "More", open: "false" },
      children: [{ type: "leaf", name: "input", attrs: { id: "f", label: "Field" } }],
    },
  ]);
  const o = opts();
  layoutDocument(d, o);
  expect(o.hits).toEqual([]);
});

test("widgets stacked in successive grid row-groups land on distinct rows", () => {
  const d = doc([
    {
      type: "container",
      name: "grid",
      attrs: { columns: "1" },
      children: [
        { type: "leaf", name: "button", attrs: { id: "a", label: "A" } },
        { type: "leaf", name: "button", attrs: { id: "b", label: "B" } },
      ],
    },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  assertHitsMatchLines(lines, o.hits!, (id) => (id === "a" ? "[ A ]" : "[ B ]"));
  expect(widgetAt(o.hits!, 0, 0)).toBe("a");
  expect(widgetAt(o.hits!, 1, 0)).toBe("b");
});

test("no hits are recorded when opts.hits is not set (default, no cost)", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const lines = layoutDocument(d, opts({ hits: undefined }));
  expect(lines.length).toBeGreaterThan(0); // renders fine without a hits sink
});

test("a preceding paragraph with an embedded hard line-break doesn't throw off later widget rows", () => {
  // A markdown hard break survives as a literal "\n" *inside* one wrapped
  // Line's span text (layout/wrap.ts's toWords only splits on runs of
  // spaces, not newlines), so this one paragraph renders as two physical
  // rows despite being a single Line[] entry. Row bookkeeping has to count
  // that, or "go" below ends up one row early.
  const d = doc([
    { type: "paragraph", children: [text("Line one\nLine two")] },
    { type: "leaf", name: "button", attrs: { id: "go", label: "Go" } },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  assertHitsMatchLines(lines, o.hits!, () => "[ Go ]");
  const plainLines = renderPlain(lines).split("\n");
  expect(plainLines.slice(0, 4)).toEqual(["Line one", "Line two", "", "  [ Go ]"]);
  expect(o.hits).toEqual([{ id: "go", row: 3, colStart: 0, colEnd: 8 }]);
});

test("two buttons in one grid row resolve by exact terminal columns", () => {
  const d = doc([
    {
      type: "container",
      name: "grid",
      attrs: { columns: "2", gap: "2" },
      children: [
        { type: "leaf", name: "button", attrs: { id: "left", label: "Left" } },
        { type: "leaf", name: "button", attrs: { id: "right", label: "Right" } },
      ],
    },
  ]);
  const o = opts();
  const lines = layoutDocument(d, o);
  const hits = o.hits!;
  const left = hits.find((hit) => hit.id === "left")!;
  const right = hits.find((hit) => hit.id === "right")!;

  expect(left.row).toBe(right.row);
  expect(widgetAt(hits, left.row, left.colStart)).toBe("left");
  expect(widgetAt(hits, right.row, right.colStart)).toBe("right");
  expect(widgetAt(hits, left.row, left.colEnd)).toBeUndefined();
  expect(widgetAt(hits, left.row, right.colStart - 1)).toBeUndefined();
  expect(renderPlain(lines)).toContain("[ Left ]");
  expect(renderPlain(lines)).toContain("[ Right ]");
});

test("wide labels and wrapped widgets use physical cell coordinates", () => {
  const wide = opts({ width: 40 });
  layoutDocument(
    doc([{ type: "leaf", name: "button", attrs: { id: "wide", label: "界🙂" } }]),
    wide,
  );
  expect(wide.hits).toEqual([{ id: "wide", row: 0, colStart: 0, colEnd: 10 }]);
  expect(widgetAt(wide.hits!, 0, 9)).toBe("wide");
  expect(widgetAt(wide.hits!, 0, 10)).toBeUndefined();

  const wrapped = opts({ width: 10, caps: caps({ width: 10 }) });
  layoutDocument(
    doc([
      {
        type: "leaf",
        name: "input",
        attrs: { id: "field", label: "Long label", value: "abcdef" },
      },
    ]),
    wrapped,
  );
  expect(wrapped.hits!.length).toBeGreaterThan(1);
  expect(new Set(wrapped.hits!.map((hit) => hit.id))).toEqual(new Set(["field"]));
  for (const hit of wrapped.hits!) {
    expect(widgetAt(wrapped.hits!, hit.row, hit.colStart)).toBe("field");
    expect(hit.colEnd).toBeLessThanOrEqual(10);
  }
});

test("a widget missing an id is never recorded (matches focus.ts's rule)", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { label: "Go" } }]);
  const o = opts();
  layoutDocument(d, o);
  expect(o.hits).toEqual([]);
});

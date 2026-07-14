import { test, expect } from "vitest";
import { doc, text } from "../../src/core/ast.js";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { gridColumnWidths } from "../../src/layout/dashboard.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { cellWidth } from "../../src/layout/measure.js";
import { inlineToSpans } from "../../src/layout/inline.js";
import { serializeMarkdown } from "../../src/markdown/serialize.js";
import { renderAnsi } from "../../src/render/ansi.js";
import { renderPlain } from "../../src/render/plain.js";
import { lineWidth } from "../../src/render/styledLine.js";
import { parseTeml } from "../../src/teml/parse.js";
import { serializeTeml } from "../../src/teml/serialize.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps = (width: number, over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width,
  ambiguousWide: false,
  ...over,
});

function assertViewport(lines: ReturnType<typeof layoutDocument>, width: number): void {
  const m = { ambiguousWide: false };
  for (const line of lines) {
    expect(lineWidth(line, m)).toBeLessThanOrEqual(width);
  }
}

function dashboardDoc() {
  return normalize(
    parseTeml(
      [
        ':::grid{columns="3" gap="2"}',
        '::metric{label="CPU" value="72%" role="warning" change="+4%"}',
        '::metric{label="Memory" value="48%"}',
        '::progress{label="Disk" value="92" max="100" role="error"}',
        '::event{time="09:15" title="Deploy finished" detail="production cluster"}',
        ":::",
        "",
        ':::details{summary="More info" open="true"}',
        "Extra body line.",
        ":::",
        "",
        ':::figure{caption="Weekly trend"}',
        "Chart placeholder text.",
        ":::",
      ].join("\n"),
    ),
  );
}

for (const width of [80, 40, 20] as const) {
  test(`dashboard elements fit viewport @ width ${width}`, () => {
    const lines = layoutDocument(dashboardDoc(), {
      width,
      theme: loadTheme("dark"),
      caps: caps(width),
      diags: new Diagnostics(),
    });
    assertViewport(lines, width);
    const out = renderPlain(lines);
    expect(out).toContain("CPU");
    expect(out).toContain("72%");
    expect(out).toContain("Disk");
    expect(out).toContain("Deploy");
    expect(out).toContain("More info");
    expect(out).toContain("Figure:");
  });
}

test("grid reduces columns when cells would be narrower than 18", () => {
  const d = doc([
    {
      type: "container",
      name: "grid",
      attrs: { columns: "4", gap: "2" },
      children: [
        { type: "paragraph", children: [text("A")] },
        { type: "paragraph", children: [text("B")] },
        { type: "paragraph", children: [text("C")] },
        { type: "paragraph", children: [text("D")] },
        { type: "paragraph", children: [text("E")] },
      ],
    },
  ]);
  const width = 40;
  const lines = layoutDocument(d, { width, theme: loadTheme("dark"), caps: caps(width), diags: new Diagnostics() });
  assertViewport(lines, width);
  const plain = renderPlain(lines);
  const rows = plain.split("\n").filter(Boolean);
  expect(rows.length).toBeGreaterThanOrEqual(2);
});

test("grid distributes remainder cells deterministically", () => {
  expect(gridColumnWidths(41, 3, 2)).toEqual([13, 12, 12]);
  expect(gridColumnWidths(41, 3, 2)).toEqual(gridColumnWidths(41, 3, 2));
});

test("nested grid inside card respects viewport", () => {
  const d = doc([
    {
      type: "container",
      name: "card",
      attrs: { title: "Panel" },
      children: [
        {
          type: "container",
          name: "grid",
          attrs: { columns: "2", gap: "1" },
          children: [
            { type: "paragraph", children: [text("left cell")] },
            { type: "paragraph", children: [text("right cell")] },
          ],
        },
      ],
    },
  ]);
  const width = 30;
  const lines = layoutDocument(d, { width, theme: loadTheme("dark"), caps: caps(width), diags: new Diagnostics() });
  assertViewport(lines, width);
  expect(renderPlain(lines)).toContain("left cell");
  expect(renderPlain(lines)).toContain("right cell");
});

test("metric defaults and truncation at pathological width", () => {
  const d = doc([{ type: "leaf", name: "metric", attrs: {} }]);
  const width = 5;
  const out = renderPlain(
    layoutDocument(d, { width, theme: loadTheme("dark"), caps: caps(width), diags: new Diagnostics() }),
  );
  expect(out).toContain("Metri");
  expect(out).toContain("—");
  for (const line of out.split("\n")) {
    expect(cellWidth(line)).toBeLessThanOrEqual(width);
  }
});

test("progress clamps value and handles zero max safely", () => {
  const d = doc([
    { type: "leaf", name: "progress", attrs: { label: "X", value: "150", max: "0" } },
    { type: "leaf", name: "progress", attrs: { label: "Y", value: "-5", max: "50" } },
  ]);
  const width = 20;
  const out = renderPlain(
    layoutDocument(d, {
      width,
      theme: loadTheme("mono"),
      caps: caps(width, { unicode: false }),
      diags: new Diagnostics(),
    }),
  );
  expect(out).toContain("100%");
  expect(out).toContain("0%");
  expect(out).toMatch(/[#-]/);
});

test("progress unicode and ascii bar glyphs", () => {
  const block = doc([{ type: "leaf", name: "progress", attrs: { label: "Load", value: "50", max: "100" } }]);
  const width = 20;
  const uni = renderPlain(
    layoutDocument(block, { width, theme: loadTheme("dark"), caps: caps(width), diags: new Diagnostics() }),
  );
  expect(uni).toMatch(/[█░]/);

  const ascii = renderPlain(
    layoutDocument(block, {
      width,
      theme: loadTheme("dark"),
      caps: caps(width, { unicode: false }),
      diags: new Diagnostics(),
    }),
  );
  expect(ascii).toMatch(/[#-]/);
  expect(ascii).not.toContain("█");
});

test("event detail wraps with deterministic indent", () => {
  const d = doc([
    {
      type: "leaf",
      name: "event",
      attrs: {
        time: "09:15",
        title: "Deploy",
        detail: "long detail text that should wrap under the marker column",
      },
    },
  ]);
  const width = 24;
  const lines = layoutDocument(d, { width, theme: loadTheme("dark"), caps: caps(width), diags: new Diagnostics() });
  assertViewport(lines, width);
  const plain = renderPlain(lines);
  const detailLines = plain.split("\n").slice(1).filter(Boolean);
  expect(detailLines.length).toBeGreaterThan(1);
  expect(detailLines.every((l) => l.startsWith("        "))).toBe(true);
});

test("event ascii marker fallback", () => {
  const d = doc([{ type: "leaf", name: "event", attrs: { title: "Ping" } }]);
  const out = renderPlain(
    layoutDocument(d, {
      width: 20,
      theme: loadTheme("dark"),
      caps: caps(20, { unicode: false }),
      diags: new Diagnostics(),
    }),
  );
  expect(out).toContain("* Ping");
  expect(out).not.toContain("●");
});

test("details closed hides body", () => {
  const d = normalize(parseTeml(':::details{summary="Hidden" open="false"}\nSecret\n:::\n'));
  const out = renderPlain(
    layoutDocument(d, { width: 40, theme: loadTheme("dark"), caps: caps(40), diags: new Diagnostics() }),
  );
  expect(out).toContain("Hidden");
  expect(out).not.toContain("Secret");
});

test("details open renders indented body", () => {
  const d = normalize(parseTeml(':::details{summary="Open" open="true"}\nVisible line\n:::\n'));
  const out = renderPlain(
    layoutDocument(d, { width: 40, theme: loadTheme("dark"), caps: caps(40), diags: new Diagnostics() }),
  );
  expect(out).toContain("Open");
  expect(out).toContain("Visible line");
});

test("figure renders caption after body", () => {
  const d = normalize(parseTeml(':::figure{caption="Trend"}\nBody content\n:::\n'));
  const out = renderPlain(
    layoutDocument(d, { width: 40, theme: loadTheme("dark"), caps: caps(40), diags: new Diagnostics() }),
  );
  expect(out.indexOf("Body content")).toBeLessThan(out.indexOf("Figure: Trend"));
});

test("Markdown degradation for dashboard elements", () => {
  const d = new Diagnostics();
  const md = serializeMarkdown(dashboardDoc(), d);
  expect(md).toContain("**CPU:** 72% (\\+4%)");
  expect(md).toContain("**Disk:** 92/100 (92%)");
  expect(md).toContain("- **09:15** Deploy finished");
  expect(md).toContain("**More info**");
  expect(md).toContain("*Figure: Weekly trend*");
  expect(d.all().some((w) => w.code === "markdown-lossy-conversion")).toBe(true);
});

test("TeML serializer remains AST-stable for dashboard directives", () => {
  const d = new Diagnostics();
  const src = [
    ':::grid{columns="2" gap="1"}',
    '::metric{label="A" value="1"}',
    ":::",
    '::progress{label="B" value="10" max="20"}',
    '::event{time="1:00" title="T"}',
    ':::details{summary="S" open="false"}',
    ":::",
    ':::figure{caption="C"}',
    "x",
    ":::",
  ].join("\n");
  const doc1 = normalize(parseTeml(src, d));
  const doc2 = normalize(parseTeml(serializeTeml(doc1), d));
  expect(doc2).toEqual(doc1);
});

test("inline strike style reaches spans", () => {
  const theme = loadTheme("dark");
  const spans = inlineToSpans(
    [{ type: "strike", children: [{ type: "bold", children: [{ type: "text", value: "gone" }] }] }],
    { theme, caps: caps(80), diags: new Diagnostics() },
  );
  expect(spans.some((s) => s.style.strike && s.style.bold && s.text.includes("gone"))).toBe(true);
});

test("ANSI strike emits SGR 9 and 29 on transition", () => {
  const out = renderAnsi(
    [[
      { text: "plain", style: {} },
      { text: "struck", style: { strike: true } },
      { text: "plain", style: {} },
    ]],
    caps(80, { colors: "ansi16" }),
  );
  expect(out).toContain("\x1b[9mstruck\x1b[29m");
});

test("GFM strike round-trip unchanged by dashboard work", () => {
  const d = new Diagnostics();
  const src = "Keep ~~removed~~ text.\n";
  const doc1 = normalize(parseTeml(src, d));
  const md = serializeMarkdown(doc1, d);
  expect(md).toContain("~~removed~~");
  const doc2 = normalize(parseTeml(md, d));
  expect(doc2).toEqual(doc1);
});

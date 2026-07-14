import { test, expect } from "vitest";
import { doc, text } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
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
  width: 40,
  ambiguousWide: false,
  ...over,
});

test("nested list adds 2-cell indent per level", () => {
  const d = doc([
    {
      type: "list",
      ordered: false,
      start: 1,
      items: [
        {
          blocks: [
            { type: "paragraph", children: [text("outer")] },
            {
              type: "list",
              ordered: false,
              start: 1,
              items: [{ blocks: [{ type: "paragraph", children: [text("inner")] }] }],
            },
          ],
        },
      ],
    },
  ]);
  const out = renderPlain(layoutDocument(d, { width: 40, theme: loadTheme("dark"), caps: caps(), diags: new Diagnostics() }));
  const lines = out.split("\n").filter(Boolean);
  expect(lines.some((l) => l.startsWith("• outer"))).toBe(true);
  expect(lines.some((l) => l.startsWith("  • inner"))).toBe(true);
});

test("code block has padding and right-aligned language", () => {
  const d = doc([
    { type: "codeBlock", language: "bash", value: "echo hi" },
  ]);
  const lines = layoutDocument(d, { width: 30, theme: loadTheme("dark"), caps: caps({ width: 30 }), diags: new Diagnostics() });
  expect(lines.length).toBeGreaterThanOrEqual(3);
  const plain = renderPlain(lines);
  const top = plain.split("\n")[0] ?? "";
  expect(top.trimEnd().endsWith("bash")).toBe(true);
});

test("card viewport width invariant", () => {
  const d = doc([
    {
      type: "container",
      name: "card",
      attrs: { title: "T" },
      children: [{ type: "paragraph", children: [text("body text")] }],
    },
  ]);
  const width = 50;
  const lines = layoutDocument(d, { width, theme: loadTheme("dark"), caps: caps({ width }), diags: new Diagnostics() });
  const widths = lines.map((l) => lineWidth(l));
  expect(widths.every((w) => w === width)).toBe(true);
});

test("ascii fallback uses + borders", () => {
  const d = doc([
    {
      type: "container",
      name: "card",
      attrs: { title: "X" },
      children: [{ type: "paragraph", children: [text("hi")] }],
    },
  ]);
  const out = renderPlain(
    layoutDocument(d, { width: 30, theme: loadTheme("dark"), caps: caps({ unicode: false, width: 30 }), diags: new Diagnostics() }),
  );
  expect(out.includes("+")).toBe(true);
  expect(out.includes("┌")).toBe(false);
});

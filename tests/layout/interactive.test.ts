import { test, expect } from "vitest";
import { doc } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { lineWidth } from "../../src/render/styledLine.js";
import { renderPlain } from "../../src/render/plain.js";
import { renderAnsi } from "../../src/render/ansi.js";
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
  return { width: 40, theme: loadTheme("dark"), caps: caps(), diags: new Diagnostics(), ...over };
}

test("button renders a light box, unfocused has no marker", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(layoutDocument(d, opts()));
  expect(out).toContain("│ Go");
  expect(out).not.toContain("▸");
});

test("button fills only its interior with theme-aware default and focus roles", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const defaultLines = layoutDocument(d, opts());
  expect(defaultLines[0]!.every((span) => span.style.bg === undefined)).toBe(true);
  expect(defaultLines[2]!.every((span) => span.style.bg === undefined)).toBe(true);
  const defaultInterior = defaultLines[1]!.filter((span) => span.style.bg !== undefined);
  expect(defaultInterior.every((span) => span.style.bg === "cyan")).toBe(true);
  expect(defaultInterior.map((span) => span.text).join("")).toContain("Go");
  expect(
    defaultLines[1]!
      .filter((span) => span.text.includes("│"))
      .every((span) => span.style.bg === undefined),
  ).toBe(true);

  const focusedLines = layoutDocument(d, opts({ focusedId: "go" }));
  expect(focusedLines[0]!.every((span) => span.style.bg === undefined)).toBe(true);
  expect(focusedLines[2]!.every((span) => span.style.bg === undefined)).toBe(true);
  const focusedInterior = focusedLines[1]!.filter((span) => span.style.bg !== undefined);
  expect(focusedInterior.every((span) => span.style.bg === "brightCyan")).toBe(true);
  expect(focusedInterior.map((span) => span.text).join("")).toContain("Go");
  expect(
    focusedLines[1]!
      .filter((span) => span.text.includes("│"))
      .every((span) => span.style.bg === undefined),
  ).toBe(true);

  const monoSpans = layoutDocument(d, opts({ theme: loadTheme("mono") })).flat();
  expect(monoSpans.every((span) => span.style.bg === undefined)).toBe(true);
});

test("button falls back to default label when missing", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "b" } }]);
  const out = renderPlain(layoutDocument(d, opts()));
  expect(out).toContain("│ Button");
});

test("focused button shows textual marker in plain output", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "go" })));
  expect(out).toContain("▸ ┌");
});

test("focused button falls back to ascii marker without unicode", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(
    layoutDocument(d, opts({ caps: caps({ unicode: false }), focusedId: "go" })),
  );
  expect(out).toContain("> +");
  expect(out).toContain("| Go");
  expect(out).not.toContain("▸");
});

test("a button that is not the focused id renders unfocused", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "a", label: "A" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "other" })));
  expect(out).not.toContain("▸");
  expect(out).toContain("│ A");
});

test("input shows placeholder when empty, value when set", () => {
  const empty = doc([
    { type: "leaf", name: "input", attrs: { id: "name", label: "Name", placeholder: "your name" } },
  ]);
  expect(renderPlain(layoutDocument(empty, opts()))).toContain("│ your name");

  const filled = doc([
    { type: "leaf", name: "input", attrs: { id: "name", label: "Name", value: "Ada" } },
  ]);
  expect(renderPlain(layoutDocument(filled, opts()))).toContain("│ Ada");
});

test("focused input shows a cursor glyph after its value", () => {
  const d = doc([{ type: "leaf", name: "input", attrs: { id: "name", value: "Ada" } }]);
  const uni = renderPlain(layoutDocument(d, opts({ focusedId: "name" })));
  expect(uni).toContain("│ Ada▏");

  const ascii = renderPlain(
    layoutDocument(d, opts({ caps: caps({ unicode: false }), focusedId: "name" })),
  );
  expect(ascii).toContain("| Ada|");
});

test("selectionActive renders the whole value as one highlighted span with no caret", () => {
  const d = doc([{ type: "leaf", name: "input", attrs: { id: "name", value: "Ada" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "name", selectionActive: true })));
  expect(out).toContain("│ Ada");
  expect(out).not.toContain("▏");
});

test.each(["input", "textarea"])("%s only highlights selected text, not typing focus", (name) => {
  const d = doc([{ type: "leaf", name, attrs: { id: "text", value: "Hello world" } }]);
  for (const themeName of ["dark", "light", "auto", "mono"]) {
    const theme = loadTheme(themeName);
    const lines = layoutDocument(d, opts({ theme, focusedId: "text", cursorPos: 5 }));
    expect(renderPlain(lines)).toContain("Hello▏ world");
    expect(renderPlain(lines)).toContain("▸");
    for (const span of lines.flat()) {
      expect(span.style.bg).toBeUndefined();
      expect(span.style.bold).toBeUndefined();
      expect(span.style.underline).toBeUndefined();
    }

    const selected = layoutDocument(d, opts({ theme, focusedId: "text", selectionActive: true }));
    expect(renderPlain(selected)).not.toContain("▏");
    const value = selected.flat().find((span) => span.text.includes("Hello"));
    expect(value?.style).toMatchObject(theme.roles.focus!);
  }
});

test("selectionActive is ignored when the input isn't the focused one", () => {
  const d = doc([{ type: "leaf", name: "input", attrs: { id: "name", value: "Ada" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "other", selectionActive: true })));
  expect(out).toContain("│ Ada");
});

test("checkbox renders checked/unchecked glyphs, unicode and ascii", () => {
  const checked = doc([
    { type: "leaf", name: "checkbox", attrs: { id: "c", label: "Agree", checked: "true" } },
  ]);
  expect(renderPlain(layoutDocument(checked, opts()))).toContain("☑ Agree");

  const unchecked = doc([{ type: "leaf", name: "checkbox", attrs: { id: "c", label: "Agree" } }]);
  expect(renderPlain(layoutDocument(unchecked, opts()))).toContain("☐ Agree");

  const ascii = renderPlain(layoutDocument(unchecked, opts({ caps: caps({ unicode: false }) })));
  expect(ascii).toContain("[ ] Agree");
});

test("radio group renders one pending focus marker and a confirmed selection", () => {
  const d = doc([
    {
      type: "container",
      name: "radio",
      attrs: { id: "plan", value: "pro" },
      children: [
        { type: "leaf", name: "option", attrs: { value: "free", label: "Free" } },
        { type: "leaf", name: "option", attrs: { value: "pro", label: "Pro" } },
      ],
    },
  ]);
  const out = renderPlain(
    layoutDocument(
      d,
      opts({
        focusedId: "plan",
        radioPending: new Map([["plan", 0]]),
      }),
    ),
  );
  expect(out).toContain("▸ ( ) Free");
  expect(out).toContain("  (*) Pro");
});

test("textarea contributes a fixed number of content rows", () => {
  const d = doc([
    {
      type: "leaf",
      name: "textarea",
      attrs: { id: "bio", label: "Bio", rows: "2", value: "one\ntwo\nthree" },
    },
  ]);
  const lines = layoutDocument(d, opts({ focusedId: "bio", cursorPos: 7 }));
  expect(lines).toHaveLength(5);
  const out = renderPlain(lines);
  expect(out).toContain("▸ Bio");
  expect(out).toContain("│ one");
});

test("auto-growing textarea uses content rows up to maxRows", () => {
  const d = doc([
    {
      type: "leaf",
      name: "textarea",
      attrs: {
        id: "bio",
        label: "Bio",
        rows: "1",
        autoGrow: "true",
        maxRows: "2",
        value: "one\ntwo\nthree",
      },
    },
  ]);
  const lines = layoutDocument(d, opts());
  expect(lines).toHaveLength(5);
  const out = renderPlain(lines);
  expect(out).toContain("one");
  expect(out).toContain("two");
  expect(out).not.toContain("three");
});

test("input width, padding, and margin are configurable", () => {
  const d = doc([
    {
      type: "leaf",
      name: "input",
      attrs: {
        id: "name",
        label: "Name",
        value: "Ada",
        width: "12",
        padding: "1",
        margin: "1",
      },
    },
  ]);
  expect(renderPlain(layoutDocument(d, opts())).split("\n")).toEqual([
    "",
    "  Name",
    "  ┌──────────┐",
    "  │          │",
    "  │ Ada      │",
    "  │          │",
    "  └──────────┘",
    "",
    "",
  ]);
});

test("app-level field defaults control vertical padding and margins", () => {
  const d = doc([
    { type: "leaf", name: "input", attrs: { id: "name", label: "Name", value: "Ada" } },
  ]);
  const out = renderPlain(
    layoutDocument(d, opts({ fields: { width: 16, paddingX: 2, paddingY: 1, marginY: 1 } })),
  );
  expect(out.split("\n")).toEqual([
    "",
    "  Name",
    "  ┌──────────────┐",
    "  │              │",
    "  │  Ada         │",
    "  │              │",
    "  └──────────────┘",
    "",
    "",
  ]);
});

test("widgets respect the viewport width invariant at pathological widths", () => {
  for (const width of [40, 10, 3]) {
    const d = doc([
      { type: "leaf", name: "button", attrs: { id: "b", label: "A very long button label" } },
      {
        type: "leaf",
        name: "input",
        attrs: { id: "i", label: "Field", value: "some long value here" },
      },
      { type: "leaf", name: "checkbox", attrs: { id: "c", label: "A rather long checkbox label" } },
    ]);
    const lines = layoutDocument(d, opts({ width, caps: caps({ width }), focusedId: "i" }));
    for (const line of lines) {
      expect(lineWidth(line, { ambiguousWide: false })).toBeLessThanOrEqual(width);
    }
  }
});

test("focus role never leaks raw escape bytes into the plain backend", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "go" })));
  expect(out).not.toContain("\x1b");
});

test("focus role is emitted through the single ANSI backend when focused", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const lines = layoutDocument(d, opts({ focusedId: "go" }));
  const out = renderAnsi(lines, caps({ colors: "ansi16" }));
  expect(out).toContain("\x1b[");
});

test("buttons default to intrinsic width with continuous interior fill and hit metadata", () => {
  for (const focusedId of [undefined, "new"]) {
    const lines = layoutDocument(
      doc([
        { type: "leaf", name: "button", attrs: { id: "new", label: "New chat", padding: "1" } },
      ]),
      opts({ focusedId }),
    );
    expect(Math.max(...lines.map((line) => lineWidth(line)))).toBe(14);
    for (const line of lines.slice(1, -1)) {
      const spans = line.filter((span) => span.text.length > 0);
      const left = spans.findIndex((span) => span.text.includes("│"));
      const right = spans.findLastIndex((span) => span.text.includes("│"));
      for (const span of spans.slice(left + 1, right)) {
        expect(span.style.bg).toBe(focusedId ? "brightCyan" : "cyan");
        expect(span.style.widgetId).toBe("new");
      }
      // Padding is deliberately a separate interior span from the neutral border.
      expect(spans[left]?.text).toBe("│");
      expect(spans[right]?.text).toBe("│");
    }
  }
});

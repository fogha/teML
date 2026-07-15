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

test("button renders label in brackets, unfocused has no marker", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(layoutDocument(d, opts()));
  expect(out).toContain("[ Go ]");
  expect(out).not.toContain("▸");
});

test("button falls back to default label when missing", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "b" } }]);
  const out = renderPlain(layoutDocument(d, opts()));
  expect(out).toContain("[ Button ]");
});

test("focused button shows textual marker in plain output", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "go" })));
  expect(out).toContain("▸ [ Go ]");
});

test("focused button falls back to ascii marker without unicode", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "go", label: "Go" } }]);
  const out = renderPlain(
    layoutDocument(d, opts({ caps: caps({ unicode: false }), focusedId: "go" })),
  );
  expect(out).toContain("> [ Go ]");
  expect(out).not.toContain("▸");
});

test("a button that is not the focused id renders unfocused", () => {
  const d = doc([{ type: "leaf", name: "button", attrs: { id: "a", label: "A" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "other" })));
  expect(out).not.toContain("▸");
  expect(out).toContain("[ A ]");
});

test("input shows placeholder when empty, value when set", () => {
  const empty = doc([
    { type: "leaf", name: "input", attrs: { id: "name", label: "Name", placeholder: "your name" } },
  ]);
  expect(renderPlain(layoutDocument(empty, opts()))).toContain("Name: [your name]");

  const filled = doc([
    { type: "leaf", name: "input", attrs: { id: "name", label: "Name", value: "Ada" } },
  ]);
  expect(renderPlain(layoutDocument(filled, opts()))).toContain("Name: [Ada]");
});

test("focused input shows a cursor glyph after its value", () => {
  const d = doc([{ type: "leaf", name: "input", attrs: { id: "name", value: "Ada" } }]);
  const uni = renderPlain(layoutDocument(d, opts({ focusedId: "name" })));
  expect(uni).toContain("[Ada▏]");

  const ascii = renderPlain(
    layoutDocument(d, opts({ caps: caps({ unicode: false }), focusedId: "name" })),
  );
  expect(ascii).toContain("[Ada|]");
});

test("selectionActive renders the whole value as one highlighted span with no caret", () => {
  const d = doc([{ type: "leaf", name: "input", attrs: { id: "name", value: "Ada" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "name", selectionActive: true })));
  expect(out).toContain("[Ada]");
  expect(out).not.toContain("▏");
  expect(out).not.toContain("|");
});

test("selectionActive is ignored when the input isn't the focused one", () => {
  const d = doc([{ type: "leaf", name: "input", attrs: { id: "name", value: "Ada" } }]);
  const out = renderPlain(layoutDocument(d, opts({ focusedId: "other", selectionActive: true })));
  expect(out).toContain("[Ada]");
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

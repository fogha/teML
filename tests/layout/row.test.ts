import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { layoutDocument } from "../../src/layout/layout.js";
import type { WidgetHit } from "../../src/layout/hits.js";
import { renderPlain } from "../../src/render/plain.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";

function render(source: string, width: number) {
  const diags = new Diagnostics();
  const hits: WidgetHit[] = [];
  const document = normalize(htmlToDoc(source, diags), diags);
  const lines = layoutDocument(document, {
    width,
    theme: loadTheme("dark", diags),
    caps: {
      colors: "none",
      unicode: true,
      hyperlinks: false,
      width,
      ambiguousWide: false,
    },
    diags,
    hits,
  });
  return { text: renderPlain(lines), hits };
}

test("row places a label and input on the same line", () => {
  const { text } = render(
    '<div data-teml="row"><label for="name">Display name</label><input id="name" value="Ada" width="32" margin="1"></div>',
    80,
  );
  const labelLine = text.split("\n").find((line) => line.includes("Display name"))!;
  expect(labelLine).toContain("Ada");
  expect(labelLine.indexOf("Display name")).toBeLessThan(labelLine.indexOf("Ada"));
});

test("row wraps children when their widths exceed the terminal", () => {
  const { text } = render(
    '<div data-teml="row"><label for="name">Display name</label><input id="name" value="Ada" width="32"></div>',
    20,
  );
  const first = text.split("\n")[0]!;
  expect(first).toContain("Display name");
  expect(first).not.toContain("┌");
  expect(text).toContain("┌");
});

test("row preserves horizontal widget hit regions", () => {
  const { hits } = render(
    '<div data-teml="row"><input id="first" value="one" width="12"><input id="second" value="two" width="12"></div>',
    80,
  );
  const first = hits.find((hit) => hit.id === "first");
  const second = hits.find((hit) => hit.id === "second");
  expect(first).toBeDefined();
  expect(second).toBeDefined();
  expect(second!.colStart).toBeGreaterThan(first!.colStart);
});

test("TeML row directive parses with gap and field children", () => {
  const diags = new Diagnostics();
  const document = normalize(
    parseTeml(
      ':::row{gap="1"}\nDisplay name\n::input{id="name" value="Ada" width="32"}\n:::',
      diags,
    ),
    diags,
  );
  expect(diags.has("unknown-directive")).toBe(false);
  expect(document.blocks[0]).toMatchObject({ type: "container", name: "row", attrs: { gap: "1" } });
});

test("row and grid reserve padding and explicit width before composing children", () => {
  for (const container of ["row", "grid"]) {
    const { text } = render(
      `<div data-teml="${container}" data-width="18" data-padding="2" data-align="end"><input id="name" width="20" value="hello"></div>`,
      20,
    );
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(20);
  }
  const { text } = render(
    '<div data-teml="row" data-width="10"><p>First label</p><p>Second label</p></div>',
    80,
  );
  for (const line of text.split("\n")) expect(line.trimEnd().length).toBeLessThanOrEqual(10);
});

test("row headings follow wrapping and outer spacing", async () => {
  const { layoutDocumentDetailed } = await import("../../src/layout/regions.js");
  const diags = new Diagnostics();
  const document = normalize(
    htmlToDoc(
      '<div data-teml="row" data-padding="1" data-margin="1"><h2>First</h2><h2>Second</h2><h2>Third</h2></div>',
      diags,
    ),
    diags,
  );
  const result = layoutDocumentDetailed(document, {
    width: 15,
    theme: loadTheme("dark"),
    caps: { colors: "none", unicode: true, hyperlinks: false, width: 15, ambiguousWide: false },
    diags,
  });
  const lines = renderPlain(result.lines).split("\n");
  for (const heading of result.headings) expect(lines[heading.row]).toContain(heading.text);
  expect(result.headings.map((h) => h.row)).toEqual([2, 4, 6]);
});

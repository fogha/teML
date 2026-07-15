import { describe, expect, test } from "vitest";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { doc, text } from "../../src/core/ast.js";
import { layoutDocumentDetailed, linkAt, nextLink } from "../../src/layout/regions.js";
import { renderPlain } from "../../src/render/plain.js";
import type { LayoutOpts } from "../../src/layout/opts.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { loadTheme } from "../../src/terminal/theme.js";

function opts(width = 20): LayoutOpts {
  const caps: Capabilities = {
    colors: "none",
    unicode: true,
    hyperlinks: true,
    width,
    ambiguousWide: false,
  };
  return { width, caps, theme: loadTheme("dark"), diags: new Diagnostics() };
}

describe("detailed layout regions", () => {
  test("collects wrapped link segments with cell-column ranges", () => {
    const result = layoutDocumentDetailed(
      doc([
        {
          type: "paragraph",
          children: [
            text("界🙂 "),
            { type: "link", href: "https://example.test", children: [text("a wrapped link")] },
          ],
        },
      ]),
      opts(10),
    );
    expect(result.links.length).toBe(3);
    expect(result.links[0]).toMatchObject({
      href: "https://example.test",
      row: 0,
      colStart: 5,
      colEnd: 6,
      label: "a",
    });
    expect(result.links[1]).toMatchObject({ row: 1, colStart: 0, label: "wrapped" });
    expect(linkAt(result.links, 0, 5)?.id).toBe("link-1");
  });

  test("preserves duplicate headings as distinct ordered identities", () => {
    const result = layoutDocumentDetailed(
      doc([
        { type: "heading", level: 3, children: [text("Same")] },
        { type: "heading", level: 3, children: [text("Same")] },
      ]),
      opts(30),
    );
    expect(result.headings).toEqual([
      { id: "heading-1", level: 3, row: 0, text: "Same" },
      { id: "heading-2", level: 3, row: 2, text: "Same" },
    ]);
  });

  test("offsets a heading nested inside a card", () => {
    const result = layoutDocumentDetailed(
      doc([
        {
          type: "container",
          name: "card",
          attrs: { title: "Card" },
          children: [{ type: "heading", level: 3, children: [text("Nested")] }],
        },
      ]),
      opts(30),
    );
    const physical = renderPlain(result.lines).split("\n");
    expect(result.headings[0]?.row).toBe(1);
    expect(physical[result.headings[0]!.row]).toContain("Nested");
  });

  test("link order and resize layout are deterministic", () => {
    const document = doc([
      {
        type: "paragraph",
        children: [{ type: "link", href: "/next", children: [text("one two three four")] }],
      },
    ]);
    const narrow = layoutDocumentDetailed(document, opts(8));
    const wide = layoutDocumentDetailed(document, opts(30));
    expect(narrow.links.length).toBeGreaterThan(wide.links.length);
    expect(nextLink(wide.links, null, 1)?.id).toBe("link-1");
    expect(nextLink(wide.links, "link-1", -1)?.id).toBe("link-1");
  });
});

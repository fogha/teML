import { test, expect } from "vitest";
import { doc, text } from "../../src/core/ast.js";
import { tokensView } from "../../src/core/tokensView.js";

test("tokensView depth-first walk", () => {
  const view = tokensView(
    doc(
      [
        { type: "heading", level: 1, children: [text("Title")] },
        {
          type: "paragraph",
          children: [
            { type: "bold", children: [text("bold")] },
            text(" plain"),
          ],
        },
        {
          type: "container",
          name: "card",
          attrs: { title: "S" },
          children: [{ type: "paragraph", children: [text("body")] }],
        },
      ],
      { title: "T", lang: "en" },
    ),
  );

  const lines = view.trimEnd().split("\n");
  expect(lines[0]).toBe("document_start");
  expect(lines).toContain('meta title="T"');
  expect(lines).toContain('meta lang="en"');
  expect(lines.indexOf("heading_start level=1")).toBeLessThan(lines.indexOf('text value="Title"'));
  expect(lines.indexOf('text value="Title"')).toBeLessThan(lines.indexOf("heading_end level=1"));
  expect(lines.indexOf("bold_start")).toBeLessThan(lines.indexOf('text value="bold"'));
  expect(lines.indexOf("container_start name=\"card\"")).toBeLessThan(lines.indexOf('attr title="S"'));
  expect(lines.at(-1)).toBe("document_end");
});

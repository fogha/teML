import { expect, test } from "vitest";
import {
  Diagnostics,
  layoutDocument,
  layoutDocumentDetailed,
  loadTheme,
  parseTeml,
  renderPlain,
  renderSpeech,
  serializeTeml,
} from "../src/index.js";

test("public entry point exposes the stable v1 pipeline", () => {
  const doc = parseTeml("# Public API\n", new Diagnostics());
  expect(serializeTeml(doc)).toContain("# Public API");
  const output = renderPlain(
    layoutDocument(doc, {
      width: 40,
      theme: loadTheme("mono"),
      caps: {
        colors: "none",
        unicode: false,
        hyperlinks: false,
        width: 40,
        ambiguousWide: false,
      },
      diags: new Diagnostics(),
    }),
  );
  expect(output).toContain("PUBLIC API");
  const detailed = layoutDocumentDetailed(doc, {
    width: 40,
    theme: loadTheme("mono"),
    caps: {
      colors: "none",
      unicode: false,
      hyperlinks: false,
      width: 40,
      ambiguousWide: false,
    },
    diags: new Diagnostics(),
  });
  expect(detailed.headings[0]).toMatchObject({ level: 1, text: "Public API" });
  expect(renderSpeech(doc)).toBe("Heading level 1: Public API\n");
});

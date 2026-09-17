import { expect, test } from "vitest";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { loadDocumentCompiler, type DocumentFormat } from "../../src/document/compiler.js";
import { documentCompilers } from "../../src/document/frontends.js";

test.each<[DocumentFormat, string]>([
  ["teml", "# Title\n\nHello **world**"],
  ["markdown", "# Title\n\nHello **world**"],
  ["html", "<h1>Title</h1><p>Hello <strong>world</strong></p>"],
])("%s synchronous and lazy compilers share normalized semantics", async (format, source) => {
  const lazy = await loadDocumentCompiler(format);
  const stages: string[] = [];
  const actual = lazy.document(source, new Diagnostics(), {
    onStage(stage) {
      stages.push(stage);
    },
  });
  expect(actual).toEqual(documentCompilers[format].document(source, new Diagnostics()));
  expect(actual.blocks).toEqual([
    { type: "heading", level: 1, children: [{ type: "text", value: "Title" }] },
    {
      type: "paragraph",
      children: [
        { type: "text", value: "Hello " },
        { type: "bold", children: [{ type: "text", value: "world" }] },
      ],
    },
  ]);
  expect(stages).toEqual(["parse", "normalize"]);
});

test("fragments discard metadata and apply their graft context", () => {
  const diags = new Diagnostics();
  const blocks = documentCompilers.teml.fragment(
    '---\ntitle: Ignore\n---\n::input{id="nested" label="Name"}',
    diags,
    {},
    { inScroll: true },
  );
  expect(blocks).toEqual([{ type: "leaf", name: "input", attrs: { label: "Name" } }]);
  expect(diags.has("scroll-nested-widget")).toBe(true);
});

test("compilers carry link sanitation policy through to the frontend", () => {
  const compiler = documentCompilers.html;
  const source = '<p><a href="file:///docs/file.md">File</a></p>';
  const blocked = compiler.document(source, new Diagnostics());
  const allowed = compiler.document(source, new Diagnostics(), { sanitize: { allowFile: true } });
  expect(JSON.stringify(blocked)).not.toContain('"href":"file:');
  expect(JSON.stringify(allowed)).toContain('"href":"file:///docs/file.md"');
});

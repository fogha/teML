import { expect, test } from "vitest";
import { doc, text, type Block } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { InteractiveLayoutCache } from "../../src/interactive/layout-cache.js";
import { collectWidgetHits } from "../../src/layout/hits.js";
import { layoutDocument } from "../../src/layout/layout.js";
import type { LayoutOpts } from "../../src/layout/opts.js";
import { renderPlain } from "../../src/render/plain.js";
import { physicalLines } from "../../src/render/screen.js";
import { loadTheme } from "../../src/terminal/theme.js";

function options(overrides: Partial<LayoutOpts> = {}): LayoutOpts {
  return {
    width: 30,
    theme: loadTheme("mono"),
    caps: {
      colors: "none",
      unicode: true,
      hyperlinks: false,
      width: 30,
      ambiguousWide: false,
    },
    diags: new Diagnostics(),
    ...overrides,
  };
}

function expectCacheMatchesFull(
  cache: InteractiveLayoutCache,
  document: ReturnType<typeof doc>,
  opts: LayoutOpts,
): void {
  const fresh = layoutDocument(document, { ...opts, hits: undefined });
  expect(renderPlain(cache.rawLines())).toBe(renderPlain(fresh));
  expect(renderPlain(cache.physicalLines())).toBe(renderPlain(physicalLines(fresh)));
  expect(cache.hits()).toEqual(
    collectWidgetHits(fresh, { ambiguousWide: opts.caps.ambiguousWide }),
  );
}

test("incremental widget growth shifts later rows exactly like a full layout", () => {
  const first: Extract<Block, { type: "leaf" }> = {
    type: "leaf",
    name: "input",
    attrs: { id: "first", label: "First", value: "x" },
  };
  const document = doc([
    first,
    { type: "paragraph", children: [text("Static middle content")] },
    { type: "leaf", name: "button", attrs: { id: "last", label: "Last" } },
  ]);
  const initial = options({ focusedId: "first", cursorPos: 1 });
  const cache = new InteractiveLayoutCache(document, initial);

  first.attrs.value = "x".repeat(100);
  const changed = options({ focusedId: "first", cursorPos: 100 });
  cache.update(changed, new Set(["first"]));
  expectCacheMatchesFull(cache, document, changed);
  expect(cache.hits().find((hit) => hit.id === "last")!.row).toBeGreaterThan(3);
});

test("focus option changes and a footnote appendix match full layout without explicit dirty ids", () => {
  const document = doc([
    { type: "leaf", name: "input", attrs: { id: "first", label: "First" } },
    {
      type: "paragraph",
      children: [text("Footnote"), { type: "footnoteRef", id: "note" }],
    },
    { type: "leaf", name: "button", attrs: { id: "last", label: "Last" } },
    {
      type: "footnoteDefinition",
      id: "note",
      children: [{ type: "paragraph", children: [text("Appendix text")] }],
    },
  ]);
  const initial = options({ focusedId: "first", cursorPos: 0 });
  const cache = new InteractiveLayoutCache(document, initial);
  const changed = options({ focusedId: "last" });

  cache.update(changed, new Set());
  expectCacheMatchesFull(cache, document, changed);
  expect(renderPlain(cache.rawLines())).toContain("Appendix text");
});

test("hard newlines before a dirty block preserve physical hit offsets", () => {
  const input: Extract<Block, { type: "leaf" }> = {
    type: "leaf",
    name: "input",
    attrs: { id: "field", label: "Field", value: "x" },
  };
  const document = doc([
    { type: "paragraph", children: [text("first physical row\nsecond physical row")] },
    input,
    { type: "leaf", name: "button", attrs: { id: "after", label: "After" } },
  ]);
  const initial = options({ focusedId: "field", cursorPos: 1 });
  const cache = new InteractiveLayoutCache(document, initial);

  input.attrs.value = "x".repeat(70);
  const changed = options({ focusedId: "field", cursorPos: 70 });
  cache.update(changed, new Set(["field"]));

  expectCacheMatchesFull(cache, document, changed);
  expect(cache.hits().find((hit) => hit.id === "after")!.row).toBeGreaterThan(4);
});

test("display-only progress widgets relayout incrementally by id", () => {
  const progress: Extract<Block, { type: "leaf" }> = {
    type: "leaf",
    name: "progress",
    attrs: { id: "deploy", label: "Deploy", value: "0", max: "100" },
  };
  const document = doc([
    { type: "paragraph", children: [text("Static header")] },
    progress,
    { type: "paragraph", children: [text("Static footer")] },
  ]);
  const initial = options();
  const cache = new InteractiveLayoutCache(document, initial);

  progress.attrs.value = "75";
  cache.update(initial, new Set(["deploy"]));
  expectCacheMatchesFull(cache, document, initial);
  expect(renderPlain(cache.physicalLines())).toContain("75%");
});

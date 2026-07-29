import { expect, test } from "vitest";
import type { Block } from "../../src/core/ast.js";
import { doc, text } from "../../src/core/ast.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { layoutDocument } from "../../src/layout/layout.js";
import type { ScrollRegionRuntime } from "../../src/layout/opts.js";
import { renderPlain } from "../../src/render/plain.js";
import { loadTheme } from "../../src/terminal/theme.js";

const caps = {
  colors: "none" as const,
  unicode: true,
  hyperlinks: false,
  width: 40,
  ambiguousWide: false,
};

test("scroll region keeps a fixed footprint and reuses cached inner layout", () => {
  const region = {
    type: "container" as const,
    name: "scroll",
    attrs: { id: "logs", rows: "3" },
    children: Array.from({ length: 100 }, (_, index) => ({
      type: "paragraph" as const,
      children: [text(`line ${index + 1}`)],
    })),
  };
  const runtime = new Map<string, ScrollRegionRuntime>();
  const options = {
    width: 40,
    theme: loadTheme("dark"),
    caps,
    diags: new Diagnostics(),
    focusedId: "logs",
    scrollRegionRuntime: runtime,
  };
  const first = layoutDocument(doc([region]), options);
  expect(first).toHaveLength(5);
  expect(runtime.get("logs")?.total).toBe(199);
  const cached = runtime.get("logs")?.innerLines;

  runtime.get("logs")!.offset = 10;
  const second = layoutDocument(doc([region]), options);
  expect(second).toHaveLength(5);
  expect(runtime.get("logs")?.innerLines).toBe(cached);
  expect(renderPlain(second)).toContain("line 6");
});

function scrollFixture(children: Block[]) {
  const region = {
    type: "container" as const,
    name: "scroll",
    attrs: { id: "logs", rows: "3" },
    children,
  };
  const runtime = new Map<string, ScrollRegionRuntime>();
  const options = {
    width: 40,
    theme: loadTheme("mono"),
    caps,
    diags: new Diagnostics(),
    scrollRegionRuntime: runtime,
  };
  return {
    region,
    runtime,
    options,
    render: () => renderPlain(layoutDocument(doc([region]), options)),
  };
}

test("mutating a scroll region's children array in place still invalidates the cache", () => {
  const { region, render } = scrollFixture([{ type: "paragraph", children: [text("first")] }]);
  expect(render()).toContain("first");

  // The array object is reused, so an alias-based cache would report "unchanged".
  region.children.push({ type: "paragraph", children: [text("second")] });
  expect(render()).toContain("second");

  region.children[0] = { type: "paragraph", children: [text("rewritten")] };
  const after = render();
  expect(after).toContain("rewritten");
  expect(after).not.toContain("first");
});

test("a fresh array of unchanged child blocks reuses the cached inner layout", () => {
  const children: Block[] = Array.from({ length: 20 }, (_, index) => ({
    type: "paragraph" as const,
    children: [text(`line ${index + 1}`)],
  }));
  const { region, runtime, render } = scrollFixture(children);
  render();
  const cached = runtime.get("logs")?.innerLines;

  region.children = [...children];
  render();
  expect(runtime.get("logs")?.innerLines).toBe(cached);
});

test("appending to a scroll region reuses the cached prefix instead of relaying out", () => {
  const children: Block[] = Array.from({ length: 20 }, (_, index) => ({
    type: "paragraph" as const,
    children: [text(`line ${index + 1}`)],
  }));
  const { region, runtime, render } = scrollFixture(children);
  render();
  const before = runtime.get("logs")!.innerLines!;

  region.children = [...children, { type: "paragraph", children: [text("appended")] }];
  render();
  const after = runtime.get("logs")!.innerLines!;
  expect(after.length).toBeGreaterThan(before.length);
  // The fast path splices the new tail onto the exact cached prefix lines.
  expect(after.slice(0, before.length)).toEqual(before);
  expect(renderPlain([after[after.length - 1]!])).toContain("appended");
});

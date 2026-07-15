import { describe, expect, test } from "vitest";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { hasPathologicalNesting, pathologicalNestingFallback } from "../../src/core/limits.js";

describe("hasPathologicalNesting", () => {
  test("is false for ordinary prose, tables, and shallow nesting", () => {
    expect(hasPathologicalNesting("# Title\n\nSome *text* with a [link](x).\n")).toBe(false);
    expect(hasPathologicalNesting("> a\n> > b\n> > > c\n")).toBe(false);
    expect(hasPathologicalNesting("- a\n  - b\n    - c\n      - d\n")).toBe(false);
  });

  test("is false for a single very long line with no nesting prefix", () => {
    expect(hasPathologicalNesting(`x${"y".repeat(100_000)}\n`)).toBe(false);
  });

  test("is true for a long chain of one-item-per-level nested lists", () => {
    let src = "";
    for (let i = 0; i < 200; i++) src += "  ".repeat(i) + "- x\n";
    expect(hasPathologicalNesting(src)).toBe(true);
  });

  test("is true for deep blockquote chains ending in a list item", () => {
    let src = "";
    for (let i = 0; i < 100; i++) src += "> ".repeat(i) + "- x\n";
    expect(hasPathologicalNesting(src)).toBe(true);
  });
});

describe("pathologicalNestingFallback", () => {
  test("renders the raw source as a literal code block and warns", () => {
    const d = new Diagnostics();
    const doc = pathologicalNestingFallback("some\nraw text\n", d);
    expect(doc.blocks).toEqual([{ type: "codeBlock", value: "some\nraw text\n" }]);
    expect(d.has("pathological-nesting-rejected")).toBe(true);
  });

  test("strips control characters via the standard sanitizer", () => {
    const d = new Diagnostics();
    const doc = pathologicalNestingFallback("safe\x07bell\n", d);
    expect(doc.blocks[0]).toMatchObject({ type: "codeBlock" });
    if (doc.blocks[0]?.type === "codeBlock") expect(doc.blocks[0].value).not.toContain("\x07");
  });
});

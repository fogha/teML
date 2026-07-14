import { test, expect } from "vitest";
import { cellWidth, graphemes, truncateToWidth } from "../../src/layout/measure.js";

test("cellWidth basics", () => {
  expect(cellWidth("abc")).toBe(3);
  expect(cellWidth("你好")).toBe(4);
  expect(cellWidth("café")).toBe(4);
  expect(cellWidth("🙂")).toBe(2);
});

test("graphemes keeps combining marks on base letter", () => {
  expect(graphemes("cafe\u0301")).toEqual(["c", "a", "f", "e\u0301"]);
});

test("truncateToWidth stops before wide char", () => {
  const out = truncateToWidth("你好世界", 5);
  expect(cellWidth(out)).toBe(5);
  expect(out.endsWith("…")).toBe(true);
});

test("ambiguousWide treats ambiguous chars as wide", () => {
  expect(cellWidth("·", { ambiguousWide: false })).toBe(1);
  expect(cellWidth("·", { ambiguousWide: true })).toBe(2);
});

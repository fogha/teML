import { describe, expect, test } from "vitest";
import {
  clampScrollRow,
  ensureRowVisible,
  maxScrollRow,
  scrollByLine,
  scrollByPage,
  sliceDocumentLines,
  statusText,
  visibleBodyRows,
} from "../../src/reader/viewport.js";
import type { ReaderModel } from "../../src/reader/model.js";

describe("reader viewport", () => {
  test("reserves status rows while always retaining one body row", () => {
    expect(visibleBodyRows({ cols: 80, rows: 24, statusRows: 1 })).toBe(23);
    expect(visibleBodyRows({ cols: 20, rows: 1, statusRows: 1 })).toBe(1);
  });

  test("clamps scrolling for empty, short, and long documents", () => {
    expect(maxScrollRow(0, 20)).toBe(0);
    expect(maxScrollRow(10, 20)).toBe(0);
    expect(maxScrollRow(100, 20)).toBe(80);
    expect(clampScrollRow(-5, 100, 20)).toBe(0);
    expect(clampScrollRow(500, 100, 20)).toBe(80);
  });

  test("line and page movement are bounded and pages overlap by one row", () => {
    expect(scrollByLine(0, 1, 100, 20)).toBe(1);
    expect(scrollByLine(80, 1, 100, 20)).toBe(80);
    expect(scrollByPage(0, 1, 100, 20)).toBe(19);
    expect(scrollByPage(19, -1, 100, 20)).toBe(0);
  });

  test("ensureRowVisible moves only when target is outside the viewport", () => {
    expect(ensureRowVisible(10, 12, 100, 20)).toBe(10);
    expect(ensureRowVisible(10, 5, 100, 20)).toBe(5);
    expect(ensureRowVisible(10, 35, 100, 20)).toBe(16);
  });

  test("slices document lines without copying the whole document", () => {
    const lines = Array.from({ length: 10 }, (_, index) => [{ text: String(index), style: {} }]);
    expect(sliceDocumentLines(lines, 4, 3).map((line) => line[0]?.text)).toEqual(["4", "5", "6"]);
  });

  test("status text reports title, percent, row range, and active mode", () => {
    const model: ReaderModel = {
      mode: "search",
      rootPath: "/docs",
      currentPath: "/docs/a.teml",
      title: "A",
      scrollRow: 40,
      focusedLinkId: null,
      history: [],
      historyIndex: -1,
      search: { query: "x", rows: [40], index: 0 },
      pendingExternalUrl: null,
      message: null,
    };
    expect(statusText(model, 100, 20)).toContain("A · 50% · 41-60/100 · search");
  });
});

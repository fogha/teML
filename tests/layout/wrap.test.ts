import { test, expect } from "vitest";
import { cellWidth } from "../../src/layout/measure.js";
import { wrapSpans } from "../../src/layout/wrap.js";

test("wrap at width 20", () => {
  const lines = wrapSpans([{ text: "one two three four five six", style: {} }], 20);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) {
    expect(line.reduce((w, s) => w + cellWidth(s.text), 0)).toBeLessThanOrEqual(20);
  }
});

test("bold word survives line break", () => {
  const lines = wrapSpans([{ text: "aaa bbbbbbbb ccc", style: { bold: true } }], 8);
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines) {
    for (const s of line) {
      if (s.text.trim()) expect(s.style.bold).toBe(true);
    }
  }
});

test("50-char URL breaks into 3 lines at width 20", () => {
  const url = "https://example.com/" + "x".repeat(30);
  const lines = wrapSpans([{ text: url, style: {} }], 20);
  expect(lines.length).toBe(3);
});

test("CJK wraps at cell boundaries", () => {
  const lines = wrapSpans([{ text: "你好世界测试内容", style: {} }], 6);
  expect(lines.length).toBeGreaterThan(1);
  for (const line of lines) {
    expect(line.reduce((w, s) => w + cellWidth(s.text), 0)).toBeLessThanOrEqual(6);
  }
});

test("width 1 does not infinite-loop", () => {
  const lines = wrapSpans([{ text: "hello", style: {} }], 1);
  expect(lines.length).toBeGreaterThan(0);
});

test("a grapheme wider than the whole line is replaced rather than overflowing it", () => {
  const lines = wrapSpans([{ text: "你好", style: {} }], 1);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) {
    expect(line.reduce((w, s) => w + cellWidth(s.text), 0)).toBeLessThanOrEqual(1);
  }
  expect(lines.map((line) => line.map((s) => s.text).join("")).join("")).toBe("……");
});

test("mixed narrow and oversized graphemes keep every line within the budget", () => {
  const lines = wrapSpans([{ text: "a你b好c", style: { bold: true } }], 1);
  for (const line of lines) {
    expect(line.reduce((w, s) => w + cellWidth(s.text), 0)).toBeLessThanOrEqual(1);
    for (const span of line) expect(span.style.bold).toBe(true);
  }
  expect(lines.map((line) => line.map((s) => s.text).join("")).join("")).toBe("a…b…c");
});

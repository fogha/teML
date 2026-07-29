import { expect, test } from "vitest";
import {
  graphemeToTextareaVisual,
  keepTextareaCursorVisible,
  textareaVisualLines,
  textareaVisualToGrapheme,
} from "../../src/layout/textarea.js";

test("textarea visual lines preserve hard newlines and terminal-cell wrapping", () => {
  const lines = textareaVisualLines("ab\n界x", 2);
  expect(lines).toEqual([
    { start: 0, end: 2, hardBreak: true, width: 2 },
    { start: 3, end: 4, hardBreak: false, width: 2 },
    { start: 4, end: 5, hardBreak: false, width: 1 },
  ]);
});

test("textarea cursor maps between grapheme offsets and visual cells", () => {
  const value = "ab\n界x";
  const lines = textareaVisualLines(value, 4);
  expect(graphemeToTextareaVisual(value, 4, lines)).toEqual({ line: 1, col: 2 });
  expect(textareaVisualToGrapheme(value, 1, 2, lines)).toBe(4);
});

test("textarea internal offset keeps the cursor visible", () => {
  expect(keepTextareaCursorVisible(0, 7, 20, 4)).toBe(4);
  expect(keepTextareaCursorVisible(10, 2, 20, 4)).toBe(2);
  expect(keepTextareaCursorVisible(30, 19, 20, 4)).toBe(16);
});

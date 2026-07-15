import { test, expect } from "vitest";
import { escapeTemlText, codeFenceLength } from "../../src/teml/escape.js";

test("escapeTemlText: prose specials and role prefix", () => {
  expect(escapeTemlText("*bold `_[]{}_#|", "prose")).toBe("\\*bold \\`\\_\\[\\]\\{\\}\\_\\#\\|");
  expect(escapeTemlText("see :success[ok]", "prose")).toBe("see \\:success\\[ok\\]");
  expect(escapeTemlText("already\\:escaped", "prose")).toBe("already\\\\:escaped");
});

test("escapeTemlText: link context", () => {
  expect(escapeTemlText("label *[`", "link")).toBe("label \\*\\[\\`");
});

test("escapeTemlText: attr quoting", () => {
  expect(escapeTemlText('say "hi"', "attr")).toBe('say \\"hi\\"');
  expect(escapeTemlText("back\\slash", "attr")).toBe("back\\\\slash");
});

test("escapeTemlText: code inline", () => {
  expect(escapeTemlText("a`b\\c", "codeInline")).toBe("a\\`b\\\\c");
});

test("escapeTemlText: table cell pipes", () => {
  expect(escapeTemlText("a | b", "tableCell")).toBe("a \\| b");
});

test("codeFenceLength: grows with backtick runs", () => {
  expect(codeFenceLength("plain")).toBe(3);
  expect(codeFenceLength("has ``` inside")).toBe(4);
  expect(codeFenceLength("````")).toBe(5);
});

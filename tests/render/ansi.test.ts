import { test, expect } from "vitest";
import { downgradeColor, renderAnsi, stylesNeedSgr } from "../../src/render/ansi.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps = (colors: Capabilities["colors"]): Capabilities => ({
  colors,
  unicode: true,
  hyperlinks: true,
  width: 80,
  ambiguousWide: false,
});

test("hex downgrades to 256 then 16", () => {
  const hex = "#ff8800";
  expect(downgradeColor(hex, "truecolor", true)).toEqual([38, 2, 255, 136, 0]);
  expect(downgradeColor(hex, "ansi256", true)[0]).toBe(38);
  expect(downgradeColor(hex, "ansi16", true)[0]).toBeGreaterThanOrEqual(30);
});

test("named colors map to basic fg", () => {
  expect(downgradeColor("red", "ansi16", true)).toEqual([31]);
});

test("minimal style transitions skip identical spans", () => {
  const a = { fg: "green" as const, bold: true };
  expect(stylesNeedSgr(a, a, "truecolor")).toBe(false);
  expect(stylesNeedSgr(a, { fg: "green", bold: false }, "truecolor")).toBe(true);
});

test("style transitions explicitly disable previous attributes", () => {
  const out = renderAnsi(
    [[
      { text: "bold", style: { bold: true } },
      { text: "plain", style: {} },
    ]],
    caps("ansi16"),
  );
  expect(out).toContain("\x1b[1mbold\x1b[22mplain");
});

test("strike SGR 9 opens and 29 closes", () => {
  const out = renderAnsi(
    [[
      { text: "before", style: {} },
      { text: "cut", style: { strike: true } },
      { text: "after", style: {} },
    ]],
    caps("truecolor"),
  );
  expect(out).toContain("\x1b[9mcut\x1b[29mafter");
});

test("line-end reset emitted", () => {
  const out = renderAnsi([[{ text: "hi", style: { bold: true, fg: "red" } }]], caps("truecolor"));
  expect(out.endsWith("\n")).toBe(true);
  expect(out.includes("\x1b[0m\n")).toBe(true);
});

test("OSC8 hyperlinks wrap link text", () => {
  const out = renderAnsi(
    [[{ text: "click", style: { fg: "blue", href: "https://example.com" } }]],
    caps("truecolor"),
  );
  expect(out.includes("\x1b]8;;https://example.com\x1b\\")).toBe(true);
});

test("no SGR when colors none", () => {
  const out = renderAnsi([[{ text: "plain", style: { fg: "red", bold: true } }]], caps("none"));
  expect(out.includes("\x1b[")).toBe(false);
});

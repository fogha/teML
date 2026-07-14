import { test, expect } from "vitest";
import { detectCapabilities } from "../../src/terminal/capabilities.js";

const env = (vars: Record<string, string | undefined>): NodeJS.ProcessEnv => ({ ...vars });

test("NO_COLOR disables colors", () => {
  const caps = detectCapabilities({}, env({ NO_COLOR: "1" }), true, 80);
  expect(caps.colors).toBe("none");
});

test("non-TTY disables colors and defaults width 80", () => {
  const caps = detectCapabilities({}, env({}), false, undefined);
  expect(caps.colors).toBe("none");
  expect(caps.width).toBe(80);
});

test("COLORTERM=truecolor selects truecolor", () => {
  const caps = detectCapabilities({}, env({ COLORTERM: "truecolor" }), true, 80);
  expect(caps.colors).toBe("truecolor");
});

test("TERM with 256color selects ansi256", () => {
  const caps = detectCapabilities({}, env({ TERM: "xterm-256color" }), true, 80);
  expect(caps.colors).toBe("ansi256");
});

test("plain TERM selects ansi16", () => {
  const caps = detectCapabilities({}, env({ TERM: "xterm" }), true, 80);
  expect(caps.colors).toBe("ansi16");
});

test("unicode false for non-UTF locale", () => {
  const caps = detectCapabilities({ ascii: false }, env({ LANG: "C" }), true, 80);
  expect(caps.unicode).toBe(false);
});

test("unicode true for UTF-8 locale", () => {
  const caps = detectCapabilities({}, env({ LANG: "en_US.UTF-8" }), true, 80);
  expect(caps.unicode).toBe(true);
});

test("width: flag beats tty columns", () => {
  const caps = detectCapabilities({ width: 100 }, env({}), true, 60);
  expect(caps.width).toBe(100);
});

test("width: explicit flag below 20 is honored", () => {
  const caps = detectCapabilities({ width: 10 }, env({}), true, 80);
  expect(caps.width).toBe(10);
});

test("width: implicit tty below 20 is clamped to 20", () => {
  const caps = detectCapabilities({}, env({}), true, 12);
  expect(caps.width).toBe(20);
});

test("width: tty columns beat COLUMNS env", () => {
  const caps = detectCapabilities({}, env({ COLUMNS: "72" }), true, 90);
  expect(caps.width).toBe(90);
});

test("hyperlinks enabled for iTerm", () => {
  const caps = detectCapabilities({}, env({ TERM_PROGRAM: "iTerm.app", COLORTERM: "truecolor" }), true, 80);
  expect(caps.hyperlinks).toBe(true);
});

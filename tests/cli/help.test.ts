import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cleanCommanderError, shouldShowRootHelp } from "../../src/cli/help.js";
import { parseFrameMode, parseHeight, parseWidth } from "../../src/cli/options.js";

const CLI = join(process.cwd(), "dist/cli/main.js");

function help(...args: string[]): string {
  return execFileSync("node", [CLI, ...args, "--help"], { encoding: "utf8" });
}

test("no arguments show help only when stdin is an interactive terminal", () => {
  expect(shouldShowRootHelp([], true)).toBe(true);
  expect(shouldShowRootHelp([], false)).toBe(false);
  expect(shouldShowRootHelp(["-"], true)).toBe(false);
  expect(shouldShowRootHelp(["README.md"], true)).toBe(false);
});

test("Commander error messages do not get a duplicated error prefix", () => {
  expect(cleanCommanderError("error: unknown option '--wat'")).toBe("unknown option '--wat'");
  expect(cleanCommanderError("invalid input")).toBe("invalid input");
});

test("numeric layout flags and frame modes reject partial or invalid values", () => {
  expect(parseWidth("40")).toBe(40);
  expect(parseHeight("24")).toBe(24);
  expect(parseFrameMode("PATCHES")).toBe("patches");
  expect(() => parseWidth("40px")).toThrow(/invalid --width/);
  expect(() => parseHeight("2.5")).toThrow(/invalid --height/);
  expect(() => parseFrameMode("delta")).toThrow(/invalid --mode/);
});

test("root help explains the three modes and gives copyable examples", () => {
  const output = help();
  expect(output).toContain("Static output");
  expect(output).toContain("Reader");
  expect(output).toContain("App runtime");
  expect(output).toContain("teml demo");
  expect(output).toContain("Piped output is plain text");
  expect(output).toContain("https://github.com/fogha/teML#readme");
});

test.each([
  ["demo", "No file or network connection is needed.", "teml demo --theme mono"],
  ["view", "Render one document and exit.", "curl -sL"],
  ["read", "Essential keys:", "Navigation stays inside"],
  ["convert", "Output formats:", "--to speech"],
  ["render", "never emits ANSI", "defaults to width 80"],
  ["inspect", "--render-tokens", "Normalized TDoc JSON"],
  ["run", "language-agnostic integration API", "runInteractiveApp()"],
])("%s help explains behavior and includes practical guidance", (command, behavior, example) => {
  const output = help(command);
  expect(output).toContain(behavior);
  expect(output).toContain(example);
});

test("command help omits options that do not apply", () => {
  expect(help("read")).not.toContain("--to <format>");
  expect(help("view")).not.toContain("--to <format>");
  expect(help("demo")).not.toContain("--from <format>");
  expect(help("convert")).toContain("--to <format>");
  expect(help("view")).not.toContain("--height <n>");
  expect(help("view")).not.toContain("--mode <mode>");
});

test("run help exposes startup frame and viewport negotiation", () => {
  const output = help("run");
  expect(output).toContain("--frames <format>");
  expect(output).toContain("ansi, plain, or both");
  expect(output).toContain("--mode <mode>");
  expect(output).toContain("full or patches");
  expect(output).toContain("--height <n>");
});

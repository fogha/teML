import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vitest";
import { cleanCommanderError, shouldShowRootHelp } from "../../src/cli/help.js";

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
});

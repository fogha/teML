// A filesystem path is both a navigation target and a display label. The raw
// path must survive for navigation; the label that reaches the screen must not
// be able to inject terminal controls (C01).
import { resolve } from "node:path";
import { expect, test } from "vitest";
import type { DetailedLayout } from "../../src/layout/regions.js";
import { ReaderSession, type ReaderEffect } from "../../src/reader/session.js";
import { encodeScreenOps } from "../../src/render/ansi.js";
import { diffFrames } from "../../src/render/screen.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "none",
  unicode: true,
  hyperlinks: false,
  width: 80,
  ambiguousWide: false,
};

const detailed: DetailedLayout = {
  lines: [[{ text: "Body", style: {} }]],
  links: [],
  headings: [],
};

function reader(currentPath: string, title?: string): ReaderSession {
  return new ReaderSession({
    rootPath: resolve("/docs"),
    currentPath,
    detailed,
    viewport: { cols: 80, rows: 6, statusRows: 1 },
    caps,
    ...(title === undefined ? {} : { title }),
  });
}

function encode(effects: ReaderEffect[]): string {
  const frame = effects.find((effect) => effect.type === "frame");
  if (frame?.type !== "frame") throw new Error("expected a frame effect");
  return encodeScreenOps(diffFrames(null, frame.frame), caps);
}

test("a filename label cannot inject an escape sequence into the frame", () => {
  const output = encode(reader(resolve("/docs/index.md"), "\x1b[31mevil.md").start());
  expect(output).not.toContain("\x1b[31m");
  expect(output).toContain("[31mevil.md");
});

test("the current-path fallback label is sanitized too", () => {
  const output = encode(reader(resolve("/docs/\x1b[31mx.md")).start());
  expect(output).not.toContain("\x1b[31m");
});

test("a navigation failure message cannot inject an escape sequence", () => {
  const session = reader(resolve("/docs/index.md"), "index.md");
  const output = encode(session.report("cannot open target: \x1b]0;pwned\x07.md"));
  expect(output).not.toContain("\x1b]0;");
  expect(output).toContain("]0;pwned.md");
});

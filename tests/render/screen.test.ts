import { describe, expect, test } from "vitest";
import { encodeScreenOps } from "../../src/render/ansi.js";
import { diffFrames, linesToScreen } from "../../src/render/screen.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "none",
  unicode: true,
  hyperlinks: false,
  width: 20,
  ambiguousWide: false,
};

describe("screen frames", () => {
  test("clips by terminal cells, never splitting wide graphemes, then pads", () => {
    const frame = linesToScreen([[{ text: "ab🙂z", style: {} }]], 4, 1);
    expect(frame.lines[0]?.map((span) => span.text).join("")).toBe("ab🙂");
  });

  test("splits embedded newlines into physical rows", () => {
    const frame = linesToScreen([[{ text: "a\nb", style: { bold: true } }]], 3, 2);
    expect(frame.lines.map((line) => line.map((span) => span.text).join(""))).toEqual([
      "a  ",
      "b  ",
    ]);
    expect(frame.lines[1]?.[0]?.style.bold).toBe(true);
  });

  test("initial frame performs a full paint", () => {
    const next = linesToScreen([[{ text: "one", style: {} }]], 5, 2);
    expect(diffFrames(null, next).map((op) => op.type)).toEqual(["clear", "row", "row"]);
  });

  test("same-sized frame emits only changed rows", () => {
    const before = linesToScreen(
      [[{ text: "one", style: {} }], [{ text: "two", style: {} }]],
      5,
      2,
    );
    const after = linesToScreen([[{ text: "one", style: {} }], [{ text: "TWO", style: {} }]], 5, 2);
    expect(diffFrames(before, after)).toEqual([{ type: "row", row: 1, line: after.lines[1] }]);
  });

  test("resize performs full paint and clears stale rows", () => {
    const before = linesToScreen([[{ text: "one", style: {} }]], 5, 3);
    const after = linesToScreen([[{ text: "x", style: {} }]], 3, 1);
    expect(diffFrames(before, after).map((op) => op.type)).toEqual(["clear", "row"]);
  });

  test("screen operations are encoded through the ANSI backend", () => {
    const frame = linesToScreen([[{ text: "ok", style: {} }]], 4, 1);
    const encoded = encodeScreenOps(diffFrames(null, frame), caps);
    expect(encoded).toContain("\x1b[2J\x1b[H");
    expect(encoded).toContain("\x1b[1;1H\x1b[2Kok  ");
  });
});

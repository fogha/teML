import { describe, expect, test } from "vitest";
import { createInputDecoder } from "../../../src/terminal/client/input.js";

describe("terminal input decoder", () => {
  test("decodes fragmented and combined key sequences", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b[")).toEqual([]);
    expect(decoder.push("Axy")).toEqual([
      { type: "key", key: "up" },
      { type: "char", char: "x" },
      { type: "char", char: "y" },
    ]);
  });

  test("decodes navigation keys and a standalone escape", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b[5~\x1b[6~\x1b[H\x1b[F")).toEqual([
      { type: "key", key: "pageUp" },
      { type: "key", key: "pageDown" },
      { type: "key", key: "home" },
      { type: "key", key: "end" },
    ]);
    expect(decoder.push("\x1b")).toEqual([]);
    expect(decoder.flush()).toEqual([{ type: "key", key: "escape" }]);
  });

  test("decodes SGR pointer and wheel events across chunks", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b[<0;4;")).toEqual([]);
    expect(decoder.push("3M\x1b[<64;1;1M\x1b[<65;1;1M")).toEqual([
      { type: "pointer", row: 2, col: 3, button: 0 },
      { type: "wheel", delta: -1 },
      { type: "wheel", delta: 1 },
    ]);
  });

  test("keeps Unicode graphemes as complete code points", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("🙂")).toEqual([{ type: "char", char: "🙂" }]);
  });
});

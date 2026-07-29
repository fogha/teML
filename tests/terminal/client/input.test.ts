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
    expect(decoder.push("\x1b[5~\x1b[6~\x1b[H\x1b[F\x1b[3~")).toEqual([
      { type: "key", key: "pageUp" },
      { type: "key", key: "pageDown" },
      { type: "key", key: "home" },
      { type: "key", key: "end" },
      { type: "key", key: "delete" },
    ]);
    expect(decoder.push("\x1b")).toEqual([]);
    expect(decoder.flush()).toEqual([{ type: "key", key: "escape" }]);
  });

  test("decodes function keys and xterm modifiers across fragmented chunks", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b[1")).toEqual([]);
    expect(decoder.push(";5A\x1b[3;3~\x1bOP\x1b[24~\x1b[13;5u")).toEqual([
      { type: "key", key: "up", modifiers: { ctrl: true } },
      { type: "key", key: "delete", modifiers: { alt: true } },
      { type: "key", key: "f1" },
      { type: "key", key: "f12" },
      { type: "key", key: "enter", modifiers: { ctrl: true } },
    ]);
  });

  test("decodes SS3 application-mode navigation and Alt+Arrow", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1bOA\x1bOB\x1bOC\x1bOD\x1bOH\x1bOF\x1b[1;3D")).toEqual([
      { type: "key", key: "up" },
      { type: "key", key: "down" },
      { type: "key", key: "right" },
      { type: "key", key: "left" },
      { type: "key", key: "home" },
      { type: "key", key: "end" },
      { type: "key", key: "left", modifiers: { alt: true } },
    ]);
  });

  test("drops complete unknown escape sequences instead of leaking literal input", () => {
    const decoder = createInputDecoder();
    expect(decoder.push("\x1b[99~x")).toEqual([{ type: "char", char: "x" }]);
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

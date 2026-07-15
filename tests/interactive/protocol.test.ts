import { test, expect } from "vitest";
import {
  decodeCommand,
  encodeEvent,
  NdjsonSplitter,
  type Command,
  type SessionEvent,
} from "../../src/interactive/protocol.js";

test("decodeCommand accepts a valid key command", () => {
  const r = decodeCommand('{"type":"key","key":"tab"}');
  expect(r).toEqual({ ok: true, command: { type: "key", key: "tab" } });
});

test("decodeCommand accepts all known key names", () => {
  for (const key of ["tab", "shiftTab", "enter", "backspace", "escape", "left", "right"]) {
    const r = decodeCommand(JSON.stringify({ type: "key", key }));
    expect(r.ok).toBe(true);
  }
});

test("decodeCommand accepts a valid pointer command", () => {
  const r = decodeCommand('{"type":"pointer","row":3,"col":7}');
  expect(r).toEqual({ ok: true, command: { type: "pointer", row: 3, col: 7 } });
});

test("decodeCommand rejects pointer commands with bad coordinates", () => {
  for (const line of [
    '{"type":"pointer","row":-1,"col":0}',
    '{"type":"pointer","row":1.5,"col":0}',
    '{"type":"pointer","row":"3","col":0}',
    '{"type":"pointer","row":3}',
  ]) {
    expect(decodeCommand(line).ok).toBe(false);
  }
});

test("decodeCommand accepts a valid char command", () => {
  const r = decodeCommand('{"type":"char","char":"a"}');
  expect(r).toEqual({ ok: true, command: { type: "char", char: "a" } });
});

test("decodeCommand accepts a render command with and without format", () => {
  const withFormat = decodeCommand('{"type":"render","markup":"# hi","format":"markdown"}');
  expect(withFormat).toEqual({
    ok: true,
    command: { type: "render", markup: "# hi", format: "markdown" },
  });

  const withoutFormat = decodeCommand('{"type":"render","markup":"# hi"}');
  expect(withoutFormat).toEqual({
    ok: true,
    command: { type: "render", markup: "# hi", format: undefined },
  });
});

test("decodeCommand accepts exit", () => {
  expect(decodeCommand('{"type":"exit"}')).toEqual({ ok: true, command: { type: "exit" } });
});

test("decodeCommand rejects malformed JSON without throwing", () => {
  const r = decodeCommand("{not json");
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("malformed JSON");
});

test("decodeCommand rejects non-object JSON", () => {
  for (const line of ['"a string"', "42", "true", "[1,2,3]", "null"]) {
    const r = decodeCommand(line);
    expect(r.ok).toBe(false);
  }
});

test("decodeCommand rejects unknown command types", () => {
  const r = decodeCommand('{"type":"teleport"}');
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error).toContain("unknown command type");
});

test("decodeCommand rejects invalid key names", () => {
  const r = decodeCommand('{"type":"key","key":"F13"}');
  expect(r.ok).toBe(false);
});

test("decodeCommand rejects an empty char", () => {
  const r = decodeCommand('{"type":"char","char":""}');
  expect(r.ok).toBe(false);
});

test("decodeCommand rejects render without markup", () => {
  const r = decodeCommand('{"type":"render"}');
  expect(r.ok).toBe(false);
});

test("decodeCommand rejects render with an unknown format", () => {
  const r = decodeCommand('{"type":"render","markup":"x","format":"pdf"}');
  expect(r.ok).toBe(false);
});

test("decodeCommand error messages never leak more than ~80 chars of a hostile line", () => {
  const huge = "x".repeat(10_000);
  const r = decodeCommand(huge);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.length).toBeLessThan(120);
});

test("encodeEvent produces a single NDJSON line ending in \\n", () => {
  const event: SessionEvent = { type: "click", id: "submit", values: { name: "Ada" } };
  const line = encodeEvent(event);
  expect(line.endsWith("\n")).toBe(true);
  expect(line.indexOf("\n")).toBe(line.length - 1);
  expect(JSON.parse(line)).toEqual(event);
});

test("encodeEvent round-trips every event shape", () => {
  const events: SessionEvent[] = [
    { type: "frame", seq: 1, focusedId: "name", plain: "hi", ansi: "\x1b[1mhi\x1b[0m" },
    { type: "frame", seq: 2, focusedId: null, plain: "hi", ansi: "hi" },
    { type: "change", id: "name", value: "Ada" },
    { type: "toggle", id: "agree", checked: true },
    { type: "click", id: "submit", values: { name: "Ada" } },
    { type: "error", message: "bad input" },
    { type: "exit" },
  ];
  for (const event of events) {
    expect(JSON.parse(encodeEvent(event))).toEqual(event);
  }
});

test("NdjsonSplitter yields multiple lines delivered in one chunk", () => {
  const s = new NdjsonSplitter();
  const lines = s.push('{"type":"key","key":"tab"}\n{"type":"exit"}\n');
  expect(lines).toEqual(['{"type":"key","key":"tab"}', '{"type":"exit"}']);
});

test("NdjsonSplitter buffers a line split across multiple chunks", () => {
  const s = new NdjsonSplitter();
  expect(s.push('{"type":"cha')).toEqual([]);
  expect(s.push('r","char":"a"}\n')).toEqual(['{"type":"char","char":"a"}']);
});

test("NdjsonSplitter drops blank lines", () => {
  const s = new NdjsonSplitter();
  const lines = s.push('\n\n{"type":"exit"}\n\n');
  expect(lines).toEqual(['{"type":"exit"}']);
});

test("NdjsonSplitter strips a trailing \\r for CRLF input", () => {
  const s = new NdjsonSplitter();
  const lines = s.push('{"type":"exit"}\r\n');
  expect(lines).toEqual(['{"type":"exit"}']);
});

test("NdjsonSplitter.flush returns a trailing unterminated line, then nothing", () => {
  const s = new NdjsonSplitter();
  s.push('{"type":"exit"}\n{"type":"key","key":"tab"}');
  expect(s.flush()).toEqual(['{"type":"key","key":"tab"}']);
  expect(s.flush()).toEqual([]);
});

test("decodeCommand handles every line NdjsonSplitter can produce end-to-end", () => {
  const s = new NdjsonSplitter();
  const lines = s.push(
    ['{"type":"key","key":"enter"}', '{"type":"char","char":"x"}', '{"type":"exit"}'].join("\n") +
      "\n",
  );
  const decoded = lines.map(decodeCommand);
  expect(decoded.every((r) => r.ok)).toBe(true);
  const commands = decoded.map((r) => (r as { ok: true; command: Command }).command);
  expect(commands).toEqual([
    { type: "key", key: "enter" },
    { type: "char", char: "x" },
    { type: "exit" },
  ]);
});

import { test, expect } from "vitest";
import {
  decodeCommand,
  encodeEvent,
  ENGINE_CAPABILITIES,
  hasProtocolCapability,
  MAX_CHAR_BYTES,
  MAX_NDJSON_LINE_BYTES,
  MAX_RENDER_MARKUP_BYTES,
  MAX_SCROLL_ROWS,
  NdjsonSplitter,
  protocolMetadata,
  readProtocolMetadata,
  type Command,
  type SessionEvent,
} from "../../src/interactive/protocol.js";

test("decodeCommand accepts a valid key command", () => {
  const r = decodeCommand('{"type":"key","key":"tab"}');
  expect(r).toEqual({ ok: true, command: { type: "key", key: "tab" } });
});

test("decodeCommand accepts all known key names", () => {
  for (const key of [
    "tab",
    "shiftTab",
    "enter",
    "backspace",
    "escape",
    "left",
    "right",
    "up",
    "down",
    "home",
    "end",
    "delete",
    "pageUp",
    "pageDown",
    ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
  ]) {
    const r = decodeCommand(JSON.stringify({ type: "key", key }));
    expect(r.ok).toBe(true);
  }
});

test("decodeCommand preserves strictly typed key modifiers", () => {
  expect(
    decodeCommand(
      '{"type":"key","key":"enter","modifiers":{"ctrl":true,"alt":false,"shift":true}}',
    ),
  ).toEqual({
    ok: true,
    command: {
      type: "key",
      key: "enter",
      modifiers: { ctrl: true, alt: false, shift: true },
    },
  });
  expect(decodeCommand('{"type":"key","key":"tab","modifiers":{}}')).toEqual({
    ok: true,
    command: { type: "key", key: "tab", modifiers: {} },
  });
});

test("decodeCommand rejects malformed or unknown key modifiers", () => {
  for (const line of [
    '{"type":"key","key":"enter","modifiers":null}',
    '{"type":"key","key":"enter","modifiers":[]}',
    '{"type":"key","key":"enter","modifiers":{"ctrl":"yes"}}',
    '{"type":"key","key":"enter","modifiers":{"meta":true}}',
  ]) {
    expect(decodeCommand(line).ok).toBe(false);
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

test("decodeCommand accepts bounded signed scroll rows", () => {
  expect(decodeCommand('{"type":"scroll","rows":3}')).toEqual({
    ok: true,
    command: { type: "scroll", rows: 3 },
  });
  expect(decodeCommand('{"type":"scroll","rows":-7}')).toEqual({
    ok: true,
    command: { type: "scroll", rows: -7 },
  });
  for (const rows of [1.5, "3", MAX_SCROLL_ROWS + 1, -MAX_SCROLL_ROWS - 1]) {
    expect(decodeCommand(JSON.stringify({ type: "scroll", rows })).ok).toBe(false);
  }
});

test("protocol metadata is finite and tolerant of unknown future capabilities", () => {
  const metadata = protocolMetadata();
  expect(metadata.protocol).toEqual({ major: 1, minor: 3 });
  expect(metadata.capabilities).toEqual(ENGINE_CAPABILITIES);
  expect(metadata.capabilities).toContain("documentMutations");
  const parsed = readProtocolMetadata({
    protocol: metadata.protocol,
    capabilities: [...metadata.capabilities, "futureFeature"],
  });
  expect(parsed).toEqual(metadata);
  expect(hasProtocolCapability(parsed, "scroll")).toBe(true);
  expect(readProtocolMetadata({ type: "frame" })).toBeNull();
  expect(readProtocolMetadata({ protocol: { major: -1, minor: 0 }, capabilities: [] })).toBeNull();
});

test("decodeCommand accepts resize with optional height", () => {
  expect(decodeCommand('{"type":"resize","width":80}')).toEqual({
    ok: true,
    command: { type: "resize", width: 80, height: undefined },
  });
  expect(decodeCommand('{"type":"resize","width":120,"height":40}')).toEqual({
    ok: true,
    command: { type: "resize", width: 120, height: 40 },
  });
});

test("decodeCommand rejects malformed resize dimensions", () => {
  for (const line of [
    '{"type":"resize"}',
    '{"type":"resize","width":0}',
    '{"type":"resize","width":-1}',
    '{"type":"resize","width":40.5}',
    '{"type":"resize","width":"80"}',
    '{"type":"resize","width":80,"height":0}',
    '{"type":"resize","width":80,"height":24.5}',
    '{"type":"resize","width":80,"height":"24"}',
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

test("decodeCommand accepts targeted document mutation commands", () => {
  expect(
    decodeCommand(
      '{"type":"replace","target":"summary","markup":"Replacement","format":"markdown"}',
    ),
  ).toEqual({
    ok: true,
    command: {
      type: "replace",
      target: "summary",
      markup: "Replacement",
      format: "markdown",
    },
  });
  expect(decodeCommand('{"type":"append","target":"logs","markup":"Next line"}')).toEqual({
    ok: true,
    command: { type: "append", target: "logs", markup: "Next line", format: undefined },
  });
  expect(decodeCommand('{"type":"remove","target":"completed"}')).toEqual({
    ok: true,
    command: { type: "remove", target: "completed" },
  });
});

test("decodeCommand rejects malformed document mutation commands", () => {
  for (const line of [
    '{"type":"replace","target":"","markup":"x"}',
    '{"type":"replace","target":"card"}',
    '{"type":"replace","target":"card","markup":"x","format":"pdf"}',
    '{"type":"append","target":"logs","markup":1}',
    '{"type":"append","markup":"x"}',
    '{"type":"remove","target":""}',
    '{"type":"remove"}',
  ]) {
    expect(decodeCommand(line).ok).toBe(false);
  }
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

test("decodeCommand rejects resource-exhausting char and render payloads", () => {
  expect(
    decodeCommand(JSON.stringify({ type: "char", char: "x".repeat(MAX_CHAR_BYTES + 1) })).ok,
  ).toBe(false);
  expect(
    decodeCommand(
      JSON.stringify({ type: "render", markup: "x".repeat(MAX_RENDER_MARKUP_BYTES + 1) }),
    ).ok,
  ).toBe(false);
  expect(
    decodeCommand(
      JSON.stringify({
        type: "append",
        target: "logs",
        markup: "x".repeat(MAX_RENDER_MARKUP_BYTES + 1),
      }),
    ).ok,
  ).toBe(false);
});

test("decodeCommand accepts a configure command with a frame format", () => {
  for (const frames of ["ansi", "plain", "both"]) {
    const r = decodeCommand(JSON.stringify({ type: "configure", frames }));
    expect(r).toEqual({ ok: true, command: { type: "configure", frames, mode: "full" } });
  }
});

test("decodeCommand rejects configure with an unknown frame format", () => {
  const r = decodeCommand('{"type":"configure","frames":"neon"}');
  expect(r.ok).toBe(false);
});

test("decodeCommand rejects configure without a frames field", () => {
  const r = decodeCommand('{"type":"configure"}');
  expect(r.ok).toBe(false);
});

test("decodeCommand accepts a configure command with a frame mode", () => {
  for (const mode of ["full", "patches"]) {
    const r = decodeCommand(JSON.stringify({ type: "configure", frames: "ansi", mode }));
    expect(r).toEqual({ ok: true, command: { type: "configure", frames: "ansi", mode } });
  }
});

test("decodeCommand defaults a configure without mode to full", () => {
  const r = decodeCommand('{"type":"configure","frames":"plain"}');
  expect(r).toEqual({ ok: true, command: { type: "configure", frames: "plain", mode: "full" } });
});

test("decodeCommand rejects configure with an unknown frame mode", () => {
  const r = decodeCommand('{"type":"configure","frames":"ansi","mode":"delta"}');
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

test("decodeCommand accepts a valid update command", () => {
  expect(
    decodeCommand('{"type":"update","id":"deploy","props":{"value":"73","max":"100"}}'),
  ).toEqual({
    ok: true,
    command: { type: "update", id: "deploy", props: { value: "73", max: "100" } },
  });
});

test("decodeCommand rejects malformed update commands", () => {
  for (const line of [
    '{"type":"update"}',
    '{"type":"update","id":"","props":{"value":"1"}}',
    '{"type":"update","id":"deploy"}',
    '{"type":"update","id":"deploy","props":[]}',
    '{"type":"update","id":"deploy","props":{"value":1}}',
    '{"type":"update","id":"deploy","props":{}}',
  ]) {
    expect(decodeCommand(line).ok).toBe(false);
  }
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
    {
      type: "frame",
      seq: 2,
      focusedId: null,
      plain: "hi",
      ansi: "hi",
      viewport: { offset: 4, height: 1, total: 10 },
    },
    {
      type: "frame",
      seq: 3,
      focusedId: "name",
      rows: 2,
      patches: [
        { row: 0, plain: "hi", ansi: "\x1b[1mhi\x1b[0m" },
        { row: 1, plain: null, ansi: "\x1b[1mthere\x1b[0m" },
      ],
      viewport: { offset: 4, height: 2, total: 10 },
    },
    { type: "frame", seq: 4, focusedId: null, rows: 2, patches: [] },
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
  expect(lines).toEqual([
    { ok: true, line: '{"type":"key","key":"tab"}' },
    { ok: true, line: '{"type":"exit"}' },
  ]);
});

test("NdjsonSplitter buffers a line split across multiple chunks", () => {
  const s = new NdjsonSplitter();
  expect(s.push('{"type":"cha')).toEqual([]);
  expect(s.push('r","char":"a"}\n')).toEqual([{ ok: true, line: '{"type":"char","char":"a"}' }]);
});

test("NdjsonSplitter drops blank lines", () => {
  const s = new NdjsonSplitter();
  const lines = s.push('\n\n{"type":"exit"}\n\n');
  expect(lines).toEqual([{ ok: true, line: '{"type":"exit"}' }]);
});

test("NdjsonSplitter strips a trailing \\r for CRLF input", () => {
  const s = new NdjsonSplitter();
  const lines = s.push('{"type":"exit"}\r\n');
  expect(lines).toEqual([{ ok: true, line: '{"type":"exit"}' }]);
});

test("NdjsonSplitter.flush returns a trailing unterminated line, then nothing", () => {
  const s = new NdjsonSplitter();
  s.push('{"type":"exit"}\n{"type":"key","key":"tab"}');
  expect(s.flush()).toEqual([{ ok: true, line: '{"type":"key","key":"tab"}' }]);
  expect(s.flush()).toEqual([]);
});

test("NdjsonSplitter reports and discards an oversized line before recovering", () => {
  const s = new NdjsonSplitter();
  expect(s.push("x".repeat(MAX_NDJSON_LINE_BYTES + 1))).toEqual([
    { ok: false, error: expect.stringContaining("exceeds") },
  ]);
  expect(s.push('still-discarded\n{"type":"exit"}\n')).toEqual([
    { ok: true, line: '{"type":"exit"}' },
  ]);
});

test("NdjsonSplitter reassembles a large line delivered one character at a time", () => {
  const s = new NdjsonSplitter();
  const line = JSON.stringify({ type: "render", markup: "x".repeat(120_000) });
  let emitted: ReturnType<NdjsonSplitter["push"]> = [];
  for (const char of line) emitted = emitted.concat(s.push(char));
  expect(emitted).toEqual([]);
  expect(s.push("\n")).toEqual([{ ok: true, line }]);
  expect(decodeCommand(line).ok).toBe(true);
});

test("NdjsonSplitter keeps multi-chunk lines independent of the byte cap accounting", () => {
  const s = new NdjsonSplitter();
  // An oversized line is discarded, then the next line must reassemble cleanly
  // even though it also arrives in several chunks.
  expect(s.push("x".repeat(MAX_NDJSON_LINE_BYTES + 1))).toEqual([
    { ok: false, error: expect.stringContaining("exceeds") },
  ]);
  expect(s.push("junk\n")).toEqual([]);
  expect(s.push('{"type":')).toEqual([]);
  expect(s.push('"exit"}\n')).toEqual([{ ok: true, line: '{"type":"exit"}' }]);
});

test("decodeCommand handles every line NdjsonSplitter can produce end-to-end", () => {
  const s = new NdjsonSplitter();
  const inputs = s.push(
    ['{"type":"key","key":"enter"}', '{"type":"char","char":"x"}', '{"type":"exit"}'].join("\n") +
      "\n",
  );
  const lines = inputs.map((input) => {
    expect(input.ok).toBe(true);
    return (input as { ok: true; line: string }).line;
  });
  const decoded = lines.map(decodeCommand);
  expect(decoded.every((r) => r.ok)).toBe(true);
  const commands = decoded.map((r) => (r as { ok: true; command: Command }).command);
  expect(commands).toEqual([
    { type: "key", key: "enter" },
    { type: "char", char: "x" },
    { type: "exit" },
  ]);
});

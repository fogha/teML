import { test, expect } from "vitest";
import { Writable } from "node:stream";
import { Diagnostics } from "../../src/core/diagnostics.js";

test("Diagnostics accumulates warnings", () => {
  const d = new Diagnostics();
  d.warn("a", "first");
  d.warn("b", "second", 3);
  expect(d.count()).toBe(2);
  expect(d.all()).toEqual([
    { code: "a", message: "first" },
    { code: "b", message: "second", line: 3 },
  ]);
  expect(d.has("a")).toBe(true);
  expect(d.has("missing")).toBe(false);
  expect(d.hasWarnings()).toBe(true);
});

test("Diagnostics warnOnce deduplicates by code", () => {
  const d = new Diagnostics();
  d.warnOnce("unknown-role", "one");
  d.warnOnce("unknown-role", "two");
  expect(d.count()).toBe(1);
});

test("Diagnostics print writes to stderr stream only", () => {
  const d = new Diagnostics();
  d.warn("x", "hello", 9);
  let out = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  d.print(stream);
  expect(out).toBe("teml: warning: hello (line 9)\n");
});

test("Diagnostics clear resets state", () => {
  const d = new Diagnostics();
  d.warnOnce("x", "msg");
  d.clear();
  expect(d.count()).toBe(0);
  d.warnOnce("x", "msg");
  expect(d.count()).toBe(1);
});

// stderr is a display surface: a message carrying a newline or a control
// sequence could forge a second warning or drive the terminal (C01).
test("Diagnostics print flattens control bytes and newlines", () => {
  const d = new Diagnostics();
  d.warn("x", "forged\x1b[31m\nsecond line");
  let out = "";
  const stream = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  d.print(stream);
  expect(out).toBe("teml: warning: forged[31m second line\n");
  expect(out).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
});

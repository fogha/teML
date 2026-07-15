import { test, expect } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { InteractiveSession, type SessionOptions } from "../../src/interactive/session.js";
import type { SessionEvent } from "../../src/interactive/protocol.js";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 40,
  ambiguousWide: false,
  ...over,
});

function sessionOptions(over: Partial<SessionOptions> = {}): SessionOptions {
  return {
    diags: new Diagnostics(),
    layout: { width: 40, theme: loadTheme("dark"), caps: caps() },
    ...over,
  };
}

function formDoc(src?: string) {
  const source =
    src ??
    [
      '::input{id="name" label="Name" placeholder="your name"}',
      '::checkbox{id="agree" label="I agree"}',
      '::button{id="submit" label="Submit"}',
    ].join("\n");
  return normalize(parseTeml(source));
}

function frameOf(events: SessionEvent[]): Extract<SessionEvent, { type: "frame" }> {
  const frame = events.find((e) => e.type === "frame");
  if (!frame || frame.type !== "frame") throw new Error("expected a frame event");
  return frame;
}

test("session focuses the first widget and start() emits a seq=1 frame", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  expect(s.getFocusedId()).toBe("name");
  const events = s.start();
  expect(events).toHaveLength(1);
  const f = frameOf(events);
  expect(f.seq).toBe(1);
  expect(f.focusedId).toBe("name");
  expect(f.plain).toContain("your name");
});

test("tab and shiftTab cycle focus with wraparound", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  expect(s.getFocusedId()).toBe("name");
  s.handle({ type: "key", key: "tab" });
  expect(s.getFocusedId()).toBe("agree");
  s.handle({ type: "key", key: "tab" });
  expect(s.getFocusedId()).toBe("submit");
  s.handle({ type: "key", key: "tab" });
  expect(s.getFocusedId()).toBe("name");
  s.handle({ type: "key", key: "shiftTab" });
  expect(s.getFocusedId()).toBe("submit");
});

test("escape clears focus", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const events = s.handle({ type: "key", key: "escape" });
  expect(s.getFocusedId()).toBeNull();
  expect(frameOf(events).focusedId).toBeNull();
});

test("typing into a focused input appends sanitized characters and emits change", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  let events = s.handle({ type: "char", char: "A" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "A" });
  events = s.handle({ type: "char", char: "da" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "Ada" });
  expect(s.values().name).toBe("Ada");
});

test("typed control characters and newlines are stripped before storage", () => {
  // sanitizeText strips the raw control byte itself (same rule as everywhere
  // else in the AST); it has no notion of "ANSI escape sequence" as a whole,
  // so literal bracket text that follows an ESC byte is untouched.
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "a\x1b[31mb\nc" });
  expect(s.values().name).toBe("a[31mbc");
  expect(s.values().name).not.toContain("\x1b");
  expect(s.values().name).not.toContain("\n");
});

test("backspace removes the last grapheme, and is a no-op on an empty value", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Hi" });
  let events = s.handle({ type: "key", key: "backspace" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "H" });
  s.handle({ type: "key", key: "backspace" });
  events = s.handle({ type: "key", key: "backspace" });
  expect(events.every((e) => e.type !== "change")).toBe(true);
  expect(s.values().name).toBe("");
});

test("backspace pops one grapheme, not one UTF-16 code unit (emoji-safe)", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "hi👍" });
  const events = s.handle({ type: "key", key: "backspace" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "hi" });
});

test("enter on an input commits and moves focus onward without a change event", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Ada" });
  const events = s.handle({ type: "key", key: "enter" });
  expect(s.getFocusedId()).toBe("agree");
  expect(events.every((e) => e.type !== "change")).toBe(true);
});

test("enter on a checkbox toggles it and emits toggle", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // -> agree
  let events = s.handle({ type: "key", key: "enter" });
  expect(events[0]).toEqual({ type: "toggle", id: "agree", checked: true });
  events = s.handle({ type: "key", key: "enter" });
  expect(events[0]).toEqual({ type: "toggle", id: "agree", checked: false });
});

test("space toggles a focused checkbox via a char event", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // -> agree
  const events = s.handle({ type: "char", char: " " });
  expect(events[0]).toEqual({ type: "toggle", id: "agree", checked: true });
});

test("non-space characters on a checkbox/button are ignored", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // -> agree
  const events = s.handle({ type: "char", char: "x" });
  expect(events.every((e) => e.type !== "toggle")).toBe(true);
});

test("enter on a button emits click with a full values snapshot", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Ada" });
  s.handle({ type: "key", key: "tab" }); // -> agree
  s.handle({ type: "key", key: "enter" }); // check it
  s.handle({ type: "key", key: "tab" }); // -> submit
  const events = s.handle({ type: "key", key: "enter" });
  expect(events[0]).toEqual({
    type: "click",
    id: "submit",
    values: { name: "Ada", agree: "true", submit: "" },
  });
});

test("char events with nothing focused are a harmless no-op", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "escape" });
  const events = s.handle({ type: "char", char: "x" });
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("frame");
});

test("exit sets isDone and further commands are ignored", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const events = s.handle({ type: "exit" });
  expect(events).toEqual([{ type: "exit" }]);
  expect(s.isDone()).toBe(true);
  expect(s.handle({ type: "key", key: "tab" })).toEqual([]);
});

test("render preserves matching values/checked by id and re-renders", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Ada" });
  s.handle({ type: "key", key: "tab" });
  s.handle({ type: "key", key: "enter" }); // check "agree"

  const events = s.handle({
    type: "render",
    markup: [
      '::input{id="name" label="Full name"}',
      '::checkbox{id="agree" label="I agree"}',
      '::button{id="submit" label="Send"}',
    ].join("\n"),
  });
  expect(s.values()).toEqual({ name: "Ada", agree: "true", submit: "" });
  const f = frameOf(events);
  expect(f.plain).toContain("Ada");
  expect(f.plain).toContain("Send");
});

test("render falls back to the first focusable when the old focus target disappears", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // -> agree
  s.handle({
    type: "render",
    markup: ['::input{id="email" label="Email"}', '::button{id="ok" label="OK"}'].join("\n"),
  });
  expect(s.getFocusedId()).toBe("email");
});

test("render keeps focus on the same id when it still exists in the new document", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // -> agree
  s.handle({
    type: "render",
    markup: [
      '::input{id="name" label="Name"}',
      '::checkbox{id="agree" label="Agree?"}',
      '::button{id="submit" label="Go"}',
    ].join("\n"),
  });
  expect(s.getFocusedId()).toBe("agree");
});

test("a document with no focusable widgets stays unfocused and tab is a no-op", () => {
  const s = new InteractiveSession(normalize(parseTeml("Just some text.\n")), sessionOptions());
  expect(s.getFocusedId()).toBeNull();
  const events = s.handle({ type: "key", key: "tab" });
  expect(s.getFocusedId()).toBeNull();
  expect(frameOf(events).focusedId).toBeNull();
});

test("left/right move the text cursor within the focused input, rendered as a caret", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Ada" }); // cursor at end: "Ada▏"
  let f = frameOf(s.handle({ type: "key", key: "left" }));
  expect(f.plain).toContain("[Ad▏a]");
  f = frameOf(s.handle({ type: "key", key: "left" }));
  expect(f.plain).toContain("[A▏da]");
  f = frameOf(s.handle({ type: "key", key: "right" }));
  expect(f.plain).toContain("[Ad▏a]");
});

test("left is clamped at position 0, right is clamped at the end", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Hi" });
  s.handle({ type: "key", key: "left" });
  s.handle({ type: "key", key: "left" });
  let f = frameOf(s.handle({ type: "key", key: "left" })); // already at 0
  expect(f.plain).toContain("[▏Hi]");
  s.handle({ type: "key", key: "right" });
  s.handle({ type: "key", key: "right" });
  f = frameOf(s.handle({ type: "key", key: "right" })); // already at the end
  expect(f.plain).toContain("[Hi▏]");
});

test("typing inserts at the cursor position, not always at the end", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Hi" });
  s.handle({ type: "key", key: "left" }); // cursor between H and i
  const events = s.handle({ type: "char", char: "e" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "Hei" });
  expect(s.values().name).toBe("Hei");
});

test("backspace removes the grapheme before the cursor, not always the last one", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Hello" });
  s.handle({ type: "key", key: "left" });
  s.handle({ type: "key", key: "left" }); // cursor between "Hel" and "lo"
  const events = s.handle({ type: "key", key: "backspace" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "Helo" });
});

test("left/right on a non-input widget is a harmless no-op", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // -> agree (checkbox)
  const events = s.handle({ type: "key", key: "left" });
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("frame");
});

test("cursor position persists when focus moves away and back to the same input", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Ada" });
  s.handle({ type: "key", key: "left" }); // cursor at 2, between "Ad" and "a"
  s.handle({ type: "key", key: "tab" }); // -> agree
  const f = frameOf(s.handle({ type: "key", key: "shiftTab" })); // back -> name
  expect(f.plain).toContain("[Ad▏a]");
});

test("an untouched default value renders as selected: no caret, whole value highlighted", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada Lovelace"}')),
    sessionOptions(),
  );
  const f = frameOf(s.start());
  expect(f.plain).toContain("[Ada Lovelace]");
  expect(f.plain).not.toContain("▏");
});

test("typing over an untouched default value replaces it outright, not inserts", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada Lovelace"}')),
    sessionOptions(),
  );
  const events = s.handle({ type: "char", char: "X" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "X" });
  expect(s.values().name).toBe("X");
  // and it's no longer "selected" — a second character now inserts normally
  const events2 = s.handle({ type: "char", char: "Y" });
  expect(events2[0]).toEqual({ type: "change", id: "name", value: "XY" });
});

test("backspace on an untouched default value clears it entirely in one press", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada Lovelace"}')),
    sessionOptions(),
  );
  const events = s.handle({ type: "key", key: "backspace" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "" });
  expect(s.values().name).toBe("");
});

test("left/right on an untouched default collapses selection to that edge without changing the value", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada"}')),
    sessionOptions(),
  );
  const f = frameOf(s.handle({ type: "key", key: "left" })); // collapse to start
  expect(s.values().name).toBe("Ada"); // unchanged
  expect(f.plain).toContain("[▏Ada]");
  // no longer selected: backspace now deletes only the char before the (start) cursor, i.e. nothing
  const events = s.handle({ type: "key", key: "backspace" });
  expect(events.every((e) => e.type !== "change")).toBe(true);
});

test("right on an untouched default collapses selection to the end", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada"}')),
    sessionOptions(),
  );
  const f = frameOf(s.handle({ type: "key", key: "right" }));
  expect(f.plain).toContain("[Ada▏]");
  const events = s.handle({ type: "key", key: "backspace" }); // now a normal single-char delete
  expect(events[0]).toEqual({ type: "change", id: "name", value: "Ad" });
});

test("once a default has been edited, subsequent edits are normal single-character operations", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada"}')),
    sessionOptions(),
  );
  s.handle({ type: "key", key: "backspace" }); // clears "Ada" -> "" (still touched from here on)
  s.handle({ type: "char", char: "Bo" });
  const events = s.handle({ type: "key", key: "backspace" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "B" });
});

test("a placeholder-only input (no default value) is never treated as selected", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" placeholder="your name"}')),
    sessionOptions(),
  );
  const events = s.handle({ type: "char", char: "A" });
  expect(events[0]).toEqual({ type: "change", id: "name", value: "A" });
  // second char inserts normally rather than "already touched, but check it wasn't overwrite-mode"
  const events2 = s.handle({ type: "char", char: "B" });
  expect(events2[0]).toEqual({ type: "change", id: "name", value: "AB" });
});

test("moving focus away and back preserves the selected state of an untouched default", () => {
  const s = new InteractiveSession(
    normalize(
      parseTeml(
        ['::input{id="name" label="Name" value="Ada"}', '::button{id="go" label="Go"}'].join("\n"),
      ),
    ),
    sessionOptions(),
  );
  s.handle({ type: "key", key: "tab" }); // -> go
  const f = frameOf(s.handle({ type: "key", key: "shiftTab" })); // back -> name, still untouched
  expect(f.plain).toContain("[Ada]");
  expect(f.plain).not.toContain("▏");
});

test("render re-marks whatever value survives (restored or fresh) as untouched/selected again", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" label="Name" value="Ada"}')),
    sessionOptions(),
  );
  s.handle({ type: "char", char: "X" }); // touches/overwrites "Ada" -> "X"
  // "name" still exists in the new markup, so its restored value ("X") wins over the new markup's default —
  // but as a *fresh* document, that restored value counts as untouched/selected again.
  const events = s.handle({
    type: "render",
    markup: '::input{id="name" label="Name" value="Grace"}',
  });
  const f = frameOf(events);
  expect(f.plain).toContain("[X]");
  expect(f.plain).not.toContain("▏");
  const overwrite = s.handle({ type: "char", char: "Y" });
  expect(overwrite[0]).toEqual({ type: "change", id: "name", value: "Y" });
});

test("pointer command focuses and activates a button, matching Enter", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const f0 = frameOf(s.start());
  const submitRow = f0.plain.split("\n").findIndex((l) => l.includes("Submit"));
  expect(submitRow).toBeGreaterThanOrEqual(0);
  s.handle({ type: "char", char: "Ada" });
  const events = s.handle({ type: "pointer", row: submitRow, col: 0 });
  expect(s.getFocusedId()).toBe("submit");
  expect(events[0]).toEqual({
    type: "click",
    id: "submit",
    values: { name: "Ada", agree: "false", submit: "" },
  });
});

test("pointer command on a checkbox row focuses and toggles it, matching Enter", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const f0 = frameOf(s.start());
  const agreeRow = f0.plain.split("\n").findIndex((l) => l.includes("I agree"));
  const events = s.handle({ type: "pointer", row: agreeRow, col: 0 });
  expect(s.getFocusedId()).toBe("agree");
  expect(events[0]).toEqual({ type: "toggle", id: "agree", checked: true });
});

test("pointer command on an input row focuses it without activating", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" }); // move focus off "name" first
  const events = s.handle({ type: "pointer", row: 0, col: 0 });
  expect(s.getFocusedId()).toBe("name");
  expect(events.every((e) => e.type !== "click" && e.type !== "toggle")).toBe(true);
});

test("pointer command on a row with no widget (e.g. the blank separator) is a harmless no-op", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const before = s.getFocusedId();
  const events = s.handle({ type: "pointer", row: 1, col: 0 });
  expect(s.getFocusedId()).toBe(before);
  expect(events).toHaveLength(1);
  expect(events[0]?.type).toBe("frame");
});

test("frame seq increments monotonically across commands", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const f1 = frameOf(s.start());
  const f2 = frameOf(s.handle({ type: "key", key: "tab" }));
  const f3 = frameOf(s.handle({ type: "key", key: "tab" }));
  expect([f1.seq, f2.seq, f3.seq]).toEqual([1, 2, 3]);
});

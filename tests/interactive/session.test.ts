import { test, expect } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { InteractiveSession, type SessionOptions } from "../../src/interactive/session.js";
import type {
  Command,
  FullFrame,
  PatchFrame,
  SessionEvent,
} from "../../src/interactive/protocol.js";
import {
  applyFrame as applyHostFrame,
  createFrameState,
  frameText,
} from "../../examples/interactive-frame.mjs";

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

function frameOf(events: SessionEvent[]): FullFrame {
  const frame = events.find((e) => e.type === "frame");
  if (!frame || frame.type !== "frame" || "patches" in frame) {
    throw new Error("expected a full frame event");
  }
  return frame;
}

function patchFrameOf(events: SessionEvent[]): PatchFrame {
  const frame = events.find((e) => e.type === "frame");
  if (!frame || frame.type !== "frame" || !("patches" in frame)) {
    throw new Error("expected a patch frame event");
  }
  return frame;
}

function splitRows(rendered: string): string[] {
  return rendered.endsWith("\n") ? rendered.slice(0, -1).split("\n") : rendered.split("\n");
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

test("up and down are first-class previous/next focus commands", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "down" });
  expect(s.getFocusedId()).toBe("agree");
  s.handle({ type: "key", key: "down" });
  expect(s.getFocusedId()).toBe("submit");
  s.handle({ type: "key", key: "up" });
  expect(s.getFocusedId()).toBe("agree");
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

test("home, end, and delete edit the focused input by grapheme", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "A🙂B" });
  let frame = frameOf(s.handle({ type: "key", key: "home" }));
  expect(frame.plain).toContain("[▏A🙂B]");
  s.handle({ type: "key", key: "right" });
  const deleted = s.handle({ type: "key", key: "delete" });
  expect(deleted[0]).toEqual({ type: "change", id: "name", value: "AB" });
  frame = frameOf(s.handle({ type: "key", key: "end" }));
  expect(frame.plain).toContain("[AB▏]");
});

test("Alt+Left/Right preserve the existing cursor movement behavior", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "char", char: "Ada" });
  let frame = frameOf(s.handle({ type: "key", key: "left", modifiers: { alt: true } }));
  expect(frame.plain).toContain("[Ad▏a]");
  frame = frameOf(s.handle({ type: "key", key: "right", modifiers: { alt: true } }));
  expect(frame.plain).toContain("[Ada▏]");
});

test("delete clears an untouched default and richer no-op keys still emit frames", () => {
  const s = new InteractiveSession(
    normalize(parseTeml('::input{id="name" value="Ada"}')),
    sessionOptions(),
  );
  const deleted = s.handle({ type: "key", key: "delete" });
  expect(deleted[0]).toEqual({ type: "change", id: "name", value: "" });
  for (const key of ["f1", "f6", "f12"] as const) {
    const events = s.handle({ type: "key", key });
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("frame");
  }
});

test("unsupported modified keys are no-ops while shift+tab aliases shiftTab", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const modified = s.handle({ type: "key", key: "enter", modifiers: { ctrl: true } });
  expect(modified).toHaveLength(1);
  expect(modified[0]?.type).toBe("frame");
  expect(s.getFocusedId()).toBe("name");

  s.handle({ type: "key", key: "tab", modifiers: { shift: true } });
  expect(s.getFocusedId()).toBe("submit");
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

test("pointer columns disambiguate side-by-side grid buttons and ignore the gutter", () => {
  const s = new InteractiveSession(
    formDoc(
      [
        ':::grid{columns="2" gap="2"}',
        '::button{id="left" label="Left"}',
        '::button{id="right" label="Right"}',
        ":::",
      ].join("\n"),
    ),
    sessionOptions(),
  );
  const initial = frameOf(s.start());
  const row = initial.plain!.split("\n").findIndex((line) => line.includes("[ Left ]"));
  const line = initial.plain!.split("\n")[row]!;
  const leftCol = line.indexOf("[ Left ]");
  const rightCol = line.indexOf("[ Right ]");
  expect(rightCol).toBeGreaterThan(leftCol);

  const right = s.handle({ type: "pointer", row, col: rightCol });
  expect(right[0]).toMatchObject({ type: "click", id: "right" });
  expect(s.getFocusedId()).toBe("right");

  const gutterCol = Math.floor((leftCol + "[ Left ]".length + rightCol) / 2);
  const gap = s.handle({ type: "pointer", row, col: gutterCol });
  expect(gap).toHaveLength(1);
  expect(gap[0]?.type).toBe("frame");
  expect(s.getFocusedId()).toBe("right");

  const left = s.handle({ type: "pointer", row, col: leftCol });
  expect(left[0]).toMatchObject({ type: "click", id: "left" });
  expect(s.getFocusedId()).toBe("left");
});

test("later duplicate widget ids render inert instead of targeting the first widget", () => {
  const s = new InteractiveSession(
    formDoc(
      [
        '::input{id="duplicate" label="First" value="one"}',
        '::input{id="duplicate" label="Second" value="two"}',
      ].join("\n"),
    ),
    sessionOptions(),
  );
  const initial = frameOf(s.start());
  const secondRow = initial.plain!.split("\n").findIndex((line) => line.includes("Second"));
  const pointer = s.handle({ type: "pointer", row: secondRow, col: 0 });
  expect(pointer).toHaveLength(1);
  expect(s.getFocusedId()).toBe("duplicate");

  s.handle({ type: "char", char: "X" });
  expect(s.values()).toEqual({ duplicate: "X" });
  expect(frameOf(s.handle({ type: "key", key: "end" })).plain).toContain("Second: [two]");
});

test("frame seq increments monotonically across commands", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const f1 = frameOf(s.start());
  const f2 = frameOf(s.handle({ type: "key", key: "tab" }));
  const f3 = frameOf(s.handle({ type: "key", key: "tab" }));
  expect([f1.seq, f2.seq, f3.seq]).toEqual([1, 2, 3]);
});

test("configure as the first command negotiates a single frame format", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const events = s.handle({ type: "configure", frames: "ansi" });
  const f = frameOf(events);
  expect(f.ansi).toContain("Submit");
  expect(f.plain).toBeNull();
  expect(f.protocol).toEqual({ major: 1, minor: 3 });
  expect(f.capabilities).toContain("scroll");
  expect(f.capabilities).toContain("update");
  expect(f.capabilities).toContain("documentMutations");

  const next = frameOf(s.handle({ type: "key", key: "tab" }));
  expect(next.plain).toBeNull();
  expect(next.ansi).toContain("agree");
});

test("a successful configure locks out a second negotiation command", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "configure", frames: "plain", mode: "patches" });

  const events = s.handle({ type: "configure", frames: "ansi", mode: "full" });
  expect(events.some((event) => event.type === "error")).toBe(true);
  const frame = frameOf(events);
  expect(frame.plain).toContain("Submit");
  expect(frame.ansi).toBeNull();

  // The rejected command also forces a clean base without changing patches mode.
  expect(patchFrameOf(s.handle({ type: "char", char: "A" })).patches.length).toBeGreaterThan(0);
});

test("configure with plain drops the ansi field instead", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  const f = frameOf(s.handle({ type: "configure", frames: "plain" }));
  expect(f.plain).toContain("Submit");
  expect(f.ansi).toBeNull();
});

test("configure after any other command is an error plus a frame, and the session continues unchanged", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "key", key: "tab" });
  const events = s.handle({ type: "configure", frames: "ansi" });
  const err = events.find((e) => e.type === "error");
  expect(err?.type).toBe("error");
  const f = frameOf(events);
  expect(f.plain).not.toBeNull(); // format unchanged — still the default both

  const after = s.handle({ type: "key", key: "tab" });
  expect(frameOf(after).focusedId).toBe("submit");
  expect(frameOf(after).plain).not.toBeNull();
});

test("single-format negotiation reduces wire size; plain saves at least 40%", () => {
  const both = new InteractiveSession(formDoc(), sessionOptions());
  const bothFrame = frameOf(both.handle({ type: "key", key: "tab" }));

  const ansi = new InteractiveSession(formDoc(), sessionOptions());
  ansi.handle({ type: "configure", frames: "ansi" });
  const ansiFrame = frameOf(ansi.handle({ type: "key", key: "tab" }));

  const plain = new InteractiveSession(formDoc(), sessionOptions());
  plain.handle({ type: "configure", frames: "plain" });
  const plainFrame = frameOf(plain.handle({ type: "key", key: "tab" }));

  // Both choices remove the unconsumed payload. Exact savings depend on how
  // heavily styled the document is: ANSI is larger than plain for this form.
  expect(ansiFrame.plain).toBeNull();
  const payloadOnly = (frame: FullFrame) => {
    const { protocol: _protocol, capabilities: _capabilities, ...payload } = frame;
    return JSON.stringify(payload).length;
  };
  expect(payloadOnly(ansiFrame)).toBeLessThan(payloadOnly(bothFrame));

  // Dropping the escape-laden ansi payload is the big win; how much ansi
  // mode saves depends on how styled the document is.
  expect(plainFrame.ansi).toBeNull();
  expect(payloadOnly(plainFrame)).toBeLessThan(payloadOnly(bothFrame) * 0.6);
});

test("SessionOptions.frames pre-negotiates the format and locks configure", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions({ frames: "plain" }));
  const first = frameOf(s.start());
  expect(first.plain).toContain("Submit");
  expect(first.ansi).toBeNull();

  // Negotiation already happened (via the --frames flag), so a configure
  // command is rejected like any late configure; the format stays "plain".
  const events = s.handle({ type: "configure", frames: "ansi", mode: "full" });
  expect(events.some((e) => e.type === "error")).toBe(true);
  const after = frameOf(s.handle({ type: "key", key: "tab" }));
  expect(after.ansi).toBeNull();
  expect(after.plain).toContain("agree");
});

test("SessionOptions.mode pre-negotiates patches while height alone leaves configure open", () => {
  const mode = new InteractiveSession(formDoc(), sessionOptions({ mode: "patches" }));
  frameOf(mode.start());
  const rejected = mode.handle({ type: "configure", frames: "plain", mode: "full" });
  expect(rejected.some((event) => event.type === "error")).toBe(true);
  expect(patchFrameOf(mode.handle({ type: "key", key: "tab" })).patches).toBeDefined();

  const heightOnly = new InteractiveSession(
    formDoc(),
    sessionOptions({
      layout: { width: 40, height: 2, theme: loadTheme("dark"), caps: caps() },
    }),
  );
  heightOnly.start();
  const accepted = heightOnly.handle({ type: "configure", frames: "plain", mode: "patches" });
  expect(accepted.some((event) => event.type === "error")).toBe(false);
  expect(frameOf(accepted).ansi).toBeNull();
});

test("a rejected configure names the cause and every setting it did not apply", () => {
  const errorOf = (events: ReturnType<InteractiveSession["handle"]>): string => {
    const error = events.find((event) => event.type === "error");
    if (error?.type !== "error") throw new Error("expected an error event");
    return error.message;
  };

  // Locked by a startup flag: the host's configure *was* its first command, so
  // naming ordering as the cause would send it looking in the wrong place.
  const flagged = new InteractiveSession(formDoc(), sessionOptions({ frames: "plain" }));
  flagged.start();
  const byFlag = errorOf(flagged.handle({ type: "configure", frames: "plain", mode: "patches" }));
  expect(byFlag).toContain("--frames/--mode startup flags");
  // The dropped mode is the whole reason the host's frames keep arriving full.
  expect(byFlag).toContain("ignored mode=patches (still full)");
  expect(byFlag).not.toContain("frames=");

  const negotiated = new InteractiveSession(formDoc(), sessionOptions());
  negotiated.handle({ type: "configure", frames: "plain", mode: "patches" });
  const twice = errorOf(negotiated.handle({ type: "configure", frames: "ansi", mode: "full" }));
  expect(twice).toContain("an earlier configure already negotiated");
  expect(twice).toContain("ignored frames=ansi (still plain), mode=full (still patches)");

  const late = new InteractiveSession(formDoc(), sessionOptions());
  late.handle({ type: "key", key: "tab" });
  expect(errorOf(late.handle({ type: "configure", frames: "ansi" }))).toBe(
    "configure rejected: another command already started the session; ignored frames=ansi (still both)",
  );

  // An omitted optional `mode` was never requested, so it cannot be "ignored".
  const noMode = new InteractiveSession(formDoc(), sessionOptions({ mode: "patches" }));
  noMode.start();
  expect(errorOf(noMode.handle({ type: "configure", frames: "both" }))).not.toContain("mode=");
});

test("default full-mode frames carry no patches/rows keys (v1 wire shape)", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  for (const events of [s.start(), s.handle({ type: "key", key: "tab" })]) {
    const f = frameOf(events);
    expect("patches" in f).toBe(false);
    expect("rows" in f).toBe(false);
  }
});

test("patches mode: the configure ack is a full frame, then commands emit row patches", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.start();
  // Negotiation just changed the host's base, so the ack re-syncs with a
  // full frame in the negotiated format even though patches mode is on.
  const ack = frameOf(s.handle({ type: "configure", frames: "both", mode: "patches" }));
  expect(ack.plain).toContain("Submit");
  expect(ack.ansi).toContain("\x1b[");

  const pf = patchFrameOf(s.handle({ type: "char", char: "A" }));
  expect(pf.rows).toBe(splitRows(ack.plain!).length);
  expect(pf.patches.length).toBeGreaterThan(0);
  for (const p of pf.patches) {
    expect(p.plain).not.toBeNull();
    expect(p.ansi).toContain("\x1b[");
  }
  // Patch frames omit the full-frame payload keys entirely.
  expect("plain" in pf).toBe(false);
  expect("ansi" in pf).toBe(false);
});

test("patches mode: patches carry only the negotiated format", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.start();
  s.handle({ type: "configure", frames: "ansi", mode: "patches" });
  const pf = patchFrameOf(s.handle({ type: "char", char: "A" }));
  for (const p of pf.patches) {
    expect(p.ansi).toContain("\x1b[");
    expect(p.plain).toBeNull();
  }
});

test("a no-op command emits an empty patch list", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.start();
  s.handle({ type: "configure", frames: "both", mode: "patches" });
  // Row 1 is the blank separator — clicking it changes nothing on screen.
  const pf = patchFrameOf(s.handle({ type: "pointer", row: 1, col: 0 }));
  expect(pf.patches).toEqual([]);
});

test("patches reconstruct the exact full-mode screen across a scripted session", () => {
  const script: Command[] = [
    { type: "char", char: "Ada" },
    { type: "key", key: "tab" },
    { type: "key", key: "enter" }, // toggle the checkbox
    { type: "key", key: "tab" }, // focus the button
    { type: "key", key: "shiftTab" },
    { type: "key", key: "left" },
    { type: "key", key: "right" },
    { type: "char", char: "x".repeat(80) }, // wraps the row — the frame grows
    { type: "key", key: "backspace" },
    { type: "key", key: "backspace" },
    { type: "key", key: "escape" },
    { type: "pointer", row: 0, col: 0 },
    { type: "key", key: "backspace" }, // shrink back down
  ];

  const full = new InteractiveSession(formDoc(), sessionOptions());
  const plainScreen = createFrameState("plain");
  const ansiScreen = createFrameState("ansi");
  const patched = new InteractiveSession(formDoc(), sessionOptions());
  const apply = (frame: FullFrame | PatchFrame): void => {
    applyHostFrame(plainScreen, frame);
    applyHostFrame(ansiScreen, frame);
  };
  apply(frameOf(patched.start())); // initial frame (v1 both shape)
  apply(frameOf(patched.handle({ type: "configure", frames: "both", mode: "patches" })));

  let sawPatch = false;
  for (const command of script) {
    const f = frameOf(full.handle(command));
    const events = patched.handle(command);
    const frame = events.find((e) => e.type === "frame");
    expect(frame).toBeDefined();
    if (frame && "patches" in frame) sawPatch = true;
    apply(frame as FullFrame | PatchFrame);
    expect(frame!.focusedId).toBe(f.focusedId);
    expect(frameText(plainScreen) + "\n").toBe(f.plain);
    expect(frameText(ansiScreen) + "\n").toBe(f.ansi);
  }
  expect(sawPatch).toBe(true);
});

test("render and late configure force full frames in patches mode", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.start();
  s.handle({ type: "configure", frames: "both", mode: "patches" });
  patchFrameOf(s.handle({ type: "char", char: "A" })); // confirm patches are live

  // A render swaps the document — the host's row state is meaningless.
  const rendered = frameOf(s.handle({ type: "render", markup: '::button{id="b" label="Hi"}' }));
  expect(rendered.plain).toContain("Hi");

  // Patches resume afterwards, diffed against the fallback full frame.
  patchFrameOf(s.handle({ type: "key", key: "tab" }));

  // A late configure is an error; its accompanying frame is full too.
  frameOf(s.handle({ type: "configure", frames: "ansi", mode: "patches" }));
});

test("a keystroke's patch frame is at least 80% smaller than the full frame", () => {
  // A realistically-sized 3-widget form: with prose around the widgets the
  // full frame is ~1 KB, while a keystroke touches a single row.
  const doc = formDoc(
    [
      "# Account settings",
      "",
      "Choose a display name and confirm the terms. Your name appears on the",
      "public leaderboard exactly as you type it here, so pick something you",
      "will recognize later. Display names are unique, lowercase, and can be",
      "changed once every thirty days from this screen. If the name you want",
      "is taken, we suggest a few close variants that are still available.",
      "Changes take effect immediately everywhere your account is shown.",
      "",
      '::input{id="name" label="Name" placeholder="your name"}',
      '::checkbox{id="agree" label="I agree to the terms"}',
      '::button{id="submit" label="Submit"}',
    ].join("\n"),
  );

  const full = new InteractiveSession(doc, sessionOptions());
  full.start();
  const fullFrame = frameOf(full.handle({ type: "char", char: "A" }));

  const patched = new InteractiveSession(doc, sessionOptions());
  patched.start();
  patched.handle({ type: "configure", frames: "both", mode: "patches" });
  const pf = patchFrameOf(patched.handle({ type: "char", char: "A" }));

  expect(JSON.stringify(pf).length).toBeLessThan(JSON.stringify(fullFrame).length * 0.2);
});

test("resize reflows while preserving values, focus, cursor, checkbox, and untouched defaults", () => {
  const doc = formDoc(
    [
      "Complete this deliberately long account profile before continuing to the next step.",
      "",
      '::input{id="name" label="Display name" placeholder="your name"}',
      '::input{id="region" label="Deployment region" value="prod"}',
      '::checkbox{id="agree" label="I agree to the deployment policy"}',
      '::button{id="submit" label="Submit"}',
    ].join("\n"),
  );
  const s = new InteractiveSession(
    doc,
    sessionOptions({
      layout: { width: 60, height: 30, theme: loadTheme("dark"), caps: caps({ width: 60 }) },
    }),
  );

  s.handle({ type: "char", char: "Ada" });
  s.handle({ type: "key", key: "left" }); // name cursor between "Ad" and "a"
  s.handle({ type: "key", key: "tab" }); // untouched region default
  s.handle({ type: "key", key: "tab" }); // checkbox
  s.handle({ type: "key", key: "enter" }); // checked
  s.handle({ type: "key", key: "shiftTab" }); // region
  const wide = frameOf(s.handle({ type: "key", key: "shiftTab" })); // name
  expect(wide.plain).toContain("[Ad▏a]");

  const resized = frameOf(s.handle({ type: "resize", width: 24, height: 12 }));
  expect(s.getLayoutSize()).toEqual({ width: 24, height: 12 });
  expect(s.getFocusedId()).toBe("name");
  expect(s.values()).toMatchObject({
    name: "Ada",
    region: "prod",
    agree: "true",
  });
  expect(resized.plain).toContain("[Ad▏a]");
  expect(splitRows(resized.plain!).length).toBeGreaterThan(splitRows(wide.plain!).length);

  // Resize must not turn an untouched default into an ordinary caret value.
  const regionFocused = frameOf(s.handle({ type: "key", key: "tab" }));
  expect(regionFocused.plain).toContain("[prod]");
  expect(regionFocused.plain).not.toContain("▏");
  s.handle({ type: "char", char: "X" });
  expect(s.values().region).toBe("X");
});

test("resize clamps live terminal width to 20 and retains omitted height", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.handle({ type: "resize", width: 5, height: 18 });
  expect(s.getLayoutSize()).toEqual({ width: 20, height: 18 });

  const beforeHeightOnlyChange = frameOf(s.handle({ type: "resize", width: 30, height: 20 }));
  const afterHeightOnlyChange = frameOf(s.handle({ type: "resize", width: 30 }));
  expect(s.getLayoutSize()).toEqual({ width: 30, height: 20 });
  expect(afterHeightOnlyChange.plain).toBe(beforeHeightOnlyChange.plain);

  s.handle({ type: "resize", width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER });
  expect(s.getLayoutSize()).toEqual({ width: 10_000, height: 10_000 });
});

test("resize is a full-frame resync point in patches mode", () => {
  const s = new InteractiveSession(formDoc(), sessionOptions());
  s.start();
  s.handle({ type: "configure", frames: "plain", mode: "patches" });
  patchFrameOf(s.handle({ type: "char", char: "A" }));

  const resized = frameOf(s.handle({ type: "resize", width: 24, height: 12 }));
  expect(resized.plain).toContain("A");
  expect("patches" in resized).toBe(false);
  expect("rows" in resized).toBe(false);

  const next = patchFrameOf(s.handle({ type: "char", char: "d" }));
  expect(next.seq).toBe(resized.seq + 1);
  expect(next.patches.length).toBeGreaterThan(0);
});

test("sub-viewport documents retain the exact v1 frame shape and bytes", () => {
  const baseline = new InteractiveSession(formDoc(), sessionOptions());
  const bounded = new InteractiveSession(
    formDoc(),
    sessionOptions({
      layout: { width: 40, height: 100, theme: loadTheme("dark"), caps: caps() },
    }),
  );

  expect(frameOf(bounded.start())).toEqual(frameOf(baseline.start()));
  expect(frameOf(bounded.handle({ type: "key", key: "tab" }))).toEqual(
    frameOf(baseline.handle({ type: "key", key: "tab" })),
  );
});

test("large documents emit viewport-bounded frames and tab keeps focus visible", () => {
  const source = [
    '::button{id="top" label="Top"}',
    ...Array.from({ length: 40 }, (_, index) => `Static row ${index}`),
    '::button{id="bottom" label="Bottom"}',
  ].join("\n");
  const s = new InteractiveSession(
    formDoc(source),
    sessionOptions({
      layout: { width: 40, height: 6, theme: loadTheme("dark"), caps: caps() },
    }),
  );

  const first = frameOf(s.start());
  expect(first.viewport).toEqual({ offset: 0, height: 6, total: expect.any(Number) });
  expect(first.viewport!.total).toBeGreaterThan(6);
  expect(splitRows(first.plain!)).toHaveLength(6);
  expect(first.plain).toContain("[ Top ]");

  const bottom = frameOf(s.handle({ type: "key", key: "tab" }));
  expect(bottom.focusedId).toBe("bottom");
  expect(bottom.viewport!.offset).toBeGreaterThan(0);
  expect(bottom.viewport!.offset + bottom.viewport!.height).toBeLessThanOrEqual(
    bottom.viewport!.total,
  );
  expect(bottom.plain).toContain("[ Bottom ]");

  const row = splitRows(bottom.plain!).findIndex((line) => line.includes("[ Bottom ]"));
  const col = splitRows(bottom.plain!)[row]!.indexOf("[ Bottom ]");
  const clicked = s.handle({ type: "pointer", row, col });
  expect(clicked[0]).toMatchObject({ type: "click", id: "bottom" });
});

test("viewport patch rows are screen-local and never exceed terminal height", () => {
  const source = [
    '::input{id="name" label="Name" value="Ada"}',
    ...Array.from({ length: 200 }, (_, index) => `Static row ${index}`),
    '::button{id="bottom" label="Bottom"}',
  ].join("\n");
  const s = new InteractiveSession(
    formDoc(source),
    sessionOptions({
      layout: { width: 40, height: 8, theme: loadTheme("dark"), caps: caps() },
    }),
  );
  const initial = frameOf(s.start());
  expect(initial.viewport?.height).toBe(8);
  const ack = frameOf(s.handle({ type: "configure", frames: "plain", mode: "patches" }));
  expect(ack.viewport).toEqual(initial.viewport);

  const edited = patchFrameOf(s.handle({ type: "key", key: "left" }));
  expect(edited.rows).toBe(8);
  expect(edited.viewport?.height).toBe(8);
  expect(edited.patches.length).toBeLessThanOrEqual(8);
  expect(edited.patches.every((patch) => patch.row >= 0 && patch.row < 8)).toBe(true);

  const scrolled = patchFrameOf(s.handle({ type: "key", key: "tab" }));
  expect(scrolled.focusedId).toBe("bottom");
  expect(scrolled.viewport!.offset).toBeGreaterThan(0);
  expect(scrolled.patches.length).toBeLessThanOrEqual(8);
});

test("pageUp and pageDown scroll an active viewport without changing focus", () => {
  const source = [
    '::button{id="top" label="Top"}',
    ...Array.from({ length: 50 }, (_, index) => `Static row ${index}`),
  ].join("\n");
  const s = new InteractiveSession(
    formDoc(source),
    sessionOptions({
      layout: { width: 40, height: 6, theme: loadTheme("dark"), caps: caps() },
    }),
  );
  const first = frameOf(s.start());
  expect(first.viewport?.offset).toBe(0);

  const down = frameOf(s.handle({ type: "key", key: "pageDown" }));
  expect(down.viewport!.offset).toBe(5);
  expect(down.focusedId).toBe("top");

  const up = frameOf(s.handle({ type: "key", key: "pageUp" }));
  expect(up.viewport!.offset).toBe(0);
  expect(up.focusedId).toBe("top");
});

test("resize activates and clamps a viewport as a full-frame resync", () => {
  const source = Array.from({ length: 30 }, (_, index) => `Static row ${index}`).join("\n");
  const s = new InteractiveSession(formDoc(source), sessionOptions());
  const initial = frameOf(s.start());
  expect(initial.viewport).toBeUndefined();
  expect(splitRows(initial.plain!).length).toBeGreaterThan(5);

  const resized = frameOf(s.handle({ type: "resize", width: 40, height: 5 }));
  expect(resized.viewport).toEqual({ offset: 0, height: 5, total: expect.any(Number) });
  expect(splitRows(resized.plain!)).toHaveLength(5);
});

test("negotiated sessions advertise finite protocol capabilities without changing default frames", () => {
  const legacy = new InteractiveSession(formDoc(), sessionOptions());
  const legacyFrame = frameOf(legacy.start());
  expect("protocol" in legacyFrame).toBe(false);
  expect("capabilities" in legacyFrame).toBe(false);

  const negotiated = new InteractiveSession(
    formDoc(),
    sessionOptions({ frames: "plain", mode: "patches" }),
  );
  const frame = frameOf(negotiated.start());
  expect(frame.protocol).toEqual({ major: 1, minor: 3 });
  expect(frame.capabilities).toContain("scroll");
  expect(frame.capabilities).toContain("scrollRegions");
  expect(frame.capabilities).toContain("update");
  expect(frame.capabilities).toContain("documentMutations");
});

test("radio keeps a pending marker until confirmation and pointer selects an option row", () => {
  const source = `:::radio{id="plan" value="free"}
::option{value="free" label="Free"}
::option{value="pro" label="Pro"}
:::

::button{id="submit" label="Submit"}
`;
  const session = new InteractiveSession(formDoc(source), sessionOptions());
  session.start();
  const moved = frameOf(session.handle({ type: "key", key: "down" }));
  expect(moved.focusedId).toBe("plan");
  expect(moved.plain).toContain("▸ ( ) Pro");
  expect(session.values().plan).toBe("free");

  const confirmed = session.handle({ type: "key", key: "enter" });
  expect(confirmed[0]).toEqual({ type: "change", id: "plan", value: "pro" });
  expect(session.values().plan).toBe("pro");

  const clicked = session.handle({ type: "pointer", row: 0, col: 4 });
  expect(clicked[0]).toEqual({ type: "change", id: "plan", value: "free" });
});

test("textarea preserves newlines, consumes vertical keys, and Ctrl+Enter advances focus", () => {
  const source = `::textarea{id="bio" rows=2}

::button{id="submit" label="Submit"}
`;
  const session = new InteractiveSession(formDoc(source), sessionOptions());
  session.start();
  const pasted = session.handle({ type: "char", char: "one\r\ntwo\nthree" });
  expect(pasted[0]).toEqual({
    type: "change",
    id: "bio",
    value: "one\ntwo\nthree",
  });
  expect(frameOf(pasted).plain?.split("\n").length).toBeLessThanOrEqual(6);

  session.handle({ type: "key", key: "up" });
  expect(session.getFocusedId()).toBe("bio");
  const newline = session.handle({ type: "key", key: "enter" });
  expect(newline[0]?.type).toBe("change");
  expect(session.values().bio).toContain("\n");

  session.handle({ type: "key", key: "enter", modifiers: { ctrl: true } });
  expect(session.getFocusedId()).toBe("submit");
});

test("textarea pointer coordinates ignore the painted caret cell", () => {
  const session = new InteractiveSession(
    formDoc(`::textarea{id="bio" value="abcdef" rows=1}`),
    sessionOptions({ layout: { width: 20, theme: loadTheme("dark"), caps: caps() } }),
  );
  session.start();
  const withCaret = frameOf(session.handle({ type: "key", key: "left" }));
  const row = splitRows(withCaret.plain!)[0]!;
  const dColumn = row.indexOf("d");
  expect(dColumn).toBeGreaterThan(0);

  session.handle({ type: "pointer", row: 0, col: dColumn });
  session.handle({ type: "char", char: "X" });
  expect(session.values().bio).toBe("abcXdef");
});

test("scroll commands update a focused region, emit bounded metadata, and bubble residual rows", () => {
  const logLines = Array.from({ length: 20 }, (_, index) => `log ${index + 1}`).join("\n\n");
  const tail = Array.from({ length: 12 }, (_, index) => `tail ${index + 1}`).join("\n\n");
  const source = `:::scroll{id="logs" rows=3}
${logLines}
:::

${tail}
`;
  const session = new InteractiveSession(
    formDoc(source),
    sessionOptions({
      mode: "patches",
      frames: "plain",
      layout: {
        width: 40,
        height: 6,
        theme: loadTheme("dark"),
        caps: caps(),
      },
    }),
  );
  const first = frameOf(session.start());
  expect(first.scrollRegions?.[0]).toMatchObject({
    id: "logs",
    offset: 0,
    height: 3,
  });

  const moved = patchFrameOf(session.handle({ type: "scroll", rows: 2 }));
  expect(moved.scrollRegions?.[0]?.offset).toBe(2);
  expect(moved.patches.length).toBeLessThanOrEqual(6);

  const bubbled = patchFrameOf(session.handle({ type: "scroll", rows: 10_000 }));
  expect(bubbled.viewport?.offset).toBeGreaterThan(0);
  const clamped = patchFrameOf(session.handle({ type: "scroll", rows: 10_000 }));
  expect(clamped.patches).toEqual([]);
});

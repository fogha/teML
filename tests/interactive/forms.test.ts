import { test, expect } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { InteractiveSession, type SessionOptions } from "../../src/interactive/session.js";
import type { Command, FullFrame, SessionEvent } from "../../src/interactive/protocol.js";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 60,
  ambiguousWide: false,
  ...over,
});

function sessionOptions(over: Partial<SessionOptions> = {}): SessionOptions {
  return {
    diags: new Diagnostics(),
    layout: { width: 60, theme: loadTheme("dark"), caps: caps() },
    ...over,
  };
}

function startSession(source: string, over: Partial<SessionOptions> = {}): InteractiveSession {
  return new InteractiveSession(normalize(parseTeml(source)), sessionOptions(over));
}

function frameOf(events: SessionEvent[]): FullFrame {
  const frame = events.find((event) => event.type === "frame");
  expect(frame).toBeDefined();
  return frame as FullFrame;
}

/** The last frame in a batch reflects the final state after every command. */
function lastFrameOf(events: SessionEvent[]): FullFrame {
  const frames = events.filter((event) => event.type === "frame") as FullFrame[];
  expect(frames.length).toBeGreaterThan(0);
  return frames[frames.length - 1]!;
}

/** Drive one command and return the events it produced. */
function send(session: InteractiveSession, ...commands: Command[]): SessionEvent[] {
  let events: SessionEvent[] = [];
  for (const command of commands) events = [...events, ...session.handle(command)];
  return events;
}

function type(session: InteractiveSession, text: string): SessionEvent[] {
  return send(session, ...[...text].map((char) => ({ type: "char", char }) as Command));
}

/** Tab from the first field to the form's submit button (owner -> tag -> accept). */
function focusSubmit(session: InteractiveSession): SessionEvent[] {
  return send(session, { type: "key", key: "tab" }, { type: "key", key: "tab" });
}

// ---- masking -------------------------------------------------------------

test("mask renders one bullet per grapheme and keeps the caret position", () => {
  const session = startSession('::input{id="pw" label="Password" value="hunter2" mask}');
  const frame = frameOf(session.start());
  expect(frame.plain).toContain("•••••••");
  expect(frame.plain).not.toContain("hunter2");

  // Focus, then move the caret left twice: the masked length must not change.
  const events = send(session, { type: "key", key: "left" }, { type: "key", key: "left" });
  const moved = frameOf(events);
  expect(moved.plain).not.toContain("hunter2");
  expect((moved.plain ?? "").match(/•/g)?.length).toBe(7);
});

test("mask falls back to ASCII asterisks without Unicode", () => {
  const session = startSession('::input{id="pw" label="Password" value="abcd" mask}', {
    layout: { width: 60, theme: loadTheme("dark"), caps: caps({ unicode: false }) },
  });
  const frame = frameOf(session.start());
  expect(frame.plain).toContain("****");
  expect(frame.plain).not.toContain("abcd");
});

test("a masked value never reaches a frame, in either format or in patches", () => {
  const secret = "s3cr3t-value";
  const session = startSession(`::input{id="pw" label="Password" value="${secret}" mask}`);

  const initial = frameOf(session.start());
  expect(initial.plain).not.toContain(secret);
  expect(initial.ansi ?? "").not.toContain(secret);

  const edited = type(session, "XY");
  const editedFrame = frameOf(edited);
  expect(editedFrame.plain).not.toContain(secret);
  expect(editedFrame.ansi ?? "").not.toContain(secret);

  // Patch frames carry only changed rows; the secret must not ride along.
  const patched = startSession(`::input{id="pw" label="Password" value="${secret}" mask}`);
  send(patched, { type: "configure", frames: "both", mode: "patches" });
  const patchEvents = type(patched, "Z");
  for (const event of patchEvents) {
    const rows = "patches" in event ? (event.patches ?? []) : [];
    for (const patch of rows) {
      expect(patch.plain ?? "").not.toContain(secret);
      expect(patch.ansi ?? "").not.toContain(secret);
    }
  }
});

test("masking is a display transform: the value still reaches the host snapshot", () => {
  const session = startSession('::input{id="pw" label="Password" value="abcd" mask}');
  session.start();
  expect(session.values()).toEqual({ pw: "abcd" });
});

// ---- validation ----------------------------------------------------------

const FORM = [
  '::::form{id="f" label="Deploy"}',
  '::input{id="owner" label="Owner" value="" required}',
  '::input{id="tag" label="Tag" value="release" pattern="[a-z]+"}',
  '::button{id="accept" label="Accept" submit="true"}',
  "::::",
].join("\n");

test("a failing field renders no error until a submit is attempted", () => {
  const session = startSession(FORM);
  const frame = frameOf(session.start());
  expect(frame.plain).not.toContain("required");
});

test("an invalid submit emits error with field ids and reveals the inline error", () => {
  const session = startSession(FORM);
  session.start();
  const events = [...focusSubmit(session), ...send(session, { type: "key", key: "enter" })];
  const error = events.find((event) => event.type === "error");
  expect(error).toBeDefined();
  expect((error as { message: string }).message).toContain("owner");
  // No submit event fires while the form is invalid.
  expect(events.some((event) => event.type === "submit")).toBe(false);

  const frame = lastFrameOf(events);
  expect(frame.plain).toContain("required");
});

test("editing a revealed field hides its error again", () => {
  const session = startSession(FORM);
  session.start();
  focusSubmit(session);
  const invalid = send(session, { type: "key", key: "enter" });
  expect(frameOf(invalid).plain).toContain("required");

  // Back to the owner field (accept -> tag -> owner) and make it valid.
  const typed = send(session, { type: "key", key: "shiftTab" }, { type: "key", key: "shiftTab" });
  const afterTyping = type(session, "Ada");
  expect(frameOf(typed).plain).toContain("required");
  expect(frameOf(afterTyping).plain).not.toContain("required");
});

test("a valid submit emits submit (not click) with the full value snapshot", () => {
  const session = startSession(FORM);
  session.start();
  type(session, "Ada");
  focusSubmit(session);
  const events = send(session, { type: "key", key: "enter" });
  const submit = events.find((event) => event.type === "submit");
  expect(submit).toBeDefined();
  const payload = submit as { form: string; values: Record<string, string> };
  expect(payload.form).toBe("f");
  // Same scope as click.values: every focusable widget.
  expect(Object.keys(payload.values).sort()).toEqual(["accept", "owner", "tag"]);
  expect(payload.values.owner).toBe("Ada");
  // One activation produces one event: no click alongside the submit.
  expect(events.some((event) => event.type === "click")).toBe(false);
});

test("a button without submit keeps emitting click", () => {
  const session = startSession(
    ['::input{id="name" label="Name"}', '::button{id="go" label="Go"}'].join("\n"),
  );
  session.start();
  const events = send(session, { type: "key", key: "tab" }, { type: "key", key: "enter" });
  expect(events.some((event) => event.type === "click")).toBe(true);
  expect(events.some((event) => event.type === "submit")).toBe(false);
});

test("submit naming a missing form is an error and leaves the session usable", () => {
  const session = startSession('::button{id="go" label="Go" submit="nope"}');
  session.start();
  const events = send(session, { type: "key", key: "enter" });
  const error = events.find((event) => event.type === "error");
  expect(error).toBeDefined();
  expect((error as { message: string }).message).toContain("nope");
  expect(session.isDone()).toBe(false);
});

test("a form-free document does no validation work and renders unchanged", () => {
  const session = startSession(
    ['::input{id="name" label="Name" required}', '::button{id="go" label="Go"}'].join("\n"),
  );
  const frame = frameOf(session.start());
  // `required` outside a form is inert: no grouping, no submit, no error row.
  expect(frame.plain).not.toContain("required");
  const events = send(session, { type: "key", key: "tab" }, { type: "key", key: "enter" });
  expect(events.some((event) => event.type === "click")).toBe(true);
});

test("revealed field ids are pruned when a render drops the field", () => {
  const session = startSession(FORM);
  session.start();
  focusSubmit(session);
  send(session, { type: "key", key: "enter" });
  // Swap in a form-free document: the stale reveal must not throw or leak.
  const rendered = send(session, {
    type: "render",
    markup: '::input{id="other" label="Other"}',
    format: "teml",
  });
  const frame = frameOf(rendered);
  expect(frame.plain).not.toContain("required");
});

// ---- form id namespace ---------------------------------------------------

/** Start a session with a shared Diagnostics so walk warnings are observable. */
function startTraced(source: string): { session: InteractiveSession; diags: Diagnostics } {
  const diags = new Diagnostics();
  const session = new InteractiveSession(normalize(parseTeml(source)), sessionOptions({ diags }));
  return { session, diags };
}

test("a field colliding with its form's id loses focusability with a diagnostic", () => {
  // The form registers 'deploy' first (pre-order), so the field is the duplicate.
  const { session, diags } = startTraced(
    [
      ':::form{id="deploy" label="Deploy"}',
      '::input{id="deploy" label="Environment" required}',
      '::button{id="accept" label="Accept" submit}',
      ":::",
    ].join("\n"),
  );
  session.start();
  expect(diags.has("focus-duplicate-id")).toBe(true);
  // The colliding field is not focusable: tab reaches only the button.
  const events = send(session, { type: "key", key: "tab" });
  expect(session.getFocusedId()).toBe("accept");
  expect(events.some((event) => event.type === "frame")).toBe(true);
});

test("a duplicate form id is rejected instead of merging two forms' fields", () => {
  const { session, diags } = startTraced(
    [
      ':::form{id="deploy"}',
      '::input{id="env" label="Env"}',
      '::button{id="a" label="A" submit}',
      ":::",
      ':::form{id="deploy"}',
      '::input{id="region" label="Region"}',
      '::button{id="b" label="B" submit}',
      ":::",
    ].join("\n"),
  );
  session.start();
  expect(diags.has("form-duplicate-id")).toBe(true);
  // The second form's id was cleared, so its submit has no form to target.
  // Focus order is env -> a -> region -> b; three tabs reach the second form's
  // submit button.
  const events = send(
    session,
    { type: "key", key: "tab" },
    { type: "key", key: "tab" },
    { type: "key", key: "tab" },
    { type: "key", key: "enter" },
  );
  expect(session.getFocusedId()).toBe("b");
  const error = events.find((event) => event.type === "error");
  expect(error).toBeDefined();
  expect((error as { message: string }).message).toContain("not inside a :::form");
});

test("a widget id colliding with an earlier form id is the duplicate", () => {
  const { session, diags } = startTraced(
    [
      ':::form{id="deploy"}',
      '::input{id="env" label="Env"}',
      ":::",
      '::button{id="deploy" label="Outside" submit="deploy"}',
    ].join("\n"),
  );
  session.start();
  // The button (visited after the form) is the duplicate and loses focusability.
  expect(diags.has("focus-duplicate-id")).toBe(true);
  expect(session.getFocusedId()).toBe("env");
});

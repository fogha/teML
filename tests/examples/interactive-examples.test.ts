import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import type { SessionEvent } from "../../src/interactive/protocol.js";
import { InteractiveSession } from "../../src/interactive/session.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";

const EXAMPLES = join(process.cwd(), "examples");

async function exampleSession(file: string): Promise<InteractiveSession> {
  const diags = new Diagnostics();
  const source = await readFile(join(EXAMPLES, file), "utf8");
  const document = normalize(parseTeml(source, diags), diags);
  expect(diags.all()).toEqual([]);
  return new InteractiveSession(document, {
    diags,
    frames: "plain",
    mode: "patches",
    layout: {
      width: 72,
      height: 24,
      theme: loadTheme("dark"),
      caps: {
        colors: "none",
        unicode: true,
        hyperlinks: false,
        width: 72,
        ambiguousWide: false,
      },
    },
  });
}

function frameOf(events: SessionEvent[]): Extract<SessionEvent, { type: "frame" }> {
  const frame = events.find((event) => event.type === "frame");
  if (!frame || frame.type !== "frame") throw new Error("expected a frame");
  return frame;
}

test("interactive-form example completes the composite widget journey", async () => {
  const session = await exampleSession("interactive/interactive-form.teml");
  expect(frameOf(session.start()).focusedId).toBe("channel");

  session.handle({ type: "key", key: "right" });
  expect(session.handle({ type: "key", key: "enter" })[0]).toEqual({
    type: "change",
    id: "channel",
    value: "production",
  });
  session.handle({ type: "key", key: "tab" });
  session.handle({ type: "char", char: "Mina" });
  session.handle({ type: "key", key: "tab" });
  session.handle({ type: "char", char: "REL-42" });
  session.handle({ type: "key", key: "tab" });
  session.handle({ type: "char", char: "s3cr3t-rollforward" });
  session.handle({ type: "key", key: "tab" });
  session.handle({ type: "char", char: "Ready\nMonitoring" });
  session.handle({ type: "key", key: "enter", modifiers: { ctrl: true } });
  session.handle({ type: "key", key: "enter" });
  session.handle({ type: "key", key: "tab" });

  // The button is a submit control inside the form, so a valid activation is
  // one atomic submit — never a click alongside it.
  const events = session.handle({ type: "key", key: "enter" });
  const submitted = events[0];
  expect(submitted).toMatchObject({
    type: "submit",
    form: "handoff",
    values: {
      channel: "production",
      owner: "Mina",
      ticket: "REL-42",
      token: "s3cr3t-rollforward",
      notes: "Ready\nMonitoring",
      approved: "true",
    },
  });
  expect(events.some((event) => event.type === "click")).toBe(false);
});

test("log-viewer example exposes a focusable bounded region", async () => {
  const session = await exampleSession("interactive/log-viewer.teml");
  session.start();
  session.handle({ type: "key", key: "tab" });
  expect(session.getFocusedId()).toBe("logs");

  const frame = frameOf(session.handle({ type: "scroll", rows: 3 }));
  expect(frame.scrollRegions).toContainEqual({
    id: "logs",
    offset: 3,
    height: 9,
    total: expect.any(Number),
  });
});

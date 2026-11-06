import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { InteractiveSession } from "../../src/interactive/session.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { lineWidth } from "../../src/render/styledLine.js";
import type { WidgetHit } from "../../src/layout/hits.js";
import { loadTheme } from "../../src/terminal/theme.js";

function form(app: string, width: number) {
  const diags = new Diagnostics();
  const doc = normalize(
    htmlToDoc(readFileSync(`examples/apps/${app}/app.html`, "utf8"), diags),
    diags,
  );
  const caps = {
    colors: "none" as const,
    unicode: true,
    hyperlinks: false,
    width,
    ambiguousWide: false,
  };
  const layout = { width, caps, theme: loadTheme("dark") };
  const hits: WidgetHit[] = [];
  const lines = layoutDocument(doc, { ...layout, diags, hits });
  const session = new InteractiveSession(doc, { diags, layout });
  session.start();
  return { session, lines, hits };
}

for (const width of [20, 40, 80]) {
  test(`settings actions retain form semantics and pointer geometry at width ${width}`, () => {
    const { session, lines, hits } = form("settings", width);
    for (const line of lines) expect(lineWidth(line)).toBeLessThanOrEqual(width);
    const save = hits.find((hit) => hit.id === "save")!;
    const cancel = hits.find((hit) => hit.id === "cancel")!;
    expect(save).toBeDefined();
    expect(cancel).toBeDefined();
    if (width >= 40) expect(cancel.row).toBe(save.row);
    else expect(cancel.row).toBeGreaterThan(save.row);
    const cancelled = session.handle({
      type: "pointer",
      row: cancel.row,
      col: cancel.colStart + 2,
    });
    expect(cancelled.some((event) => event.type === "click" && event.id === "cancel")).toBe(true);
    expect(cancelled.some((event) => event.type === "submit")).toBe(false);
    const saved = session.handle({ type: "pointer", row: save.row, col: save.colStart + 2 });
    expect(saved).toContainEqual({ type: "submit", form: "profile", values: session.values() });
  });
}

test("settings validation stays next to the field and preserves the rest of the form", () => {
  const { session, hits } = form("settings", 80);
  session.handle({ type: "key", key: "backspace" });
  const save = hits.find((hit) => hit.id === "save")!;
  const events = session.handle({ type: "pointer", row: save.row, col: save.colStart + 2 });
  expect(events.some((event) => event.type === "submit")).toBe(false);
  expect(session.values()).toMatchObject({ name: "", channel: "stable" });
  const frame = events.find((event) => event.type === "frame");
  expect(frame).toMatchObject({ focusedId: "save" });
  expect(frame && "plain" in frame ? frame.plain : "").toMatch(/required/i);
});

test("chat action row keeps Send as submit and New chat as an ordinary action", () => {
  const { session, hits } = form("chat", 80);
  session.handle({ type: "char", char: "hello" });
  const send = hits.find((hit) => hit.id === "send")!;
  const fresh = hits.find((hit) => hit.id === "new")!;
  expect(fresh.row).toBe(send.row);
  expect(session.handle({ type: "pointer", row: send.row, col: send.colStart + 2 })).toContainEqual(
    { type: "submit", form: "composer", values: session.values() },
  );
  const events = session.handle({ type: "pointer", row: fresh.row, col: fresh.colStart + 2 });
  expect(events.some((event) => event.type === "click" && event.id === "new")).toBe(true);
  expect(events.some((event) => event.type === "submit")).toBe(false);
});

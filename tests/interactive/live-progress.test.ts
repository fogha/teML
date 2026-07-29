import { test, expect, vi } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import * as parseTemlModule from "../../src/teml/parse.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { InteractiveSession, type SessionOptions } from "../../src/interactive/session.js";
import type { PatchFrame, SessionEvent } from "../../src/interactive/protocol.js";
import {
  applyFrame as applyHostFrame,
  createFrameState,
  frameText,
} from "../../examples/interactive-frame.mjs";
import { collectInteractiveWidgets, validateUpdateProps } from "../../src/interactive/updatable.js";

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

function dashboardDoc() {
  return normalize(
    parseTeml(
      [
        "Static header",
        "",
        '::progress{id="deploy" label="Deploy" value="0" max="100"}',
        "",
        '::input{id="note" label="Note" value="draft"}',
        "",
        "Static footer",
      ].join("\n"),
    ),
  );
}

function patchFrameOf(events: SessionEvent[]): PatchFrame {
  const frame = events.find((event) => event.type === "frame");
  if (!frame || frame.type !== "frame" || !("patches" in frame)) {
    throw new Error("expected a patch frame event");
  }
  return frame;
}

test("progress and metric accept id and register as updatable widgets", () => {
  const doc = normalize(
    parseTeml(
      [
        '::metric{id="cpu" label="CPU" value="10%"}',
        '::progress{id="disk" label="Disk" value="5" max="100"}',
      ].join("\n"),
    ),
  );
  const { updatables } = collectInteractiveWidgets(doc);
  expect(updatables.map((widget) => widget.id)).toEqual(["cpu", "disk"]);
});

test("duplicate addressable ids keep the first widget and clear later ids", () => {
  const doc = normalize(
    parseTeml(
      [
        '::progress{id="dup" label="First" value="1" max="10"}',
        '::button{id="dup" label="Second"}',
      ].join("\n"),
    ),
  );
  const diags = new Diagnostics();
  const { focusables, updatables } = collectInteractiveWidgets(doc, diags);
  expect(updatables).toHaveLength(1);
  expect(focusables).toHaveLength(0);
  expect(diags.has("update-duplicate-id")).toBe(false);
  expect(diags.has("focus-duplicate-id")).toBe(true);
});

test("updatable-only duplicate and missing ids are diagnosed and remain inert", () => {
  const doc = normalize(
    parseTeml(
      [
        '::progress{id="dup" label="First" value="1" max="10"}',
        '::progress{id="dup" label="Second" value="2" max="10"}',
        '::metric{label="Missing" value="3"}',
      ].join("\n"),
    ),
  );
  const diags = new Diagnostics();
  const { updatables } = collectInteractiveWidgets(doc, diags);

  expect(updatables).toHaveLength(1);
  expect(updatables[0]).toMatchObject({ id: "dup", attrs: { label: "First" } });
  expect(diags.has("update-duplicate-id")).toBe(true);
  expect(diags.has("update-missing-id")).toBe(true);
});

test("validateUpdateProps rejects unknown and invalid props before mutation", () => {
  const doc = normalize(
    parseTeml('::progress{id="job" label="Job" value="1" max="10" role="info"}'),
  );
  const widget = collectInteractiveWidgets(doc).updatables[0]!;
  expect(validateUpdateProps(widget, { value: "5" }).ok).toBe(true);
  expect(validateUpdateProps(widget, { label: "Build" }).ok).toBe(true);
  expect(validateUpdateProps(widget, { role: "warning" }).ok).toBe(false);
  expect(validateUpdateProps(widget, { rows: "3" }).ok).toBe(false);
  const invalid = validateUpdateProps(widget, { value: "nope" });
  expect(invalid.ok).toBe(false);
});

test("metric updates use their own narrow mutable-attribute allowlist", () => {
  const doc = normalize(parseTeml('::metric{id="cpu" label="CPU" value="10%" change="+1%"}'));
  const widget = collectInteractiveWidgets(doc).updatables[0]!;

  expect(validateUpdateProps(widget, { label: "Load", value: "11%", change: "+2%" }).ok).toBe(true);
  expect(validateUpdateProps(widget, { role: "warning" }).ok).toBe(false);
  expect(validateUpdateProps(widget, { max: "100" }).ok).toBe(false);
});

test("role in an update batch is rejected atomically without mutating allowed props", () => {
  const doc = normalize(
    parseTeml('::progress{id="job" label="Job" value="1" max="10" role="info"}'),
  );
  const session = new InteractiveSession(doc, sessionOptions({ frames: "plain" }));
  session.start();
  const events = session.handle({
    type: "update",
    id: "job",
    props: { value: "50", role: "error" },
  });
  expect(events[0]).toMatchObject({ type: "error" });
  expect(session["updatables"][0]!.block.attrs).toMatchObject({
    value: "1",
    role: "info",
  });
});

test("update commands mutate progress in place without re-parsing markup", () => {
  const parseSpy = vi.spyOn(parseTemlModule, "parseTeml");
  const session = new InteractiveSession(dashboardDoc(), sessionOptions({ mode: "patches" }));
  session.start();
  parseSpy.mockClear();

  const events = session.handle({ type: "update", id: "deploy", props: { value: "50" } });
  expect(parseSpy).not.toHaveBeenCalled();
  expect(events.some((event) => event.type === "error")).toBe(false);
  const frame = patchFrameOf(events);
  expect(frame.patches.length).toBeGreaterThan(0);
  expect(JSON.stringify(events)).toContain("50%");

  for (let value = 55; value <= 100; value += 5) {
    session.handle({ type: "update", id: "deploy", props: { value: String(value) } });
  }
  expect(parseSpy).not.toHaveBeenCalled();
  parseSpy.mockRestore();
});

test("unknown id or prop emits error and leaves the frame unchanged", () => {
  const session = new InteractiveSession(dashboardDoc(), sessionOptions({ frames: "plain" }));
  const baseline = createFrameState("plain");
  applyHostFrame(baseline, session.start()[0] as never);
  const baselineText = frameText(baseline);

  const unknownId = session.handle({ type: "update", id: "missing", props: { value: "1" } });
  expect(unknownId[0]).toMatchObject({ type: "error" });
  const afterUnknown = createFrameState("plain");
  applyHostFrame(afterUnknown, unknownId.at(-1)!);
  expect(frameText(afterUnknown)).toBe(baselineText);

  const unknownProp = session.handle({
    type: "update",
    id: "deploy",
    props: { value: "10", rows: "3" },
  });
  expect(unknownProp[0]).toMatchObject({ type: "error" });
  expect(session["updatables"][0]!.block.attrs.value).toBe("0");
  const afterProp = createFrameState("plain");
  applyHostFrame(afterProp, unknownProp.at(-1)!);
  expect(frameText(afterProp)).toBe(baselineText);
});

test("updates preserve focus, cursor, scroll, and patch continuity", () => {
  const longBody = Array.from({ length: 12 }, (_, index) => `Filler row ${index}`).join("\n");
  const doc = normalize(
    parseTeml(
      [
        longBody,
        "",
        '::progress{id="deploy" label="Deploy" value="10" max="100"}',
        "",
        '::input{id="note" label="Note" placeholder="optional"}',
      ].join("\n"),
    ),
  );
  const session = new InteractiveSession(
    doc,
    sessionOptions({ mode: "patches", height: 6, frames: "plain" }),
  );
  session.start();
  session.handle({ type: "key", key: "tab" });
  session.handle({ type: "char", char: "d" });
  session.handle({ type: "char", char: "!" });
  session.handle({ type: "key", key: "pageDown" });
  const scrollOffset = session["scrollOffset"];

  const events = session.handle({ type: "update", id: "deploy", props: { value: "80" } });
  const frame = patchFrameOf(events);
  expect(frame.focusedId).toBe("note");
  expect(session["scrollOffset"]).toBe(scrollOffset);
  expect(session["cursor"].get("note")).toBe(2);
  expect(frame.patches.length).toBeGreaterThan(0);
  expect(frame.patches.length).toBeLessThanOrEqual(2);
  expect(frame.patches.some((patch) => patch.plain?.includes("80%"))).toBe(true);
});

import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { InteractiveSession, type SessionOptions } from "../../src/interactive/session.js";
import {
  MAX_DOCUMENT_BLOCKS,
  MAX_MUTATION_TARGET_CHILDREN,
  MAX_RENDER_MARKUP_BYTES,
  type FullFrame,
  type PatchFrame,
  type SessionEvent,
} from "../../src/interactive/protocol.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import {
  applyFrame as applyHostFrame,
  createFrameState,
  frameText,
} from "../../examples/interactive-frame.mjs";

function sessionOptions(overrides: Partial<SessionOptions> = {}): SessionOptions {
  return {
    diags: new Diagnostics(),
    layout: {
      width: 40,
      theme: loadTheme("mono"),
      caps: {
        colors: "none",
        unicode: true,
        hyperlinks: false,
        width: 40,
        ambiguousWide: false,
      },
    },
    frames: "plain",
    ...overrides,
  };
}

function sessionFor(source: string, overrides: Partial<SessionOptions> = {}): InteractiveSession {
  return new InteractiveSession(
    normalize(parseTeml(source, new Diagnostics())),
    sessionOptions(overrides),
  );
}

function patchFrame(events: SessionEvent[]): PatchFrame {
  const frame = events.find(
    (event): event is PatchFrame => event.type === "frame" && "patches" in event,
  );
  if (!frame) throw new Error("expected patch frame");
  return frame;
}

function fullFrame(events: SessionEvent[]): FullFrame {
  const frame = events.find(
    (event): event is FullFrame => event.type === "frame" && !("patches" in event),
  );
  if (!frame) throw new Error("expected full frame");
  return frame;
}

test("append parses a fragment into an addressable container and preserves patch continuity", () => {
  const session = sessionFor(
    [
      ':::scroll{id="logs" rows="3"}',
      "First log",
      ":::",
      "",
      '::input{id="filter" label="Filter"}',
    ].join("\n"),
    { mode: "patches" },
  );
  const screen = createFrameState("plain");
  applyHostFrame(screen, session.start()[0] as never);

  const events = session.handle({
    type: "append",
    target: "logs",
    markup: "Second log",
    format: "teml",
  });

  expect(events.some((event) => event.type === "error")).toBe(false);
  expect(patchFrame(events).focusedId).toBe("logs");
  applyHostFrame(screen, events.at(-1)!);
  expect(frameText(screen)).toContain("First log");
  expect(frameText(screen)).toContain("Second log");
});

test("append preserves a scroll target's offset while its normalized content grows", () => {
  const logs = Array.from({ length: 8 }, (_, index) => `Log ${index}`).join("\n\n");
  const session = sessionFor([':::scroll{id="logs" rows="3"}', logs, ":::"].join("\n"), {
    mode: "patches",
  });
  session.start();
  const scrolled = patchFrame(session.handle({ type: "scroll", rows: 2 }));
  expect(scrolled.scrollRegions?.[0]?.offset).toBe(2);

  const appended = patchFrame(session.handle({ type: "append", target: "logs", markup: "Log 8" }));
  expect(appended.scrollRegions?.[0]?.offset).toBe(2);
  expect(appended.scrollRegions?.[0]?.total).toBeGreaterThan(
    scrolled.scrollRegions?.[0]?.total ?? 0,
  );
});

test("append normalizes fragments in the target scroll context", () => {
  const diags = new Diagnostics();
  const document = normalize(
    parseTeml([':::scroll{id="logs" rows="3"}', "Ready", ":::"].join("\n"), diags),
    diags,
  );
  const session = new InteractiveSession(document, sessionOptions({ diags }));
  session.start();

  session.handle({
    type: "append",
    target: "logs",
    markup: '::input{id="nested" label="Nested"}',
  });

  expect(diags.has("scroll-nested-widget")).toBe(true);
  expect(session.values()).toEqual({});
});

test("footnote-bearing appends resynchronize with a fresh index", () => {
  const session = sessionFor(
    [
      ':::card{id="body"}',
      "Seed",
      ":::",
      "",
      ':::footnote{id="note"}',
      "Footnote details",
      ":::",
    ].join("\n"),
    { mode: "patches" },
  );
  session.start();

  const frame = fullFrame(
    session.handle({
      type: "append",
      target: "body",
      markup: 'See :fn{id="note"}.',
    }),
  );
  expect(frame.plain).toContain("[1]");
  expect(frame.plain).not.toContain("[?]");
});

test("a footnote-definition append preserves a surviving scroll offset", () => {
  const logs = Array.from({ length: 8 }, (_, index) => `Log ${index}`).join("\n\n");
  const session = sessionFor([':::scroll{id="logs" rows="3"}', logs, ":::"].join("\n"), {
    mode: "patches",
  });
  session.start();
  patchFrame(session.handle({ type: "scroll", rows: 2 }));

  const frame = fullFrame(
    session.handle({
      type: "append",
      target: "logs",
      markup: [':::footnote{id="new-note"}', "Details", ":::"].join("\n"),
    }),
  );
  expect(frame.scrollRegions?.[0]?.offset).toBe(2);
});

test("append preserves the active document viewport offset", () => {
  const body = Array.from({ length: 12 }, (_, index) => `Body ${index}`).join("\n\n");
  const session = sessionFor([':::card{id="body"}', body, ":::", "", "Footer"].join("\n"), {
    mode: "patches",
    layout: { ...sessionOptions().layout, height: 4 },
  });
  session.start();
  const scrolled = patchFrame(session.handle({ type: "scroll", rows: 3 }));
  expect(scrolled.viewport?.offset).toBe(3);

  const appended = patchFrame(session.handle({ type: "append", target: "body", markup: "Later" }));
  expect(appended.viewport?.offset).toBe(3);
});

test("replace preserves user values, focus, and cursor for ids reintroduced by the fragment", () => {
  const session = sessionFor(
    [
      ':::card{id="panel" title="Before"}',
      '::input{id="name" label="Name"}',
      ":::",
      "",
      '::button{id="after" label="After"}',
    ].join("\n"),
    { mode: "patches" },
  );
  session.start();
  session.handle({ type: "char", char: "Ada" });
  session.handle({ type: "key", key: "left" });

  const replaced = session.handle({
    type: "replace",
    target: "panel",
    markup: [
      ':::card{id="panel" title="Replacement"}',
      '::input{id="name" label="Renamed"}',
      "Updated body",
      ":::",
    ].join("\n"),
  });

  expect(fullFrame(replaced)).toMatchObject({ focusedId: "name" });
  expect(session.values().name).toBe("Ada");
  const changed = session.handle({ type: "char", char: "X" });
  expect(changed[0]).toEqual({ type: "change", id: "name", value: "AdXa" });
  expect(fullFrame(replaced).plain).toContain("Replacement");
});

test("remove deletes the target subtree and falls back to the first surviving focusable", () => {
  const session = sessionFor(
    [
      ':::card{id="panel" title="Temporary"}',
      '::input{id="inside" label="Inside"}',
      ":::",
      "",
      '::button{id="after" label="After"}',
    ].join("\n"),
    { mode: "patches" },
  );
  session.start();

  const removed = session.handle({ type: "remove", target: "panel" });

  const frame = fullFrame(removed);
  expect(frame.focusedId).toBe("after");
  expect(frame.plain).not.toContain("Temporary");
  expect(frame.plain).not.toContain("Inside");
  expect(frame.plain).toContain("After");
});

test("invalid, empty, and wrong-kind mutations emit an error with an unchanged frame", () => {
  const session = sessionFor(
    [':::card{id="panel" title="Stable"}', "Original", ":::", '::input{id="field"}'].join("\n"),
  );
  const baseline = fullFrame(session.start()).plain;

  for (const command of [
    { type: "append", target: "missing", markup: "Nope" },
    { type: "replace", target: "panel", markup: "" },
    { type: "remove", target: "field" },
  ] as const) {
    const events = session.handle(command);
    expect(events[0]).toMatchObject({ type: "error" });
    expect(fullFrame(events).plain).toBe(baseline);
  }
});

test("mutation fragments use each sanitized frontend and never merge fragment metadata", () => {
  const session = sessionFor([':::card{id="panel"}', "Seed", ":::"].join("\n"));
  session.start();

  expect(
    fullFrame(
      session.handle({
        type: "append",
        target: "panel",
        markup: "**Markdown**",
        format: "markdown",
      }),
    ).plain,
  ).toContain("Markdown");
  const html = fullFrame(
    session.handle({
      type: "append",
      target: "panel",
      markup: "<p>Safe</p><script>unsafe()</script>",
      format: "html",
    }),
  ).plain;
  expect(html).toContain("Safe");
  expect(html).not.toContain("unsafe");
});

test("append enforces target-child and whole-document block limits atomically", () => {
  const targetChildren = Array.from({ length: MAX_MUTATION_TARGET_CHILDREN }, (_, index) => ({
    type: "paragraph" as const,
    children: [{ type: "text" as const, value: `Child ${index}` }],
  }));
  const targetSession = new InteractiveSession(
    {
      meta: {},
      blocks: [
        {
          type: "container",
          name: "card",
          attrs: { id: "bounded" },
          children: targetChildren,
        },
      ],
    },
    sessionOptions(),
  );
  expect(
    targetSession.handle({ type: "append", target: "bounded", markup: "Overflow" })[0],
  ).toEqual({
    type: "error",
    message: `append would exceed the ${MAX_MUTATION_TARGET_CHILDREN}-child target limit`,
  });

  const documentSession = new InteractiveSession(
    {
      meta: {},
      blocks: [
        { type: "container", name: "card", attrs: { id: "bounded" }, children: [] },
        ...Array.from({ length: MAX_DOCUMENT_BLOCKS - 1 }, (_, index) => ({
          type: "paragraph" as const,
          children: [{ type: "text" as const, value: `Block ${index}` }],
        })),
      ],
    },
    sessionOptions(),
  );
  expect(
    documentSession.handle({ type: "append", target: "bounded", markup: "Overflow" })[0],
  ).toEqual({
    type: "error",
    message: `append would exceed the ${MAX_DOCUMENT_BLOCKS}-block document limit`,
  });
}, 15_000);

test("render is held to the same document block budget as the mutation commands", () => {
  const session = sessionFor('::input{id="filter" label="Filter"}');
  session.start();

  const oversized = "para\n\n".repeat(MAX_DOCUMENT_BLOCKS + 1);
  const events = session.handle({ type: "render", markup: oversized });
  expect(events[0]).toEqual({
    type: "error",
    message: `render would exceed the ${MAX_DOCUMENT_BLOCKS}-block document limit`,
  });
  // The rejected render leaves the previous document in place.
  expect(fullFrame(events).plain).toContain("Filter");
  expect(session.values()).toEqual({ filter: "" });
});

test("render enforces the markup byte budget even when called without the wire decoder", () => {
  const session = sessionFor('::input{id="filter" label="Filter"}');
  session.start();

  const events = session.handle({
    type: "render",
    markup: "x".repeat(MAX_RENDER_MARKUP_BYTES + 1),
  });
  expect(events[0]).toEqual({
    type: "error",
    message: `render command exceeds the ${MAX_RENDER_MARKUP_BYTES}-byte markup limit`,
  });
  expect(fullFrame(events).plain).toContain("Filter");
});

test("an oversized startup document warns and refuses further structural growth", () => {
  const diags = new Diagnostics();
  const blocks = Array.from({ length: MAX_DOCUMENT_BLOCKS + 1 }, (_, index) => ({
    type: "paragraph" as const,
    children: [{ type: "text" as const, value: `Block ${index}` }],
  }));
  const session = new InteractiveSession(
    {
      meta: {},
      blocks: [{ type: "container", name: "card", attrs: { id: "body" }, children: [] }, ...blocks],
    },
    sessionOptions({ diags }),
  );
  session.start();

  expect(diags.has("document-blocks-over-budget")).toBe(true);
  expect(session.handle({ type: "append", target: "body", markup: "More" })[0]).toEqual({
    type: "error",
    message: `append would exceed the ${MAX_DOCUMENT_BLOCKS}-block document limit`,
  });
});

test("full and patch hosts reconstruct equivalent screens across growth, replacement, and removal", () => {
  const source = [
    ':::scroll{id="logs" rows="3"}',
    "First",
    ":::",
    "",
    ':::card{id="summary" title="Summary"}',
    "Pending",
    ":::",
    "",
    '::button{id="done" label="Done"}',
  ].join("\n");
  const full = sessionFor(source, { mode: "full" });
  const patches = sessionFor(source, { mode: "patches" });
  const fullScreen = createFrameState("plain");
  const patchScreen = createFrameState("plain");
  applyHostFrame(fullScreen, full.start()[0] as never);
  applyHostFrame(patchScreen, patches.start()[0] as never);

  const commands = [
    { type: "append", target: "logs", markup: "Second" },
    {
      type: "replace",
      target: "summary",
      markup: [':::card{id="summary" title="Summary"}', "Complete", ":::"].join("\n"),
    },
    { type: "remove", target: "summary" },
  ] as const;
  for (const command of commands) {
    applyHostFrame(fullScreen, full.handle(command).at(-1)!);
    applyHostFrame(patchScreen, patches.handle(command).at(-1)!);
    expect(frameText(patchScreen)).toBe(frameText(fullScreen));
  }
});

test("duplicate mutation ids keep the first target and make later containers inert", () => {
  const session = sessionFor(
    [
      ':::card{id="dup" title="First"}',
      "First body",
      ":::",
      "",
      ':::card{id="dup" title="Second"}',
      "Second body",
      ":::",
    ].join("\n"),
  );
  session.start();

  const frame = fullFrame(
    session.handle({ type: "append", target: "dup", markup: "Appended once" }),
  );
  expect(frame.plain?.match(/Appended once/g)).toHaveLength(1);
  expect(frame.plain).toContain("Second body");
});

test("an unrelated append preserves a radio group's pending selection", () => {
  const session = sessionFor(
    [
      ':::radio{id="choice" value="one"}',
      '::option{value="one" label="One"}',
      '::option{value="two" label="Two"}',
      ":::",
      "",
      ':::card{id="activity"}',
      "Ready",
      ":::",
    ].join("\n"),
  );
  session.start();
  session.handle({ type: "key", key: "down" });
  session.handle({ type: "append", target: "activity", markup: "Still ready" });

  expect(session.handle({ type: "key", key: "enter" })[0]).toEqual({
    type: "change",
    id: "choice",
    value: "two",
  });
});

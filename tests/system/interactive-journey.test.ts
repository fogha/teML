import { PassThrough } from "node:stream";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import stringWidth from "string-width";
import { expect, test, vi } from "vitest";
import { runInteractiveApp, type InteractiveAppHandlers } from "../../src/interactive/host.js";
import {
  applyFrame,
  createFrameState,
  delay,
  findRow,
  frameText,
  frames,
  makeInteractiveForm,
  replayFrames,
  runCli,
  runRawSession,
  runSession,
  semanticEvents,
  tick,
  visibleText,
  type WireFrame,
} from "./harness.js";

test("the NDJSON runtime completes a negotiated, patched, resized, submitted, and rerendered form", () => {
  const form = makeInteractiveForm();
  try {
    const baseline = runSession(
      form.file,
      [{ type: "resize", width: 20, height: 12 }, { type: "exit" }],
      ["--frames", "plain"],
    );
    const submitRow = findRow(frames(baseline.events).at(-1)?.plain, "Submit");
    expect(frames(baseline.events)[0]).toMatchObject({
      plain: expect.any(String),
      ansi: null,
    });

    const commands = [
      { type: "configure", frames: "plain", mode: "patches" },
      { type: "char", char: "Ada" },
      { type: "key", key: "left" },
      { type: "resize", width: 20, height: 12 },
      { type: "char", char: "!" },
      { type: "key", key: "tab" },
      { type: "key", key: "enter" },
      { type: "pointer", row: submitRow, col: 0 },
      {
        type: "render",
        markup: [
          "# Done",
          "",
          '::input{id="name" label="Full name"}',
          '::checkbox{id="agree" label="Accepted"}',
          '::button{id="submit" label="Send again"}',
        ].join("\n"),
      },
      { type: "exit" },
    ];
    const patchRun = runSession(form.file, commands);

    expect(patchRun.status).toBe(0);
    expect(patchRun.stderr).toBe("");
    expect(patchRun.events[0]).toMatchObject({
      type: "frame",
      seq: 1,
      focusedId: "name",
    });

    const patchFrames = frames(patchRun.events);
    expect(patchFrames[0].patches).toBeUndefined();
    expect(patchFrames[1].patches).toBeUndefined(); // configure acknowledgement
    expect(patchFrames.slice(2, 4).every((frame) => frame.patches != null)).toBe(true);
    const resizeFrame = patchFrames.find(
      (frame) => frame.patches == null && frame.plain?.includes("[Ad▏a]"),
    );
    const renderFrame = patchFrames.find(
      (frame) => frame.patches == null && frame.plain?.includes("DONE"),
    );
    expect(resizeFrame?.focusedId).toBe("name");
    expect(renderFrame?.plain).toContain("Ad!a");
    expect(renderFrame?.plain).toContain("☑");

    expect(semanticEvents(patchRun.events)).toEqual([
      { type: "change", id: "name", value: "Ada" },
      { type: "change", id: "name", value: "Ad!a" },
      { type: "toggle", id: "agree", checked: true },
      {
        type: "click",
        id: "submit",
        values: { name: "Ad!a", agree: "true", submit: "" },
      },
      { type: "exit" },
    ]);

    // Replay the actual host patches up to the render command, then compare
    // that reconstructed screen with a full-frame run of the same user flow.
    const patchState = createFrameState("plain");
    for (const frame of patchFrames.slice(0, -1)) applyFrame(patchState, frame);
    const fullRun = runSession(form.file, [
      ...commands.filter((command) => command.type !== "configure" && command.type !== "render"),
    ]);
    const fullFinal = frames(fullRun.events).at(-1) as WireFrame;
    expect(frameText(patchState) + "\n").toBe(fullFinal.plain);

    const finalState = replayFrames(patchRun.events, "plain");
    expect(frameText(finalState)).toContain("Send again");
  } finally {
    form.cleanup();
  }
});

test("the default full-frame wire transcript remains byte-identical to the v1 golden", () => {
  const fixture = join(process.cwd(), "fixtures/teml/36-interactive-form.teml");
  const golden = readFileSync(
    join(process.cwd(), "tests/system/snapshots/interactive-v1.ndjson"),
    "utf8",
  );
  const run = runRawSession(fixture, '{"type":"exit"}\n', ["--no-color"]);
  expect(run.status).toBe(0);
  expect(run.stderr).toBe("");
  expect(run.stdout).toBe(golden);
});

test("radio, textarea, and nested scrolling complete one wire-level app journey", () => {
  const form = makeInteractiveForm();
  try {
    const file = join(form.dir, "composite-widgets.teml");
    writeFileSync(
      file,
      `:::radio{id="plan" value="free"}
::option{value="free" label="Free"}
::option{value="pro" label="Pro"}
:::

::textarea{id="bio" rows=2}

:::scroll{id="logs" rows=2}
log one

log two

log three

log four
:::

::button{id="submit" label="Submit"}
`,
    );
    const run = runSession(file, [
      { type: "configure", frames: "plain", mode: "patches" },
      { type: "key", key: "down" },
      { type: "key", key: "enter" },
      { type: "key", key: "tab" },
      { type: "char", char: "first\r\nsecond" },
      { type: "key", key: "enter", modifiers: { ctrl: true } },
      { type: "scroll", rows: 3 },
      { type: "key", key: "tab" },
      { type: "key", key: "enter" },
      { type: "exit" },
    ]);

    expect(run.status).toBe(0);
    expect(semanticEvents(run.events)).toEqual([
      { type: "change", id: "plan", value: "pro" },
      { type: "change", id: "bio", value: "first\nsecond" },
      {
        type: "click",
        id: "submit",
        values: { plan: "pro", bio: "first\nsecond", submit: "" },
      },
      { type: "exit" },
    ]);
    const painted = replayFrames(run.events, "plain");
    expect(frameText(painted)).toContain("[ Submit ]");
    expect(frames(run.events).some((frame) => frame.scrollRegions?.[0]?.offset === 3)).toBe(true);
  } finally {
    form.cleanup();
  }
});

test("the wire runtime keeps viewport patches bounded across richer-key navigation", () => {
  const form = makeInteractiveForm();
  try {
    const file = join(form.dir, "large-form.teml");
    writeFileSync(
      file,
      [
        '::input{id="query" label="Query"}',
        ...Array.from({ length: 100 }, (_, index) => `Static row ${index}`),
        '::button{id="bottom" label="Bottom"}',
      ].join("\n"),
    );
    const commands = [
      { type: "configure", frames: "plain", mode: "patches" },
      { type: "resize", width: 40, height: 6 },
      { type: "char", char: "Ada" },
      { type: "key", key: "home" },
      { type: "key", key: "delete" },
      { type: "key", key: "end" },
      { type: "key", key: "enter", modifiers: { ctrl: true } },
      { type: "key", key: "pageDown" },
      { type: "key", key: "down" },
      { type: "exit" },
    ];
    const patched = runSession(file, commands);
    expect(patched.status).toBe(0);
    expect(semanticEvents(patched.events)).toEqual([
      { type: "change", id: "query", value: "Ada" },
      { type: "change", id: "query", value: "da" },
      { type: "exit" },
    ]);

    const patchFrames = frames(patched.events);
    const viewportFrames = patchFrames.filter((frame) => frame.viewport);
    expect(viewportFrames.length).toBeGreaterThan(5);
    for (const frame of viewportFrames) {
      expect(frame.viewport!.height).toBe(6);
      expect(frame.viewport!.offset + frame.viewport!.height).toBeLessThanOrEqual(
        frame.viewport!.total,
      );
      if (frame.patches) {
        expect(frame.rows).toBe(6);
        expect(frame.patches.length).toBeLessThanOrEqual(6);
        expect(frame.patches.every((patch) => patch.row < 6)).toBe(true);
      }
    }
    expect(patchFrames.at(-1)?.focusedId).toBe("bottom");
    expect(patchFrames.at(-1)?.viewport?.offset).toBeGreaterThan(0);
    expect(frameText(replayFrames(patched.events, "plain"))).toContain("[ Bottom ]");

    const full = runSession(
      file,
      commands.filter((command) => command.type !== "configure"),
      ["--frames", "plain"],
    );
    expect(frameText(replayFrames(patched.events, "plain")) + "\n").toBe(
      frames(full.events).at(-1)?.plain,
    );
  } finally {
    form.cleanup();
  }
});

test("column-precise pointer commands activate the intended grid button over NDJSON", () => {
  const form = makeInteractiveForm();
  try {
    const file = join(form.dir, "grid.teml");
    writeFileSync(
      file,
      [
        ':::grid{columns="2" gap="2"}',
        '::button{id="left" label="Left"}',
        '::button{id="right" label="Right"}',
        ":::",
      ].join("\n"),
    );
    const baseline = runSession(file, [{ type: "exit" }], ["--frames", "plain"]);
    const initial = frames(baseline.events)[0]!;
    const row = findRow(initial.plain, "[ Left ]");
    const line = initial.plain!.split("\n")[row]!;
    const rightIndex = line.indexOf("[ Right ]");
    const rightCol = stringWidth(line.slice(0, rightIndex));
    expect(rightCol).toBeGreaterThan(0);

    const clicked = runSession(
      file,
      [{ type: "pointer", row, col: rightCol }, { type: "exit" }],
      ["--frames", "plain"],
    );
    expect(semanticEvents(clicked.events)[0]).toMatchObject({ type: "click", id: "right" });
    expect(frames(clicked.events).at(-1)?.focusedId).toBe("right");

    const tallFile = join(form.dir, "scrolled-grid.teml");
    writeFileSync(
      tallFile,
      [
        '::button{id="top" label="Top"}',
        ...Array.from({ length: 40 }, (_, index) => `Static row ${index}`),
        ':::grid{columns="2" gap="2"}',
        '::button{id="left" label="Left"}',
        '::button{id="right" label="Right"}',
        ":::",
      ].join("\n"),
    );
    const scrolled = runSession(
      tallFile,
      [{ type: "resize", width: 40, height: 6 }, { type: "key", key: "down" }, { type: "exit" }],
      ["--frames", "plain"],
    );
    const visibleGrid = frames(scrolled.events).at(-1)!;
    expect(visibleGrid.viewport?.offset).toBeGreaterThan(0);
    const visibleRow = findRow(visibleGrid.plain, "[ Left ]");
    const visibleLine = visibleGrid.plain!.split("\n")[visibleRow]!;
    const visibleRightIndex = visibleLine.indexOf("[ Right ]");
    const visibleRightCol = stringWidth(visibleLine.slice(0, visibleRightIndex));

    const scrolledClick = runSession(
      tallFile,
      [
        { type: "resize", width: 40, height: 6 },
        { type: "key", key: "down" },
        { type: "pointer", row: visibleRow, col: visibleRightCol },
        { type: "exit" },
      ],
      ["--frames", "plain"],
    );
    expect(semanticEvents(scrolledClick.events)[0]).toMatchObject({
      type: "click",
      id: "right",
    });
  } finally {
    form.cleanup();
  }
});

test("malformed wire input reports errors without poisoning the session", () => {
  const form = makeInteractiveForm();
  try {
    const run = runRawSession(
      form.file,
      '{not json\n{"type":"mystery"}\n{"type":"key","key":"tab"}\n{"type":"exit"}\n',
    );
    const errors = run.events.filter((event) => event.type === "error");
    expect(run.status).toBe(0);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({
      type: "error",
      message: expect.stringContaining("malformed JSON"),
    });
    expect(errors[1]).toMatchObject({
      type: "error",
      message: expect.stringContaining("unknown command type"),
    });
    expect(frames(run.events)).toHaveLength(2); // initial frame + the valid Tab command only
    expect(run.events.at(-1)).toEqual({ type: "exit" });

    const negotiated = runRawSession(
      form.file,
      '{not json\n{"type":"configure","frames":"plain","mode":"patches"}\n{"type":"exit"}\n',
    );
    expect(negotiated.events.filter((event) => event.type === "error")).toHaveLength(1);
    expect(frames(negotiated.events).at(-1)).toMatchObject({
      plain: expect.any(String),
      ansi: null,
    });
  } finally {
    form.cleanup();
  }
});

test("the runtime boundary honors color, static documents, frame flags, and file errors", () => {
  const form = makeInteractiveForm();
  try {
    const defaultRun = runSession(form.file, [{ type: "exit" }]);
    const noColorRun = runSession(form.file, [{ type: "exit" }], ["--no-color"]);
    const ansiRun = runSession(form.file, [{ type: "exit" }], ["--frames", "ansi"]);
    const defaultFrame = frames(defaultRun.events)[0];
    const noColorFrame = frames(noColorRun.events)[0];
    expect(defaultFrame.plain).not.toContain("\x1b");
    expect(defaultFrame.ansi).toContain("\x1b[");
    expect(noColorFrame.ansi).not.toContain("\x1b");
    expect(frames(ansiRun.events)[0]).toMatchObject({
      plain: null,
      ansi: expect.stringContaining("Name"),
    });

    const preconfigured = runSession(
      form.file,
      [{ type: "key", key: "tab" }, { type: "exit" }],
      ["--frames", "plain", "--mode", "patches", "--height", "2"],
    );
    expect(frames(preconfigured.events)[0]).toMatchObject({
      plain: expect.any(String),
      ansi: null,
      viewport: { offset: expect.any(Number), height: 2 },
    });
    expect(frames(preconfigured.events)[1].patches).toBeDefined();

    const lateConfigure = runSession(form.file, [
      { type: "key", key: "tab" },
      { type: "configure", frames: "ansi", mode: "patches" },
      { type: "exit" },
    ]);
    expect(semanticEvents(lateConfigure.events)[0]).toMatchObject({
      type: "error",
      // Over the wire the rejection has to say what the host is not getting:
      // the requested patches mode is the reason its frames stay full.
      message: expect.stringContaining("another command already started the session"),
    });
    expect(semanticEvents(lateConfigure.events)[0]).toMatchObject({
      message: expect.stringContaining(
        "ignored frames=ansi (still both), mode=patches (still full)",
      ),
    });
    const lateFrame = frames(lateConfigure.events).at(-1)!;
    expect(lateFrame).toMatchObject({
      plain: expect.any(String),
      ansi: expect.any(String),
    });
    expect("patches" in lateFrame).toBe(false);

    const staticFile = join(form.dir, "static.teml");
    writeFileSync(staticFile, "# Static\n\nNo widgets here.\n");
    const staticRun = runSession(staticFile, [
      { type: "key", key: "tab" },
      { type: "char", char: "x" },
      { type: "exit" },
    ]);
    expect(staticRun.status).toBe(0);
    expect(frames(staticRun.events)[0].focusedId).toBeNull();
    expect(staticRun.events.some((event) => event.type === "change")).toBe(false);

    const missing = runCli(["run", join(form.dir, "missing.teml")], {
      input: '{"type":"exit"}\n',
    });
    expect(missing).toMatchObject({ status: 1, stdout: "" });
    expect(missing.stderr).toMatch(/cannot read|ENOENT/i);
  } finally {
    form.cleanup();
  }
});

test("the in-process Node host handles callbacks, rerender, resize, submit, and cleanup together", async () => {
  const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
  const setRawMode = vi.fn();
  Object.assign(input, { isTTY: true, setRawMode });
  Object.assign(output, { isTTY: true, columns: 60, rows: 24 });
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));

  const changes: string[] = [];
  const toggles: boolean[] = [];
  let submitted: Record<string, string> | undefined;
  const handlers: InteractiveAppHandlers = {
    onChange: (_id, value) => changes.push(value),
    onToggle: (_id, checked, ctx) => {
      toggles.push(checked);
      ctx.render(`
        <h1>Updated account</h1>
        <p>This deliberately long account description reflows when the terminal narrows.</p>
        <input id="name">
        <input id="agree" type="checkbox">
        <button id="submit">Submit</button>
      `);
    },
    onClick: (_id, values, ctx) => {
      submitted = values;
      ctx.exit();
    },
  };

  const done = runInteractiveApp(
    `<input id="name" placeholder="your name">
     <input id="agree" type="checkbox">
     <button id="submit">Submit</button>`,
    { input, output, handlers },
  );
  await tick();
  expect(chunks.join("")).toContain("Submit");

  input.write("Ada");
  await tick();
  input.write("\t ");
  await tick();
  expect(changes).toEqual(["A", "Ad", "Ada"]);
  expect(toggles).toEqual([true]);
  // Styled output wraps each word in its own escape sequence, so the words
  // have to be read from the visible text rather than the raw stream.
  expect(visibleText(chunks.join(""))).toContain("UPDATED ACCOUNT");

  chunks.length = 0;
  Object.assign(output, { columns: 40, rows: 18 });
  output.emit("resize");
  Object.assign(output, { columns: 20, rows: 12 });
  output.emit("resize");
  await delay(200);
  const resized = chunks.join("");
  expect(resized.match(/\x1b\[2J/g)).toHaveLength(1);
  expect(resized).toContain("Ada");

  input.write("\t\r"); // checkbox -> submit -> activate
  const values = await done;
  expect(submitted).toMatchObject({ name: "Ada", agree: "true", submit: "" });
  expect(values).toMatchObject({ name: "Ada", agree: "true", submit: "" });
  expect(setRawMode).toHaveBeenNthCalledWith(1, true);
  expect(setRawMode).toHaveBeenLastCalledWith(false);
});

test("the in-process Node host decodes richer CSI and SS3 keys end to end", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let clicked = false;
  const done = runInteractiveApp('<input id="name"><button id="submit">Submit</button>', {
    input,
    output,
    handlers: {
      onClick: (_id, _values, ctx) => {
        clicked = true;
        ctx.exit();
      },
    },
  });
  await tick();

  input.write("Ada");
  await tick();
  // Home, Delete, SS3 Down, Enter: "Ada" -> "da" -> focus button -> click.
  input.write("\x1b[H\x1b[3~\x1bOB\r");
  const values = await done;
  expect(clicked).toBe(true);
  expect(values).toMatchObject({ name: "da", submit: "" });
});

test("the in-process Node host maps an SGR mouse column to the correct grid button", async () => {
  const input = new PassThrough();
  const output = new PassThrough() as PassThrough & { columns: number; rows: number };
  Object.assign(output, { columns: 40, rows: 12 });
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));
  let clicked: string | undefined;
  const done = runInteractiveApp(
    [
      ':::grid{columns="2" gap="2"}',
      '::button{id="left" label="界 Left"}',
      '::button{id="right" label="Right"}',
      ":::",
    ].join("\n"),
    {
      input,
      output,
      format: "teml",
      handlers: {
        onClick: (id, _values, ctx) => {
          clicked = id;
          ctx.exit();
        },
      },
    },
  );
  await tick();

  const painted = chunks.join("").split("\x1b[2J\x1b[H").at(-1) ?? "";
  const lines = painted.split("\n");
  const row = lines.findIndex((line) => line.includes("[ Right ]"));
  const line = lines[row]!;
  const index = line.indexOf("[ Right ]");
  const col = stringWidth(line.slice(0, index));
  expect(row).toBeGreaterThanOrEqual(0);
  expect(col).toBeGreaterThan(0);

  input.write(`\x1b[<0;${col + 1};${row + 1}M`);
  await expect(done).resolves.toMatchObject({ left: "", right: "" });
  expect(clicked).toBe("right");
});

test("an explicit sub-20 host width remains fixed through resize and Ctrl+C cleanup", async () => {
  const input = new PassThrough();
  const output = new PassThrough() as PassThrough & {
    isTTY: boolean;
    columns: number;
    rows: number;
  };
  Object.assign(output, { isTTY: true, columns: 60, rows: 24 });
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString("utf8")));

  expect(typeof (input as { setRawMode?: unknown }).setRawMode).toBe("undefined");
  const done = runInteractiveApp('::input{id="name" label="Name"}', {
    input,
    output,
    width: 15,
    format: "teml",
  });
  await tick();
  input.write("partial");
  await tick();
  chunks.length = 0;
  Object.assign(output, { columns: 30, rows: 12 });
  output.emit("resize");
  await delay(200);
  expect(chunks).toEqual([]);

  input.emit("data", "\u0003");
  await expect(done).resolves.toMatchObject({ name: "partial" });
});

test("ending non-TTY stdin resolves the in-process host without terminal side effects", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const done = runInteractiveApp('<input id="name">', { input, output });
  await tick();
  input.emit("end");
  await expect(done).resolves.toMatchObject({ name: "" });
});

test("live progress updates over the CLI emit bounded patches through 100%", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-live-progress-"));
  try {
    const file = join(dir, "live-progress.teml");
    writeFileSync(
      file,
      ['::progress{id="deploy" label="Deploy" value="0" max="100"}', ""].join("\n"),
    );
    const commands = [
      { type: "configure", frames: "plain", mode: "patches" },
      ...Array.from({ length: 10 }, (_, index) => ({
        type: "update",
        id: "deploy",
        props: { value: String((index + 1) * 10) },
      })),
      { type: "exit" },
    ];
    const run = runSession(file, commands);
    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const patchFrames = frames(run.events).filter((frame) => (frame.patches?.length ?? 0) > 0);
    expect(patchFrames.length).toBeGreaterThan(0);
    expect(patchFrames.every((frame) => (frame.patches?.length ?? 0) <= 2)).toBe(true);
    expect(frameText(replayFrames(run.events, "plain"))).toContain("100%");
    expect(run.events.some((event) => event.type === "error")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("targeted mutations stream through the CLI with patch and full resync frames", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-document-mutations-"));
  try {
    const file = join(dir, "mutations.teml");
    writeFileSync(
      file,
      [
        ':::scroll{id="logs" rows="3"}',
        "First",
        ":::",
        "",
        ':::card{id="summary" title="Summary"}',
        "Pending",
        ":::",
      ].join("\n"),
    );
    const run = runSession(file, [
      { type: "configure", frames: "plain", mode: "patches" },
      { type: "append", target: "logs", markup: "Second" },
      {
        type: "replace",
        target: "summary",
        markup: [':::card{id="summary" title="Summary"}', "Complete", ":::"].join("\n"),
      },
      { type: "remove", target: "summary" },
      { type: "exit" },
    ]);

    expect(run.status).toBe(0);
    expect(run.stderr).toBe("");
    const mutationFrames = frames(run.events).slice(2);
    expect(mutationFrames[0]?.patches).toBeDefined();
    expect(mutationFrames[1]?.patches).toBeUndefined();
    expect(mutationFrames[2]?.patches).toBeUndefined();
    const final = frameText(replayFrames(run.events, "plain"));
    expect(final).toContain("Second");
    expect(final).not.toContain("Summary");
    expect(run.events.some((event) => event.type === "error")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

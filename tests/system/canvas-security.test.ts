import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { frames, makeInteractiveForm, runSession, semanticEvents } from "./harness.js";

test("canvas geometry is clipped and frames stay bounded", () => {
  const form = makeInteractiveForm();
  try {
    const file = join(form.dir, "canvas.teml");
    const markup = [
      '::canvas{id="game" width="256" height="256"}',
      '::input{id="name" label="Name"}',
    ].join("\n");
    writeFileSync(file, markup);
    const run = runSession(
      file,
      [
        {
          type: "canvas",
          id: "game",
          ops: [
            { op: "fillStyle", color: "#50fa7b" },
            { op: "fillRect", x: -5, y: 0, width: 2, height: 1 },
            { op: "fillRect", x: 250, y: 250, width: 1000, height: 1000 },
          ],
        },
        { type: "char", char: "A" },
        { type: "exit" },
      ],
      ["--frames", "plain", "--height", "30"],
    );

    expect(run.status).toBe(0);
    const frame = frames(run.events).at(-1)!;
    expect(frame.viewport?.height).toBeLessThanOrEqual(30);
    for (const line of frame.plain!.split("\n")) expect(line.length).toBeLessThanOrEqual(40);
    expect(frame.plain).toContain("A");
    expect(frame.plain).not.toContain("\x1b");
  } finally {
    form.cleanup();
  }
});

test("invalid canvas input recovers without terminal injection or dropped edits", () => {
  const form = makeInteractiveForm();
  try {
    const file = join(form.dir, "canvas.teml");
    const markup = '::canvas{id="game"}\n::input{id="name" label="Name"}';
    writeFileSync(file, markup);
    const run = runSession(
      file,
      [
        { type: "canvas", id: "game", ops: [{ op: "fillStyle", color: "\x1b[31m" }] },
        { type: "char", char: "A" },
        { type: "exit" },
      ],
      ["--frames", "plain"],
    );

    expect(run.status).toBe(0);
    expect(semanticEvents(run.events)).toContainEqual({
      type: "error",
      message: "fillStyle needs a #RRGGBB color",
      frame: false,
    });
    expect(semanticEvents(run.events)).toContainEqual({ type: "change", id: "name", value: "A" });
    expect(run.stdout).not.toContain("\x1b[31m");
  } finally {
    form.cleanup();
  }
});

test("canvas error events strip host-visible control characters", () => {
  const form = makeInteractiveForm();
  try {
    const file = join(form.dir, "canvas.teml");
    writeFileSync(file, '::canvas{id="game"}');
    const run = runSession(
      file,
      [{ type: "canvas", id: "missing\x1b[31m", ops: [] }, { type: "exit" }],
      ["--frames", "plain"],
    );
    expect(run.status).toBe(0);
    expect(semanticEvents(run.events)).toContainEqual({
      type: "error",
      message: "unknown canvas id 'missing[31m'",
      frame: true,
    });
  } finally {
    form.cleanup();
  }
});

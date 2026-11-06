import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { InteractiveSession } from "../../src/interactive/session.js";
import { loadTheme } from "../../src/terminal/theme.js";
import { createGame } from "../../examples/apps/snake/state.mjs";
import { snakeView } from "../../examples/apps/snake/view.mjs";

test("snake view draws a directional eye and highlighted food", () => {
  const view = snakeView(createGame({ rng: () => 0 }));
  expect(view.score).toBe("0000");
  expect(view.status).toBe("Running");
  expect(view.operations.length).toBeLessThanOrEqual(600);

  const eye = view.operations.findIndex(
    (operation) => operation.op === "fillRect" && operation.x === 26 && operation.y === 13,
  );
  expect(eye).toBeGreaterThan(0);
  expect(view.operations[eye - 1]).toEqual({ op: "fillStyle", color: "#0b0f14" });

  const highlight = view.operations.findIndex(
    (operation) => operation.op === "fillRect" && operation.x === 2 && operation.y === 2,
  );
  expect(highlight).toBeGreaterThan(0);
  expect(view.operations[highlight - 1]).toEqual({ op: "fillStyle", color: "#ffb86c" });
});

test("snake board renders live score and status", () => {
  const diags = new Diagnostics();
  const document = normalize(
    htmlToDoc(readFileSync("examples/apps/snake/game.html", "utf8"), diags),
    diags,
  );
  const session = new InteractiveSession(document, {
    diags,
    frames: "plain",
    layout: {
      width: 80,
      theme: loadTheme("dark"),
      caps: {
        colors: "none",
        unicode: true,
        hyperlinks: false,
        width: 80,
        ambiguousWide: false,
      },
    },
  });
  session.start();
  const view = snakeView(createGame({ rng: () => 0 }));
  session.handle({ type: "update", id: "score", props: { value: view.score } });
  session.handle({ type: "update", id: "status", props: { value: view.status } });
  const frame = session.handle({ type: "canvas", id: "game", ops: view.operations }).at(-1);
  expect(frame?.type).toBe("frame");
  if (frame?.type !== "frame") return;
  expect(frame.plain).toContain("Score");
  expect(frame.plain).toContain("0000");
  expect(frame.plain).toContain("Running");
});

#!/usr/bin/env node
// PROTOTYPE: Snake driven entirely through the shared canvas protocol.
import { readFileSync } from "node:fs";
import { runInteractiveApp } from "../../../dist/interactive/host.js";
import { changeDirection, createGame, stepGame, togglePause } from "./state.mjs";
import { snakeView } from "./view.mjs";

if (!process.stdin.isTTY) {
  process.stderr.write("snake-prototype: run directly in a real terminal.\n");
  process.exit(1);
}

let state = createGame();
let timer;
const arrows = { up: "up", down: "down", left: "left", right: "right" };
const wasd = { w: "up", s: "down", a: "left", d: "right" };

function draw(ctx) {
  const view = snakeView(state);
  ctx.update("score", { value: view.score });
  ctx.update("status", { value: view.status });
  const canvas = ctx.canvas("game");
  for (const operation of view.operations) {
    if (operation.op === "clear") canvas.clear();
    else if (operation.op === "fillStyle") canvas.fillStyle(operation.color);
    else canvas.fillRect(operation.x, operation.y, operation.width, operation.height);
  }
  canvas.present();
}

try {
  await runInteractiveApp(readFileSync(new URL("./game.html", import.meta.url), "utf8"), {
    format: "html",
    mouse: false,
    handlers: {
      onReady(ctx) {
        draw(ctx);
        timer = setInterval(() => {
          if (state.status !== "running") return;
          state = stepGame(state);
          draw(ctx);
        }, 120);
      },
      onKey(key, _modifiers, ctx) {
        if (!arrows[key]) return;
        state = changeDirection(state, arrows[key]);
        draw(ctx);
      },
      onChar(char, ctx) {
        const key = char.toLowerCase();
        if (key === "q") {
          ctx.exit();
        } else if (key === "r") {
          state = createGame();
          draw(ctx);
        } else if (key === " " || key === "p") {
          state = togglePause(state);
          draw(ctx);
        } else if (wasd[key]) {
          state = changeDirection(state, wasd[key]);
          draw(ctx);
        }
      },
    },
  });
} finally {
  if (timer) clearInterval(timer);
}

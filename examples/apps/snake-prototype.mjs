#!/usr/bin/env node
// PROTOTYPE: Snake driven entirely through the shared canvas protocol.
import { readFileSync } from "node:fs";
import { runInteractiveApp } from "../../dist/interactive/host.js";
import { changeDirection, createGame, stepGame, togglePause } from "./snake-prototype-state.mjs";

if (!process.stdin.isTTY) {
  process.stderr.write("snake-prototype: run directly in a real terminal.\n");
  process.exit(1);
}

let state = createGame();
let timer;
const arrows = { up: "up", down: "down", left: "left", right: "right" };
const wasd = { w: "up", s: "down", a: "left", d: "right" };

function draw(canvas) {
  canvas.clear();
  canvas.fillStyle("#444444");
  canvas.fillRect(0, 0, 48, 1);
  canvas.fillRect(0, 23, 48, 1);
  canvas.fillRect(0, 0, 1, 24);
  canvas.fillRect(47, 0, 1, 24);
  for (const [index, cell] of state.snake.entries()) {
    canvas.fillStyle(index === 0 ? "#50fa7b" : "#2aa198");
    canvas.fillRect(cell.x * 2 + 1, cell.y * 2 + 1, 2, 2);
  }
  if (state.food) {
    canvas.fillStyle("#ff5555");
    canvas.fillRect(state.food.x * 2 + 1, state.food.y * 2 + 1, 2, 2);
  }
  canvas.present();
}

try {
  await runInteractiveApp(
    readFileSync(new URL("./snake-prototype.html", import.meta.url), "utf8"),
    {
      format: "html",
      mouse: false,
      handlers: {
        onReady(ctx) {
          const canvas = ctx.canvas("game");
          draw(canvas);
          timer = setInterval(() => {
            if (state.status !== "running") return;
            state = stepGame(state);
            draw(canvas);
          }, 120);
        },
        onKey(key, _modifiers, ctx) {
          if (!arrows[key]) return;
          const canvas = ctx.canvas("game");
          state = changeDirection(state, arrows[key]);
          draw(canvas);
        },
        onChar(char, ctx) {
          const key = char.toLowerCase();
          const canvas = ctx.canvas("game");
          if (key === "q") {
            ctx.exit();
          } else if (key === "r") {
            state = createGame();
            draw(canvas);
          } else if (key === " " || key === "p") {
            state = togglePause(state);
            draw(canvas);
          } else if (wasd[key]) {
            state = changeDirection(state, wasd[key]);
            draw(canvas);
          }
        },
      },
    },
  );
} finally {
  if (timer) clearInterval(timer);
}

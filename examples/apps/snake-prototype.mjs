#!/usr/bin/env node
// PROTOTYPE — throwaway TeML shell for the Snake state model.
// Question: does full-frame TeML rendering feel responsive enough for a small
// real-time terminal game, and where does the current host API get in the way?

import { runInteractiveApp } from "../../dist/interactive/host.js";
import { createInputDecoder } from "../../dist/terminal/client/input.js";
import {
  boardLines,
  changeDirection,
  createGame,
  stepGame,
  togglePause,
} from "./snake-prototype-state.mjs";

if (!process.stdin.isTTY) {
  process.stderr.write("snake-prototype: run directly in a real terminal.\n");
  process.exit(1);
}

const START_SCREEN = `# Snake — prototype

A pure JavaScript game loop rendered through TeML. The prototype deliberately
uses full-frame repaints so we can judge responsiveness and flicker.

::button{id="start" label="Start game"}
`;

let state = createGame();
let context;
let timer;
let started = false;

function gameMarkup() {
  return `# Snake — prototype

**Score:** ${state.score} · **Length:** ${state.snake.length} · **Direction:** ${state.direction} · **Queued:** ${state.pendingDirection} · **Ticks:** ${state.ticks} · **Status:** ${state.status}

\`\`\`
${boardLines(state).join("\n")}
\`\`\`

${state.status === "game-over" ? "Game over — press **R** to restart." : state.status === "won" ? "Board cleared — press **R** to play again." : "Eat `■`, avoid walls and your own tail."}
`;
}

function paint() {
  context?.render(gameMarkup(), "teml");
}

function start(ctx) {
  if (started) return;
  started = true;
  context = ctx;
  paint();
  timer = setInterval(() => {
    if (state.status !== "running") return;
    state = stepGame(state);
    paint();
  }, 120);
}

const decoder = createInputDecoder();
const arrows = { up: "up", down: "down", left: "left", right: "right" };
const wasd = { w: "up", s: "down", a: "left", d: "right" };

function handleInput(event) {
  if (!started || !context) return;
  if (event.type === "key" && arrows[event.key]) {
    state = changeDirection(state, arrows[event.key]);
    paint();
    return;
  }
  if (event.type !== "char") return;
  const key = event.char.toLowerCase();
  if (key === "q") {
    context.exit();
  } else if (key === "r") {
    state = createGame();
    paint();
  } else if (key === " " || key === "p") {
    state = togglePause(state);
    paint();
  } else if (wasd[key]) {
    state = changeDirection(state, wasd[key]);
    paint();
  }
}

function onData(chunk) {
  for (const event of decoder.push(chunk)) handleInput(event);
}

process.stdin.on("data", onData);
try {
  await runInteractiveApp(START_SCREEN, {
    format: "teml",
    mouse: false,
    footer: "\x1b[2mArrows/WASD move · Space/P pause · R restart · Q quit · Ctrl+C exit\x1b[0m",
    handlers: {
      onClick(id, _values, ctx) {
        if (id === "start") start(ctx);
      },
    },
  });
} finally {
  if (timer) clearInterval(timer);
  process.stdin.removeListener("data", onData);
}

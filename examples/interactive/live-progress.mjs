#!/usr/bin/env node
// examples/interactive/live-progress.mjs — 10 Hz interactive `update` demo.
//
// Usage:
//   node examples/interactive/live-progress.mjs
//   pnpm run demo:live-progress   # parent package.json script

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyFrame, createFrameState, frameText } from "./interactive-frame.mjs";

const FPS = 10;
const TICKS = FPS * 3;
const INTERVAL_MS = Math.round(1000 / FPS);
const doc = join(dirname(fileURLToPath(import.meta.url)), "live-progress.teml");
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "dist", "cli", "main.js");

const child = spawn(
  "node",
  [cliPath, "run", doc, "--frames", "plain", "--mode", "patches", "--width", "48", "--no-color"],
  { stdio: ["pipe", "pipe", "inherit"] },
);

const screen = createFrameState("plain");
let buffer = "";
let tick = 0;
let paused = false;

function send(command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  while (true) {
    const newline = buffer.indexOf("\n");
    if (newline === -1) break;
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const event = JSON.parse(line);
    if (event.type === "frame") applyFrame(screen, event);
    if (event.type === "click" && event.id === "pause") paused = !paused;
    if (event.type === "exit") process.exit(0);
  }
});

child.on("exit", (code) => process.exit(code ?? 0));

send({ type: "configure", frames: "plain", mode: "patches" });

const timer = setInterval(() => {
  if (paused) return;
  tick += 1;
  const value = Math.min(100, tick * Math.round(100 / TICKS));
  send({ type: "update", id: "deploy", props: { value: String(value) } });
  send({
    type: "update",
    id: "cpu",
    props: { value: `${10 + tick}%`, change: tick % 2 === 0 ? "+1%" : "-1%" },
  });
  process.stderr.write(`\r${frameText(screen).replace(/\n/g, " | ")}`);
  if (tick >= TICKS) {
    clearInterval(timer);
    send({ type: "exit" });
  }
}, INTERVAL_MS);

#!/usr/bin/env node
// examples/interactive-host.mjs — a minimal reference host for `teml run`.
//
// This is deliberately small: it exists to demonstrate (and let you play
// with) the host side of the protocol documented in
// docs/interactive-protocol.md, not to be a production TUI. It puts *this*
// terminal in raw mode, translates keypresses into Commands, writes them to
// `teml run`'s stdin as NDJSON, and repaints the screen from each `frame`
// event's `ansi` field. teml itself never touches the terminal — this
// script is the "host" the protocol doc keeps referring to.
//
// Usage:
//   node examples/interactive-host.mjs <file> [-- extra teml run flags]
//   npm run demo:interactive

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const file = process.argv[2];
if (!file) {
  console.error("usage: node examples/interactive-host.mjs <file> [teml-run-flags...]");
  process.exit(2);
}
if (!process.stdin.isTTY) {
  console.error(
    "this demo host needs a real TTY on stdin — run it directly in a terminal, not piped.",
  );
  process.exit(1);
}

const flags = process.argv.slice(3);
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");
const child = spawn("node", [cliPath, "run", file, ...flags], {
  stdio: ["pipe", "pipe", "inherit"],
});

function send(command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

// SGR mouse mode: ?1000h turns on click reporting, ?1006h switches the
// coordinate encoding to SGR (plain decimal, no 223-column ceiling).
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  process.stdout.write(MOUSE_OFF);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

// Persists across frames (frames overwrite the whole screen, so any
// one-shot message printed alongside a click/toggle would otherwise be
// wiped out by the very next redraw). Cleared once the user starts
// editing again, so it can't go stale silently.
let lastAction = null;

let outBuffer = "";
child.stdout.on("data", (chunk) => {
  outBuffer += chunk.toString("utf8");
  let idx;
  while ((idx = outBuffer.indexOf("\n")) !== -1) {
    const line = outBuffer.slice(0, idx);
    outBuffer = outBuffer.slice(idx + 1);
    if (line.trim() === "") continue;
    handleEvent(JSON.parse(line));
  }
});

function handleEvent(event) {
  switch (event.type) {
    case "frame":
      process.stdout.write("\x1b[2J\x1b[H"); // clear screen, cursor home — teml never does this itself
      process.stdout.write(event.ansi);
      process.stdout.write(
        "\n\x1b[2m(Tab/Shift+Tab/\u2191\u2193 focus \u00b7 \u2190\u2192 move cursor \u00b7 Enter/Space/click activate \u00b7 Ctrl+C quits)\x1b[0m\n",
      );
      if (lastAction) process.stdout.write(`\n${lastAction}\n`);
      break;
    case "click":
      lastAction = `\x1b[1;32m\u2713 Submitted "${event.id}"\x1b[0m \u2014 collected: ${JSON.stringify(event.values)}`;
      break;
    case "toggle":
    case "change":
      lastAction = null; // editing again — the last submission summary is stale now
      break;
    case "error":
      process.stderr.write(`\n[host] protocol error: ${event.message}\n`);
      break;
    case "exit":
      cleanup();
      process.exit(0);
      break;
    default:
      break;
  }
}

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding("utf8");
process.stdout.write(MOUSE_ON);

const SGR_MOUSE_RE = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])/;
const ARROW_KEYS = { A: "up", B: "down", C: "right", D: "left" };

// A small keypress/mouse decoder: tab navigation, typing, backspace,
// arrow keys (Up/Down move focus like Tab/Shift+Tab, Left/Right move the
// text cursor within the focused input), left-click (focus + activate,
// same as Enter), and Ctrl+C. Anything else escape-sequence-shaped that we
// don't recognize is dropped rather than misinterpreted as literal text.
process.stdin.on("data", (data) => {
  let s = data;
  while (s.length > 0) {
    const mouse = SGR_MOUSE_RE.exec(s);
    if (mouse) {
      const [whole, buttonStr, colStr, rowStr, pressRelease] = mouse;
      const button = Number(buttonStr);
      // Left button (0, no modifiers) press only — ignore drag/release/scroll/other buttons.
      if (pressRelease === "M" && button === 0) {
        send({ type: "pointer", row: Number(rowStr) - 1, col: Number(colStr) - 1 });
      }
      s = s.slice(whole.length);
      continue;
    }
    if (s[0] === "\u0003") {
      send({ type: "exit" });
      s = s.slice(1);
    } else if (s.startsWith("\u001b[Z")) {
      send({ type: "key", key: "shiftTab" });
      s = s.slice(3);
    } else if (s[0] === "\t") {
      send({ type: "key", key: "tab" });
      s = s.slice(1);
    } else if (s[0] === "\r" || s[0] === "\n") {
      send({ type: "key", key: "enter" });
      s = s.slice(1);
    } else if (s[0] === "\u007f" || s[0] === "\b") {
      send({ type: "key", key: "backspace" });
      s = s.slice(1);
    } else if (s.length >= 3 && s[0] === "\u001b" && s[1] === "[" && ARROW_KEYS[s[2]]) {
      const direction = ARROW_KEYS[s[2]];
      if (direction === "up") send({ type: "key", key: "shiftTab" });
      else if (direction === "down") send({ type: "key", key: "tab" });
      else send({ type: "key", key: direction }); // left/right move the text cursor
      s = s.slice(3);
    } else if (s[0] === "\u001b") {
      if (s.length === 1) send({ type: "key", key: "escape" });
      s = ""; // drop the rest of any longer, unrecognized escape sequence
    } else {
      send({ type: "char", char: s[0] });
      s = s.slice(1);
    }
  }
});

process.on("exit", cleanup);
child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});

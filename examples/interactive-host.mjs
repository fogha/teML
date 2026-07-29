#!/usr/bin/env node
// examples/interactive-host.mjs — a minimal reference host for `teml run`.
//
// This is deliberately small: it exists to demonstrate (and let you play
// with) the host side of the protocol documented in
// docs/interactive-protocol.md, not to be a production TUI. It puts *this*
// terminal in raw mode, translates keypresses into Commands, writes them to
// `teml run`'s stdin as NDJSON, reconstructs full/patch `frame` events, and
// repaints the screen. teml itself never touches the terminal — this script
// is the "host" the protocol doc keeps referring to.
//
// Usage:
//   node examples/interactive-host.mjs <file> [-- extra teml run flags]
//   pnpm run demo:interactive

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import stringWidth from "string-width";
import { applyFrame, createFrameState, frameText } from "./interactive-frame.mjs";
import { createInputDecoder } from "../dist/terminal/client/input.js";

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
const HOST_CHROME_ROWS = 4;
const framesPreconfigured = flags.some(
  (flag, index) => flag.startsWith("--frames=") || (flag === "--frames" && flags[index + 1]),
);
const modePreconfigured = flags.some(
  (flag, index) => flag.startsWith("--mode=") || (flag === "--mode" && flags[index + 1]),
);
const widthArgIndex = flags.findIndex((flag) => flag === "--width" || flag.startsWith("--width="));
const configuredWidth =
  widthArgIndex < 0
    ? undefined
    : Number(
        flags[widthArgIndex].startsWith("--width=")
          ? flags[widthArgIndex].slice("--width=".length)
          : flags[widthArgIndex + 1],
      );
const heightArgIndex = flags.findIndex(
  (flag) => flag === "--height" || flag.startsWith("--height="),
);
const configuredHeight =
  heightArgIndex < 0
    ? undefined
    : Number(
        flags[heightArgIndex].startsWith("--height=")
          ? flags[heightArgIndex].slice("--height=".length)
          : flags[heightArgIndex + 1],
      );
const liveResizeEnabled = configuredWidth == null || configuredWidth >= 20;
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");
const initialWidth = Math.min(
  configuredWidth ?? Number.MAX_SAFE_INTEGER,
  Math.max(1, process.stdout.columns ?? 80),
);
const initialHeight =
  configuredHeight ?? Math.max(1, (process.stdout.rows ?? 24) - HOST_CHROME_ROWS);
const runtimeFlags = [...flags];
if (widthArgIndex < 0) runtimeFlags.push("--width", String(initialWidth));
if (heightArgIndex < 0) runtimeFlags.push("--height", String(initialHeight));
if (!framesPreconfigured) runtimeFlags.push("--frames", "ansi");
if (!modePreconfigured) runtimeFlags.push("--mode", "patches");
const child = spawn("node", [cliPath, "run", file, ...runtimeFlags], {
  stdio: ["pipe", "pipe", "inherit"],
});

function send(command) {
  child.stdin.write(`${JSON.stringify(command)}\n`);
}

// SGR mouse mode: ?1000h turns on click reporting, ?1006h switches the
// coordinate encoding to SGR (plain decimal, no 223-column ceiling).
const MOUSE_ON = "\x1b[?1000h\x1b[?1006h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1006l";
// Reserve stable rows for the key-hint line and optional action banner so
// viewport frames plus host chrome never push content into scrollback.
let cleaned = false;
let resizeTimer;
let escapeTimer;
let wheelTimer;
let pendingWheelRows = 0;
let capabilities = null;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  if (resizeTimer) clearTimeout(resizeTimer);
  if (escapeTimer) clearTimeout(escapeTimer);
  if (wheelTimer) clearTimeout(wheelTimer);
  process.stdout.removeListener("resize", onResize);
  process.stdout.write(MOUSE_OFF);
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  process.stdin.pause();
}

// Persists across frames (frames overwrite the whole screen, so any
// one-shot message printed alongside a click/toggle would otherwise be
// wiped out by the very next redraw). Cleared once the user starts
// editing again, so it can't go stale silently.
let lastAction = null;
const screen = createFrameState("ansi");
let lastSize = { width: initialWidth, height: initialHeight };

function statusLine(text) {
  const limit = Math.max(1, process.stdout.columns ?? 80);
  let output = "";
  let width = 0;
  for (const character of Array.from(text)) {
    const next = stringWidth(character);
    if (width + next > limit) break;
    output += character;
    width += next;
  }
  return output;
}

function interactionHint() {
  const version = screen.protocol
    ? `protocol ${screen.protocol.major}.${screen.protocol.minor}`
    : "protocol v1";
  const focusedRegion = screen.scrollRegions.find((region) => region.id === screen.focusedId);
  if (focusedRegion) {
    const first = focusedRegion.total === 0 ? 0 : focusedRegion.offset + 1;
    const last = Math.min(focusedRegion.total, focusedRegion.offset + focusedRegion.height);
    return `${version} · ${focusedRegion.id} ${first}-${last}/${focusedRegion.total} · wheel/PgUp/PgDn scroll · Tab leaves`;
  }
  const scrollHint = capabilities?.has("scroll") ? "wheel scroll" : "PgUp/PgDn scroll";
  return `${version} · Tab focus · radio ←→/Enter · textarea Enter/Ctrl+Enter · ${scrollHint}`;
}

function currentSize() {
  const terminalWidth = Math.max(1, process.stdout.columns ?? 80);
  return {
    width: Math.min(configuredWidth ?? Number.MAX_SAFE_INTEGER, terminalWidth),
    height: Math.max(1, (process.stdout.rows ?? 24) - HOST_CHROME_ROWS),
  };
}

function sendCurrentSize() {
  if (!liveResizeEnabled || cleaned || child.stdin.destroyed) return;
  const next = currentSize();
  if (lastSize?.width === next.width && lastSize?.height === next.height) return;
  lastSize = next;
  send({ type: "resize", ...next });
}

function onResize() {
  if (!liveResizeEnabled || cleaned) return;
  if (resizeTimer) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = undefined;
    sendCurrentSize();
  }, 75);
}

let outBuffer = "";
child.stdout.on("data", (chunk) => {
  outBuffer += chunk.toString("utf8");
  let idx;
  while ((idx = outBuffer.indexOf("\n")) !== -1) {
    const line = outBuffer.slice(0, idx);
    outBuffer = outBuffer.slice(idx + 1);
    if (line.trim() === "") continue;
    try {
      handleEvent(JSON.parse(line));
    } catch (error) {
      process.stderr.write(
        `\n[host] invalid protocol output: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      cleanup();
      child.kill();
      process.exit(1);
    }
  }
});

function handleEvent(event) {
  switch (event.type) {
    case "frame": {
      if (cleaned) break;
      if (Array.isArray(event.capabilities)) capabilities = new Set(event.capabilities);
      applyFrame(screen, event);
      process.stdout.write("\x1b[2J\x1b[H"); // clear screen, cursor home — teml never does this itself
      process.stdout.write(frameText(screen));
      process.stdout.write(`\n\x1b[2m${statusLine(interactionHint())}\x1b[0m\n`);
      if (lastAction) process.stdout.write(`\n\x1b[1;32m${statusLine(lastAction)}\x1b[0m\n`);
      break;
    }
    case "click":
      lastAction = `✓ Submitted "${event.id}" — ${JSON.stringify(event.values)}`;
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
process.stdout.on("resize", onResize);

const decoder = createInputDecoder();

function dispatchInput(event) {
  switch (event.type) {
    case "interrupt":
    case "end":
      send({ type: "exit" });
      break;
    case "pointer":
      if (event.button === 0) send({ type: "pointer", row: event.row, col: event.col });
      break;
    case "wheel":
      pendingWheelRows = Math.max(-10_000, Math.min(10_000, pendingWheelRows + event.delta * 3));
      if (!wheelTimer) {
        wheelTimer = setTimeout(() => {
          wheelTimer = undefined;
          const rows = pendingWheelRows;
          pendingWheelRows = 0;
          if (rows === 0 || cleaned) return;
          if (capabilities?.has("scroll")) send({ type: "scroll", rows });
          else send({ type: "key", key: rows < 0 ? "pageUp" : "pageDown" });
        }, 16);
      }
      break;
    case "char":
      send({ type: "char", char: event.char });
      break;
    case "key":
      send({
        type: "key",
        key: event.key,
        ...(event.modifiers ? { modifiers: event.modifiers } : {}),
      });
      break;
    case "resize":
      send({ type: "resize", width: event.cols, height: event.rows });
      break;
    default:
      break;
  }
}

// The shared decoder buffers fragmented CSI/SS3 sequences. A short timer
// distinguishes a standalone Escape key from the prefix of a later sequence.
process.stdin.on("data", (data) => {
  if (escapeTimer) clearTimeout(escapeTimer);
  for (const event of decoder.push(data)) dispatchInput(event);
  escapeTimer = setTimeout(() => {
    escapeTimer = undefined;
    for (const event of decoder.flush()) dispatchInput(event);
  }, 25);
});

process.on("exit", cleanup);
child.on("exit", (code) => {
  cleanup();
  process.exit(code ?? 0);
});

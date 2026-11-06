#!/usr/bin/env node
// fixtures/engine/fake-engine.mjs — a scriptable stand-in for `teml run`.
//
// Host-library tests need to exercise app-loop behavior the real engine never
// produces today: unknown *future* event types (forward compatibility) and
// `submit` dispatch. This engine speaks enough NDJSON protocol for that: one
// startup full frame, one canned reaction per command, and a clean `exit`.
//
// The scenario is the basename (without extension) of the document argument
// that follows `run` — every host passes a document path and none of them
// require it to exist, so tests select behavior without env races:
//   unknown-event — every non-exit command is answered with an event whose
//                   `type` no current host knows ("future-thing") and NO frame,
//                   which is exactly the shape that used to hang the Rust loop.
//   submit        — the first non-exit command is answered with a `submit`
//                   event followed by a frame, so dispatch is observable.
// Any other document answers every non-exit command with a plain frame.
//
// Frame payloads are deliberately trivial: hosts validate shape (monotonic
// seq, viewport bounds), not content.

import { basename, extname } from "node:path";
import readline from "node:readline";
import { spawn } from "node:child_process";

if (process.argv.includes("--version")) {
  process.stdout.write("fake-engine 1.6\n");
  process.exit(0);
}

const runIndex = process.argv.indexOf("run");
const document = runIndex >= 0 ? process.argv[runIndex + 1] : "";
const scenario = basename(document ?? "", extname(document ?? "") || undefined);

// Transport scenarios run before the normal startup frame. Descendants have
// their own finite lifetime so a failed cleanup assertion cannot leak them.
if (scenario === "silent" || scenario === "inherited-stdout") {
  if (scenario === "inherited-stdout") {
    spawn(process.execPath, ["-e", "setTimeout(() => {}, 1500)"], {
      stdio: ["ignore", "inherit", "ignore"],
    }).unref();
  }
  setTimeout(() => process.exit(0), 1500);
  if (scenario === "inherited-stdout") process.stdout.write('{"type":"exit"}\n');
  await new Promise(() => {});
}
if (scenario === "oversized-event") {
  process.stdout.write("x".repeat(8 * 1024 * 1024 + 1) + '\n{"type":"exit"}\n');
  // Allow the pipe to flush naturally.
} else {

let seq = 0;
let submitted = false;

function write(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function frame(text) {
  seq += 1;
  write({
    type: "frame",
    seq,
    focusedId: null,
    plain: `${text}\n`,
    ansi: null,
    viewport: { offset: 0, height: 1, total: 1 },
    scrollRegions: [],
    protocol: { major: 1, minor: 4 },
    capabilities: [],
  });
}

frame("fake engine ready");

const commands = readline.createInterface({ input: process.stdin });
commands.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let command;
  try {
    command = JSON.parse(trimmed);
  } catch {
    return;
  }
  switch (command.type) {
    case "exit":
      write({ type: "exit" });
      process.exit(0);
      break;
    case "configure":
      // A real engine answers configure with a frame; keep that contract.
      frame("configured");
      break;
    default: {
      if (scenario === "unknown-event") {
        // No frame follows: the engine considers the command answered.
        write({ type: "future-thing", detail: "canned" });
      } else if (scenario === "submit" && !submitted) {
        submitted = true;
        write({ type: "submit", form: "deploy", values: { env: "prod", accept: "" } });
        frame("submitted");
      } else {
        frame(`handled ${command.type}`);
      }
    }
  }
});
}

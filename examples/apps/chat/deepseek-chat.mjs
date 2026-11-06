#!/usr/bin/env node
// A single-file-view DeepSeek chat with real and mock streaming responses.
import { readFileSync } from "node:fs";
import {
  Diagnostics,
  applyMetaRoles,
  colorsEnabled,
  detectCapabilities,
  htmlToDoc,
  layoutDocument,
  loadTheme,
  normalize,
  renderAnsi,
  renderPlain,
} from "../../../dist/index.js";
import { runInteractiveApp } from "../../../dist/interactive/host.js";
import { deepSeekStream, mockStream } from "./stream.mjs";

import { createChatController } from "./controller.mjs";

const VIEW = readFileSync(new URL("./app.html", import.meta.url), "utf8");

function parseArgs(argv) {
  const options = {
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    theme: undefined,
    width: undefined,
    color: undefined,
    once: undefined,
    mock: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--model") options.model = argv[++index];
    else if (arg === "--theme") options.theme = argv[++index];
    else if (arg === "--width") options.width = Number.parseInt(argv[++index], 10);
    else if (arg === "--no-color") options.color = false;
    else if (arg === "--once") options.once = argv[++index];
    else if (arg === "--mock") options.mock = true;
    else if (arg === "--") continue;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "usage: pnpm run demo:chat -- [--mock] [--once <message>] [--model <name>] [--theme <name>] [--width <cols>] [--no-color]\n",
      );
      process.exit(0);
    } else {
      process.stderr.write(`deepseek-chat: unknown flag ${JSON.stringify(arg)}\n`);
      process.exit(2);
    }
  }
  return options;
}

function renderOnce(html, options) {
  const diags = new Diagnostics();
  const caps = detectCapabilities({ width: options.width, color: options.color });
  const theme = applyMetaRoles(loadTheme(options.theme ?? "auto"), {}, diags);
  const doc = normalize(htmlToDoc(html, diags), diags);
  const lines = layoutDocument(doc, { width: caps.width, theme, caps, diags });
  process.stdout.write(colorsEnabled(caps) ? renderAnsi(lines, caps) : renderPlain(lines));
  diags.print();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!options.mock && !apiKey) {
    process.stderr.write("deepseek-chat: set DEEPSEEK_API_KEY or use --mock\n");
    process.exitCode = 1;
    return;
  }

  const stream = (messages, signal) =>
    options.mock
      ? mockStream()
      : deepSeekStream({ model: options.model, messages, apiKey, signal });

  if (options.once !== undefined) {
    let html = "";
    for await (const delta of stream([{ role: "user", content: options.once }])) html += delta;
    renderOnce(`<div class="card"><h3>Assistant</h3>${html}</div>`, options);
    return;
  }
  if (!process.stdin.isTTY) {
    process.stderr.write('deepseek-chat: interactive mode needs a TTY; use --once "<message>"\n');
    process.exitCode = 2;
    return;
  }

  const controller = createChatController({ view: VIEW, stream });
  try {
    await runInteractiveApp(controller.markup(), {
      format: "html",
      theme: options.theme,
      width: options.width,
      handlers: controller.handlers,
    });
  } finally {
    controller.dispose();
  }
}

main().catch((error) => {
  process.stderr.write(
    `deepseek-chat: fatal: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

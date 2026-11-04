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
import { SYSTEM_PROMPT, deepSeekStream, mockStream } from "./stream.mjs";

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

function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  const messages = [];
  let busy = false;
  let turnId = 0;
  let activeController;

  const appMarkup = () =>
    VIEW.replaceAll('id="composer"', `id="composer-${turnId}"`)
      .replaceAll('id="message"', `id="message-${turnId}"`)
      .replaceAll('for="message"', `for="message-${turnId}"`);

  const historyMarkup = () => {
    const content = messages.length
      ? messages
          .map((message) => {
            if (message.role === "user") {
              return `<section><h3>You</h3><p>${escapeHtml(message.content)}</p></section>`;
            }
            const body = message.streaming
              ? `<p>${escapeHtml(message.content).replace(/\n/g, "<br>")}</p>`
              : message.content;
            return `<section><h3>Assistant</h3>${body}</section>`;
          })
          .join("")
      : '<p><span class="text-muted">Ask a question to begin. Your messages appear here.</span></p>';
    return `<div data-teml="grid" data-id="history"><div class="card">${content}</div></div>`;
  };

  function paintHistory(ctx) {
    ctx.replace("history", historyMarkup(), "html");
  }

  function paintStatus(ctx, kind, text) {
    ctx.replace(
      "status",
      `<div data-teml="grid" data-id="status"><div class="alert alert-${kind}">${escapeHtml(text)}</div></div>`,
      "html",
    );
  }

  async function runTurn(text, ctx) {
    const id = ++turnId;
    busy = true;
    activeController = new AbortController();
    messages.push({ role: "user", content: text });
    const assistant = { role: "assistant", content: "", streaming: true };
    messages.push(assistant);
    ctx.render(appMarkup(), "html");
    paintHistory(ctx);
    paintStatus(ctx, "info", "Assistant is responding…");

    let lastPaint = 0;
    try {
      const wireMessages = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages.filter((message) => !message.streaming),
      ];
      for await (const delta of stream(wireMessages, activeController.signal)) {
        if (id !== turnId) return;
        assistant.content += delta;
        const now = Date.now();
        if (now - lastPaint >= 60) {
          paintHistory(ctx);
          lastPaint = now;
        }
      }
      if (id !== turnId) return;
      assistant.streaming = false;
      paintHistory(ctx);
      paintStatus(ctx, "success", "Response complete. Ask a follow-up or start a new chat.");
    } catch (error) {
      if (id !== turnId) return;
      messages.pop();
      paintHistory(ctx);
      paintStatus(
        ctx,
        "danger",
        `Could not get a response: ${error instanceof Error ? error.message : String(error)}. Check your connection or API configuration and try again.`,
      );
    } finally {
      if (id === turnId) {
        busy = false;
        activeController = undefined;
      }
    }
  }

  function submitCurrent(ctx) {
    if (busy) {
      paintStatus(ctx, "warning", "Wait for the current response before sending another message.");
      return;
    }
    const key = Object.keys(ctx.values()).find((id) => id.startsWith("message-"));
    const text = key ? ctx.values()[key].trim() : "";
    if (text) void runTurn(text, ctx);
  }

  await runInteractiveApp(appMarkup(), {
    format: "html",
    theme: options.theme,
    width: options.width,
    handlers: {
      onSubmit(_form, _values, ctx) {
        submitCurrent(ctx);
      },
      onKey(key, modifiers, ctx) {
        if (key === "enter" && modifiers?.ctrl) submitCurrent(ctx);
      },
      onClick(id, _values, ctx) {
        if (id !== "new") return;
        turnId += 1;
        activeController?.abort();
        activeController = undefined;
        busy = false;
        messages.length = 0;
        ctx.render(appMarkup(), "html");
        paintStatus(ctx, "info", "New conversation ready.");
      },
      onError(message, ctx) {
        if (message === "unknown mutation target 'status'") return;
        paintStatus(ctx, "danger", message);
      },
    },
  });
}

main().catch((error) => {
  process.stderr.write(
    `deepseek-chat: fatal: ${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});

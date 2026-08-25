#!/usr/bin/env node
// examples/apps/chat/deepseek-chat.mjs — a minimal CLI chat client for the
// DeepSeek API that renders assistant replies through the TeML pipeline.
//
// The model is instructed (via the system prompt below) to answer using a
// small, safe subset of HTML. Each full reply is run through TeML's normal
// library pipeline — htmlToDoc -> normalize -> layoutDocument -> render —
// exactly like `teml view --from html some.html` would, so every existing
// TeML guarantee (sanitization, link vetting, width-aware wrapping, theming,
// graceful degradation on malformed markup) applies to LLM output too.
//
// Usage:
//   export DEEPSEEK_API_KEY=sk-...
//   node examples/apps/chat/deepseek-chat.mjs
//   pnpm run demo:chat
//
// Flags:
//   --model <name>   DeepSeek model id (default: deepseek-v4-flash, or $DEEPSEEK_MODEL)
//   --theme <name>   TeML theme: auto | dark | light | mono (default: auto)
//   --width <cols>   Wrap width override (default: detected terminal width)
//   --no-color       Force plain-text rendering
//   --once "<msg>"   Send a single message non-interactively and exit (scripting/CI)
//   --mock           Skip the network call and use a canned HTML reply (no API key needed)
//
// This is a reference/demo host, not a production chat client: no retries,
// no token-budget trimming of history, no streaming. See docs/interactive-protocol.md
// for the (separate, more involved) protocol used for *interactive* widgets —
// this script only needs one-shot request/response rendering, so it talks to
// the library API directly instead of `teml run`.

import { createInterface } from "node:readline";
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

const API_URL = "https://api.deepseek.com/chat/completions";

const SYSTEM_PROMPT = `You are a helpful assistant running inside a terminal chat client.

Reply with ONLY a fragment of HTML — no markdown, no code fences around the
whole reply, no <html>/<head>/<body> wrapper (your reply is placed inside a
card the client already renders for you, so don't wrap it in another one).

Structural/text elements, plain, no class/style/id attributes:

  <h1>-<h4>            section headings
  <p>                  paragraphs
  <strong> <em> <code> <del> <mark> <kbd>   inline emphasis
  <a href="...">       links (absolute http(s) URLs only)
  <br>                 line breaks inside a paragraph
  <ul> <ol> <li>        lists (<ol start="N"> to resume numbering)
  <blockquote>          quoted text
  <pre><code class="language-xxx">...</code></pre>   code blocks
  <table><thead><tbody><tr><th><td>          simple tables
  <hr>                  section break

You also have a small set of *exact* rich widgets — use them, don't invent
your own class names, and don't nest them inside each other beyond what's
shown:

  <span class="text-success">...</span>   green inline text (good/healthy/done)
  <span class="text-danger">...</span>    red inline text (bad/error/failed)
  <span class="text-warning">...</span>   yellow inline text (caution)
  <span class="text-muted">...</span>     dim inline text (secondary detail)
  <span class="badge">...</span>          small inline tag/label
  <div class="alert alert-info">...</div>       info callout box
  <div class="alert alert-success">...</div>    success callout box
  <div class="alert alert-warning">...</div>    warning callout box
  <div class="alert alert-danger">...</div>     error callout box
  <div data-teml="metric" data-label="Requests" data-value="1.2k/s" data-role="success"></div>
      (a labelled headline number; data-role is optional: success|warning|error|info)
  <div data-teml="progress" data-label="Disk" data-value="72" data-max="100" data-role="warning"></div>
      (a filled progress bar; data-max defaults to 100, data-role optional)

Use the alert/metric/progress widgets sparingly and only when they genuinely
fit the content (a status update, a warning, a numeric stat) — most replies
should just be well-structured prose/lists/code, not decorated for its own
sake. Keep replies concise and readable in a narrow terminal; prefer headings
and lists over long paragraphs. Never invent a href you weren't given or
asked to produce; prefer omitting a link over guessing one.`;

function parseArgs(argv) {
  const opts = {
    model: process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    theme: undefined,
    width: undefined,
    color: undefined,
    once: undefined,
    mock: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--model":
        opts.model = argv[++i];
        break;
      case "--theme":
        opts.theme = argv[++i];
        break;
      case "--width":
        opts.width = parseInt(argv[++i], 10);
        break;
      case "--no-color":
        opts.color = false;
        break;
      case "--once":
        opts.once = argv[++i];
        break;
      case "--mock":
        opts.mock = true;
        break;
      // `pnpm run demo:chat -- --mock` forwards the separator itself.
      case "--":
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        process.stderr.write(`deepseek-chat: unknown flag ${JSON.stringify(arg)} (see --help)\n`);
        process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  process.stdout.write(
    [
      "usage: node examples/apps/chat/deepseek-chat.mjs [options]",
      "",
      "  --model <name>   DeepSeek model id (default: deepseek-v4-flash, or $DEEPSEEK_MODEL)",
      "  --theme <name>   TeML theme: auto | dark | light | mono (default: auto)",
      "  --width <cols>   Wrap width override (default: detected terminal width)",
      "  --no-color       Force plain-text rendering",
      '  --once "<msg>"   Send a single message non-interactively and exit',
      "  --mock           Use a canned reply instead of calling the API (no key needed)",
      "",
    ].join("\n"),
  );
}

const MOCK_REPLY = `<p>This is a canned response so you can try the rendering pipeline
<strong>without</strong> a DeepSeek API key. Run without <code>--mock</code>
once <code>DEEPSEEK_API_KEY</code> is set.</p>
<ul>
  <li><span class="text-success">HTML in, TeML out</span></li>
  <li>Same sanitizer and layout engine as <code>teml view</code></li>
</ul>
<div class="alert alert-info">Widgets like this alert, badges, metrics and progress bars come from the system prompt's vocabulary — the real model uses them too.</div>
<div data-teml="metric" data-label="Mock replies served" data-value="1" data-role="success"></div>
<div data-teml="progress" data-label="Demo completeness" data-value="90" data-max="100" data-role="warning"></div>`;

async function callDeepSeek(model, messages, apiKey) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text;
      try {
        detail = JSON.parse(text).error?.message ?? text;
      } catch {
        // keep raw text
      }
      throw new Error(`DeepSeek API error ${res.status}: ${detail}`);
    }
    const json = JSON.parse(text);
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("DeepSeek API returned an empty response");
    }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/** Strip a ```html fenced wrapper if the model adds one despite instructions. */
function unfence(html) {
  const fenced = /^\s*```(?:html)?\s*\n([\s\S]*?)\n?\s*```\s*$/i.exec(html.trim());
  return fenced ? fenced[1] : html;
}

/** Give every reply the same bordered-card chrome regardless of what the model produced. */
function wrapInCard(html, title) {
  return `<div class="card"><h3>${title}</h3>${html}</div>`;
}

function renderHtml(html, caps, theme) {
  const diags = new Diagnostics();
  const raw = htmlToDoc(unfence(html), diags);
  const doc = normalize(raw, diags);
  const lines = layoutDocument(doc, { width: caps.width, theme, caps, diags });
  const rendered = colorsEnabled(caps) ? renderAnsi(lines, caps) : renderPlain(lines);
  return { rendered, diags };
}

function renderHtmlReply(html, caps, theme, title) {
  return renderHtml(wrapInCard(html, title), caps, theme);
}

const PROMPT_COLOR = "\x1b[1;36m"; // bold cyan
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

function styledPrompt(caps) {
  return colorsEnabled(caps) ? `${PROMPT_COLOR}you>${RESET} ` : "you> ";
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!opts.mock && !apiKey) {
    process.stderr.write(
      "deepseek-chat: set DEEPSEEK_API_KEY (or pass --mock to try it without one)\n",
    );
    process.exit(1);
  }

  const caps = detectCapabilities({ width: opts.width, color: opts.color });
  const baseTheme = loadTheme(opts.theme ?? "auto");
  const theme = applyMetaRoles(baseTheme, {}, new Diagnostics());

  const history = [{ role: "system", content: SYSTEM_PROMPT }];

  async function turn(userText) {
    history.push({ role: "user", content: userText });
    let html;
    if (opts.mock) {
      html = MOCK_REPLY;
    } else {
      try {
        html = await callDeepSeek(opts.model, history, apiKey);
      } catch (e) {
        process.stderr.write(`\n[error] ${e instanceof Error ? e.message : String(e)}\n\n`);
        history.pop(); // don't poison history with a failed turn
        return;
      }
    }
    history.push({ role: "assistant", content: html });
    const { rendered, diags } = renderHtmlReply(html, caps, theme, "Assistant");
    process.stdout.write(`\n${rendered}\n`);
    diags.print();
  }

  if (opts.once != null) {
    await turn(opts.once);
    return;
  }

  if (!process.stdin.isTTY) {
    process.stderr.write('deepseek-chat: no TTY on stdin — use --once "<message>" instead\n');
    process.exit(2);
  }

  const banner = `<div class="alert alert-info"><strong>DeepSeek chat</strong> — model <code>${opts.model}</code>${
    opts.mock ? ' <span class="badge">mock mode</span>' : ""
  }. Type <code>exit</code> to quit.</div>`;
  const { rendered: bannerRendered } = renderHtml(banner, caps, theme);
  process.stdout.write(`${bannerRendered}\n`);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: styledPrompt(caps),
  });
  rl.prompt();
  rl.on("line", async (line) => {
    const text = line.trim();
    if (text === "") {
      rl.prompt();
      return;
    }
    if (text === "exit" || text === "quit") {
      rl.close();
      return;
    }
    rl.pause();
    await turn(text);
    rl.resume();
    rl.prompt();
  });
  rl.on("close", () => {
    process.stdout.write(colorsEnabled(caps) ? `\n${DIM}bye!${RESET}\n` : "\nbye!\n");
    process.exit(0);
  });
}

main().catch((e) => {
  process.stderr.write(`deepseek-chat: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

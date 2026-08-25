#!/usr/bin/env node
// examples/bindings-demo.mjs — a small HTML-authored interface whose live
// values are host variables, reflected through id-keyed bindings (ADR 006).
//
// Assigning a string to `state[id]` mutates a live ::metric/::progress widget
// (the `update` command under the hood) — no re-sending markup, no widget-id
// bookkeeping. In-process timers need no extra plumbing: they assign on the
// same event loop between input events.
//
// Usage:
//   node examples/apps/bindings-demo.mjs

import { bindings, runInteractiveApp } from "../../dist/interactive/host.js";

const state = bindings();

const view = `
<h2>Release monitor</h2>
<div data-teml="metric" data-id="requests" data-label="Requests served" data-value="0"></div>
<div data-teml="metric" data-id="uptime" data-label="Uptime" data-value="0s"></div>
<label for="deploy">Deploy progress</label>
<progress id="deploy" value="0" max="100" aria-label="Deploy progress"></progress>
<button id="advance">Advance 25%</button>
<button id="reset">Reset counters</button>
<button id="done">Done</button>`;

const FOOTER = "\x1b[2m(Enter/Space to activate · Tab to move · Ctrl+C to quit)\x1b[0m";

async function main() {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "bindings-demo: needs a real TTY on stdin — run it directly in a terminal.\n",
    );
    process.exit(1);
  }

  let requests = 0;
  const started = Date.now();

  const trafficTimer = setInterval(() => {
    requests += Math.floor(Math.random() * 30);
    state.requests = String(requests);
  }, 400);

  const uptimeTimer = setInterval(() => {
    state.uptime = `${Math.round((Date.now() - started) / 1000)}s`;
  }, 1000);

  await runInteractiveApp(view, {
    format: "html",
    footer: FOOTER,
    state,
    handlers: {
      onClick(id, _values, ctx) {
        if (id === "advance") {
          const next = Math.min(100, Number(state.deploy || 0) + 25);
          state.deploy = String(next);
        } else if (id === "reset") {
          requests = 0;
          state.requests = "0";
          state.deploy = "0";
        } else if (id === "done") {
          ctx.exit();
        }
      },
    },
  });

  clearInterval(trafficTimer);
  clearInterval(uptimeTimer);

  console.log(
    `Final state — requests=${state.requests}, uptime=${state.uptime}, deploy=${state.deploy}%`,
  );
}

main().catch((e) => {
  process.stderr.write(`bindings-demo: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

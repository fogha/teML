#!/usr/bin/env node
// examples/settings-app.mjs — a small "nice CLI interface built from HTML"
// reference app: a single-screen settings form driven by
// interactive/host.ts's runInteractiveApp, with no NDJSON/subprocess in the
// loop at all — this app talks to the InteractiveSession engine in-process.
//
// It demonstrates:
//   - authoring a screen entirely as HTML (inputs, a checkbox, buttons)
//   - live validation that re-renders the *same* screen with an inline
//     error, preserving whatever the user already typed (ctx.render())
//   - ending the interactive loop from a button handler (ctx.exit())
//   - rendering a plain (non-interactive) TeML summary once the loop ends,
//     reusing the exact same htmlToDoc -> layout -> render pipeline
//
// Usage:
//   node examples/settings-app.mjs
//   npm run demo:settings

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
} from "../dist/index.js";
import { runInteractiveApp } from "../dist/interactive/host.js";

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function screen({ error } = {}) {
  return `
${error ? `<div class="alert alert-danger">${escapeHtml(error)}</div>` : ""}
<h2>Account Settings</h2>
<label for="name">Name</label>
<input id="name" placeholder="Your name">
<label for="email">Email</label>
<input id="email" placeholder="you@example.com">
<label for="notify">Enable email notifications</label>
<input id="notify" type="checkbox">
<button id="save">Save</button>
<button id="cancel">Cancel</button>`;
}

const FOOTER =
  "\x1b[2m(Tab/\u2191\u2193 focus \u00b7 \u2190\u2192 edit \u00b7 Enter/Space activate \u00b7 Ctrl+C cancel)\x1b[0m";

function validate(values) {
  if (!values.name.trim()) return "Name is required.";
  if (values.email.trim() && !values.email.includes("@")) return "Email looks invalid.";
  return null;
}

/** Render a one-shot (non-interactive) HTML fragment through the normal TeML pipeline. */
function renderOnce(html, caps, theme) {
  const diags = new Diagnostics();
  const doc = normalize(htmlToDoc(html, diags), diags);
  const lines = layoutDocument(doc, { width: caps.width, theme, caps, diags });
  return colorsEnabled(caps) ? renderAnsi(lines, caps) : renderPlain(lines);
}

async function main() {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      "settings-app: needs a real TTY on stdin — run it directly in a terminal.\n",
    );
    process.exit(1);
  }

  let outcome; // set by a button handler just before ctx.exit()

  await runInteractiveApp(screen(), {
    format: "html",
    footer: FOOTER,
    handlers: {
      onClick(id, values, ctx) {
        if (id === "cancel") {
          outcome = { type: "cancelled" };
          ctx.exit();
          return;
        }
        if (id === "save") {
          const error = validate(values);
          if (error) {
            ctx.render(screen({ error }));
            return;
          }
          outcome = { type: "saved", values };
          ctx.exit();
        }
      },
    },
  });

  const caps = detectCapabilities();
  const theme = applyMetaRoles(loadTheme("auto"), {}, new Diagnostics());

  process.stdout.write("\x1b[2J\x1b[H"); // final repaint: same clear the interactive loop used
  if (outcome?.type === "saved") {
    const { name, email, notify } = outcome.values;
    const summary = `
<div class="alert alert-success"><strong>Settings saved.</strong></div>
<ul>
  <li>Name: <strong>${escapeHtml(name)}</strong></li>
  <li>Email: ${email ? escapeHtml(email) : '<span class="text-muted">(none)</span>'}</li>
  <li>Notifications: ${notify === "true" ? '<span class="text-success">on</span>' : '<span class="text-muted">off</span>'}</li>
</ul>`;
    process.stdout.write(`${renderOnce(summary, caps, theme)}\n`);
  } else {
    process.stdout.write(
      `${renderOnce('<p class="text-muted">Cancelled — nothing was saved.</p>', caps, theme)}\n`,
    );
  }
}

main().catch((e) => {
  process.stderr.write(`settings-app: fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});

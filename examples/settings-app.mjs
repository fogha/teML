#!/usr/bin/env node
// examples/settings-app.mjs — a small "nice CLI interface built from HTML"
// reference app: a workspace-profile form driven by
// interactive/host.ts's runInteractiveApp, with no NDJSON/subprocess in the
// loop at all — this app talks to the InteractiveSession engine in-process.
//
// It demonstrates:
//   - authoring a screen entirely as semantic HTML, including a native radio
//     group and textarea that TeML coalesces into composite widgets
//   - live validation that re-renders the *same* screen with an inline
//     error, preserving whatever the user already typed (ctx.render())
//   - ending the interactive loop from a button handler (ctx.exit())
//   - rendering a plain (non-interactive) TeML summary once the loop ends,
//     reusing the exact same htmlToDoc -> layout -> render pipeline
//
// Usage:
//   node examples/settings-app.mjs
//   pnpm run demo:settings

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
<h2>Workspace profile</h2>
<p>Choose how this CLI receives updates, then leave a note for collaborators.</p>
<label for="name">Display name</label>
<input id="name" value="Ada">
<label for="stable">Stable · recommended</label>
<input id="stable" type="radio" name="channel" value="stable" checked>
<label for="preview">Preview · early features</label>
<input id="preview" type="radio" name="channel" value="preview">
<label for="nightly">Nightly · newest builds</label>
<input id="nightly" type="radio" name="channel" value="nightly">
<label for="notes">Workspace note</label>
<textarea id="notes" rows="3" placeholder="What should teammates know?"></textarea>
<label for="notify">Notify me when the channel updates</label>
<input id="notify" type="checkbox">
<button id="save">Save profile</button>
<button id="cancel">Cancel</button>`;
}

const FOOTER =
  "\x1b[2m(Tab focus · radio ←→ then Enter · textarea Enter newline/Ctrl+Enter next · Ctrl+C cancel)\x1b[0m";

function validate(values) {
  if (!values.name.trim()) return "Display name is required.";
  if (values.notes.length > 240) return "Workspace note must be 240 characters or fewer.";
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
    const { name, channel, notes, notify } = outcome.values;
    const summary = `
<div class="alert alert-success"><strong>Workspace profile saved.</strong></div>
<ul>
  <li>Name: <strong>${escapeHtml(name)}</strong></li>
  <li>Update channel: <strong>${escapeHtml(channel)}</strong></li>
  <li>Notifications: ${notify === "true" ? '<span class="text-success">on</span>' : '<span class="text-muted">off</span>'}</li>
</ul>
<p>Workspace note: ${notes ? escapeHtml(notes) : '<span class="text-muted">(none)</span>'}</p>`;
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

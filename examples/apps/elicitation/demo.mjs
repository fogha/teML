#!/usr/bin/env node
// examples/apps/elicitation/demo.mjs — MCP elicitation form mode ↔ TeML.
//
// An MCP server that requests user input receives a JSON Schema
// (`requestedSchema`). This demo turns that schema into a TeML form with
// `schemaToTeml`, drives it through the interactive engine headlessly as a
// user would (tab, type, submit), and maps the widget values back into the
// typed elicitation response with `valuesToResponse` — the exact round trip
// an MCP host needs.
//
// Constraints this engine cannot enforce (minimum/maximum/multipleOf,
// multi-select arrays) and secret-bearing schemas are REFUSED with a
// diagnostic rather than silently degraded: a server must never reject input
// the form accepted.
//
// Usage:
//   node examples/apps/elicitation/demo.mjs

import { schemaToTeml, valuesToResponse } from "../../../dist/index.js";
import { Diagnostics, normalize } from "../../../dist/core/index.js";
import { parseTeml } from "../../../dist/teml/parse.js";
import { loadTheme } from "../../../dist/terminal/theme.js";
import { InteractiveSession } from "../../../dist/interactive/session.js";

/** The deploy example from docs/research/teml-mcp-apps-concept.md §4. */
const DEPLOY_SCHEMA = {
  type: "object",
  required: ["environment", "owner"],
  properties: {
    environment: {
      type: "string",
      title: "Environment",
      enum: ["Canary", "Staging", "Production"],
      default: "Staging",
    },
    owner: { type: "string", title: "Release owner", default: "Ada" },
    notes: { type: "string", title: "Notes", maxLength: 500 },
    notify: { type: "boolean", title: "Notify on-call", default: true },
  },
};

/** A schema naming a secret produces no markup at all. */
const SECRET_SCHEMA = {
  type: "object",
  properties: { apiKey: { type: "string", title: "API key" } },
};

function show(title, body) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 66 - title.length))}`);
  console.log(body);
}

async function main() {
  // 1. Refusal comes first: a secret-bearing schema generates no markup.
  const refused = schemaToTeml(SECRET_SCHEMA);
  show(
    "refused: secret-bearing schema",
    [
      `markup: ${JSON.stringify(refused.markup)}`,
      ...refused.diagnostics.map((d) => `diagnostic: ${d}`),
    ].join("\n"),
  );

  // 2. The deploy schema becomes a TeML form.
  const { markup, diagnostics } = schemaToTeml(DEPLOY_SCHEMA, { title: "Deploy" });
  if (diagnostics.length > 0) {
    console.error(`unexpected diagnostics: ${diagnostics.join("; ")}`);
    process.exitCode = 1;
    return;
  }
  show("generated form", markup.trimEnd());

  // 3. Drive it through the engine as a user would: the radio keeps its
  //    default, the owner is edited, and the accept button submits.
  const session = new InteractiveSession(normalize(parseTeml(markup), new Diagnostics()), {
    diags: new Diagnostics(),
    layout: {
      width: 64,
      theme: loadTheme("dark"),
      caps: {
        colors: "truecolor",
        unicode: true,
        hyperlinks: false,
        width: 64,
        ambiguousWide: false,
      },
    },
  });
  session.start();
  session.handle({ type: "key", key: "tab" }); // radio (default kept)
  for (const char of "Grace") session.handle({ type: "char", char });
  session.handle({ type: "key", key: "tab" }); // notes (left empty: omitted)
  session.handle({ type: "key", key: "tab" }); // notify (default true kept)
  session.handle({ type: "key", key: "tab" }); // accept
  const events = session.handle({ type: "key", key: "enter" });
  const submit = events.find((event) => event.type === "submit");
  if (!submit) {
    console.error(`expected a submit event, got: ${events.map((e) => e.type).join(", ")}`);
    process.exitCode = 1;
    return;
  }

  // 4. Widget values become the typed elicitation response.
  const response = valuesToResponse(DEPLOY_SCHEMA, submit.values, { action: "accept" });
  show("submit values (engine)", JSON.stringify(submit.values));
  show("elicitation response", JSON.stringify(response, null, 2));

  // An untouched optional (`notes`) is absent, not ""; types are coerced.
  if (response.action !== "accept" || "notes" in response.content) {
    console.error("unexpected response shape");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

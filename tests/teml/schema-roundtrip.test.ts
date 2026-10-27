import { test, expect } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import {
  schemaToTeml,
  valuesToResponse,
  type ElicitationSchema,
} from "../../src/mcp/elicitation.js";

/** The deploy example from docs/research/teml-mcp-apps-concept.md §4. */
const DEPLOY: ElicitationSchema = {
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

test("the deploy schema generates a form that the engine parses", () => {
  const { markup, diagnostics } = schemaToTeml(DEPLOY, { title: "Deploy" });
  expect(diagnostics).toEqual([]);
  expect(markup).toContain('::::form{id="elicitation" label="Deploy"}');

  const doc = normalize(parseTeml(markup), new Diagnostics());
  const form = doc.blocks[0];
  expect(form?.type).toBe("container");
  expect(form?.type === "container" && form.name).toBe("form");

  const children = form?.type === "container" ? form.children : [];
  const radio = children.find((b) => b.type === "container" && b.name === "radio");
  expect(radio).toBeDefined();
  if (radio?.type === "container") {
    // `const` must survive as the option value, separate from the label.
    expect(radio.attrs.id).toBe("environment");
    expect(radio.attrs.value).toBe("Staging");
    expect(radio.children.map((o) => o.type === "leaf" && o.attrs.value)).toEqual([
      "Canary",
      "Staging",
      "Production",
    ]);
  }

  const byId = new Map(children.filter((b) => b.type === "leaf").map((b) => [b.attrs.id ?? "", b]));
  expect(byId.get("owner")?.type === "leaf" && byId.get("owner")!.attrs.required).toBe("");
  expect(byId.get("notes")?.type === "leaf" && byId.get("notes")!.attrs.maxLength).toBe("500");
  expect(byId.get("notify")?.type === "leaf" && byId.get("notify")!.attrs.checked).toBe("true");
});

test("the outermost fence is longer than the nested radio fence", () => {
  const { markup } = schemaToTeml(DEPLOY);
  const lines = markup.split("\n");
  const open = lines.find((line) => line.startsWith("::::form"));
  const radio = lines.find((line) => line.startsWith(":::radio"));
  const closeRadio = lines.indexOf(":::");
  const closeForm = lines.lastIndexOf("::::");
  expect(open).toBeDefined();
  expect(radio).toBeDefined();
  // The radio must close before the form does, or the form is stranded open.
  expect(closeRadio).toBeGreaterThan(-1);
  expect(closeForm).toBeGreaterThan(closeRadio);
});

test("a secret-bearing schema produces no markup and names the field", () => {
  const schema: ElicitationSchema = {
    type: "object",
    properties: { apiKey: { type: "string", title: "API key" } },
  };
  const result = schemaToTeml(schema);
  expect(result.markup).toBe("");
  expect(result.diagnostics.join(" ")).toContain("apiKey");
});

test("format password is refused outright", () => {
  const schema: ElicitationSchema = {
    type: "object",
    properties: { whatever: { type: "string", format: "password" } },
  };
  const result = schemaToTeml(schema);
  expect(result.markup).toBe("");
  expect(result.diagnostics.join(" ")).toContain("password");
});

test("an allow override unblocks a false-positive secret name", () => {
  const schema: ElicitationSchema = {
    type: "object",
    properties: { access: { type: "string", title: "Access level" } },
  };
  // The default heuristic is intentionally broad for "auth"-ish names.
  const denied: ElicitationSchema = {
    type: "object",
    properties: { auth: { type: "string", title: "Auth" } },
  };
  expect(schemaToTeml(denied).markup).toBe("");
  const allowed = schemaToTeml(denied, { secrets: { allow: ["auth"] } });
  expect(allowed.markup).toContain('id="auth"');
  // A non-secret name is unaffected.
  expect(schemaToTeml(schema).markup).toContain('id="access"');
});

test("unenforceable constraints are refused, never silently dropped", () => {
  const schema: ElicitationSchema = {
    type: "object",
    properties: { replicas: { type: "integer", title: "Replicas", minimum: 1, maximum: 9 } },
  };
  const result = schemaToTeml(schema);
  expect(result.markup).toBe("");
  expect(result.diagnostics.join(" ")).toContain("minimum");
});

test("multi-select arrays are refused rather than degraded", () => {
  const schema = {
    type: "object",
    properties: {
      channels: { type: "array", title: "Channels", items: { enum: ["email", "sms"] } },
    },
  } as unknown as ElicitationSchema;
  const result = schemaToTeml(schema);
  // An `array` property is not representable, so nothing is emitted for it.
  expect(result.markup).not.toContain('id="channels"');
});

test("values round-trip into typed content, dropping buttons and untouched optionals", () => {
  const response = valuesToResponse(DEPLOY, {
    environment: "Staging",
    owner: "Ada",
    notes: "",
    notify: "true",
    accept: "",
    decline: "",
  });
  expect(response).toEqual({
    action: "accept",
    content: { environment: "Staging", owner: "Ada", notify: true },
  });
});

test("an untouched optional is omitted, not sent as an empty string", () => {
  const response = valuesToResponse(DEPLOY, {
    environment: "Canary",
    owner: "Grace",
    notes: "",
    notify: "false",
  });
  expect(response).toHaveProperty("action", "accept");
  if ("content" in response) {
    expect("notes" in response.content).toBe(false);
    expect(response.content.notify).toBe(false);
  }
});

test("a missing required field is reported instead of guessed", () => {
  const response = valuesToResponse(DEPLOY, { environment: "Staging", notify: "true" });
  expect(response).toHaveProperty("errors");
  if ("errors" in response) {
    expect(response.errors.join(" ")).toContain("owner");
  }
});

test("decline and cancel are recognized from the activated control", () => {
  // Button values are always "", so the activated id is what distinguishes them.
  expect(valuesToResponse(DEPLOY, { decline: "" }, { action: "decline" })).toEqual({
    action: "decline",
  });
  expect(valuesToResponse(DEPLOY, { cancel: "" }, { action: "cancel" })).toEqual({
    action: "cancel",
  });
});

test("a generated form accepts a real submit round trip through the engine", async () => {
  const { markup } = schemaToTeml(DEPLOY, { title: "Deploy" });
  const doc = normalize(parseTeml(markup), new Diagnostics());
  const { InteractiveSession } = await import("../../src/interactive/session.js");
  const { loadTheme } = await import("../../src/terminal/theme.js");
  const session = new InteractiveSession(doc, {
    diags: new Diagnostics(),
    layout: {
      width: 60,
      theme: loadTheme("dark"),
      caps: {
        colors: "truecolor",
        unicode: true,
        hyperlinks: false,
        width: 60,
        ambiguousWide: false,
      },
    },
  });
  session.start();
  // Focus order is radio(environment) -> owner -> notes -> notify -> accept.
  for (let i = 0; i < 4; i += 1) session.handle({ type: "key", key: "tab" });
  expect(session.getFocusedId()).toBe("accept");
  const events = session.handle({ type: "key", key: "enter" });
  const submit = events.find((event) => event.type === "submit") as
    { form: string; values: Record<string, string> } | undefined;
  expect(submit).toBeDefined();
  const response = valuesToResponse(DEPLOY, submit!.values);
  expect(response).toHaveProperty("action", "accept");
  if ("content" in response) {
    // The radio default and the boolean default survive as typed values.
    expect(response.content.environment).toBe("Staging");
    expect(response.content.notify).toBe(true);
  }
});

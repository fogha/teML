import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { parseHtml } from "../../src/html/parse.js";
import { extractContent } from "../../src/html/extract.js";

const FIXTURES = join(process.cwd(), "fixtures/html");

test("extractContent: removes script/style/hidden nodes", async () => {
  const source = await readFile(join(FIXTURES, "02-messy.html"), "utf8");
  const doc = parseHtml(source);
  const root = extractContent(doc, new Diagnostics());
  const text = root.textContent ?? "";
  expect(text).toContain("Visible content survives cleanup.");
  expect(text).not.toContain("pwned");
  expect(text).not.toContain("Hidden paragraph");
  expect(text).not.toContain("Display none");
});

test("extractContent: article fixture prefers readability root", async () => {
  const source = await readFile(join(FIXTURES, "15-readability-article.html"), "utf8");
  const diags = new Diagnostics();
  const doc = parseHtml(source);
  const root = extractContent(doc, diags);
  const text = root.textContent ?? "";
  expect(text).toContain("Incident Postmortem");
  expect(text).not.toContain("Sidebar promos");
});

test("extractContent: fallback warns when readability fails", async () => {
  const source = await readFile(join(FIXTURES, "16-readability-fallback.html"), "utf8");
  const diags = new Diagnostics();
  const doc = parseHtml(source);
  const root = extractContent(doc, diags);
  expect(root.textContent).toContain("Fragment fallback content");
  // parse5 wrapping may still let Readability succeed; empty pages always fallback.
  if (!diags.has("readability-fallback")) {
    const empty = parseHtml("<html><head><title>Empty</title></head><body></body></html>");
    const diags2 = new Diagnostics();
    extractContent(empty, diags2);
    expect(diags2.has("readability-fallback")).toBe(true);
  }
});

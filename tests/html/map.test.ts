import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, inlineText, normalize } from "../../src/core/index.js";
import { parseHtml } from "../../src/html/parse.js";
import { extractContent } from "../../src/html/extract.js";
import { htmlToDocFromRoot } from "../../src/html/map.js";
import { loadProfile } from "../../src/html/profiles/loader.js";

const FIXTURES = join(process.cwd(), "fixtures/html");

test("map: dl/dt/dd becomes definitionList", async () => {
  const source = await readFile(join(FIXTURES, "10-dl-kv.html"), "utf8");
  const doc = parseHtml(source);
  const root = extractContent(doc, new Diagnostics(), { preserveClasses: true });
  const mapped = normalize(htmlToDocFromRoot(root, {}, new Diagnostics(), doc));
  const dl = mapped.blocks.find((b) => b.type === "definitionList");
  expect(dl?.type).toBe("definitionList");
  if (dl?.type === "definitionList") {
    expect(inlineText(dl.items[0]!.term)).toBe("Cluster");
    expect(dl.items.some((it) => inlineText(it.term) === "Pods")).toBe(true);
  }
});

test("map: heading clamp emits diagnostic", async () => {
  const source = await readFile(join(FIXTURES, "13-headings-clamp.html"), "utf8");
  const diags = new Diagnostics();
  const doc = parseHtml(source);
  const root = extractContent(doc, diags, { preserveClasses: true });
  const mapped = htmlToDocFromRoot(root, {}, diags, doc);
  expect(mapped.blocks.every((b) => b.type !== "heading" || (b.type === "heading" && b.level <= 4))).toBe(true);
  expect(diags.has("heading-clamped")).toBe(true);
});

test("map: bootstrap profile maps card and alert containers", async () => {
  const source = await readFile(join(FIXTURES, "03-bootstrap.html"), "utf8");
  const diags = new Diagnostics();
  const doc = parseHtml(source);
  const root = extractContent(doc, diags, { preserveClasses: true });
  const profile = loadProfile("bootstrap");
  const mapped = normalize(htmlToDocFromRoot(root, { profile }, diags, doc));
  const names = mapped.blocks
    .filter((b) => b.type === "container")
    .map((b) => (b.type === "container" ? b.name : ""));
  expect(names).toContain("card");
  expect(names).toContain("warning");
  expect(names).toContain("error");
  const card = mapped.blocks.find((b) => b.type === "container" && b.name === "card");
  expect(card?.type).toBe("container");
  if (card?.type === "container") {
    expect(card.children[0]?.type).not.toBe("heading");
  }
});

test("map: table spans warn once", async () => {
  const source = await readFile(join(FIXTURES, "05-table-spans.html"), "utf8");
  const diags = new Diagnostics();
  const doc = parseHtml(source);
  const root = extractContent(doc, diags, { preserveClasses: true });
  htmlToDocFromRoot(root, {}, diags, doc);
  expect(diags.has("table-span-flattened")).toBe(true);
});

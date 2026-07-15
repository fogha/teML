import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, inlineText, normalize } from "../../src/core/index.js";
import { maxContainerNesting, parseTeml, parseToMdast } from "../../src/teml/parse.js";
import { mdastToTDoc, extractMeta } from "../../src/teml/mdast-to-tdoc.js";

const FIXTURES = join(process.cwd(), "fixtures/teml");

async function load(name: string): Promise<string> {
  return readFile(join(FIXTURES, name), "utf8");
}

test("parseToMdast: kitchen sink has directives and yaml", async () => {
  const tree = parseToMdast(await load("10-kitchen-sink.teml"));
  const types = new Set<string>();
  const walk = (nodes: { type: string; children?: { type: string; children?: unknown[] }[] }[]) => {
    for (const n of nodes) {
      types.add(n.type);
      if (n.children) walk(n.children as { type: string; children?: { type: string }[] }[]);
    }
  };
  walk(tree.children);
  expect(types.has("yaml")).toBe(true);
  expect(types.has("containerDirective")).toBe(true);
  expect(types.has("leafDirective")).toBe(true);
  expect(types.has("textDirective")).toBe(true);
});

test("parse: headings clamp levels 5 and 6", async () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(await load("01-headings.teml"), d));
  const levels = doc.blocks.filter((b) => b.type === "heading").map((b) => b.level);
  expect(levels).toEqual([1, 2, 3, 4, 4, 4]);
  expect(d.all().filter((w) => w.code === "heading-clamped")).toHaveLength(2);
});

test("parse: inline styles and links", async () => {
  const doc = normalize(parseTeml(await load("02-inline.teml")));
  const para = doc.blocks.find(
    (b) => b.type === "paragraph" && inlineText(b.children).includes("bold"),
  );
  expect(para?.type).toBe("paragraph");
  const dump = JSON.stringify(doc);
  expect(dump).toContain('"type":"bold"');
  expect(dump).toContain('"type":"italic"');
  expect(dump).toContain('"type":"code"');
  expect(dump).toContain('"type":"link"');
});

test("parse: ordered list honors start attribute", async () => {
  const doc = normalize(parseTeml(await load("03-lists.teml")));
  const ordered = doc.blocks.find((b) => b.type === "list" && b.ordered);
  expect(ordered?.type).toBe("list");
  if (ordered?.type === "list") expect(ordered.start).toBe(3);
});

test("parse: nested containers via colon depth", async () => {
  const doc = normalize(parseTeml(await load("05-containers.teml")));
  const card = doc.blocks[0];
  expect(card.type).toBe("container");
  if (card.type === "container") {
    expect(card.name).toBe("card");
    expect(card.children[0].type).toBe("container");
    if (card.children[0].type === "container") expect(card.children[0].name).toBe("warning");
  }
});

test("parse: inline spans and escaped directive", async () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(await load("06-inline-spans.teml"), d));
  const dump = JSON.stringify(doc);
  expect(dump).toContain('"type":"span"');
  expect(dump).toContain('"role":"success"');
  expect(
    inlineText(doc.blocks.flatMap((b) => (b.type === "paragraph" ? b.children : []))),
  ).toContain(":notaspan[ignored]");
  expect(d.all().some((w) => w.code === "unknown-directive")).toBe(false);
});

test("parse: leaf directives", async () => {
  const doc = normalize(parseTeml(await load("07-leafs.teml")));
  const names = doc.blocks.filter((b) => b.type === "leaf").map((b) => b.name);
  expect(names).toEqual(["kv", "image", "break"]);
});

test("parse: frontmatter meta and ignored nested key", async () => {
  const d = new Diagnostics();
  const tree = parseToMdast(await load("08-frontmatter.teml"));
  const meta = extractMeta(tree, d);
  expect(meta.title).toBe("Frontmatter Demo");
  expect(meta.theme).toBe("dark");
  expect(meta.lang).toBe("en");
  expect(meta.base).toBe("https://example.com/docs");
  expect(meta.roles?.accent?.fg).toBe("brightCyan");
  expect(d.all().some((w) => w.code === "frontmatter-ignored-key")).toBe(true);
});

test("parse: invalid frontmatter colors are rejected", () => {
  const d = new Diagnostics();
  const doc = parseTeml(
    '---\nroles:\n  danger:\n    fg: "#zzz"\n    bg: red\n---\n\n:danger[test]\n',
    d,
  );
  expect(doc.meta.roles?.danger).toEqual({ bg: "red" });
  expect(d.has("frontmatter-invalid-color")).toBe(true);
});

test("parse: frontmatter themes are limited to built-ins", () => {
  const d = new Diagnostics();
  const doc = parseTeml("---\ntheme: ../../private.json\n---\n\nsafe\n", d);
  expect(doc.meta.theme).toBeUndefined();
  expect(d.has("frontmatter-theme-rejected")).toBe(true);
});

test("parse: GFM table alignment", async () => {
  const doc = normalize(parseTeml(await load("09-tables.teml")));
  const table = doc.blocks.find((b) => b.type === "table");
  expect(table?.type).toBe("table");
  if (table?.type === "table") {
    expect(table.align).toEqual(["left", "center", "right"]);
    expect(table.rows[0]?.header).toBe(true);
  }
});

test("parse: kitchen sink without throwing", async () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(await load("10-kitchen-sink.teml"), d));
  expect(doc.blocks.length).toBeGreaterThan(5);
  expect(doc.meta.title).toBe("Kitchen Sink");
});

test("parse: adversarial links and ESC stripped", async () => {
  const d = new Diagnostics();
  const src = await readFile(
    join(process.cwd(), "fixtures/adversarial/javascript-link.teml"),
    "utf8",
  );
  const doc = normalize(parseTeml(src, d));
  expect(JSON.stringify(doc)).not.toContain("javascript:");
  expect(d.all().some((w) => w.code === "link-dropped")).toBe(true);
});

test("mdastToTDoc export matches parseTeml", async () => {
  const src = await load("04-quote-hr-code.teml");
  const d1 = new Diagnostics();
  const d2 = new Diagnostics();
  const a = normalize(parseTeml(src, d1));
  const b = normalize(mdastToTDoc(parseToMdast(src), d2));
  expect(b).toEqual(a);
});

test("maxContainerNesting counts concurrently-open fences, not total fence count", () => {
  expect(maxContainerNesting(":::a\nx\n:::\n:::b\ny\n:::\n")).toBe(1);
  expect(maxContainerNesting(":::a\n::::b\nx\n::::\n:::\n")).toBe(2);
  expect(maxContainerNesting("no fences here\n")).toBe(0);
});

test("parse: pathologically deep container nesting degrades instead of costing O(depth^2)", () => {
  // remark-directive's container tokenizer re-checks the whole open-container
  // stack per line, so unbounded nesting depth is a CPU-exhaustion vector
  // (a ~14KB document with 1600 nested fences previously took >7s to parse).
  const depth = 2000;
  const src = ":::a\n".repeat(depth) + "x\n" + ":::\n".repeat(depth);
  const d = new Diagnostics();
  const t0 = Date.now();
  const doc = parseTeml(src, d);
  const elapsedMs = Date.now() - t0;
  expect(elapsedMs).toBeLessThan(1000);
  expect(d.has("container-nesting-too-deep")).toBe(true);
  // Fences are neutralized (treated as plain text), not dropped or crashed on.
  expect(JSON.stringify(doc)).not.toContain('"type":"container"');
});

test("parse: container nesting within the safe limit still nests normally", async () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(await load("05-containers.teml"), d));
  expect(d.has("container-nesting-too-deep")).toBe(false);
  expect(doc.blocks[0].type).toBe("container");
});

test("parse: pathologically deep list/blockquote chains degrade instead of costing O(depth) per line", () => {
  // remark-parse's list/blockquote continuation check is O(open-container
  // depth) per line, so a long chain of nested single-item lists (no `:::`
  // fences involved) is a format-agnostic CPU-exhaustion vector distinct
  // from the container-fence one above.
  let src = "";
  for (let i = 0; i < 800; i++) src += "  ".repeat(i) + "- x\n";
  const d = new Diagnostics();
  const t0 = Date.now();
  const doc = parseTeml(src, d);
  expect(Date.now() - t0).toBeLessThan(2000);
  expect(d.has("pathological-nesting-rejected")).toBe(true);
  expect(doc.blocks).toEqual([{ type: "codeBlock", value: src }]);
});

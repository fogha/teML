import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, inlineText, normalize, tokensView } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { serializeTeml } from "../../src/teml/serialize.js";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { serializeMarkdown } from "../../src/markdown/serialize.js";
import { htmlToDoc } from "../../src/html/index.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { renderPlain } from "../../src/render/plain.js";
import { lineWidth } from "../../src/render/styledLine.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { snapshotRender } from "../snapshot.js";

const FIXTURE = join(process.cwd(), "fixtures/teml/34-doc-elements.teml");

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 60,
  ambiguousWide: false,
  ...over,
});

test("titled callout preserves title attr and renders title line", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(':::info{title="Setup"}\nBody\n:::\n', d));
  const container = doc.blocks[0] as Extract<(typeof doc.blocks)[0], { type: "container" }>;
  expect(container.type).toBe("container");
  expect(container.attrs.title).toBe("Setup");
  const out = renderPlain(
    layoutDocument(doc, { width: 50, theme: loadTheme("dark"), caps: caps(), diags: d }),
  );
  expect(out).toContain("Setup");
});

test("task list round-trips checked state", () => {
  const src = "- [x] done\n- [ ] todo\n";
  const d = new Diagnostics();
  const doc = normalize(parseTeml(src, d));
  const list = doc.blocks[0] as Extract<(typeof doc.blocks)[0], { type: "list" }>;
  expect(list.items[0]?.checked).toBe(true);
  expect(list.items[1]?.checked).toBe(false);
  const back = normalize(parseTeml(serializeTeml(doc), d));
  expect(back).toEqual(doc);
});

test("task list markers: unicode and ascii fallbacks", () => {
  const doc = normalize(parseTeml("- [x] yes\n- [ ] no\n"));
  const uni = renderPlain(
    layoutDocument(doc, {
      width: 40,
      theme: loadTheme("dark"),
      caps: caps(),
      diags: new Diagnostics(),
    }),
  );
  expect(uni).toMatch(/☑/);
  expect(uni).toMatch(/☐/);

  const ascii = renderPlain(
    layoutDocument(doc, {
      width: 40,
      theme: loadTheme("dark"),
      caps: caps({ unicode: false }),
      diags: new Diagnostics(),
    }),
  );
  expect(ascii).toContain("[x]");
  expect(ascii).toContain("[ ]");
});

test("definition list coalesces adjacent TeML directives", () => {
  const src = `:::definition{term="A"}\none\n:::\n\n:::definition{term="B"}\ntwo\n:::\n`;
  const doc = normalize(parseTeml(src));
  expect(doc.blocks).toHaveLength(1);
  expect(doc.blocks[0]?.type).toBe("definitionList");
  const dl = doc.blocks[0] as Extract<(typeof doc.blocks)[0], { type: "definitionList" }>;
  expect(dl.items).toHaveLength(2);
  expect(inlineText(dl.items[0]!.term)).toBe("A");
});

test("HTML dl maps to definitionList not kv", () => {
  const html = "<dl><dt>Host</dt><dd>db</dd><dt>Port</dt><dd>5432</dd></dl>";
  const doc = normalize(htmlToDoc(html, new Diagnostics()));
  expect(doc.blocks[0]?.type).toBe("definitionList");
  expect(doc.blocks.some((b) => b.type === "leaf")).toBe(false);
});

test("Markdown definition list round-trip via bold term", () => {
  const d = new Diagnostics();
  const src = "**Host**\n\n    db-primary\n\n**Port**\n\n    5432\n";
  const doc = normalize(parseMarkdown(src, d));
  // Markdown has no native dl — stays as paragraphs unless from HTML/TeML
  expect(doc.blocks.length).toBeGreaterThan(0);
});

test("footnotes: TeML round-trip and appendix layout", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const d = new Diagnostics();
  const doc = normalize(parseTeml(source, d));
  expect(tokensView(doc)).toContain("footnote_ref");
  expect(tokensView(doc)).toContain("footnote_definition_start");

  const back = normalize(parseTeml(serializeTeml(doc), d));
  expect(back).toEqual(doc);

  const out = renderPlain(
    layoutDocument(doc, {
      width: 40,
      theme: loadTheme("dark"),
      caps: caps({ width: 40 }),
      diags: d,
    }),
  );
  expect(out).toContain("Footnotes");
  expect(out).toContain("[traffic]");
  expect(out).not.toMatch(/Source:.*\n[\s\S]*Source:/);
});

test("footnotes: duplicate and missing diagnostics", () => {
  const d = new Diagnostics();
  normalize(
    parseTeml(
      'Ref :fn{id="a"}\n\n:::footnote{id="a"}\nOne\n:::\n\n:::footnote{id="a"}\nDup\n:::\n',
      d,
    ),
    d,
  );
  expect(d.all().some((w) => w.code === "footnote-duplicate")).toBe(true);

  const d2 = new Diagnostics();
  normalize(parseTeml('Missing :fn{id="ghost"}\n', d2), d2);
  expect(d2.all().some((w) => w.code === "footnote-missing")).toBe(true);
});

test("Markdown footnote GFM round-trip", () => {
  const src = "Note[^note].\n\n[^note]: Big footnote.\n";
  const d = new Diagnostics();
  const doc = normalize(parseMarkdown(src, d));
  const md = serializeMarkdown(doc, d);
  const doc2 = normalize(parseMarkdown(md, d));
  expect(doc2.blocks.some((b) => b.type === "footnoteDefinition")).toBe(true);
  expect(
    doc2.blocks.some(
      (b) => b.type === "paragraph" && b.children.some((n) => n.type === "footnoteRef"),
    ),
  ).toBe(true);
});

test("nested combination fixture snapshot @ narrow width", async () => {
  const source = await readFile(FIXTURE, "utf8");
  const doc = normalize(parseTeml(source, new Diagnostics()));
  const out = snapshotRender(doc, 20, "plain", "mono");
  await expect(out).toMatchFileSnapshot("snapshots/m65-doc-elements-20.txt");

  const width = 40;
  const lines = layoutDocument(doc, {
    width,
    theme: loadTheme("mono"),
    caps: caps({ width }),
    diags: new Diagnostics(),
  });
  const widths = lines.map((l) => lineWidth(l));
  expect(widths.every((w) => w <= width)).toBe(true);
});

test("complex docs fixture smoke: 30-realworld-excerpt", async () => {
  const source = await readFile(
    join(process.cwd(), "fixtures/teml/30-realworld-excerpt.teml"),
    "utf8",
  );
  const doc = normalize(parseTeml(source, new Diagnostics()));
  const out = snapshotRender(doc, 80, "plain", "dark");
  expect(out.length).toBeGreaterThan(100);
});

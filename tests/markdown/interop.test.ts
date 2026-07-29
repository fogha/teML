import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, inlineText, normalize } from "../../src/core/index.js";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { serializeMarkdown } from "../../src/markdown/serialize.js";
import { parseTeml } from "../../src/teml/parse.js";
import { sanitizeText } from "../../src/core/sanitize.js";
import { parseGuardBudgetMs } from "../budget.js";

const MD_DIR = join(process.cwd(), "fixtures/markdown");

test("Markdown hostile: unsafe links and controls stripped", async () => {
  const source = await readFile(join(MD_DIR, "09-hostile.md"), "utf8");
  const d = new Diagnostics();
  const doc = normalize(parseMarkdown(source, d));
  const dump = JSON.stringify(doc);
  expect(dump).not.toContain("javascript:");
  expect(dump).not.toMatch(/\\u001b/);
  expect(d.all().some((w) => w.code === "link-dropped")).toBe(true);
});

test("Markdown serialize: deterministic output has no control chars", async () => {
  const source = await readFile(join(MD_DIR, "10-kitchen-sink.md"), "utf8");
  const d = new Diagnostics();
  const doc = normalize(parseMarkdown(source));
  const out = serializeMarkdown(doc, d);
  expect(out).toBe(serializeMarkdown(doc, new Diagnostics()));
  for (const ch of out) {
    const c = ch.charCodeAt(0);
    expect(c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)).toBe(true);
  }
});

test("TeML→Markdown: alert degraded to labeled blockquote", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(":::warning\ncareful\n:::\n", d));
  const md = serializeMarkdown(doc, d);
  expect(md).toContain("> **WARNING:**");
  expect(md).toContain("> careful");
  expect(d.all().some((w) => w.code === "markdown-lossy-conversion")).toBe(true);
});

test("TeML→Markdown: card degraded to heading and body", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(':::card{title="Card"}\nBody line\n:::\n', d));
  const md = serializeMarkdown(doc, d);
  expect(md).toContain("## Card");
  expect(md).toContain("Body line");
  expect(d.all().some((w) => w.message.includes("card container"))).toBe(true);
});

test("TeML→Markdown: kv leaf degraded to GFM table", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml('::kv{Key="value"}\n', d));
  const md = serializeMarkdown(doc, d);
  expect(md).toContain("| Key | Value |");
  expect(md).toContain("| Key | value |");
  expect(d.all().some((w) => w.message.includes("kv leaf"))).toBe(true);
});

test("TeML→Markdown: image leaf safe and unsafe", () => {
  const d1 = new Diagnostics();
  const safe = normalize(parseTeml('::image{src="https://x.dev/a.png" alt="Logo"}\n', d1));
  expect(serializeMarkdown(safe, d1)).toContain("![Logo](https://x.dev/a.png)");

  const d2 = new Diagnostics();
  const unsafe = normalize(parseTeml('::image{src="javascript:evil()" alt="X"}\n', d2));
  const md = serializeMarkdown(unsafe, d2);
  expect(md).toContain("[Image: X]");
  expect(md).not.toContain("javascript:");
  expect(d2.all().some((w) => w.message.includes("unsafe or missing src"))).toBe(true);
});

test("TeML→Markdown: break leaf and kbd span", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml("Line :kbd[Ctrl+C]\n\n::break\n", d));
  const md = serializeMarkdown(doc, d);
  expect(md).toContain("`Ctrl+C`");
  expect(md).toContain("---");
});

test("TeML→Markdown: custom span role degrades to plain text", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml(":status[deploy]{role=custom}\n", d));
  const md = serializeMarkdown(doc, d);
  expect(md).toContain("deploy");
  expect(md).not.toContain(":status");
  expect(d.all().some((w) => w.message.includes("custom span role"))).toBe(true);
});

test("TeML→Markdown→TeML: content-stable after degradation", () => {
  const d = new Diagnostics();
  const src = `:::card{title="Ops"}\n:success[ok] detail\n:::\n\n::kv{Env="prod"}\n`;
  const doc1 = normalize(parseTeml(src, d));
  const md = serializeMarkdown(doc1, d);
  const doc2 = normalize(parseMarkdown(md, d));
  expect(
    inlineText(
      doc2.blocks.flatMap((b) => ("children" in b && b.type === "paragraph" ? b.children : [])),
    ),
  ).toContain("ok");
  expect(JSON.stringify(doc2)).toContain("Ops");
  expect(doc2.blocks.some((b) => b.type === "table")).toBe(true);
});

test("Markdown link href safety rechecked on serialize", () => {
  const d = new Diagnostics();
  const doc: ReturnType<typeof normalize> = normalize({
    meta: {},
    blocks: [
      {
        type: "paragraph",
        children: [
          { type: "link", href: "https://ok.dev", children: [{ type: "text", value: "ok" }] },
        ],
      },
    ],
  });
  expect(serializeMarkdown(doc, d)).toContain("(https://ok.dev)");

  const docBad = normalize({
    meta: {},
    blocks: [
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            href: sanitizeText("https://ok.dev"),
            children: [{ type: "text", value: "x" }],
          },
        ],
      },
    ],
  });
  // Force unsafe href past normalize by constructing directly
  docBad.blocks[0] = {
    type: "paragraph",
    children: [
      { type: "link", href: "javascript:alert(1)", children: [{ type: "text", value: "x" }] },
    ],
  };
  const d2 = new Diagnostics();
  const out = serializeMarkdown(docBad, d2);
  expect(out).not.toContain("javascript:");
  expect(d2.all().some((w) => w.code === "link-dropped")).toBe(true);
});

test("plain Markdown with pathologically deep list nesting degrades instead of hanging", () => {
  // Plain .md files go through remark-parse without remark-directive, so
  // this is a distinct, format-agnostic attack from the TeML container-fence
  // one: a chain of one-item-per-level nested lists costs O(depth) per line
  // in remark's list-continuation check with no `:::` syntax involved.
  let src = "";
  for (let i = 0; i < 800; i++) src += "  ".repeat(i) + "- x\n";
  const d = new Diagnostics();
  const t0 = Date.now();
  const doc = parseMarkdown(src, d);
  expect(Date.now() - t0).toBeLessThan(parseGuardBudgetMs(2000));
  expect(d.has("pathological-nesting-rejected")).toBe(true);
  expect(doc.blocks).toEqual([{ type: "codeBlock", value: src }]);
});

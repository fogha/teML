import { test, expect } from "vitest";
import { Diagnostics, inlineText, normalize } from "../src/core/index.js";
import type { Block } from "../src/core/ast.js";
import { cellWidth, truncateToWidth } from "../src/layout/measure.js";
import { wrapSpans } from "../src/layout/wrap.js";
import { parseTeml, parseInline } from "../src/teml/parse.js";
import { serializeTeml } from "../src/teml/serialize.js";
import { htmlToDoc } from "../src/html/convert.js";
import { layoutDocument } from "../src/layout/layout.js";
import { renderPlain } from "../src/render/plain.js";
import { renderAnsi } from "../src/render/ansi.js";
import { loadTheme } from "../src/terminal/theme.js";
import type { Capabilities } from "../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 60,
  ambiguousWide: false,
};
const opts = () => ({ width: 60, theme: loadTheme("dark"), caps, diags: new Diagnostics() });

// ---- measure (R-5) ----------------------------------------------------------

test("cellWidth: ascii, cjk, combining", () => {
  expect(cellWidth("abc")).toBe(3);
  expect(cellWidth("你好")).toBe(4);
  expect(cellWidth("café")).toBe(4);
  expect(cellWidth("cafe\u0301")).toBe(4);
});

test("truncateToWidth never splits a wide char", () => {
  expect(cellWidth(truncateToWidth("你好世界", 5))).toBe(5);
});

// ---- wrap (R-6) ---------------------------------------------------------------

test("wrap: style survives line breaks", () => {
  const lines = wrapSpans([{ text: "aaa bbbbbbbb ccc", style: { bold: true } }], 8);
  expect(lines.length).toBeGreaterThanOrEqual(2);
  for (const line of lines)
    for (const s of line) if (s.text.trim()) expect(s.style.bold).toBe(true);
});

test("wrap: overlong word hard-breaks", () => {
  const lines = wrapSpans([{ text: "x".repeat(25), style: {} }], 10);
  expect(lines.length).toBe(3);
});

// ---- parser (F-series) --------------------------------------------------------

test("parse: kitchen sink structure", () => {
  const d = new Diagnostics();
  const doc = parseTeml(
    `---\ntitle: T\n---\n\n# H\n\npara with **bold** and :success[ok]\n\n:::card{title="S"}\n- a\n- b\n:::\n\n::kv{K="v"}\n`,
    d,
  );
  expect(doc.meta.title).toBe("T");
  expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "container", "leaf"]);
  const card = doc.blocks[2] as Extract<Block, { type: "container" }>;
  expect(card.attrs.title).toBe("S");
  expect(card.children[0]?.type).toBe("list");
});

test("parse: nested containers via colon count", () => {
  const doc = parseTeml(`::::card{title="Outer"}\n:::warning\ninner\n:::\n::::\n`);
  const card = doc.blocks[0] as Extract<Block, { type: "container" }>;
  expect(card.name).toBe("card");
  const inner = card.children[0] as Extract<Block, { type: "container" }>;
  expect(inner.name).toBe("warning");
});

test("parse: unknown directives degrade with warning (F-3)", () => {
  const d = new Diagnostics();
  parseTeml(`:::mystery\nhi\n:::\n`, d);
  expect(d.all().some((w) => w.code === "unknown-directive")).toBe(true);
});

test("parse: heading clamp", () => {
  const d = new Diagnostics();
  const doc = parseTeml("##### deep\n", d);
  expect((doc.blocks[0] as Extract<Block, { type: "heading" }>).level).toBe(4);
  expect(d.all().some((w) => w.code === "heading-clamped")).toBe(true);
});

test("inline: escapes and unsafe links", () => {
  const d = new Diagnostics();
  const nodes = parseInline("\\:success[nope] [x](javascript:alert(1))", d);
  expect(inlineText(nodes)).toBe(":success[nope] x");
  expect(d.all().some((w) => w.code === "link-dropped")).toBe(true);
});

// ---- round-trip (M4) ------------------------------------------------------------

test("round-trip is AST-stable", () => {
  const src = `# Title\n\npara **bold** \`c\` [l](https://x.dev) :error[bad]\n\n:::card{title="S"}\n- one\n- two\n:::\n`;
  const a1 = normalize(parseTeml(src));
  const a2 = normalize(parseTeml(serializeTeml(a1)));
  expect(a2).toEqual(a1);
});

// ---- HTML conversion (H-1) --------------------------------------------------------

test("html: semantic mapping + hostile content neutralized", () => {
  const d = new Diagnostics();
  const html = `<title>T</title><h1>H</h1><p>x <span class="text-success">ok</span></p>
    <div class="card"><h2>C</h2><p>body</p></div>
    <div class="alert alert-warning">careful</div>
    <script>alert(1)</script>
    <a href="javascript:evil()">bad</a>
    <p>esc \x1b[31m here</p>`;
  const doc = normalize(htmlToDoc(html, d));
  expect(doc.meta.title).toBe("T");
  const types = doc.blocks.map((b) => b.type + ("name" in b ? ":" + b.name : ""));
  expect(types.includes("container:card")).toBe(true);
  expect(types.includes("container:warning")).toBe(true);
  const dump = JSON.stringify(doc);
  expect(dump.includes("alert(1)")).toBe(false);
  expect(dump.includes("\\u001b")).toBe(false);
  const card = doc.blocks.find(
    (b): b is Extract<Block, { type: "container" }> => b.type === "container" && b.name === "card",
  );
  expect(card?.attrs.title).toBe("C");
});

// ---- single-emitter invariant (S-2) ------------------------------------------------

test("SECURITY: no foreign ESC ever reaches output", () => {
  const hostile = `# T\x1b[2J\n\nhi \x1b]0;pwned\x07 there [l](https://x.dev)\n\n\`\`\`\ncode \x1b[31m red\n\`\`\`\n\n:::card{title="a\x1b[9999Hb"}\nbody\n:::\n`;
  const doc = normalize(parseTeml(hostile, new Diagnostics()));
  const o = opts();
  const lines = layoutDocument(doc, o);
  const plain = renderPlain(lines);
  for (const ch of plain) {
    const c = ch.charCodeAt(0);
    expect(c === 10 || c >= 32).toBe(true);
  }
  const ansi = renderAnsi(lines, caps);
  for (let i = 0; i < ansi.length; i++) {
    if (ansi[i] === "\x1b") {
      const next = ansi.slice(i + 1, i + 3);
      expect(next.startsWith("[") || next.startsWith("]8") || next.startsWith("\\")).toBe(true);
    }
  }
});

// ---- layout smoke ------------------------------------------------------------------

test("layout: card borders align with CJK content", () => {
  const doc = parseTeml(`:::card{title="宽"}\n你好世界 and ascii mixed content here\n:::\n`);
  const o = opts();
  const lines = layoutDocument(normalize(doc), o);
  const widths = lines.map((l) => l.reduce((w, s) => w + cellWidth(s.text), 0));
  expect(widths.every((w) => w === widths[0])).toBe(true);
});

test("layout: exactly one blank line between top-level blocks", () => {
  const doc = parseTeml("# A\n\npara one\n\npara two\n");
  const out = renderPlain(layoutDocument(normalize(doc), opts()));
  expect(/\n\n\n/.test(out)).toBe(false);
});

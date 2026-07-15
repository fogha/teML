import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Align, Block, Inline, Meta, TDoc } from "../../src/core/ast.js";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { serializeTeml } from "../../src/teml/serialize.js";
import { isShorthandInlineRole } from "../../src/teml/directives.js";

const FIXTURES_DIR = join(process.cwd(), "fixtures/teml");

async function temlFixtures(): Promise<string[]> {
  return (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith(".teml"))
    .sort()
    .map((f) => join(FIXTURES_DIR, f));
}

for (const file of await temlFixtures()) {
  const base = file.split("/").pop()!;
  test(`TeML round-trip AST-stable: ${base}`, async () => {
    const source = await readFile(file, "utf8");
    const ast1 = normalize(parseTeml(source, new Diagnostics()));
    const ast2 = normalize(parseTeml(serializeTeml(ast1), new Diagnostics()));
    expect(ast2).toEqual(ast1);
  });
}

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)]!;
}

function randText(rng: () => number): string {
  const alphabet = "abc *_[]:`{}#|\\:<>&\n\t";
  const len = 1 + Math.floor(rng() * 12);
  let out = "";
  for (let i = 0; i < len; i++) out += pick(rng, [...alphabet, ..."xyz012"]);
  return out.replace(/\x00/g, "");
}

function genInline(rng: () => number, depth: number): Inline {
  const kind = Math.floor(rng() * 9);
  if (depth <= 0 || kind === 0) return { type: "text", value: randText(rng) };
  switch (kind) {
    case 1:
      return { type: "bold", children: [genInline(rng, depth - 1)] };
    case 2:
      return { type: "italic", children: [genInline(rng, depth - 1)] };
    case 3:
      return { type: "strike", children: [genInline(rng, depth - 1)] };
    case 4:
      return { type: "code", value: randText(rng) };
    case 5:
      return {
        type: "link",
        href: rng() > 0.5 ? "https://example.com/p" : "/docs",
        children: [genInline(rng, 0)],
      };
    case 6: {
      const role = pick(rng, [
        "success",
        "warning",
        "error",
        "info",
        "muted",
        "highlight",
        "kbd",
        "custom",
      ]);
      if (isShorthandInlineRole(role)) return { type: "span", role, children: [genInline(rng, 0)] };
      return { type: "span", role, children: [genInline(rng, 0)] };
    }
    default:
      return { type: "text", value: randText(rng) };
  }
}

function genInlines(rng: () => number): Inline[] {
  const n = 1 + Math.floor(rng() * 3);
  return Array.from({ length: n }, () => genInline(rng, 2));
}

function genBlock(rng: () => number, depth: number): Block {
  const kind = Math.floor(rng() * 10);
  switch (kind) {
    case 0:
      return {
        type: "heading",
        level: pick(rng, [1, 2, 3, 4] as const),
        children: genInlines(rng),
      };
    case 1:
      return { type: "paragraph", children: genInlines(rng) };
    case 2:
      return { type: "thematicBreak" };
    case 3:
      return {
        type: "codeBlock",
        language: rng() > 0.5 ? "js" : undefined,
        value: randText(rng) + (rng() > 0.7 ? "\n`tick``" : ""),
      };
    case 4:
      return {
        type: "list",
        ordered: rng() > 0.5,
        start: 1 + Math.floor(rng() * 3),
        items: [
          { blocks: [genBlock(rng, depth - 1)] },
          { blocks: [genBlock(rng, depth - 1), genBlock(rng, depth - 1)] },
        ],
      };
    case 5:
      return { type: "quote", children: [genBlock(rng, depth - 1)] };
    case 6: {
      const align: Align[] = ["left", "center", "right", null];
      return {
        type: "table",
        align: [pick(rng, align), pick(rng, align)],
        rows: [
          { header: true, cells: [genInlines(rng), genInlines(rng)] },
          { header: false, cells: [genInlines(rng), genInlines(rng)] },
        ],
      };
    }
    case 7: {
      const name = pick(rng, ["card", "info", "warning", "note"]);
      const attrs = name === "card" ? { title: randText(rng) } : {};
      const children =
        depth > 0 ? [genBlock(rng, depth - 1), genBlock(rng, depth - 1)] : [genBlock(rng, 0)];
      return { type: "container", name, attrs, children };
    }
    case 8: {
      const name = pick(rng, ["kv", "image", "break"]);
      if (name === "kv") {
        return {
          type: "leaf",
          name,
          attrs: { [randText(rng).replace(/\s/g, "_") || "K"]: randText(rng) },
        };
      }
      if (name === "image") {
        return {
          type: "leaf",
          name,
          attrs: { src: "https://example.com/x.png", alt: randText(rng) },
        };
      }
      return { type: "leaf", name: "break", attrs: {} };
    }
    default:
      return { type: "paragraph", children: genInlines(rng) };
  }
}

function genMeta(rng: () => number): Meta {
  if (rng() > 0.7) return {};
  return {
    title: randText(rng),
    theme: pick(rng, ["dark", "mono", "auto"]),
    lang: rng() > 0.5 ? "en" : undefined,
    roles: rng() > 0.5 ? { accent: { fg: "brightCyan", bold: true } } : undefined,
  };
}

function genDoc(rng: () => number): TDoc {
  const blocks = Array.from({ length: 1 + Math.floor(rng() * 4) }, () => genBlock(rng, 2));
  return { meta: genMeta(rng), blocks };
}

test("TeML round-trip fuzz: 200 seeded valid ASTs", () => {
  const rng = seededRng(0x4d34);
  for (let i = 0; i < 200; i++) {
    const ast1 = normalize(genDoc(rng));
    const ast2 = normalize(parseTeml(serializeTeml(ast1), new Diagnostics()));
    expect(ast2, `iteration ${i}`).toEqual(ast1);
  }
});

test("serializeTeml: frontmatter includes lang and roles", () => {
  const doc: TDoc = {
    meta: {
      title: "T",
      lang: "en",
      roles: { accent: { fg: "brightCyan", bold: true } },
    },
    blocks: [{ type: "paragraph", children: [{ type: "text", value: "hi" }] }],
  };
  const out = serializeTeml(doc);
  expect(out.startsWith("---\n")).toBe(true);
  expect(out).toContain("lang: en");
  expect(out).toContain("roles:");
  expect(out).toContain("accent:");
});

test("serializeTeml: nested container fence depth", () => {
  const doc = normalize(parseTeml(`::::card{title="Outer"}\n:::warning\ninner\n:::\n::::\n`));
  const out = serializeTeml(doc);
  expect(out).toMatch(/^::::card/m);
  expect(out).toContain(":::warning");
});

test("serializeTeml: table alignment separators", async () => {
  const doc = normalize(parseTeml(await readFile(join(FIXTURES_DIR, "09-tables.teml"), "utf8")));
  const out = serializeTeml(doc);
  expect(out).toContain(":---");
  expect(out).toContain(":---:");
  expect(out).toContain("---:");
});

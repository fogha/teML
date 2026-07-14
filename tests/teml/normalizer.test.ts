import { test, expect } from "vitest";
import { normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";

test("normalize: merges adjacent text nodes", () => {
  const doc = normalize(parseTeml("Hello **bold** world"));
  const para = doc.blocks[0];
  expect(para.type).toBe("paragraph");
  if (para.type !== "paragraph") return;
  const texts = para.children.filter((n) => n.type === "text");
  expect(texts).toHaveLength(2);
});

test("normalize: drops whitespace-only paragraphs", () => {
  const doc = normalize(parseTeml("# Title\n\n   \n\nBody"));
  expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph"]);
});

test("normalize: trims outer inline whitespace", () => {
  const doc = normalize(parseTeml("  spaced  "));
  const para = doc.blocks[0];
  if (para.type !== "paragraph") return;
  expect(para.children[0]).toEqual({ type: "text", value: "spaced" });
});

test("normalize: hoists heading into untitled card", () => {
  const doc = normalize(parseTeml(`:::card\n## Card title\n\nBody\n:::\n`));
  const card = doc.blocks[0];
  expect(card.type).toBe("container");
  if (card.type !== "container") return;
  expect(card.attrs.title).toBe("Card title");
  expect(card.children[0]?.type).toBe("paragraph");
});

test("normalize: unwraps unknown single-child container", () => {
  const doc = normalize(parseTeml(`:::mystery\n\nSingle paragraph inside.\n\n:::\n`));
  expect(doc.blocks).toHaveLength(1);
  expect(doc.blocks[0].type).toBe("paragraph");
});

test("normalize: keeps known directive even with single child", () => {
  const doc = normalize(parseTeml(`:::warning\n\nOnly one block.\n\n:::\n`));
  expect(doc.blocks[0].type).toBe("container");
  if (doc.blocks[0].type === "container") expect(doc.blocks[0].name).toBe("warning");
});

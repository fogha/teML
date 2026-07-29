import { test, expect } from "vitest";
import { normalize } from "../../src/core/index.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
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

test("normalize: radio options and defaults are deterministic", () => {
  const diags = new Diagnostics();
  const doc = normalize(
    parseTeml(
      `:::radio{id="plan" value="missing"}
::option{value="free" label="Free"}
::option{value="free" label="Duplicate"}
::option{label="Missing"}
:::
`,
      diags,
    ),
    diags,
  );
  const radio = doc.blocks[0];
  expect(radio).toMatchObject({
    type: "container",
    attrs: { id: "plan" },
    children: [{ type: "leaf", attrs: { value: "free", label: "Free" } }],
  });
  expect(diags.has("radio-duplicate-value")).toBe(true);
  expect(diags.has("radio-option-missing-value")).toBe(true);
  expect(diags.has("radio-invalid-default")).toBe(true);
});

test("normalize: nested controls in scroll regions become static", () => {
  const diags = new Diagnostics();
  const doc = normalize(
    parseTeml(
      `:::scroll{id="logs" rows=3}
::button{id="nested" label="Nested"}
:::
`,
      diags,
    ),
    diags,
  );
  const scroll = doc.blocks[0];
  expect(scroll.type).toBe("container");
  if (scroll.type !== "container") return;
  expect(scroll.children[0]).toMatchObject({
    type: "leaf",
    attrs: { label: "Nested" },
  });
  if (scroll.children[0]?.type === "leaf") {
    expect(scroll.children[0].attrs.id).toBeUndefined();
  }
  expect(diags.has("scroll-nested-widget")).toBe(true);
});

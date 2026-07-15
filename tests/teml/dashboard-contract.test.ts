import { test, expect } from "vitest";
import { Diagnostics, inlineText, normalize, tokensView } from "../../src/core/index.js";
import { renderTokensView } from "../../src/core/renderTokensView.js";
import { parseInline, parseTeml } from "../../src/teml/parse.js";
import { serializeTeml } from "../../src/teml/serialize.js";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { serializeMarkdown } from "../../src/markdown/serialize.js";
import {
  DIRECTIVE_REGISTRY,
  isKnownContainer,
  isKnownLeaf,
  isShorthandInlineRole,
} from "../../src/teml/directives.js";
import { inlineToSpans } from "../../src/layout/inline.js";
import { loadTheme, validateThemeShape } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps = (): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 80,
  ambiguousWide: false,
});

test("directive registry: dashboard containers and leaf attrs", () => {
  expect(DIRECTIVE_REGISTRY.containers.grid.attrs).toEqual(["columns", "gap"]);
  expect(DIRECTIVE_REGISTRY.containers.details.attrs).toEqual(["summary", "open"]);
  expect(DIRECTIVE_REGISTRY.containers.figure.attrs).toEqual(["caption"]);
  expect(DIRECTIVE_REGISTRY.leafs.metric.attrs).toEqual(["label", "value", "role", "change"]);
  expect(DIRECTIVE_REGISTRY.leafs.progress.attrs).toEqual(["label", "value", "max", "role"]);
  expect(DIRECTIVE_REGISTRY.leafs.event.attrs).toEqual(["time", "title", "detail", "role"]);
  expect(isShorthandInlineRole("highlight")).toBe(true);
});

test("parse: new container and leaf directives preserve attrs", () => {
  const src = [
    ':::grid{columns="2" gap="1"}',
    "cell",
    ":::",
    "",
    '::metric{label="CPU" value="72%" role="warning" change="+4%"}',
    "",
    '::progress{label="Disk" value="92" max="100" role="error"}',
    "",
    '::event{time="09:15" title="Deploy" detail="prod" role="info"}',
    "",
    ':::details{summary="More" open="true"}',
    "hidden",
    ":::",
    "",
    ':::figure{caption="Chart"}',
    "body",
    ":::",
  ].join("\n");

  const doc = normalize(parseTeml(src));
  const grid = doc.blocks.find((b) => b.type === "container" && b.name === "grid");
  expect(grid?.type).toBe("container");
  if (grid?.type === "container") {
    expect(grid.attrs).toEqual({ columns: "2", gap: "1" });
  }

  const leaves = doc.blocks.filter((b) => b.type === "leaf");
  expect(leaves.map((b) => (b.type === "leaf" ? b.name : ""))).toEqual([
    "metric",
    "progress",
    "event",
  ]);
  expect((leaves[0] as { attrs: Record<string, string> }).attrs.label).toBe("CPU");
  expect((leaves[1] as { attrs: Record<string, string> }).attrs.max).toBe("100");
  expect((leaves[2] as { attrs: Record<string, string> }).attrs.time).toBe("09:15");

  const details = doc.blocks.find((b) => b.type === "container" && b.name === "details");
  expect(details?.type).toBe("container");
  if (details?.type === "container") {
    expect(details.attrs).toEqual({ summary: "More", open: "true" });
  }

  const figure = doc.blocks.find((b) => b.type === "container" && b.name === "figure");
  expect(figure?.type).toBe("container");
  if (figure?.type === "container") {
    expect(figure.attrs.caption).toBe("Chart");
  }

  expect(isKnownContainer("grid")).toBe(true);
  expect(isKnownLeaf("metric")).toBe(true);
});

test("parse: GFM strikethrough maps to strike without unsupported-node warning", () => {
  const d = new Diagnostics();
  const doc = normalize(parseTeml("~~removed~~ and **kept**", d));
  expect(d.all().some((w) => w.code === "unsupported-node")).toBe(false);

  const para = doc.blocks[0];
  expect(para?.type).toBe("paragraph");
  if (para?.type !== "paragraph") return;

  const strike = para.children.find((n) => n.type === "strike");
  expect(strike?.type).toBe("strike");
  if (strike?.type === "strike") {
    expect(inlineText(strike.children)).toBe("removed");
  }
  expect(inlineText(para.children)).toBe("removed and kept");
});

test("parseInline: nested strike preserves inner inline nodes", () => {
  const d = new Diagnostics();
  const nodes = parseInline("~~**bold** strike~~", d);
  expect(nodes).toEqual([
    {
      type: "strike",
      children: [
        { type: "bold", children: [{ type: "text", value: "bold" }] },
        { type: "text", value: " strike" },
      ],
    },
  ]);
});

test("TeML round-trip: strike and highlight shorthand", () => {
  const src = "~~old~~ :highlight[new]\n";
  const d = new Diagnostics();
  const doc1 = normalize(parseTeml(src, d));
  const out = serializeTeml(doc1);
  expect(out).toContain("~~old~~");
  expect(out).toContain(":highlight[new]");
  const doc2 = normalize(parseTeml(out, d));
  expect(doc2).toEqual(doc1);
});

test("Markdown round-trip: GFM strike stable", () => {
  const src = "Ship ~~legacy~~ path.\n";
  const d = new Diagnostics();
  const doc1 = normalize(parseMarkdown(src, d));
  const md = serializeMarkdown(doc1, d);
  expect(md).toContain("~~legacy~~");
  const doc2 = normalize(parseMarkdown(md, d));
  expect(doc2).toEqual(doc1);
  expect(d.all().some((w) => w.code === "unsupported-node")).toBe(false);
});

test("frontmatter roles: strike parsed and serialized", () => {
  const src = `---
title: Strike roles
roles:
  deprecated:
    fg: brightBlack
    strike: true
---
Body
`;
  const d = new Diagnostics();
  const doc1 = normalize(parseTeml(src, d));
  expect(doc1.meta.roles?.deprecated).toEqual({ fg: "brightBlack", strike: true });
  expect(
    d
      .all()
      .some((w) => w.code === "frontmatter-ignored-key" && String(w.message).includes("strike")),
  ).toBe(false);

  const out = serializeTeml(doc1);
  expect(out).toContain("strike: true");
  const doc2 = normalize(parseTeml(out, d));
  expect(doc2.meta.roles?.deprecated?.strike).toBe(true);
});

test("tokensView: strike and highlight role meta", () => {
  const view = tokensView(
    normalize(
      parseTeml(`---
roles:
  mark:
    bg: "#334455"
    strike: true
---
:highlight[term] ~~gone~~
`),
    ),
  );
  expect(view).toContain("strike_start");
  expect(view).toContain("strike_end");
  expect(view).toContain('span_start role="highlight"');
  expect(view).toContain("strike=true");
});

test("renderTokensView and inlineToSpans: strike style bit", () => {
  const theme = loadTheme("dark");
  const spans = inlineToSpans([{ type: "strike", children: [{ type: "text", value: "x" }] }], {
    theme,
    caps: caps(),
    diags: new Diagnostics(),
  });
  expect(spans[0]?.style.strike).toBe(true);

  const rendered = renderTokensView([[{ text: "x", style: { strike: true } }]]);
  expect(rendered).toContain("strike=true");
});

test("validateThemeShape accepts strike style key", () => {
  const d = new Diagnostics();
  const theme = validateThemeShape(
    {
      name: "strike-theme",
      roles: {
        heading1: {},
        heading2: {},
        heading3: {},
        heading4: {},
        success: {},
        warning: {},
        error: {},
        info: {},
        muted: {},
        highlight: { fg: "yellow" },
        border: {},
        link: {},
        code: {},
        codeBlock: {},
        quote: {},
        listMarker: {},
        kbd: {},
        cardTitle: {},
        deprecated: { strike: true },
      },
      decorations: {
        success: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "✓", labelAscii: "[OK]" },
        warning: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "⚠", labelAscii: "[WARN]" },
        error: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "✗", labelAscii: "[FAIL]" },
        info: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "ℹ", labelAscii: "[INFO]" },
      },
    },
    d,
  );
  expect(theme?.roles.deprecated.strike).toBe(true);
  expect(theme?.roles.highlight.fg).toBe("yellow");
  expect(
    d.all().some((w) => w.code === "theme-ignored-key" && String(w.message).includes("strike")),
  ).toBe(false);
});

test("built-in themes define highlight role", () => {
  for (const name of ["dark", "light", "mono", "auto"] as const) {
    const theme = loadTheme(name);
    expect(theme.roles.highlight).toBeDefined();
  }
});

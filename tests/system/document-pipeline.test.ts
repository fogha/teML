import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { expect, test } from "vitest";
import { Diagnostics, normalize, type TDoc } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { cellWidth } from "../../src/layout/measure.js";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { serializeMarkdown } from "../../src/markdown/serialize.js";
import { renderAnsi } from "../../src/render/ansi.js";
import { renderPlain } from "../../src/render/plain.js";
import { parseTeml } from "../../src/teml/parse.js";
import { serializeTeml } from "../../src/teml/serialize.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { assertNoForeignEsc, runCli } from "./harness.js";

async function fixtures(directory: string, extension: string): Promise<string[]> {
  const root = join(process.cwd(), directory);
  return (await readdir(root))
    .filter((file) => file.endsWith(extension))
    .sort()
    .map((file) => join(root, file));
}

function renderThroughTerminalPipeline(document: TDoc, context: string): void {
  for (const width of [20, 40, 80, 120]) {
    for (const themeName of ["dark", "light", "mono", "auto"]) {
      const diags = new Diagnostics();
      const caps: Capabilities = {
        colors: themeName === "mono" ? "none" : "truecolor",
        unicode: true,
        hyperlinks: false,
        width,
        ambiguousWide: false,
        showUrls: true,
      };
      const options = {
        width,
        theme: loadTheme(themeName, diags),
        caps,
        diags,
        showUrls: true,
      };
      const lines = layoutDocument(document, options);
      const plain = renderPlain(lines);
      const ansi = renderAnsi(lines, caps);
      expect(plain.length, context).toBeGreaterThan(0);
      expect(
        renderPlain(layoutDocument(document, { ...options, diags: new Diagnostics() })),
        context,
      ).toBe(plain);
      expect(
        plain
          .replace(/\n$/, "")
          .split("\n")
          .every((line) => cellWidth(line) <= width),
        context,
      ).toBe(true);
      expect(plain, context).not.toContain("\x1b");
      assertNoForeignEsc(ansi);
    }
  }

  const asciiDiags = new Diagnostics();
  const asciiCaps: Capabilities = {
    colors: "none",
    unicode: false,
    hyperlinks: false,
    width: 80,
    ambiguousWide: false,
    showUrls: true,
  };
  const ascii = renderPlain(
    layoutDocument(document, {
      width: 80,
      theme: loadTheme("mono", asciiDiags),
      caps: asciiCaps,
      diags: asciiDiags,
      showUrls: true,
    }),
  );
  expect(ascii.length, context).toBeGreaterThan(0);
  expect(ascii, context).not.toContain("\x1b");
}

function plainAt(document: TDoc, width = 80): string {
  const diags = new Diagnostics();
  const caps: Capabilities = {
    colors: "none",
    unicode: true,
    hyperlinks: false,
    width,
    ambiguousWide: false,
    showUrls: true,
  };
  return renderPlain(
    layoutDocument(document, {
      width,
      theme: loadTheme("mono", diags),
      caps,
      diags,
      showUrls: true,
    }),
  );
}

test("the complete TeML corpus round-trips and renders through the terminal pipeline", async () => {
  const files = await fixtures("fixtures/teml", ".teml");
  expect(files.length).toBeGreaterThanOrEqual(30);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const first = normalize(parseTeml(source, new Diagnostics()));
    const second = normalize(parseTeml(serializeTeml(first), new Diagnostics()));
    expect(second, file).toEqual(first);
    renderThroughTerminalPipeline(first, file);
  }
}, 60_000);

test("the complete Markdown corpus survives Markdown and TeML conversion before rendering", async () => {
  const files = await fixtures("fixtures/markdown", ".md");
  expect(files.length).toBeGreaterThanOrEqual(10);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const first = normalize(parseMarkdown(source, new Diagnostics()));
    const markdown = serializeMarkdown(first, new Diagnostics());
    const fromMarkdown = normalize(parseMarkdown(markdown, new Diagnostics()));
    const teml = serializeTeml(first);
    const fromTeml = normalize(parseTeml(teml, new Diagnostics()));
    const backToMarkdown = normalize(
      parseMarkdown(serializeMarkdown(fromTeml, new Diagnostics()), new Diagnostics()),
    );
    expect(fromMarkdown, `${file}: Markdown round-trip`).toEqual(first);
    expect(fromTeml, `${file}: TeML conversion`).toEqual(first);
    expect(backToMarkdown, `${file}: TeML to Markdown conversion`).toEqual(first);
    renderThroughTerminalPipeline(fromTeml, file);
  }
}, 60_000);

test("the complete HTML corpus converts to stable TeML and renders without active content", async () => {
  const files = await fixtures("fixtures/html", ".html");
  expect(files.length).toBeGreaterThanOrEqual(20);

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const first = normalize(htmlToDoc(source, new Diagnostics()));
    const fromTeml = normalize(parseTeml(serializeTeml(first), new Diagnostics()));
    const before = plainAt(first);
    const after = plainAt(fromTeml);
    const semanticText = (text: string): string =>
      text
        .replace(/\\\\(x1b|x07)/g, "\\$1")
        .replace(/\s+/g, " ")
        .trim();
    expect(semanticText(after), file).toBe(semanticText(before));
    if (["03-bootstrap.html", "10-dl-kv.html", "12-code-blocks.html"].includes(basename(file))) {
      expect(fromTeml, file).toEqual(first);
    }
    expect(JSON.stringify(first), file).not.toContain("\\u001b");
    renderThroughTerminalPipeline(fromTeml, file);
  }
}, 60_000);

test("real documentation pages also work through the built CLI boundary", () => {
  for (const page of ["04-realpage.html", "20-mdn-excerpt.html", "21-node-docs-excerpt.html"]) {
    const result = runCli([
      "view",
      join(process.cwd(), "fixtures/html", page),
      "--width",
      "80",
      "--no-color",
    ]);
    expect(result.status, page).toBe(0);
    expect(result.stdout.length, page).toBeGreaterThan(100);
    expect(result.stdout.split("\n").length, page).toBeGreaterThan(5);
    expect(result.stdout, page).not.toContain("\x1b");
  }
});

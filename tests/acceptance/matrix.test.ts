import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { htmlToDoc } from "../../src/html/index.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { renderPlain } from "../../src/render/plain.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const WIDTHS = [20, 40, 80, 120] as const;
type ThemeMode = "dark" | "light" | "mono" | "auto";

function capsFor(mode: ThemeMode, width: number, ascii: boolean, noColor: boolean): Capabilities {
  return {
    colors: noColor ? "none" : "truecolor",
    unicode: !ascii,
    hyperlinks: false,
    width,
    ambiguousWide: false,
    showUrls: true,
  };
}

async function listFixtures(dir: string, ext: string): Promise<string[]> {
  return (await readdir(join(process.cwd(), dir))).filter((f) => f.endsWith(ext)).sort();
}

async function loadDoc(kind: "teml" | "markdown" | "html", path: string) {
  const source = await readFile(path, "utf8");
  const diags = new Diagnostics();
  if (kind === "teml") return normalize(parseTeml(source, diags));
  if (kind === "markdown") return normalize(parseMarkdown(source, diags));
  return normalize(htmlToDoc(source, diags));
}

function assertNoForeignEsc(text: string): void {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\x1b") {
      const next = text.slice(i + 1, i + 3);
      expect(next.startsWith("[") || next.startsWith("]8") || next.startsWith("\\")).toBe(true);
    }
  }
}

const corpus = [
  { kind: "teml" as const, dir: "fixtures/teml", ext: ".teml", min: 30 },
  { kind: "html" as const, dir: "fixtures/html", ext: ".html", min: 20 },
  { kind: "markdown" as const, dir: "fixtures/markdown", ext: ".md", min: 10 },
];

for (const { kind, dir, ext, min } of corpus) {
  test(`${kind} fixture count >= ${min}`, async () => {
    const files = await listFixtures(dir, ext);
    expect(files.length).toBeGreaterThanOrEqual(min);
  });

  test(`${kind} acceptance matrix invariants`, async () => {
    const files = await listFixtures(dir, ext);
    const modes: ThemeMode[] = ["dark", "light", "mono", "auto"];
    for (const file of files) {
      const doc = await loadDoc(kind, join(process.cwd(), dir, file));
      for (const width of WIDTHS) {
        for (const themeName of modes) {
          const diags = new Diagnostics();
          const theme = loadTheme(themeName, diags);
          const caps = capsFor(themeName, width, false, true);
          const lines = layoutDocument(doc, {
            width,
            theme,
            caps,
            diags,
            showUrls: !caps.hyperlinks,
          });
          const plain = renderPlain(lines);
          expect(plain.length).toBeGreaterThan(0);
          assertNoForeignEsc(plain);
          const again = renderPlain(
            layoutDocument(doc, {
              width,
              theme,
              caps,
              diags: new Diagnostics(),
              showUrls: !caps.hyperlinks,
            }),
          );
          expect(again).toBe(plain);
        }
      }
      for (const variant of [
        { ascii: true, noColor: true, label: "ascii" },
        { ascii: false, noColor: true, label: "no-color" },
      ]) {
        const diags = new Diagnostics();
        const theme = loadTheme("dark", diags);
        const caps = capsFor("dark", 80, variant.ascii, variant.noColor);
        const plain = renderPlain(
          layoutDocument(doc, { width: 80, theme, caps, diags, showUrls: !caps.hyperlinks }),
        );
        expect(plain.length).toBeGreaterThan(0);
        expect(plain.includes("\x1b")).toBe(false);
      }
    }
  }, 60_000);
}

test("offline real documentation HTML fixtures render readably", async () => {
  const CLI = join(process.cwd(), "dist/cli/main.js");
  const pages = ["04-realpage.html", "20-mdn-excerpt.html", "21-node-docs-excerpt.html"];
  for (const page of pages) {
    const file = join(process.cwd(), "fixtures/html", page);
    const out = execFileSync("node", [CLI, "view", file, "--width", "80", "--no-color"], {
      encoding: "utf8",
    });
    expect(out.length).toBeGreaterThan(100);
    expect(out.includes("\x1b")).toBe(false);
    expect(out.split("\n").length).toBeGreaterThan(5);
  }
});

import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { normalize } from "../../src/core/index.js";
import { Diagnostics } from "../../src/core/diagnostics.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { renderAnsi } from "../../src/render/ansi.js";
import { renderPlain } from "../../src/render/plain.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "truecolor",
  unicode: true,
  hyperlinks: true,
  width: 80,
  ambiguousWide: false,
};

async function adversarialFixtures(): Promise<string[]> {
  const dirs = [
    join(process.cwd(), "fixtures/adversarial"),
    join(process.cwd(), "fixtures/html"),
  ];
  const files: string[] = [];
  for (const dir of dirs) {
    for (const f of await readdir(dir)) {
      if (f.endsWith(".teml")) files.push(join(dir, f));
      if (dir.endsWith("/html") && f.endsWith(".html") && f.includes("hostile")) {
        files.push(join(dir, f));
      }
    }
  }
  return files;
}

async function loadFixtureSource(file: string): Promise<{ doc: ReturnType<typeof normalize> }> {
  const source = await readFile(file, "utf8");
  if (file.endsWith(".html")) {
    const { htmlToDoc } = await import("../../src/html/index.js");
    return { doc: normalize(htmlToDoc(source, new Diagnostics())) };
  }
  return { doc: normalize(parseTeml(source, new Diagnostics())) };
}

test("S-2: adversarial fixtures produce safe plain output", async () => {
  for (const file of await adversarialFixtures()) {
    const { doc } = await loadFixtureSource(file);
    const lines = layoutDocument(doc, { width: 80, theme: loadTheme("dark"), caps, diags: new Diagnostics() });
    const plain = renderPlain(lines);
    for (const ch of plain) {
      const c = ch.charCodeAt(0);
      expect(c === 10 || c >= 32, `${file} had control char ${c}`).toBe(true);
    }
  }
});

test("S-2: adversarial fixtures only emit our ESC sequences", async () => {
  for (const file of await adversarialFixtures()) {
    const { doc } = await loadFixtureSource(file);
    const lines = layoutDocument(doc, { width: 80, theme: loadTheme("dark"), caps, diags: new Diagnostics() });
    const ansi = renderAnsi(lines, caps);
    for (let i = 0; i < ansi.length; i++) {
      if (ansi[i] === "\x1b") {
        const next = ansi.slice(i + 1, i + 3);
        expect(next.startsWith("[") || next.startsWith("]8") || next.startsWith("\\"), file).toBe(true);
      }
    }
  }
});

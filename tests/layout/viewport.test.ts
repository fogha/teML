import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { cellWidth } from "../../src/layout/measure.js";
import { parseTeml } from "../../src/teml/parse.js";
import { renderAnsi } from "../../src/render/ansi.js";
import { renderPlain } from "../../src/render/plain.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";
import { snapshotRender } from "../snapshot.js";

const FIXTURES_DIR = join(process.cwd(), "fixtures/teml");
const WIDTHS = [20, 40, 80, 120] as const;

function caps(width: number, over: Partial<Capabilities> = {}): Capabilities {
  return {
    colors: "truecolor",
    unicode: true,
    hyperlinks: false,
    width,
    ambiguousWide: false,
    ...over,
  };
}

async function fixtureFiles(): Promise<string[]> {
  return (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith(".teml"))
    .sort()
    .map((f) => join(FIXTURES_DIR, f));
}

function assertLinesFitWidth(text: string, width: number): void {
  const m = { ambiguousWide: false };
  for (const line of text.split("\n")) {
    expect(cellWidth(line, m)).toBeLessThanOrEqual(width);
  }
}

for (const width of WIDTHS) {
  test(`every fixture physical line ≤ width ${width}`, async () => {
    for (const file of await fixtureFiles()) {
      const source = await readFile(file, "utf8");
      const doc = normalize(parseTeml(source, new Diagnostics()));
      const out = snapshotRender(doc, width, "plain", "mono");
      assertLinesFitWidth(out, width);
    }
  });
}

test("kitchen sink ansi snapshot @ 80 byte-exact", async () => {
  const source = await readFile(join(FIXTURES_DIR, "10-kitchen-sink.teml"), "utf8");
  const doc = normalize(parseTeml(source, new Diagnostics()));
  const lines = layoutDocument(doc, {
    width: 80,
    theme: loadTheme("dark"),
    caps: caps(80),
    diags: new Diagnostics(),
  });
  const out = renderAnsi(lines, caps(80));
  await expect(out).toMatchFileSnapshot("../teml/snapshots/fixtures/10-kitchen-sink-ansi-80.txt");
});

test("wrap-code wraps instead of truncating", () => {
  const d = normalize(parseTeml("```js\nconst x = 'hello world long line';\n```\n"));
  const diags = new Diagnostics();
  const wrapped = renderPlain(
    layoutDocument(d, {
      width: 20,
      theme: loadTheme("dark"),
      caps: caps(20),
      diags,
      wrapCode: true,
    }),
  );
  expect(diags.all().some((w) => w.code === "code-truncated")).toBe(false);
  expect(wrapped.split("\n").length).toBeGreaterThan(3);
});

test("code truncates with diagnostic by default", () => {
  const d = normalize(parseTeml("```\n" + "x".repeat(40) + "\n```\n"));
  const diags = new Diagnostics();
  renderPlain(layoutDocument(d, { width: 20, theme: loadTheme("dark"), caps: caps(20), diags }));
  expect(diags.all().some((w) => w.code === "code-truncated")).toBe(true);
});

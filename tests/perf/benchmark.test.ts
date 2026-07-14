import { test, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Diagnostics, normalize, type Block, type TDoc } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { layoutDocument } from "../../src/layout/layout.js";
import { renderPlain } from "../../src/render/plain.js";
import { loadTheme } from "../../src/terminal/theme.js";
import { readVersion } from "../../src/cli/version.js";

const CLI = join(process.cwd(), "dist/cli/main.js");

function buildLargeSource(blocks: number): string {
  const parts: string[] = ["---\ntitle: Perf\n---\n\n"];
  for (let i = 0; i < blocks; i++) {
    parts.push(`Paragraph ${i} with **bold** text.\n\n`);
  }
  return parts.join("");
}

function buildLargeDoc(blocks: number): TDoc {
  const body: Block[] = [];
  for (let i = 0; i < blocks; i++) {
    body.push({
      type: "paragraph",
      children: [{ type: "text", value: `Paragraph ${i} with plain text.` }],
    });
  }
  return { meta: { title: "Perf" }, blocks: body };
}

test("1000-block layout+render median < 100ms", () => {
  const doc = buildLargeDoc(1000);
  const caps = {
    colors: "none" as const,
    unicode: true,
    hyperlinks: false,
    width: 80,
    ambiguousWide: false,
  };
  for (let w = 0; w < 5; w++) {
    renderPlain(
      layoutDocument(doc, {
        width: 80,
        theme: loadTheme("mono"),
        caps,
        diags: new Diagnostics(),
      }),
    );
  }
  const samples: number[] = [];
  for (let i = 0; i < 11; i++) {
    const t0 = performance.now();
    const lines = layoutDocument(doc, {
      width: 80,
      theme: loadTheme("mono"),
      caps,
      diags: new Diagnostics(),
    });
    renderPlain(lines);
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  console.log(`perf: 1000-block layout+render median=${median.toFixed(2)}ms`);
  expect(median).toBeLessThan(100);
});

test("1000-block parse+layout+render median < 100ms", () => {
  const source = buildLargeSource(1000);
  for (let w = 0; w < 2; w++) {
    normalize(parseTeml(source, new Diagnostics()));
  }
  const samples: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = performance.now();
    const doc = normalize(parseTeml(source, new Diagnostics()));
    const caps = {
      colors: "none" as const,
      unicode: true,
      hyperlinks: false,
      width: 80,
      ambiguousWide: false,
    };
    renderPlain(
      layoutDocument(doc, {
        width: 80,
        theme: loadTheme("mono"),
        caps,
        diags: new Diagnostics(),
      }),
    );
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  console.log(
    `perf: 1000-block parse+layout+render median=${median.toFixed(2)}ms`,
  );
  expect(median).toBeLessThan(100);
});

test("CLI --version adds < 15ms over host Node startup", () => {
  const paired: number[] = [];
  for (let i = 0; i < 7; i++) {
    const baseT0 = performance.now();
    execFileSync("node", ["-e", ""], { encoding: "utf8" });
    const baseMs = performance.now() - baseT0;

    const cliT0 = performance.now();
    execFileSync("node", [CLI, "--version"], { encoding: "utf8" });
    const cliMs = performance.now() - cliT0;

    paired.push(cliMs - baseMs);
  }
  paired.sort((a, b) => a - b);
  const overhead = paired[Math.floor(paired.length / 2)]!;
  console.log(`perf: --version paired-overhead median=${overhead.toFixed(2)}ms (${paired.length} interleaved pairs)`);
  expect(overhead).toBeLessThan(15);
});

test("readVersion() hot path < 5ms", () => {
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now();
    readVersion();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  console.log(`perf: readVersion() median=${median.toFixed(3)}ms`);
  expect(median).toBeLessThan(5);
});

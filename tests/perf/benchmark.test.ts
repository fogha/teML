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
import { ReaderSession } from "../../src/reader/session.js";
import { diffFrames, type ScreenFrame } from "../../src/render/screen.js";
import { InteractiveSession } from "../../src/interactive/session.js";
import type { PatchFrame } from "../../src/interactive/protocol.js";

const CLI = join(process.cwd(), "dist/cli/main.js");
const layoutPerfBudgetMs = (() => {
  const configured = Number(process.env.TEML_LAYOUT_PERF_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 100;
})();
const parsePerfBudgetMs = (() => {
  const configured = Number(process.env.TEML_PARSE_PERF_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 100;
})();
const scrollRegionPerfBudgetMs = (() => {
  const configured = Number(process.env.TEML_SCROLL_REGION_PERF_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 16;
})();
const appendPerfBudgetMs = (() => {
  const configured = Number(process.env.TEML_APPEND_PERF_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 50;
})();

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

test(`1000-block layout+render median < ${layoutPerfBudgetMs}ms`, () => {
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
  expect(median).toBeLessThan(layoutPerfBudgetMs);
});

test(`1000-block parse+layout+render median < ${parsePerfBudgetMs}ms`, () => {
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
  console.log(`perf: 1000-block parse+layout+render median=${median.toFixed(2)}ms`);
  expect(median).toBeLessThan(parsePerfBudgetMs);
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
  console.log(
    `perf: --version paired-overhead median=${overhead.toFixed(2)}ms (${paired.length} interleaved pairs)`,
  );
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

test("10,000-line Reader navigation stays viewport-bounded", () => {
  const lines = Array.from({ length: 10_000 }, (_, row) => [{ text: `Line ${row}`, style: {} }]);
  const reader = new ReaderSession({
    rootPath: process.cwd(),
    currentPath: join(process.cwd(), "large.teml"),
    title: "Large",
    detailed: { lines, links: [], headings: [] },
    viewport: { cols: 80, rows: 24, statusRows: 1 },
    caps: {
      colors: "none",
      unicode: true,
      hyperlinks: false,
      width: 80,
      ambiguousWide: false,
    },
  });
  let previous = (reader.start()[0] as { type: "frame"; frame: ScreenFrame }).frame;
  const samples: number[] = [];
  let maxChangedRows = 0;
  for (let i = 0; i < 100; i++) {
    const started = performance.now();
    const frame = (
      reader.handle({ type: "key", key: "down" })[0] as {
        type: "frame";
        frame: typeof previous;
      }
    ).frame;
    samples.push(performance.now() - started);
    maxChangedRows = Math.max(
      maxChangedRows,
      diffFrames(previous, frame).filter((operation) => operation.type === "row").length,
    );
    previous = frame;
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  console.log(
    `perf: 10k Reader input-to-frame median=${median.toFixed(3)}ms, changedRows<=${maxChangedRows}`,
  );
  expect(median).toBeLessThan(10);
  expect(maxChangedRows).toBeLessThanOrEqual(24);
});

test("10,000-line interactive keystrokes stay below 5ms p95 and viewport-bounded", () => {
  const doc = buildLargeDoc(9_999);
  doc.blocks.unshift({
    type: "leaf",
    name: "input",
    attrs: { id: "query", label: "Query", value: "abcdef" },
  });
  const caps = {
    colors: "none" as const,
    unicode: true,
    hyperlinks: false,
    width: 80,
    ambiguousWide: false,
  };
  const session = new InteractiveSession(doc, {
    diags: new Diagnostics(),
    layout: {
      width: 80,
      height: 24,
      theme: loadTheme("mono"),
      caps,
    },
  });
  session.start();
  session.handle({ type: "configure", frames: "plain", mode: "patches" });

  const samples: number[] = [];
  let maxChangedRows = 0;
  const keys = ["left", "pageDown", "right", "pageUp"] as const;
  for (let index = 0; index < 100; index++) {
    const started = performance.now();
    const frame = session.handle({
      type: "key",
      key: keys[index % keys.length]!,
    })[0] as PatchFrame;
    samples.push(performance.now() - started);
    maxChangedRows = Math.max(maxChangedRows, frame.patches.length);
    expect(frame.viewport?.height).toBe(24);
    expect(frame.rows).toBe(24);
  }

  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor((samples.length - 1) * 0.95)]!;
  console.log(
    `perf: 10k interactive key-to-frame p95=${p95.toFixed(3)}ms, changedRows<=${maxChangedRows}`,
  );
  expect(p95).toBeLessThan(5);
  expect(maxChangedRows).toBeLessThanOrEqual(24);
});

test(`10,000-block scroll-region movement stays below ${scrollRegionPerfBudgetMs}ms p95 and region-bounded`, () => {
  const children = buildLargeDoc(10_000).blocks;
  const doc: TDoc = {
    meta: {},
    blocks: [
      {
        type: "container",
        name: "scroll",
        attrs: { id: "logs", rows: "10" },
        children,
      },
    ],
  };
  const caps = {
    colors: "none" as const,
    unicode: true,
    hyperlinks: false,
    width: 80,
    ambiguousWide: false,
  };
  const session = new InteractiveSession(doc, {
    diags: new Diagnostics(),
    frames: "plain",
    mode: "patches",
    layout: {
      width: 80,
      height: 24,
      theme: loadTheme("mono"),
      caps,
    },
  });
  session.start();

  const samples: number[] = [];
  let maxChangedRows = 0;
  for (let index = 0; index < 100; index++) {
    const started = performance.now();
    const frame = session.handle({ type: "scroll", rows: 1 })[0] as PatchFrame;
    samples.push(performance.now() - started);
    maxChangedRows = Math.max(maxChangedRows, frame.patches.length);
    expect(frame.scrollRegions?.[0]?.height).toBe(10);
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor((samples.length - 1) * 0.95)]!;
  console.log(
    `perf: 10k scroll-region input-to-frame p95=${p95.toFixed(3)}ms, changedRows<=${maxChangedRows}`,
  );
  expect(p95).toBeLessThan(scrollRegionPerfBudgetMs);
  expect(maxChangedRows).toBeLessThanOrEqual(12);
});

test(`bounded 10Hz log append stays below ${appendPerfBudgetMs}ms p95 and region-bounded`, () => {
  const children = buildLargeDoc(1_000).blocks;
  const doc: TDoc = {
    meta: {},
    blocks: [
      {
        type: "container",
        name: "scroll",
        attrs: { id: "logs", rows: "9" },
        children,
      },
    ],
  };
  const caps = {
    colors: "none" as const,
    unicode: true,
    hyperlinks: false,
    width: 80,
    ambiguousWide: false,
  };
  const session = new InteractiveSession(doc, {
    diags: new Diagnostics(),
    frames: "plain",
    mode: "patches",
    layout: {
      width: 80,
      height: 24,
      theme: loadTheme("mono"),
      caps,
    },
  });
  session.start();

  const samples: number[] = [];
  let maxChangedRows = 0;
  let finalTotal = 0;
  for (let index = 0; index < 100; index++) {
    const started = performance.now();
    const event = session.handle({
      type: "append",
      target: "logs",
      markup: `Log ${1_000 + index}`,
    })[0]!;
    samples.push(performance.now() - started);
    expect(event.type).toBe("frame");
    expect("patches" in event).toBe(true);
    const frame = event as PatchFrame;
    maxChangedRows = Math.max(maxChangedRows, frame.patches.length);
    finalTotal = frame.scrollRegions?.[0]?.total ?? 0;
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.floor((samples.length - 1) * 0.95)]!;
  console.log(
    `perf: bounded log append p95=${p95.toFixed(3)}ms, changedRows<=${maxChangedRows}, total=${finalTotal}`,
  );
  expect(p95).toBeLessThan(appendPerfBudgetMs);
  expect(maxChangedRows).toBeLessThanOrEqual(12);
  expect(finalTotal).toBeGreaterThan(1_000);
});

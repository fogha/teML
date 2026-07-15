import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Diagnostics, normalize, tokensView } from "../../src/core/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { snapshotRender } from "../snapshot.js";

const FIXTURES_DIR = join(process.cwd(), "fixtures/teml");
const WIDTHS = [20, 40, 80, 120] as const;

async function fixtureFiles(): Promise<string[]> {
  return (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith(".teml"))
    .sort()
    .map((f) => join(FIXTURES_DIR, f));
}

for (const width of WIDTHS) {
  test(`fixture plain snapshots @ width ${width}`, async () => {
    for (const file of await fixtureFiles()) {
      const base = file.replace(`${FIXTURES_DIR}/`, "").replace(/\.teml$/, "");
      const source = await readFile(file, "utf8");
      const doc = normalize(parseTeml(source, new Diagnostics()));
      const out = snapshotRender(doc, width, "plain", "mono");
      // mono uses hyperlinks:false → show-urls fallback for link fixtures
      await expect(out).toMatchFileSnapshot(`snapshots/fixtures/${base}-${width}.txt`);
    }
  });
}

test("cli inspect --tokens on kitchen sink", async () => {
  const file = join(FIXTURES_DIR, "10-kitchen-sink.teml");
  const out = execFileSync("node", ["dist/cli/main.js", "inspect", file, "--tokens"], {
    encoding: "utf8",
  });
  expect(out).toContain("document_start");
  expect(out).toContain("heading_start level=1");
  expect(out).toContain("container_start");
});

test("tokensView matches inspect --tokens", async () => {
  const source = await readFile(join(FIXTURES_DIR, "06-inline-spans.teml"), "utf8");
  const doc = normalize(parseTeml(source));
  expect(tokensView(doc)).toContain('span_start role="success"');
});

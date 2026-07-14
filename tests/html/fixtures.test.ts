import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { serializeTeml } from "../../src/teml/serialize.js";
import { snapshotRender } from "../snapshot.js";

const FIXTURES_DIR = join(process.cwd(), "fixtures/html");
const CLI = join(process.cwd(), "dist/cli/main.js");
const SNAPSHOT_FIXTURES = ["01-elements", "02-messy", "03-bootstrap", "04-realpage", "05-table-spans"];

async function htmlFixtures(): Promise<string[]> {
  return (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((f) => join(FIXTURES_DIR, f));
}

for (const base of SNAPSHOT_FIXTURES) {
  test(`HTML AST snapshot: ${base}`, async () => {
    const source = await readFile(join(FIXTURES_DIR, `${base}.html`), "utf8");
    const doc = normalize(htmlToDoc(source, new Diagnostics()));
    await expect(doc).toMatchFileSnapshot(`snapshots/ast/${base}.json`);
  });

  test(`HTML TeML output snapshot: ${base}`, async () => {
    const source = await readFile(join(FIXTURES_DIR, `${base}.html`), "utf8");
    const doc = normalize(htmlToDoc(source, new Diagnostics()));
    const teml = serializeTeml(doc);
    await expect(teml).toMatchFileSnapshot(`snapshots/teml/${base}.teml`);
  });

  test(`HTML rendered snapshot: ${base}`, async () => {
    const source = await readFile(join(FIXTURES_DIR, `${base}.html`), "utf8");
    const doc = normalize(htmlToDoc(source, new Diagnostics()));
    const out = snapshotRender(doc, 80, "plain", "mono");
    await expect(out).toMatchFileSnapshot(`snapshots/render/${base}-80.txt`);
  });
}

test("HTML fixtures count is at least 20", async () => {
  const files = await htmlFixtures();
  expect(files.length).toBeGreaterThanOrEqual(20);
});

test("CLI convert: html inference by extension", () => {
  const file = join(FIXTURES_DIR, "03-bootstrap.html");
  const out = execFileSync("node", [CLI, "convert", file, "--to", "teml"], { encoding: "utf8" });
  expect(out).toContain("# Service Overview");
  expect(out).toContain(":::card");
  expect(out).toContain(":::warning");
});

test("CLI convert: html with explicit profile", () => {
  const file = join(FIXTURES_DIR, "03-bootstrap.html");
  const out = execFileSync("node", [CLI, "convert", file, "--profile", "bootstrap", "--to", "teml"], {
    encoding: "utf8",
  });
  expect(out).toContain(":::warning");
});

test("CLI view: html file renders without error", () => {
  const file = join(FIXTURES_DIR, "22-demo-page.html");
  const out = execFileSync("node", [CLI, "view", file], { encoding: "utf8" });
  expect(out.length).toBeGreaterThan(20);
});

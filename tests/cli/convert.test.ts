import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { parseMarkdown } from "../../src/markdown/parse.js";
import { parseTeml } from "../../src/teml/parse.js";

const CLI = join(process.cwd(), "dist/cli/main.js");
const MD_FIXTURE = join(process.cwd(), "fixtures/markdown/10-kitchen-sink.md");
const TEML_FIXTURE = join(process.cwd(), "fixtures/teml/10-kitchen-sink.teml");

test("CLI convert: markdown → teml inference by extension", () => {
  const out = execFileSync("node", [CLI, "convert", MD_FIXTURE, "--to", "teml"], {
    encoding: "utf8",
  });
  expect(out).toContain("# Kitchen Sink");
  expect(out).not.toContain(":::");
});

test("CLI convert: explicit --from markdown --to json", () => {
  const out = execFileSync(
    "node",
    [CLI, "convert", MD_FIXTURE, "--from", "markdown", "--to", "json"],
    { encoding: "utf8" },
  );
  const json = JSON.parse(out);
  expect(json.blocks.length).toBeGreaterThan(3);
});

test("CLI convert: teml → markdown", () => {
  const out = execFileSync("node", [CLI, "convert", TEML_FIXTURE, "--to", "markdown"], {
    encoding: "utf8",
  });
  expect(out).toContain("# Kitchen Sink");
  expect(out).not.toContain(":::card");
});

test("CLI convert: teml → json", () => {
  const out = execFileSync("node", [CLI, "convert", TEML_FIXTURE, "--to", "json"], {
    encoding: "utf8",
  });
  expect(JSON.parse(out).meta.title).toBe("Kitchen Sink");
});

test("CLI view: markdown file renders without error", () => {
  const out = execFileSync("node", [CLI, "view", MD_FIXTURE], { encoding: "utf8" });
  expect(out.length).toBeGreaterThan(20);
});

test("CLI convert: markdown and teml produce equivalent AST", async () => {
  const mdSrc = await readFile(MD_FIXTURE, "utf8");
  const mdDoc = normalize(parseMarkdown(mdSrc, new Diagnostics()));
  const temlOut = execFileSync("node", [CLI, "convert", MD_FIXTURE, "--to", "teml"], {
    encoding: "utf8",
  });
  const temlDoc = normalize(parseTeml(temlOut, new Diagnostics()));
  const mdTypes = mdDoc.blocks.map((b) => b.type);
  const temlTypes = temlDoc.blocks.map((b) => b.type);
  expect(temlTypes[0]).toBe("heading");
  expect(temlTypes.filter((t) => t === "heading").length).toBe(mdTypes.filter((t) => t === "heading").length);
  expect(temlTypes.includes("table")).toBe(mdTypes.includes("table"));
  expect(temlTypes.includes("codeBlock")).toBe(true);
});

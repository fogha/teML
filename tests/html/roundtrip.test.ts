import { test, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { htmlToDoc } from "../../src/html/index.js";
import { parseTeml } from "../../src/teml/parse.js";
import { serializeTeml } from "../../src/teml/serialize.js";

const FIXTURES = join(process.cwd(), "fixtures/html");

const ROUNDTRIP_FIXTURES = ["03-bootstrap.html", "10-dl-kv.html", "12-code-blocks.html"];

for (const file of ROUNDTRIP_FIXTURES) {
  test(`HTML→TeML roundtrip AST-stable: ${file}`, async () => {
    const source = await readFile(join(FIXTURES, file), "utf8");
    const ast1 = normalize(htmlToDoc(source, new Diagnostics()));
    const teml = serializeTeml(ast1);
    const ast2 = normalize(parseTeml(teml, new Diagnostics()));
    expect(ast2).toEqual(ast1);
  });
}

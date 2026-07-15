import { test, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function walkTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walkTs(path)));
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

test("S-2: only render/ansi.ts may contain ESC literal", async () => {
  const root = join(process.cwd(), "src");
  const files = await walkTs(root);
  const esc = "\x1b";
  const offenders: string[] = [];
  for (const file of files) {
    if (file.endsWith("/render/ansi.ts")) continue;
    const text = await readFile(file, "utf8");
    if (text.includes(esc) || text.includes("\\x1b"))
      offenders.push(file.replace(process.cwd() + "/", ""));
  }
  expect(offenders).toEqual([]);
});

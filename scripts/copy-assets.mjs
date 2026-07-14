#!/usr/bin/env node
// Copy non-TypeScript assets into dist/ after tsc (themes, HTML profiles).

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const assetDirs = [
  ["src/terminal/themes", "dist/terminal/themes"],
  ["src/html/profiles", "dist/html/profiles"],
  ["docs", "dist/assets/docs"],
];

for (const [srcRel, destRel] of assetDirs) {
  const src = join(root, srcRel);
  if (!existsSync(src)) continue;
  const dest = join(root, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

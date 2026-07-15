#!/usr/bin/env node
// Copy non-TypeScript assets into dist/ after tsc (themes, HTML profiles).

import { chmodSync, cpSync, existsSync, mkdirSync } from "node:fs";
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

// tsc doesn't preserve/set the executable bit; npm's own install step usually
// handles this for `bin` entries, but setting it explicitly means `node
// dist/cli/main.js` and direct invocation work right after `npm run build`
// too, without depending on that install-time behavior.
const binPath = join(root, "dist/cli/main.js");
if (existsSync(binPath)) chmodSync(binPath, 0o755);

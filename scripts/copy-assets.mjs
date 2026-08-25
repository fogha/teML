#!/usr/bin/env node
// Copy non-TypeScript assets into dist/ after tsc.

import { chmodSync, cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const assetDirs = [["src/terminal/themes", "dist/terminal/themes"]];

const assetFiles = [
  ["src/html/profiles/bootstrap.json", "dist/html/profiles/bootstrap.json"],
  ["examples/markup/demo.teml", "dist/assets/demo.teml"],
  ["docs/spec.md", "dist/assets/docs/spec.md"],
  ["docs/cli.md", "dist/assets/docs/cli.md"],
  ["docs/reader.md", "dist/assets/docs/reader.md"],
  ["docs/interactive-protocol.md", "dist/assets/docs/interactive-protocol.md"],
  ["docs/theming.md", "dist/assets/docs/theming.md"],
  ["docs/tutorial.md", "dist/assets/docs/tutorial.md"],
  ["docs/host-porting-playbook.md", "dist/assets/docs/host-porting-playbook.md"],
  ["docs/polyglot-hosts.md", "dist/assets/docs/polyglot-hosts.md"],
  [
    "docs/adr/001-terminal-client-ownership.md",
    "dist/assets/docs/adr/001-terminal-client-ownership.md",
  ],
  [
    "docs/adr/002-read-command-and-mode-boundary.md",
    "dist/assets/docs/adr/002-read-command-and-mode-boundary.md",
  ],
  [
    "docs/adr/003-host-engine-distribution.md",
    "dist/assets/docs/adr/003-host-engine-distribution.md",
  ],
  [
    "docs/adr/004-native-engine-port-decision.md",
    "dist/assets/docs/adr/004-native-engine-port-decision.md",
  ],
];

for (const [srcRel, destRel] of assetDirs) {
  const src = join(root, srcRel);
  if (!existsSync(src)) continue;
  const dest = join(root, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
}

for (const [srcRel, destRel] of assetFiles) {
  const src = join(root, srcRel);
  const dest = join(root, destRel);
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest);
}

// tsc doesn't preserve/set the executable bit; pnpm's own install step usually
// handles this for `bin` entries, but setting it explicitly means `node
// dist/cli/main.js` and direct invocation work right after `pnpm run build`
// too, without depending on that install-time behavior.
const binPath = join(root, "dist/cli/main.js");
if (existsSync(binPath)) chmodSync(binPath, 0o755);

#!/usr/bin/env node
// Bundle dist/cli/main.js into a single CommonJS file for Node SEA injection.

import { join } from "node:path";
import * as esbuild from "esbuild";
import { ensureSeaDir, root, seaBundlePath } from "./lib.mjs";

ensureSeaDir();

await esbuild.build({
  entryPoints: [join(root, "dist/cli/main.js")],
  outfile: seaBundlePath(),
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  sourcemap: false,
  logLevel: "info",
  external: ["node:sea"],
  define: {
    "import.meta.url": "_temlImportMetaUrl",
  },
  banner: {
    js: 'const _temlImportMetaUrl = require("node:url").pathToFileURL(__filename).href;',
  },
});

console.log(`sea:bundle → ${seaBundlePath()}`);

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const builtCli = join(root, "dist", "cli", "main.js");
const sourceRoot = join(root, "src");

if (!existsSync(builtCli)) {
  fail("dist/cli/main.js is missing");
}

const builtAt = statSync(builtCli).mtimeMs;
let newestSource = { path: sourceRoot, mtimeMs: 0 };

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) scan(path);
    else {
      const mtimeMs = statSync(path).mtimeMs;
      if (mtimeMs > newestSource.mtimeMs) newestSource = { path, mtimeMs };
    }
  }
}

scan(sourceRoot);
if (newestSource.mtimeMs > builtAt) {
  fail(`${relative(root, newestSource.path)} is newer than the built CLI`);
}

function fail(reason) {
  process.stderr.write(`test prerequisite failed: ${reason}; run 'pnpm run build' first\n`);
  process.exit(1);
}

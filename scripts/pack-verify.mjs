#!/usr/bin/env node
// Verify npm pack contents and install smoke test in a clean temp directory.

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function run(cmd, cwd = root) {
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

console.log("pack-verify: building…");
run("npm run build", root);

console.log("pack-verify: dry-run…");
const dry = run("npm pack --dry-run 2>&1");
if (dry.includes("fixtures/") || dry.includes("tests/") || dry.includes("/src/")) {
  console.error("pack-verify: FAIL — tarball must not include src/tests/fixtures");
  process.exit(1);
}
if (!dry.includes("dist/terminal/themes/dark.json") && !dry.includes("terminal/themes/dark.json")) {
  console.error("pack-verify: FAIL — themes missing from pack listing");
  process.exit(1);
}

console.log("pack-verify: creating tarball…");
const packOut = run("npm pack 2>&1");
const tgz = packOut.trim().split("\n").pop().trim();
const tgzPath = join(root, tgz);

const tmp = mkdtempSync(join(tmpdir(), "teml-pack-"));
const proj = join(tmp, "consumer");
mkdirSync(proj);
cpSync(tgzPath, join(proj, tgz));

try {
  run(`npm init -y`, proj);
  run(`npm install ./${tgz}`, proj);
  const version = run(`npx --yes teml --version`, proj).trim();
  console.log(`pack-verify: npx teml --version → ${version}`);

  writeFileSync(
    join(proj, "verify-api.mjs"),
    "import { parseTeml, serializeTeml, layoutDocumentDetailed, renderSpeech } from 'teml';\n" +
      "const doc = parseTeml('# Public API\\n');\n" +
      "if (!serializeTeml(doc).includes('Public API')) process.exit(1);\n" +
      "if (typeof layoutDocumentDetailed !== 'function' || !renderSpeech(doc).includes('Heading level 1')) process.exit(1);\n",
  );
  run("node verify-api.mjs", proj);
  console.log("pack-verify: public library API present");

  writeFileSync(
    join(proj, "verify-interactive-api.mjs"),
    "import { runInteractiveApp } from 'teml/interactive';\n" +
      "if (typeof runInteractiveApp !== 'function') process.exit(1);\n",
  );
  run("node verify-interactive-api.mjs", proj);
  console.log("pack-verify: teml/interactive subpath export present");

  const demoPath = join(proj, "demo.teml");
  cpSync(join(root, "examples/demo.teml"), demoPath);
  const rendered = run(`npx --yes teml render ${demoPath} --width 80`, proj);
  if (!/deploy report/i.test(rendered)) {
    console.error("pack-verify: FAIL — external example render missing expected heading");
    process.exit(1);
  }

  const docsSpec = join(proj, "node_modules/teml/dist/assets/docs/spec.md");
  try {
    readFileSync(docsSpec, "utf8");
    console.log("pack-verify: bundled docs/spec.md present");
  } catch {
    console.error("pack-verify: FAIL — dist/assets/docs/spec.md missing from install");
    process.exit(1);
  }

  console.log("pack-verify: PASS");
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(tgzPath, { force: true });
  console.log("pack-verify: cleaned temp dir and tarball");
}

#!/usr/bin/env node
// Verify pnpm pack contents and install smoke test in a clean temp directory.

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// pnpm is a .cmd shim on Windows, which execFileSync cannot launch directly:
// without a shell the lookup fails with ENOENT, and naming pnpm.cmd explicitly
// fails with EINVAL because Node refuses to exec batch files. Going through a
// shell resolves the shim via PATHEXT on Windows and changes nothing elsewhere,
// at the cost of having to quote arguments that may contain spaces.
const shellArg = (value) => `"${value}"`;

function run(cmd, cwd = root) {
  return execSync(cmd, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
  });
}

console.log("pack-verify: building…");
run("pnpm run build", root);

const tmp = mkdtempSync(join(tmpdir(), "teml-pack-"));
const proj = join(tmp, "consumer");
const tgz = "teml.tgz";
const tgzPath = join(proj, tgz);
mkdirSync(proj);

try {
  console.log("pack-verify: creating tarball…");
  const packed = JSON.parse(
    execFileSync("pnpm", ["pack", "--json", "--out", shellArg(tgzPath)], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
    }),
  );
  if (
    typeof packed.filename !== "string" ||
    resolve(root, packed.filename) !== tgzPath ||
    !Array.isArray(packed.files)
  ) {
    throw new Error("pnpm pack did not report the expected tarball");
  }
  const packedFiles = packed.files.map((file) => file.path);
  if (
    packedFiles.some(
      (path) =>
        path.startsWith("fixtures/") || path.startsWith("tests/") || path.startsWith("src/"),
    )
  ) {
    throw new Error("pack-verify: FAIL — tarball must not include src/tests/fixtures");
  }
  if (!packedFiles.includes("dist/terminal/themes/dark.json")) {
    throw new Error("pack-verify: FAIL — themes missing from pack listing");
  }

  writeFileSync(join(proj, "package.json"), '{"private":true,"type":"module"}\n');
  run(`pnpm add ./${tgz}`, proj);
  const packageSpec = `file:${tgzPath}`;
  const version = run(`pnpx --package ${JSON.stringify(packageSpec)} teml --version`, proj).trim();
  console.log(`pack-verify: pnpx teml --version → ${version}`);

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
    "import { decodeCommand, runInteractiveApp } from 'teml/interactive';\n" +
      "if (typeof runInteractiveApp !== 'function' || !decodeCommand('{\"type\":\"exit\"}').ok) process.exit(1);\n",
  );
  run("node verify-interactive-api.mjs", proj);
  console.log("pack-verify: teml/interactive subpath export present");

  const protocolFixture = join(proj, "protocol.teml");
  writeFileSync(protocolFixture, '::input{id="name" label="Name"}\n');
  const protocolOut = execFileSync(
    process.execPath,
    [
      join(proj, "node_modules/teml/dist/cli/main.js"),
      "run",
      protocolFixture,
      "--frames",
      "plain",
      "--mode",
      "patches",
      "--height",
      "4",
    ],
    {
      cwd: proj,
      input: '{"type":"char","char":"A"}\n{"type":"exit"}\n',
      encoding: "utf8",
    },
  );
  const protocolEvents = protocolOut
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  if (
    protocolEvents[0]?.type !== "frame" ||
    protocolEvents[0]?.ansi !== null ||
    !protocolEvents.some((event) => event.type === "change" && event.value === "A") ||
    !protocolEvents.some((event) => Array.isArray(event.patches))
  ) {
    throw new Error("pack-verify: FAIL — installed interactive protocol smoke failed");
  }
  console.log("pack-verify: installed interactive protocol present");

  const rendered = run("pnpm exec teml demo --width 80 --no-color", proj);
  if (!/deploy report/i.test(rendered)) {
    throw new Error("pack-verify: FAIL — built-in demo render missing expected heading");
  }
  console.log("pack-verify: built-in demo present");

  const docsSpec = join(proj, "node_modules/teml/dist/assets/docs/spec.md");
  try {
    readFileSync(docsSpec, "utf8");
    console.log("pack-verify: bundled docs/spec.md present");
  } catch {
    throw new Error("pack-verify: FAIL — dist/assets/docs/spec.md missing from install");
  }

  // Every path here must exist in the repo, or the assertion passes vacuously.
  const packagedPlanningDocs = [join(proj, "node_modules/teml/dist/assets/docs/teml-prd.md")];
  if (packagedPlanningDocs.some(existsSync)) {
    throw new Error("pack-verify: FAIL — internal planning docs leaked into the package");
  }
  console.log("pack-verify: internal planning docs excluded");

  console.log("pack-verify: PASS");
} finally {
  rmSync(tmp, { recursive: true, force: true });
  console.log("pack-verify: cleaned temp dir and tarball");
}

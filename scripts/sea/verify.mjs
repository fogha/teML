#!/usr/bin/env node
// pack:verify-equivalent smoke suite for the SEA binary.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileSizeBytes, readJson, root, seaBinaryPath } from "./lib.mjs";

const binary = seaBinaryPath();
if (!existsSync(binary)) {
  console.error("sea:verify: missing binary — run pnpm run sea:build first");
  process.exit(1);
}

function run(args, opts = {}) {
  return execFileSync(binary, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 10 * 1024 * 1024,
    ...opts,
  });
}

const pkgVersion = readJson(join(root, "package.json")).version;
const version = run(["--version"]).trim();
if (version !== pkgVersion) {
  throw new Error(`sea:verify: version mismatch (got ${version}, expected ${pkgVersion})`);
}
console.log(`sea:verify: --version → ${version}`);

const demo = run(["demo", "--width", "80", "--no-color"]);
if (!/deploy report/i.test(demo)) {
  throw new Error("sea:verify: demo render missing expected heading");
}
console.log("sea:verify: demo render OK");

const convertFixture = join(root, "examples/demo.teml");
const converted = run(["convert", convertFixture, "--to", "markdown", "--no-color"]);
if (!converted.includes("#")) {
  throw new Error("sea:verify: convert to markdown failed");
}
console.log("sea:verify: convert OK");

const protocolFixture = join(root, ".sea", "protocol.teml");
writeFileSync(protocolFixture, '::input{id="name" label="Name"}\n');
const protocolOut = execFileSync(
  binary,
  ["run", protocolFixture, "--frames", "plain", "--mode", "patches", "--height", "4"],
  {
    cwd: root,
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
  throw new Error("sea:verify: interactive protocol smoke failed");
}
console.log("sea:verify: run NDJSON protocol OK");

const readSmoke = spawnSync(binary, ["read", convertFixture], {
  cwd: root,
  encoding: "utf8",
  stdio: ["pipe", "pipe", "pipe"],
});
if (readSmoke.status === 0) {
  throw new Error("sea:verify: read should fail without a TTY");
}
if (!/requires TTY/i.test(readSmoke.stderr)) {
  throw new Error(`sea:verify: read non-TTY message unexpected: ${readSmoke.stderr}`);
}
console.log("sea:verify: read non-TTY guard OK (manual TTY smoke documented in ADR 003)");

const metrics = {
  platform: `${process.platform}-${process.arch}`,
  node: process.version,
  binaryBytes: fileSizeBytes(binary),
  version,
};
writeFileSync(join(root, ".sea", "verify-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(`sea:verify: binary size ${metrics.binaryBytes} bytes`);
console.log("sea:verify: PASS");

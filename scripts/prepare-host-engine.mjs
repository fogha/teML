#!/usr/bin/env node
// Install the release tarball into a clean directory for host conformance.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tarball = join(root, "teml.tgz");
const installRoot = join(root, ".host-engine");
const cli = join(installRoot, "node_modules", "teml", "dist", "cli", "main.js");

if (!existsSync(tarball)) {
  throw new Error("host engine tarball is missing; run 'pnpm run release:pack' first");
}

rmSync(installRoot, { recursive: true, force: true });
mkdirSync(installRoot, { recursive: true });
writeFileSync(join(installRoot, "package.json"), '{"private":true}\n');

// --force because a `file:` dependency is keyed by its path: without it pnpm
// happily serves the copy it cached the last time this same teml.tgz path was
// installed, and the host conformance suites then run against a previous
// engine build. A clean CI runner never hits that; a developer's machine does.
//
// shell: true because pnpm is a .cmd shim on Windows, which execFileSync cannot
// launch directly — it fails with ENOENT unquoted and EINVAL when the shim is
// named, since Node refuses to exec batch files.
// --ignore-workspace keeps this throwaway install out of the committed
// lockfile. pnpm-workspace.yaml makes the repo root a workspace root, so
// without it pnpm walks up from .host-engine and records an integrity hash for
// a tarball that is rebuilt on every release:pack, dirtying the tree of anyone
// who runs the host suites.
const args = ["add", "--ignore-scripts", "--force", "--ignore-workspace", `"file:${tarball}"`];
execFileSync("pnpm", args, {
  cwd: installRoot,
  stdio: "inherit",
  shell: true,
});

if (!existsSync(cli)) {
  throw new Error(`installed host engine entry is missing: ${cli}`);
}

const version = execFileSync(process.execPath, [cli, "--version"], {
  cwd: installRoot,
  encoding: "utf8",
}).trim();

// The whole point of this directory is to test the engine that is about to be
// released, so a mismatch has to fail rather than be reported in passing.
const expected = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (version !== expected) {
  throw new Error(
    `installed host engine reports ${version} but the tarball is ${expected}; a cached copy was served`,
  );
}

if (process.env.GITHUB_ENV) {
  appendFileSync(process.env.GITHUB_ENV, `TEML_CLI=${cli}\n`);
}

process.stdout.write(`host engine: ${cli} (${version})\n`);

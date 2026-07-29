#!/usr/bin/env node
// Build the stable-name package attached to each GitHub Release.
//
// Users install this artifact directly from GitHub:
//   pnpm add --global \
//     https://github.com/fogha/teML/releases/latest/download/teml.tgz

import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const expectedTag = `v${manifest.version}`;
const releaseTag = process.env.GITHUB_REF_NAME || process.argv[2];

if (releaseTag && releaseTag !== expectedTag) {
  throw new Error(
    `release tag ${JSON.stringify(releaseTag)} does not match package version ${JSON.stringify(expectedTag)}`,
  );
}

const destination = join(root, "teml.tgz");
rmSync(destination, { force: true });

// pnpm is a .cmd shim on Windows, which execFileSync cannot launch directly:
// without a shell the lookup fails with ENOENT, and naming pnpm.cmd explicitly
// fails with EINVAL because Node refuses to exec batch files. A shell resolves
// the shim via PATHEXT and changes nothing elsewhere, so long as arguments that
// may contain spaces are quoted.
const output = execFileSync("pnpm", ["pack", "--json", "--out", `"${destination}"`], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
  shell: true,
});
const packed = JSON.parse(output);
if (typeof packed.filename !== "string" || resolve(root, packed.filename) !== destination) {
  throw new Error("pnpm pack did not report the expected tarball filename");
}

const bytes = statSync(destination).size;
process.stdout.write(
  `release-pack: ${expectedTag} -> teml.tgz (${(bytes / 1024).toFixed(1)} KiB)\n`,
);

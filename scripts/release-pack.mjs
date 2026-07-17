#!/usr/bin/env node
// Build the stable-name package attached to each GitHub Release.
//
// Users install this artifact directly from GitHub:
//   npm install --global \
//     https://github.com/fogha/teML/releases/latest/download/teml.tgz

import { execFileSync } from "node:child_process";
import { readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
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

const output = execFileSync("npm", ["pack", "--json"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const packed = JSON.parse(output);
const filename = packed[0]?.filename;
if (typeof filename !== "string" || !filename.endsWith(".tgz")) {
  throw new Error("npm pack did not report a tarball filename");
}

const source = join(root, filename);
const destination = join(root, "teml.tgz");
rmSync(destination, { force: true });
renameSync(source, destination);

const bytes = statSync(destination).size;
process.stdout.write(
  `release-pack: ${expectedTag} -> teml.tgz (${(bytes / 1024).toFixed(1)} KiB)\n`,
);

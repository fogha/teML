// cli/version.ts — read package version without heavy imports.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tryReadSeaAsset } from "../sea/runtime.js";

let cached: string | undefined;

export function readVersion(): string {
  if (cached) return cached;
  const fromSea = tryReadSeaAsset("package.json");
  if (fromSea) {
    cached = (JSON.parse(fromSea) as { version: string }).version;
    return cached;
  }
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
  cached = pkg.version;
  return cached;
}

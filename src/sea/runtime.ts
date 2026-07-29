// sea/runtime.ts — read embedded assets in Node SEA; fall back to dist/ on disk.

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Virtual URI prefix for bundled demo input resolved by readInput(). */
export const SEA_URI_PREFIX = "@teml/";

type SeaModule = {
  isSea: () => boolean;
  getAsset: (key: string, encoding?: string) => string | ArrayBuffer;
};

const require = createRequire(
  typeof __filename !== "undefined" ? __filename : fileURLToPath(import.meta.url),
);

let seaModule: SeaModule | null | undefined;

function sea(): SeaModule | null {
  if (seaModule !== undefined) return seaModule;
  try {
    const mod = require("node:sea") as SeaModule;
    seaModule = mod.isSea() ? mod : null;
  } catch {
    seaModule = null;
  }
  return seaModule;
}

export function isSeaRuntime(): boolean {
  return sea() !== null;
}

export function readSeaAsset(key: string): string {
  const mod = sea();
  if (!mod) throw new Error(`not running as SEA: missing asset ${key}`);
  return mod.getAsset(key, "utf8") as string;
}

export function tryReadSeaAsset(key: string): string | undefined {
  if (!isSeaRuntime()) return undefined;
  try {
    return readSeaAsset(key);
  } catch {
    return undefined;
  }
}

export function readBundledFile(assetKey: string, fsPath: string): string {
  const embedded = tryReadSeaAsset(assetKey);
  if (embedded !== undefined) return embedded;
  return readFileSync(fsPath, "utf8");
}

export function bundledFileExists(assetKey: string, fsPath: string): boolean {
  if (tryReadSeaAsset(assetKey) !== undefined) return true;
  return existsSync(fsPath);
}

export function seaUriForAsset(assetKey: string): string {
  return `${SEA_URI_PREFIX}${assetKey}`;
}

export function parseSeaUri(value: string): string | undefined {
  if (!value.startsWith(SEA_URI_PREFIX)) return undefined;
  return value.slice(SEA_URI_PREFIX.length);
}

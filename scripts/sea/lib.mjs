#!/usr/bin/env node
// Shared helpers for the Node SEA artifact described by ADR 003.

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const seaDir = join(root, ".sea");

export function platformBinaryName() {
  return process.platform === "win32" ? "teml.exe" : "teml";
}

export function seaBinaryPath() {
  return join(seaDir, platformBinaryName());
}

export function seaBundlePath() {
  return join(seaDir, "bundle.cjs");
}

export function seaConfigPath() {
  return join(seaDir, "sea-config.json");
}

export function seaBlobPath() {
  return join(seaDir, "sea-prep.blob");
}

export function ensureSeaDir() {
  mkdirSync(seaDir, { recursive: true });
}

/** Asset keys mirror dist/ layout (terminal/themes/…, assets/…, package.json). */
export function collectSeaAssets() {
  const assets = {
    "package.json": join(root, "package.json"),
  };

  const trees = [
    join(root, "dist/terminal/themes"),
    join(root, "dist/assets"),
    join(root, "dist/html/profiles"),
  ];

  for (const dir of trees) {
    if (!existsSync(dir)) continue;
    walk(dir, (file) => {
      const key = relative(join(root, "dist"), file).split("\\").join("/");
      assets[key] = file;
    });
  }

  return assets;
}

function walk(dir, onFile) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, onFile);
    else if (entry.isFile()) onFile(path);
  }
}

export function writeSeaConfig() {
  ensureSeaDir();
  const config = {
    main: resolve(seaBundlePath()),
    output: resolve(seaBlobPath()),
    disableExperimentalSEAWarning: true,
    useCodeCache: false,
    assets: Object.fromEntries(
      Object.entries(collectSeaAssets()).map(([key, path]) => [key, resolve(path)]),
    ),
  };
  writeFileSync(seaConfigPath(), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function fileSizeBytes(path) {
  return statSync(path).size;
}

export function cleanSeaOutputs() {
  if (!existsSync(seaDir)) return;
  for (const name of readdirSync(seaDir)) {
    rmSync(join(seaDir, name), { recursive: true, force: true });
  }
}

export function copyNodeBinary(dest) {
  cpSync(process.execPath, dest);
}

#!/usr/bin/env node
// Generate the SEA prep blob, inject it into a Node copy, and sign on macOS.

import { chmodSync, existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  copyNodeBinary,
  ensureSeaDir,
  seaBinaryPath,
  seaBlobPath,
  seaBundlePath,
  seaConfigPath,
  writeSeaConfig,
} from "./lib.mjs";

const require = createRequire(import.meta.url);
const { inject } = require("postject");

if (!existsSync(seaBundlePath())) {
  console.error("sea:build: missing bundle — run pnpm run sea:bundle first");
  process.exit(1);
}

ensureSeaDir();
writeSeaConfig();

console.log("sea:build: generating preparation blob…");
execFileSync(process.execPath, ["--experimental-sea-config", seaConfigPath()], {
  stdio: "inherit",
});

const binary = seaBinaryPath();
console.log(`sea:build: copying ${process.execPath} → ${binary}`);
copyNodeBinary(binary);

if (process.platform === "darwin") {
  console.log("sea:build: removing macOS signature…");
  execFileSync("codesign", ["--remove-signature", binary], { stdio: "inherit" });
}

console.log("sea:build: injecting blob with postject…");
await inject(binary, "NODE_SEA_BLOB", readFileSync(seaBlobPath()), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  machoSegmentName: process.platform === "darwin" ? "NODE_SEA" : undefined,
});

if (process.platform === "darwin") {
  console.log("sea:build: ad-hoc codesign…");
  execFileSync("codesign", ["--sign", "-", binary], { stdio: "inherit" });
}

if (process.platform !== "win32") {
  chmodSync(binary, 0o755);
}

console.log(`sea:build: done → ${binary}`);

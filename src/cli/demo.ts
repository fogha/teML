// cli/demo.ts — locate the showcase in both source and packaged builds.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bundledFileExists, isSeaRuntime, seaUriForAsset } from "../sea/runtime.js";

const DEMO_ASSET = "assets/demo.teml";

export function bundledDemoPath(moduleUrl: string = import.meta.url): string {
  const packaged = fileURLToPath(new URL("../assets/demo.teml", moduleUrl));
  if (isSeaRuntime() || bundledFileExists(DEMO_ASSET, packaged)) {
    if (isSeaRuntime()) return seaUriForAsset(DEMO_ASSET);
    if (existsSync(packaged)) return packaged;
  }

  const source = fileURLToPath(new URL("../../examples/markup/demo.teml", moduleUrl));
  if (existsSync(source)) return source;

  throw new Error("built-in demo asset is missing; reinstall TeML");
}

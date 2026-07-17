// cli/demo.ts — locate the showcase in both source and packaged builds.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function bundledDemoPath(moduleUrl: string = import.meta.url): string {
  const packaged = fileURLToPath(new URL("../assets/demo.teml", moduleUrl));
  if (existsSync(packaged)) return packaged;

  const source = fileURLToPath(new URL("../../examples/demo.teml", moduleUrl));
  if (existsSync(source)) return source;

  throw new Error("built-in demo asset is missing; reinstall TeML");
}

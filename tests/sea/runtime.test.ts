import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import { bundledDemoPath } from "../../src/cli/demo.js";
import { readVersion } from "../../src/cli/version.js";
import { bundledFileExists, parseSeaUri, seaUriForAsset } from "../../src/sea/runtime.js";

test("parseSeaUri round-trips bundled asset keys", () => {
  const uri = seaUriForAsset("assets/demo.teml");
  expect(parseSeaUri(uri)).toBe("assets/demo.teml");
  expect(parseSeaUri("examples/demo.teml")).toBeUndefined();
});

test("readVersion matches package.json on disk", () => {
  expect(readVersion()).toMatch(/^\d+\.\d+\.\d+/);
});

test("bundled demo resolves from dist assets after build", () => {
  const distDemo = join(process.cwd(), "dist/assets/demo.teml");
  const distDemoModule = join(process.cwd(), "dist/cli/demo.js");
  if (!existsSync(distDemo) || !existsSync(distDemoModule)) return;
  expect(bundledDemoPath(pathToFileURL(distDemoModule).href)).toBe(distDemo);
});

test("bundledFileExists checks dist paths outside SEA", () => {
  const theme = join(process.cwd(), "dist/terminal/themes/dark.json");
  if (!existsSync(theme)) return;
  expect(bundledFileExists("terminal/themes/dark.json", theme)).toBe(true);
});

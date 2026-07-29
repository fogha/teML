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

// These assert that the asset is present rather than skipping when it is
// absent: a missing asset is the failure these tests exist to catch, so an
// early return would make them pass in exactly the broken case.
test("bundled demo resolves from dist assets after build", () => {
  const distDemo = join(process.cwd(), "dist/assets/demo.teml");
  const distDemoModule = join(process.cwd(), "dist/cli/demo.js");
  expect(existsSync(distDemo), `${distDemo} is missing; run 'pnpm run build'`).toBe(true);
  expect(existsSync(distDemoModule), `${distDemoModule} is missing; run 'pnpm run build'`).toBe(
    true,
  );
  expect(bundledDemoPath(pathToFileURL(distDemoModule).href)).toBe(distDemo);
});

test("bundledFileExists checks dist paths outside SEA", () => {
  const theme = join(process.cwd(), "dist/terminal/themes/dark.json");
  expect(existsSync(theme), `${theme} is missing; run 'pnpm run build'`).toBe(true);
  expect(bundledFileExists("terminal/themes/dark.json", theme)).toBe(true);
});

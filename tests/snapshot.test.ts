import { test, expect } from "vitest";
import { demoSnapshot } from "./snapshot.js";

const widths = [40, 80, 120] as const;
const variants = ["dark", "mono", "ascii", "no-color"] as const;

for (const variant of variants) {
  for (const width of widths) {
    test(`demo snapshot ${variant} @ ${width}`, async () => {
      await expect(demoSnapshot(width, variant)).toMatchFileSnapshot(`snapshots/demo-${variant}-${width}.txt`);
    });
  }
}

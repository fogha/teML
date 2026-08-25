// tests/snapshot.ts — deterministic render helper for file snapshots (Milestone 2).

import type { TDoc } from "../src/core/ast.js";
import { Diagnostics } from "../src/core/diagnostics.js";
import { layoutDocument } from "../src/layout/layout.js";
import { renderAnsi } from "../src/render/ansi.js";
import { renderPlain } from "../src/render/plain.js";
import type { Capabilities } from "../src/terminal/capabilities.js";
import { loadTheme } from "../src/terminal/theme.js";
import { buildDemoDoc } from "./helpers/hardcoded.js";

export type SnapshotVariant = "dark" | "mono" | "ascii" | "no-color";

function capsForVariant(variant: SnapshotVariant, width: number): Capabilities {
  switch (variant) {
    case "dark":
      return { colors: "truecolor", unicode: true, hyperlinks: true, width, ambiguousWide: false };
    case "mono":
      return { colors: "none", unicode: true, hyperlinks: false, width, ambiguousWide: false };
    case "ascii":
      return { colors: "truecolor", unicode: false, hyperlinks: true, width, ambiguousWide: false };
    case "no-color":
      return { colors: "none", unicode: true, hyperlinks: false, width, ambiguousWide: false };
  }
}

export function snapshotRender(
  source: TDoc | (() => TDoc),
  width: number,
  mode: "plain" | "ansi",
  variant: SnapshotVariant = "dark",
): string {
  const docNode = typeof source === "function" ? source() : source;
  const diags = new Diagnostics();
  const themeName = variant === "mono" ? "mono" : "dark";
  const theme = loadTheme(themeName, diags);
  const caps = capsForVariant(variant, width);
  const lines = layoutDocument(docNode, { width, theme, caps, diags });
  return mode === "ansi" ? renderAnsi(lines, caps) : renderPlain(lines);
}

export function demoSnapshot(width: number, variant: SnapshotVariant): string {
  return snapshotRender(buildDemoDoc, width, "plain", variant);
}

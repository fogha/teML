// cli/commands/render.ts — deterministic plain snapshot.

import type { TDoc } from "../../core/index.js";
import type { Diagnostics } from "../../core/diagnostics.js";
import { layoutDocument } from "../../layout/layout.js";
import { renderPlain } from "../../render/plain.js";
import { loadTheme } from "../../terminal/theme.js";
import type { Capabilities } from "../../terminal/capabilities.js";

export type RenderOpts = {
  width: number;
  caps: Capabilities;
  diags: Diagnostics;
  wrapCode?: boolean;
};

export function runRender(doc: TDoc, opts: RenderOpts): string {
  const plainCaps = { ...opts.caps, colors: "none" as const, width: opts.width };
  const lines = layoutDocument(doc, {
    width: opts.width,
    theme: loadTheme("mono"),
    caps: plainCaps,
    diags: opts.diags,
    wrapCode: opts.wrapCode,
  });
  return renderPlain(lines);
}

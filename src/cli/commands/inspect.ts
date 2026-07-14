// cli/commands/inspect.ts — dump internals (--ast / --tokens / --render-tokens).

import type { TDoc } from "../../core/index.js";
import { tokensView, renderTokensView } from "../../core/index.js";
import { layoutDocument } from "../../layout/layout.js";
import { loadTheme } from "../../terminal/theme.js";
import type { LayoutOpts } from "../../layout/opts.js";

export type InspectOpts = {
  ast?: boolean;
  tokens?: boolean;
  renderTokens?: boolean;
  layout?: Omit<LayoutOpts, "diags"> & { diags: LayoutOpts["diags"] };
};

export function runInspect(doc: TDoc, opts: InspectOpts = {}): string {
  if (opts.renderTokens && opts.layout) {
    const lines = layoutDocument(doc, opts.layout);
    return renderTokensView(lines);
  }
  if (opts.tokens) return tokensView(doc);
  return JSON.stringify(doc, null, 2) + "\n";
}

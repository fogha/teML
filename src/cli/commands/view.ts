// cli/commands/view.ts — render a document to the terminal.

import type { TDoc } from "../../core/index.js";
import type { Diagnostics } from "../../core/diagnostics.js";
import { layoutDocument } from "../../layout/layout.js";
import { renderAnsi } from "../../render/ansi.js";
import { renderPlain } from "../../render/plain.js";
import { colorsEnabled, type Capabilities } from "../../terminal/capabilities.js";
import type { LayoutOpts } from "../../layout/opts.js";

export type ViewOpts = LayoutOpts;

export function runView(doc: TDoc, opts: ViewOpts): string {
  const lines = layoutDocument(doc, opts);
  return colorsEnabled(opts.caps) ? renderAnsi(lines, opts.caps) : renderPlain(lines);
}

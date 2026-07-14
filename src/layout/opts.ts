// layout/opts.ts — shared layout options (avoids circular imports).

import type { Diagnostics } from "../core/diagnostics.js";
import type { FootnoteIndex } from "../core/footnotes.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { Theme } from "../terminal/theme.js";

export type LayoutOpts = {
  width: number;
  theme: Theme;
  caps: Capabilities;
  diags: Diagnostics;
  /** When true, code block lines wrap; otherwise truncate with diagnostic. */
  wrapCode?: boolean;
  /** Append visible URLs for links (fallback when hyperlinks unavailable). */
  showUrls?: boolean;
  /** Footnote numbering for inline refs and appendix (set by layoutDocument). */
  footnotes?: FootnoteIndex;
};

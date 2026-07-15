// layout/opts.ts — shared layout options (avoids circular imports).

import type { Diagnostics } from "../core/diagnostics.js";
import type { FootnoteIndex } from "../core/footnotes.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { Theme } from "../terminal/theme.js";
import type { WidgetHit } from "./hits.js";
import type { SemanticRegions } from "./regions.js";

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
  /** id of the focused interactive leaf (button/input/checkbox), if any. */
  focusedId?: string;
  /** Grapheme index of the text cursor within the focused input's value. */
  cursorPos?: number;
  /** When true, the focused input's whole value renders as selected (no caret) — see interactive/session.ts's untouchedDefault. */
  selectionActive?: boolean;
  /** When set, every focusable leaf laid out appends its row range here (see layout/hits.ts). */
  hits?: WidgetHit[];
  /** Additive Reader metadata collector; omitted by the v1 layout API. */
  regions?: SemanticRegions;
};

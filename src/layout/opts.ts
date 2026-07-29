// layout/opts.ts — shared layout options (avoids circular imports).

import type { Diagnostics } from "../core/diagnostics.js";
import type { Block } from "../core/ast.js";
import type { FootnoteIndex } from "../core/footnotes.js";
import type { Line } from "../render/styledLine.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { Theme } from "../terminal/theme.js";
import type { WidgetHit } from "./hits.js";
import type { SemanticRegions } from "./regions.js";

export type ScrollRegionRuntime = {
  offset: number;
  rows: number;
  total: number;
  width?: number;
  /** Snapshot (not an alias) of the children laid out into `innerLines`, so
   * that mutating the live array in place still invalidates the cache. */
  children?: Block[];
  innerLines?: Line[];
};

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
  /** id of the focused interactive target, if any. */
  focusedId?: string;
  /** Grapheme index of the text cursor within the focused input's value. */
  cursorPos?: number;
  /** When true, the focused input's whole value renders as selected (no caret) — see interactive/session.ts's untouchedDefault. */
  selectionActive?: boolean;
  /** Pending option index per radio group; pending values are session-only. */
  radioPending?: ReadonlyMap<string, number>;
  /** First visible visual line per fixed-height textarea. */
  textareaScrollOffsets?: ReadonlyMap<string, number>;
  /** Session-owned inner layout caches and offsets for scroll containers. */
  scrollRegionRuntime?: Map<string, ScrollRegionRuntime>;
  /** Render nested controls as static content (used by v1 scroll regions). */
  interactiveDisabled?: boolean;
  /** When set, layoutDocument replaces it with exact terminal-cell widget
   * regions collected from the final styled lines (see layout/hits.ts). */
  hits?: WidgetHit[];
  /** Additive Reader metadata collector; omitted by the v1 layout API. */
  regions?: SemanticRegions;
};

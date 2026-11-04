// layout/opts.ts — shared layout options (avoids circular imports).

import type { Diagnostics } from "../core/diagnostics.js";
import type { Block } from "../core/ast.js";
import type { FootnoteIndex } from "../core/footnotes.js";
import type { Line } from "../render/styledLine.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { Theme } from "../terminal/theme.js";
import type { WidgetHit } from "./hits.js";
import type { SemanticRegions } from "./regions.js";
import type { CanvasSurface } from "./canvas.js";

export type FieldLayoutConfig = {
  /** Maximum outer box width in terminal cells; defaults to available width. */
  width?: number;
  /** Horizontal cells between a border and its content. Default: 1. */
  paddingX?: number;
  /** Blank rows inside the top and bottom borders. Default: 0. */
  paddingY?: number;
  /** Blank rows before and after the field. Default: 0. */
  marginY?: number;
  /** Horizontal placement when width is narrower than available space. Default: "start". */
  align?: "start" | "center" | "end";
};

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
  /** Shared defaults for button/input/textarea boxes; markup can override per field. */
  fields?: FieldLayoutConfig;
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
  /** First visible visual line per textarea. */
  textareaScrollOffsets?: ReadonlyMap<string, number>;
  /** Session-owned inner layout caches and offsets for scroll containers. */
  scrollRegionRuntime?: Map<string, ScrollRegionRuntime>;
  /** Host-driven pixel surfaces keyed by declarative canvas id. */
  canvas?: ReadonlyMap<string, CanvasSurface>;
  /** Render nested controls as static content (used by v1 scroll regions). */
  interactiveDisabled?: boolean;
  /** When set, layoutDocument replaces it with exact terminal-cell widget
   * regions collected from the final styled lines (see layout/hits.ts). */
  hits?: WidgetHit[];
  /** Additive Reader metadata collector; omitted by the v1 layout API. */
  regions?: SemanticRegions;
  /** Session-owned, id-keyed validation messages rendered under each field.
   * Layout only *reads* this — the session is the sole validator
   * (core/validate.ts, docs/architecture.md). Absent means nothing is shown,
   * and output stays byte-identical to the unvalidated render. */
  fieldErrors?: ReadonlyMap<string, string>;
};

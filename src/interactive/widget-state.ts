// interactive/widget-state.ts — transient, id-keyed editing/selection state
// owned by InteractiveSession. Document *values* live on the AST
// (attrs.value/attrs.checked, mutated in place); everything here is
// presentation/edit state that must be carried across document mutations and
// dropped for widget ids that disappear. Consolidating it in one object makes
// the session's carry-over and pruning lifecycle visible in a single place
// instead of several parallel maps scattered through InteractiveSession.

import type { ScrollRegionRuntime } from "../layout/opts.js";

export class WidgetState {
  /** Grapheme index into each input's value, keyed by widget id. Lazily
   * defaulted to "end of value" the first time a field is read; persists
   * across focus changes so returning to a field resumes where you left it. */
  readonly cursor = new Map<string, number>();

  /** Preferred terminal-cell column for textarea vertical navigation. */
  readonly preferredCol = new Map<string, number>();

  /** Internal scroll offset for each textarea whose content exceeds its visible rows. */
  readonly textareaScrollOffsets = new Map<string, number>();

  /** Pending (not yet confirmed) radio selection, keyed by radio group id. */
  readonly radioPending = new Map<string, number>();

  /** Scroll-region runtime state, keyed by `::scroll` container id. */
  readonly scrollRegionRuntime = new Map<string, ScrollRegionRuntime>();

  /** Ids of inputs/textarea whose value is still exactly the document-supplied
   * default (set at construction or by a `render`) and hasn't been edited by
   * the user yet — mirrors a browser's "select all on focus" for a pre-filled
   * field. While an id is in here, the whole value renders as selected (no
   * caret) and the first edit replaces it outright: typing overwrites it,
   * backspace clears it. Any edit removes the id. */
  readonly untouchedDefault = new Set<string>();

  /** Ids whose validation message is currently allowed to render. A field is
   * revealed only when a submit of its form fails; editing it hides the
   * message again. Kept here rather than on the session so document
   * transitions prune it with every other id-keyed transient. */
  readonly revealedFields = new Set<string>();

  /** Drop per-widget transient state for ids that no longer resolve to a
   * surviving widget after a document mutation or a `render` swap. */
  pruneTransient(survivingIds: ReadonlySet<string>): void {
    for (const map of [
      this.cursor,
      this.preferredCol,
      this.textareaScrollOffsets,
      this.scrollRegionRuntime,
    ]) {
      for (const id of map.keys()) {
        if (!survivingIds.has(id)) map.delete(id);
      }
    }
    for (const id of this.revealedFields) {
      if (!survivingIds.has(id)) this.revealedFields.delete(id);
    }
  }
}

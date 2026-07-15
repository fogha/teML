// interactive/focus.ts — walks a normalized TDoc to find focusable widgets
// (button/input/checkbox) in document order, for keyboard navigation.
//
// Layout only *renders* focus (via LayoutOpts.focusedId); this module is the
// single place that decides what is focusable and in what order, mirroring
// the same block-recursion shape as core/footnotes.ts's walkBlocks.

import type { Block, TDoc } from "../core/index.js";
import type { Diagnostics } from "../core/diagnostics.js";
import { isFocusableLeaf } from "../teml/directives.js";

export type FocusableWidget = {
  id: string;
  name: "button" | "input" | "checkbox";
  attrs: Record<string, string>;
};

function walkBlocks(blocks: Block[], out: FocusableWidget[], diags?: Diagnostics): void {
  for (const b of blocks) {
    switch (b.type) {
      case "leaf":
        if (isFocusableLeaf(b.name)) {
          const id = b.attrs.id?.trim();
          if (!id) {
            diags?.warn(
              "focus-missing-id",
              `::${b.name} has no id; it cannot receive keyboard focus`,
            );
            break;
          }
          out.push({ id, name: b.name as FocusableWidget["name"], attrs: b.attrs });
        }
        break;
      case "list":
        for (const item of b.items) walkBlocks(item.blocks, out, diags);
        break;
      case "quote":
      case "container":
      case "footnoteDefinition":
        walkBlocks(b.children, out, diags);
        break;
      case "definitionList":
        for (const item of b.items) {
          for (const def of item.definitions) walkBlocks(def, out, diags);
        }
        break;
      default:
        break;
    }
  }
}

/**
 * Collect focusable widgets in document order. Widgets with a missing id are
 * dropped from the tab order (and warned about); duplicate ids keep only the
 * first occurrence so navigation never gets stuck on an ambiguous target.
 */
export function collectFocusable(doc: TDoc, diags?: Diagnostics): FocusableWidget[] {
  const found: FocusableWidget[] = [];
  walkBlocks(doc.blocks, found, diags);

  const seen = new Set<string>();
  const out: FocusableWidget[] = [];
  for (const w of found) {
    if (seen.has(w.id)) {
      diags?.warn("focus-duplicate-id", `duplicate focusable id '${w.id}'`);
      continue;
    }
    seen.add(w.id);
    out.push(w);
  }
  return out;
}

/** Id to focus after Tab, wrapping around; undefined if nothing is focusable. */
export function nextFocusId(
  order: FocusableWidget[],
  currentId: string | undefined,
): string | undefined {
  if (!order.length) return undefined;
  if (currentId == null) return order[0]!.id;
  const idx = order.findIndex((w) => w.id === currentId);
  if (idx === -1) return order[0]!.id;
  return order[(idx + 1) % order.length]!.id;
}

/** Id to focus after Shift+Tab, wrapping around; undefined if nothing is focusable. */
export function prevFocusId(
  order: FocusableWidget[],
  currentId: string | undefined,
): string | undefined {
  if (!order.length) return undefined;
  if (currentId == null) return order[order.length - 1]!.id;
  const idx = order.findIndex((w) => w.id === currentId);
  if (idx === -1) return order[order.length - 1]!.id;
  return order[(idx - 1 + order.length) % order.length]!.id;
}

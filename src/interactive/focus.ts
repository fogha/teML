// interactive/focus.ts — walks a normalized TDoc to find focusable widgets
// and containers in document order, for keyboard navigation.
//
// Layout only *renders* focus (via LayoutOpts.focusedId); this module is the
// single place that decides what is focusable and in what order, mirroring
// the same block-recursion shape as core/footnotes.ts's walkBlocks.

import type { TDoc } from "../core/index.js";
import type { Diagnostics } from "../core/diagnostics.js";
import type { Block } from "../core/index.js";
import { collectInteractiveWidgets } from "./updatable.js";
import type { RadioOption } from "./radio.js";

export type FocusableWidget = {
  id: string;
  name: "button" | "input" | "checkbox" | "textarea" | "radio" | "scroll";
  attrs: Record<string, string>;
  block?: Extract<Block, { type: "container" }>;
  options?: RadioOption[];
};

/**
 * Collect focusable widgets in document order. Widgets with a missing id are
 * dropped from the tab order (and warned about); duplicate ids keep only the
 * first occurrence so navigation never gets stuck on an ambiguous target.
 */
export function collectFocusable(doc: TDoc, diags?: Diagnostics): FocusableWidget[] {
  return collectInteractiveWidgets(doc, diags).focusables;
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

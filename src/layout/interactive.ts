// layout/interactive.ts — button/input/checkbox leaf layout (M-interactive step 3).
//
// Focus is carried two ways: a theme "focus" role (color/bold, lost on
// --no-color) and a literal textual marker (▸ / >), which is the load-bearing
// signal for the plain backend and for anyone grepping output. Neither
// widget ever emits raw ANSI itself — resolveRole + the single ANSI emitter
// still own that. The marker is prepended outside wrapSpans (like list
// markers in layoutList) so the reserved gutter survives word-wrapping.

import type { Block } from "../core/index.js";
import type { Line, Span } from "../render/styledLine.js";
import { lineWidth } from "../render/styledLine.js";
import { resolveRole } from "../terminal/theme.js";
import type { LayoutOpts } from "./opts.js";
import { cellWidth, graphemes, truncateToWidth, type MeasureOpts } from "./measure.js";
import { wrapSpans } from "./wrap.js";

function measureOpts(opts: LayoutOpts): MeasureOpts {
  return { ambiguousWide: opts.caps.ambiguousWide };
}

function clampLine(line: Line, maxW: number, m: MeasureOpts): Line {
  const w = lineWidth(line, m);
  if (w <= maxW) return line;
  const plain = line.map((s) => s.text).join("");
  const style = line.find((s) => s.text.trim())?.style ?? {};
  return [{ text: truncateToWidth(plain, maxW, "…", m), style }];
}

function isFocused(id: string | undefined, opts: LayoutOpts): boolean {
  return !!id && opts.focusedId === id;
}

/** Textual focus marker: the only signal that survives renderPlain. Fixed
 * width so unfocused/focused rows of the same widget line up. */
function focusMarker(focused: boolean, unicode: boolean): string {
  if (!focused) return "  ";
  return unicode ? "▸ " : "> ";
}

function widgetLine(marker: string, content: Span[], opts: LayoutOpts, indent: number): Line[] {
  const m = measureOpts(opts);
  const markerW = cellWidth(marker, m);
  const innerW = Math.max(1, opts.width - indent - markerW);
  const pad = " ".repeat(indent);
  const wrapped = wrapSpans(content, innerW, m);
  return wrapped.map((line, i) => [
    { text: pad, style: {} },
    { text: i === 0 ? marker : " ".repeat(markerW), style: {} },
    ...clampLine(line, innerW, m),
  ]);
}

export function layoutButton(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { theme, caps, diags } = opts;
  const focused = isFocused(b.attrs.id, opts);
  const label = b.attrs.label?.trim() || "Button";
  const style = focused ? resolveRole(theme, "focus", diags) : {};

  return widgetLine(
    focusMarker(focused, caps.unicode),
    [{ text: `[ ${label} ]`, style }],
    opts,
    indent,
  );
}

export function layoutInput(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { theme, caps, diags } = opts;
  const focused = isFocused(b.attrs.id, opts);
  const label = b.attrs.label?.trim();
  const value = b.attrs.value ?? "";
  const placeholder = b.attrs.placeholder?.trim();
  const muted = resolveRole(theme, "muted", diags);
  const fieldStyle = focused ? resolveRole(theme, "focus", diags) : {};

  const caret = caps.unicode ? "▏" : "|";
  const spans: Span[] = [];
  if (label) spans.push({ text: `${label}: `, style: muted });
  spans.push({ text: "[", style: {} });
  if (value) {
    if (focused && opts.selectionActive) {
      // The whole value is "selected" (untouched default) — highlight it
      // as one span, with no caret, same idea as an OS text field that
      // pre-selects a suggested value so the next keystroke replaces it.
      spans.push({ text: value, style: fieldStyle });
    } else if (focused) {
      // Cursor position defaults to the end (undefined = static/no session
      // driving this render), same as the old always-append-at-end caret.
      const chars = graphemes(value);
      const cursor =
        opts.cursorPos == null ? chars.length : Math.min(chars.length, Math.max(0, opts.cursorPos));
      const before = chars.slice(0, cursor).join("");
      const after = chars.slice(cursor).join("");
      if (before) spans.push({ text: before, style: fieldStyle });
      spans.push({ text: caret, style: fieldStyle });
      if (after) spans.push({ text: after, style: fieldStyle });
    } else {
      spans.push({ text: value, style: fieldStyle });
    }
  } else if (placeholder) {
    spans.push({ text: placeholder, style: muted });
    if (focused) spans.push({ text: caret, style: fieldStyle });
  } else if (focused) {
    spans.push({ text: caret, style: fieldStyle });
  }
  spans.push({ text: "]", style: {} });

  return widgetLine(focusMarker(focused, caps.unicode), spans, opts, indent);
}

export function layoutCheckbox(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { theme, caps, diags } = opts;
  const focused = isFocused(b.attrs.id, opts);
  const checked = b.attrs.checked?.trim().toLowerCase() === "true";
  const box = caps.unicode ? (checked ? "☑ " : "☐ ") : checked ? "[x] " : "[ ] ";
  const label = b.attrs.label?.trim() ?? "";
  const style = focused ? resolveRole(theme, "focus", diags) : {};

  return widgetLine(
    focusMarker(focused, caps.unicode),
    [
      { text: box, style },
      { text: label, style: focused ? style : {} },
    ],
    opts,
    indent,
  );
}

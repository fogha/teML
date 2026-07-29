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
import { radioOptions } from "../interactive/radio.js";
import type { LayoutOpts } from "./opts.js";
import { cellWidth, graphemes, truncateToWidth, type MeasureOpts } from "./measure.js";
import { graphemeToTextareaVisual, textareaRows, textareaVisualLines } from "./textarea.js";
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
  return !opts.interactiveDisabled && !!id && opts.focusedId === id;
}

/** Textual focus marker: the only signal that survives renderPlain. Fixed
 * width so unfocused/focused rows of the same widget line up. */
function focusMarker(focused: boolean, unicode: boolean): string {
  if (!focused) return "  ";
  return unicode ? "▸ " : "> ";
}

function widgetLine(
  id: string | undefined,
  marker: string,
  content: Span[],
  opts: LayoutOpts,
  indent: number,
  kind?: "radioOption",
  value?: string,
): Line[] {
  const m = measureOpts(opts);
  const markerW = cellWidth(marker, m);
  const innerW = Math.max(1, opts.width - indent - markerW);
  const pad = " ".repeat(indent);
  const interactiveId = opts.interactiveDisabled ? undefined : id;
  const metadata = interactiveId
    ? kind
      ? {
          interactiveId,
          interactiveKind: kind,
          ...(value !== undefined ? { interactiveValue: value } : {}),
        }
      : { widgetId: interactiveId }
    : {};
  const tagged = interactiveId
    ? content.map((span) => ({ ...span, style: { ...span.style, ...metadata } }))
    : content;
  const wrapped = wrapSpans(tagged, innerW, m);
  return wrapped.map((line, i) => [
    { text: pad, style: metadata },
    { text: i === 0 ? marker : " ".repeat(markerW), style: metadata },
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
    b.attrs.id?.trim(),
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

  return widgetLine(b.attrs.id?.trim(), focusMarker(focused, caps.unicode), spans, opts, indent);
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
    b.attrs.id?.trim(),
    focusMarker(focused, caps.unicode),
    [
      { text: box, style },
      { text: label, style: focused ? style : {} },
    ],
    opts,
    indent,
  );
}

export function layoutRadio(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const id = b.attrs.id?.trim();
  const focused = isFocused(id, opts);
  const options = radioOptions(b);
  const confirmed = b.attrs.value;
  const confirmedIndex = options.findIndex((option) => option.value === confirmed);
  const pending = focused
    ? Math.max(
        0,
        Math.min(
          options.length - 1,
          opts.radioPending?.get(id ?? "") ?? (confirmedIndex >= 0 ? confirmedIndex : 0),
        ),
      )
    : -1;
  const focusedStyle = resolveRole(opts.theme, "focus", opts.diags);
  const lines: Line[] = [];
  for (let index = 0; index < options.length; index++) {
    const option = options[index]!;
    const selected = option.value === confirmed;
    const style = focused && index === pending ? focusedStyle : {};
    lines.push(
      ...widgetLine(
        id,
        focusMarker(focused && index === pending, opts.caps.unicode),
        [
          { text: selected ? "(*)" : "( )", style },
          { text: ` ${option.label}`, style },
        ],
        opts,
        indent,
        "radioOption",
        option.value,
      ),
    );
  }
  if (lines.length > 0) return lines;
  return widgetLine(
    undefined,
    focusMarker(false, opts.caps.unicode),
    [{ text: "(empty radio group)", style: resolveRole(opts.theme, "muted", opts.diags) }],
    opts,
    indent,
  );
}

export function layoutTextarea(
  b: Extract<Block, { type: "leaf" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const id = b.attrs.id?.trim();
  const interactiveId = opts.interactiveDisabled ? undefined : id;
  const focused = isFocused(id, opts);
  const rows = textareaRows(b.attrs.rows);
  const m = measureOpts(opts);
  const available = Math.max(1, opts.width - indent);
  const marker = available >= 5 ? focusMarker(focused, opts.caps.unicode) : "";
  const markerW = cellWidth(marker, m);
  const fieldWidth = Math.max(1, available - markerW);
  const bracketed = fieldWidth >= 3;
  const contentWidth = Math.max(1, fieldWidth - (bracketed ? 2 : 0));
  const value = b.attrs.value ?? "";
  const visual = textareaVisualLines(value, contentWidth, m);
  const cursor =
    focused && !opts.selectionActive
      ? graphemeToTextareaVisual(value, opts.cursorPos ?? graphemes(value).length, visual, m)
      : undefined;
  const maxOffset = Math.max(0, visual.length - rows);
  const offset = Math.max(0, Math.min(maxOffset, opts.textareaScrollOffsets?.get(id ?? "") ?? 0));
  const chars = graphemes(value);
  const fieldStyle = focused ? resolveRole(opts.theme, "focus", opts.diags) : {};
  const muted = resolveRole(opts.theme, "muted", opts.diags);
  const genericMetadata = interactiveId
    ? { interactiveId, interactiveKind: "widget" as const }
    : {};
  const lines: Line[] = [];
  const label = b.attrs.label?.trim();
  if (label) {
    lines.push([
      { text: " ".repeat(indent), style: genericMetadata },
      { text: marker, style: genericMetadata },
      {
        text: truncateToWidth(label, Math.max(1, available - markerW), "…", m),
        style: { ...muted, ...genericMetadata },
      },
    ]);
  }

  for (let row = 0; row < rows; row++) {
    const visualIndex = offset + row;
    const line = visual[visualIndex];
    let display = line ? chars.slice(line.start, line.end).join("") : "";
    let style = fieldStyle;
    if (!value && row === 0 && b.attrs.placeholder) {
      display = b.attrs.placeholder;
      style = muted;
    } else if (cursor?.line === visualIndex) {
      const before = truncateToWidth(display, Math.max(0, cursor.col), "", m);
      const beforeGraphemes = graphemes(before).length;
      const source = graphemes(display);
      display = [
        ...source.slice(0, beforeGraphemes),
        opts.caps.unicode ? "▏" : "|",
        ...source.slice(beforeGraphemes),
      ].join("");
    }
    display = truncateToWidth(display, contentWidth, "", m);
    const used = cellWidth(display, m);
    const contentMetadata = interactiveId
      ? {
          interactiveId,
          interactiveKind: "textareaContent" as const,
          interactiveValue: String(visualIndex),
        }
      : {};
    const rowMarker = !label && row === 0 ? marker : " ".repeat(markerW);
    lines.push([
      { text: " ".repeat(indent), style: genericMetadata },
      { text: rowMarker, style: genericMetadata },
      { text: bracketed ? "[" : "", style: genericMetadata },
      { text: display, style: { ...style, ...contentMetadata } },
      {
        text: " ".repeat(Math.max(0, contentWidth - used)),
        style: contentMetadata,
      },
      { text: bracketed ? "]" : "", style: genericMetadata },
    ]);
  }
  return lines;
}

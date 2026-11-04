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
import { lineWidth, padLine } from "../render/styledLine.js";
import { resolveRole } from "../terminal/theme.js";
import { radioOptions } from "../interactive/radio.js";
import type { LayoutOpts } from "./opts.js";
import { cellWidth, graphemes, truncateToWidth, type MeasureOpts } from "./measure.js";
import { graphemeToTextareaVisual, textareaVisibleRows, textareaVisualLines } from "./textarea.js";
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

/** True when the widget declared a mask. A bare `mask` parses to HTML's
 * empty-string attribute form, which means "on"; only an explicit "false"
 * turns it off. `password` is the conventional alias. */
function masked(attrs: Record<string, string>): boolean {
  const raw = attrs.mask?.trim().toLowerCase();
  return raw !== undefined && raw !== "false";
}

/** Replace every grapheme with one mask cell, preserving grapheme count so all
 * caret arithmetic above stays valid. This is a display transform only: the
 * real value stays in attrs.value and in every event payload. */
function maskDisplay(text: string, caps: { unicode: boolean }): string {
  const ch = caps.unicode ? "•" : "*";
  return ch.repeat(graphemes(text).length);
}

/** Inline validation feedback under a field. The session decides *whether* an
 * error is shown (LayoutOpts.fieldErrors); layout only draws what it is given,
 * and never validates. Message text is engine-authored and value-free. */
function errorLines(id: string | undefined, opts: LayoutOpts, indent: number): Line[] {
  const message = id ? opts.fieldErrors?.get(id) : undefined;
  if (!message) return [];
  const marker = opts.caps.unicode ? "✗" : "!";
  return [
    [
      { text: " ".repeat(indent), style: {} },
      { text: `${marker} ${message}`, style: resolveRole(opts.theme, "error", opts.diags) },
    ],
  ];
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

function boxMetrics(opts: LayoutOpts, indent: number, focused: boolean) {
  const m = measureOpts(opts);
  const available = Math.max(1, opts.width - indent);
  const marker = available >= 5 ? focusMarker(focused, opts.caps.unicode) : "";
  const markerW = cellWidth(marker, m);
  const boxWidth = Math.max(1, available - markerW);
  return {
    m,
    available,
    marker,
    markerW,
    boxWidth,
    contentWidth: Math.max(1, boxWidth - 4),
    showBox: boxWidth >= 5,
  };
}

function boxedField(
  opts: LayoutOpts,
  indent: number,
  focused: boolean,
  label: string | undefined,
  content: Line[],
  metadata: Span["style"],
): Line[] {
  const { m, available, marker, markerW, contentWidth, showBox } = boxMetrics(
    opts,
    indent,
    focused,
  );
  const lines: Line[] = [];
  if (label) {
    lines.push([
      { text: " ".repeat(indent), style: metadata },
      { text: marker, style: metadata },
      {
        text: truncateToWidth(label, Math.max(1, available - markerW), "…", m),
        style: metadata,
      },
    ]);
  }
  if (!showBox) {
    lines.push(
      ...content.map((line, index) => [
        { text: " ".repeat(indent), style: metadata },
        { text: label || index > 0 ? " ".repeat(markerW) : marker, style: metadata },
        ...clampLine(line, Math.max(1, available - markerW), m),
      ]),
    );
    return lines;
  }

  const top = opts.caps.unicode ? "┌" : "+";
  const bottom = opts.caps.unicode ? "└" : "+";
  const vertical = opts.caps.unicode ? "│" : "|";
  const horizontal = opts.caps.unicode ? "─" : "-";
  lines.push([
    { text: " ".repeat(indent), style: metadata },
    { text: label ? " ".repeat(markerW) : marker, style: metadata },
    {
      text: `${top}${horizontal.repeat(contentWidth + 2)}${opts.caps.unicode ? "┐" : "+"}`,
      style: metadata,
    },
  ]);
  for (const line of content) {
    const padded = padLine(clampLine(line, contentWidth, m), contentWidth, {}, m);
    lines.push([
      { text: " ".repeat(indent), style: metadata },
      { text: " ".repeat(markerW), style: metadata },
      { text: `${vertical} `, style: metadata },
      ...padded,
      { text: ` ${vertical}`, style: metadata },
    ]);
  }
  lines.push([
    { text: " ".repeat(indent), style: metadata },
    { text: " ".repeat(markerW), style: metadata },
    {
      text: `${bottom}${horizontal.repeat(contentWidth + 2)}${opts.caps.unicode ? "┘" : "+"}`,
      style: metadata,
    },
  ]);
  return lines;
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
  const maskedInput = masked(b.attrs);
  // Masking preserves grapheme count, so a caret index taken against the real
  // value still addresses the right cell in the masked text.
  const valueDisplay = maskedInput ? maskDisplay(value, caps) : value;
  const spans: Span[] = [];
  if (value) {
    if (focused && opts.selectionActive) {
      // The whole value is "selected" (untouched default) — highlight it
      // as one span, with no caret, same idea as an OS text field that
      // pre-selects a suggested value so the next keystroke replaces it.
      spans.push({ text: valueDisplay, style: fieldStyle });
    } else if (focused) {
      // Cursor position defaults to the end (undefined = static/no session
      // driving this render), same as the old always-append-at-end caret.
      const chars = graphemes(valueDisplay);
      const cursor =
        opts.cursorPos == null ? chars.length : Math.min(chars.length, Math.max(0, opts.cursorPos));
      const before = chars.slice(0, cursor).join("");
      const after = chars.slice(cursor).join("");
      if (before) spans.push({ text: before, style: fieldStyle });
      spans.push({ text: caret, style: fieldStyle });
      if (after) spans.push({ text: after, style: fieldStyle });
    } else {
      spans.push({ text: valueDisplay, style: fieldStyle });
    }
  } else if (placeholder) {
    spans.push({ text: placeholder, style: muted });
    if (focused) spans.push({ text: caret, style: fieldStyle });
  } else if (focused) {
    spans.push({ text: caret, style: fieldStyle });
  }
  const id = b.attrs.id?.trim();
  const content = widgetLine(id, "", spans, opts, 0);
  const metadata = content[0]?.[0]?.style ?? {};
  const lines = boxedField(opts, indent, focused, label, content, metadata);
  lines.push(...errorLines(id, opts, indent));
  return lines;
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
  const m = measureOpts(opts);
  const { contentWidth } = boxMetrics(opts, indent, focused);
  const value = b.attrs.value ?? "";
  const maskedTextarea = masked(b.attrs);
  const visual = textareaVisualLines(value, contentWidth, m);
  const rows = textareaVisibleRows(b.attrs, visual.length);
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
  for (let row = 0; row < rows; row++) {
    const visualIndex = offset + row;
    const line = visual[visualIndex];
    let display = line ? chars.slice(line.start, line.end).join("") : "";
    // Mask before the caret splice below: wrapping above still derives from the
    // real value, so visual line breaks stay correct and the caret stays
    // grapheme-indexed.
    if (maskedTextarea) display = maskDisplay(display, opts.caps);
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
    lines.push([
      { text: display, style: { ...style, ...contentMetadata } },
      {
        text: " ".repeat(Math.max(0, contentWidth - used)),
        style: contentMetadata,
      },
    ]);
  }
  const boxed = boxedField(opts, indent, focused, label, lines, genericMetadata);
  boxed.push(...errorLines(id, opts, indent));
  return boxed;
}

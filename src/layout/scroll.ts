import type { Block } from "../core/ast.js";
import { physicalLines } from "../render/screen.js";
import type { Line } from "../render/styledLine.js";
import { lineWidth } from "../render/styledLine.js";
import { resolveRole } from "../terminal/theme.js";
import { cellWidth, truncateToWidth, type MeasureOpts } from "./measure.js";
import type { LayoutOpts, ScrollRegionRuntime } from "./opts.js";

type LayoutChildren = (
  blocks: Block[],
  opts: LayoutOpts,
  blankBetween: boolean,
  indent?: number,
) => Line[];

const UNICODE_BORDER = { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" };
const ASCII_BORDER = { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };

export function scrollRows(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? Math.max(1, Math.min(500, parsed)) : 10;
}

function tagLine(line: Line, id: string | undefined): Line {
  if (!id) return line;
  return line.map((span) => ({
    ...span,
    style: {
      ...span.style,
      interactiveId: id,
      interactiveKind: "scroll",
    },
  }));
}

/** Cached inner lines stay valid only while every child block is still the
 * exact object that was laid out. Callers replace a block to change it, so
 * reference equality is the content check — but it has to run against a
 * snapshot, because an alias of the live array cannot detect in-place pushes. */
function sameChildren(snapshot: readonly Block[], children: readonly Block[]): boolean {
  return (
    snapshot.length === children.length &&
    snapshot.every((child, index) => children[index] === child)
  );
}

function cachedInner(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  width: number,
  rows: number,
  layoutChildren: LayoutChildren,
): { state: ScrollRegionRuntime; lines: Line[] } {
  const id = opts.interactiveDisabled ? undefined : b.attrs.id?.trim();
  let state = id ? opts.scrollRegionRuntime?.get(id) : undefined;
  if (!state) state = { offset: 0, rows, total: 0 };
  const previousChildren = state.children;
  const previousInnerLines = state.innerLines;
  const tailAppend =
    state.width === width &&
    previousInnerLines !== undefined &&
    previousChildren !== undefined &&
    b.children.length > previousChildren.length &&
    previousChildren.every((child, index) => b.children[index] === child);
  if (tailAppend) {
    const appended = b.children.slice(previousChildren.length);
    const raw = layoutChildren(
      appended,
      {
        ...opts,
        width,
        focusedId: undefined,
        cursorPos: undefined,
        selectionActive: undefined,
        interactiveDisabled: true,
        hits: undefined,
        regions: undefined,
      },
      true,
      0,
    );
    const separator: Line[] = previousChildren.length > 0 && appended.length > 0 ? [[]] : [];
    state.innerLines = [...previousInnerLines, ...separator, ...physicalLines(raw)];
    state.children = [...b.children];
  } else if (
    !state.innerLines ||
    state.width !== width ||
    !previousChildren ||
    !sameChildren(previousChildren, b.children)
  ) {
    const raw = layoutChildren(
      b.children,
      {
        ...opts,
        width,
        focusedId: undefined,
        cursorPos: undefined,
        selectionActive: undefined,
        interactiveDisabled: true,
        hits: undefined,
        regions: undefined,
      },
      true,
      0,
    );
    state.innerLines = physicalLines(raw);
    state.children = [...b.children];
    state.width = width;
  }
  state.rows = rows;
  state.total = state.innerLines.length;
  state.offset = Math.max(0, Math.min(Math.max(0, state.total - rows), state.offset));
  if (id && opts.scrollRegionRuntime) opts.scrollRegionRuntime.set(id, state);
  return { state, lines: state.innerLines };
}

export function layoutScroll(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
  layoutChildren: LayoutChildren,
): Line[] {
  const m: MeasureOpts = { ambiguousWide: opts.caps.ambiguousWide };
  const id = opts.interactiveDisabled ? undefined : b.attrs.id?.trim();
  const focused = !!id && opts.focusedId === id;
  const rows = scrollRows(b.attrs.rows);
  const available = Math.max(1, opts.width - indent);
  const marker = available >= 6 ? (focused ? (opts.caps.unicode ? "▸ " : "> ") : "  ") : "";
  const markerWidth = cellWidth(marker, m);
  const boxWidth = Math.max(1, available - markerWidth);
  const innerWidth = Math.max(1, boxWidth - 4);
  const border = opts.caps.unicode ? UNICODE_BORDER : ASCII_BORDER;
  const borderStyle = focused
    ? resolveRole(opts.theme, "focus", opts.diags)
    : resolveRole(opts.theme, "border", opts.diags);
  const { state, lines } = cachedInner(b, opts, innerWidth, rows, layoutChildren);
  const visible = lines.slice(state.offset, state.offset + rows);
  while (visible.length < rows) visible.push([]);

  if (boxWidth < 4) {
    const rule = border.h.repeat(boxWidth);
    const content = visible.map((line) => {
      const text = truncateToWidth(line.map((span) => span.text).join(""), boxWidth, "", m);
      return tagLine(
        [
          { text: " ".repeat(indent + markerWidth), style: {} },
          { text, style: line[0]?.style ?? {} },
          { text: " ".repeat(Math.max(0, boxWidth - cellWidth(text, m))), style: {} },
        ],
        id,
      );
    });
    return [
      tagLine(
        [
          { text: " ".repeat(indent), style: {} },
          { text: marker + rule, style: borderStyle },
        ],
        id,
      ),
      ...content,
      tagLine(
        [
          { text: " ".repeat(indent + markerWidth), style: {} },
          { text: rule, style: borderStyle },
        ],
        id,
      ),
    ];
  }

  const position =
    state.total > rows
      ? ` ${state.offset + 1}-${Math.min(state.total, state.offset + rows)}/${state.total} `
      : id
        ? ` ${id} `
        : "";
  const maxTitle = Math.max(0, boxWidth - 2);
  const title = truncateToWidth(position, maxTitle, "…", m);
  const titleWidth = cellWidth(title, m);
  const top: Line = tagLine(
    [
      { text: " ".repeat(indent), style: {} },
      { text: marker, style: borderStyle },
      {
        text:
          border.tl + title + border.h.repeat(Math.max(0, boxWidth - 2 - titleWidth)) + border.tr,
        style: borderStyle,
      },
    ],
    id,
  );

  const content: Line[] = visible.map((line) => {
    const plainWidth = lineWidth(line, m);
    const clipped =
      plainWidth > innerWidth
        ? [
            {
              text: truncateToWidth(line.map((span) => span.text).join(""), innerWidth, "…", m),
              style: line[0]?.style ?? {},
            },
          ]
        : line;
    const used = Math.min(innerWidth, lineWidth(clipped, m));
    return tagLine(
      [
        { text: " ".repeat(indent + markerWidth), style: {} },
        { text: `${border.v} `, style: borderStyle },
        ...clipped,
        { text: " ".repeat(Math.max(0, innerWidth - used)), style: {} },
        { text: ` ${border.v}`, style: borderStyle },
      ],
      id,
    );
  });
  const bottom = tagLine(
    [
      { text: " ".repeat(indent + markerWidth), style: {} },
      {
        text: border.bl + border.h.repeat(Math.max(0, boxWidth - 2)) + border.br,
        style: borderStyle,
      },
    ],
    id,
  );
  return [top, ...content, bottom];
}

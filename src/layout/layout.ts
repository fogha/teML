// layout/layout.ts — the heart. AST → styled lines. Blocks stack vertically
// with exactly one blank line between top-level blocks (policy: only
// layoutDocument inserts blanks). Every block degrades under ascii/narrow.

import {
  inlineText,
  buildFootnoteIndex,
  footnoteAppendixOrder,
  footnoteNumber,
} from "../core/index.js";
import type { Block, TDoc } from "../core/index.js";
import type { Capabilities } from "../terminal/capabilities.js";
import { decoration, mergeStyle, resolveRole } from "../terminal/theme.js";
import { cellWidth, truncateToWidth, type MeasureOpts } from "./measure.js";
import type { Line, Span } from "../render/styledLine.js";
import { lineWidth, padLine } from "../render/styledLine.js";
import { wrapSpans } from "./wrap.js";
import { inlineToSpans } from "./inline.js";
import { layoutTable } from "./table.js";
import {
  layoutDetails,
  layoutEvent,
  layoutFigure,
  layoutGrid,
  layoutMetric,
  layoutProgress,
} from "./dashboard.js";
import { layoutButton, layoutCheckbox, layoutInput } from "./interactive.js";
import { recordWidgetHit, shiftHits, visualHeight } from "./hits.js";
import { isAlertContainer } from "../teml/directives.js";
import type { LayoutOpts } from "./opts.js";

export type { LayoutOpts } from "./opts.js";

const B = {
  u: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" },
  a: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" },
};

function measureOpts(opts: LayoutOpts): MeasureOpts {
  return { ambiguousWide: opts.caps.ambiguousWide };
}

function borders(caps: Capabilities) {
  return caps.unicode ? B.u : B.a;
}

export { inlineToSpans };

function semanticStart(opts: LayoutOpts): number {
  return opts.regions?.headings.length ?? 0;
}

function shiftSemanticRows(opts: LayoutOpts, startIndex: number, rowOffset: number): void {
  if (!opts.regions || rowOffset === 0) return;
  for (let i = startIndex; i < opts.regions.headings.length; i++) {
    opts.regions.headings[i]!.row += rowOffset;
  }
}

// ---- blocks → lines -------------------------------------------------------

export function layoutBlock(b: Block, opts: LayoutOpts, indent = 0): Line[] {
  const { width, theme, caps, diags } = opts;
  const m = measureOpts(opts);
  switch (b.type) {
    case "paragraph":
      return wrapSpans(inlineToSpans(b.children, opts), Math.max(1, width - indent), m);

    case "heading": {
      opts.regions?.headings.push({
        id: `heading-${opts.regions.headings.length + 1}`,
        level: b.level,
        row: 0,
        text: inlineText(b.children),
      });
      const role = `heading${b.level}` as const;
      const style = resolveRole(theme, role, diags);
      const raw = inlineText(b.children);
      const label = b.level === 1 ? raw.toUpperCase() : raw;
      const lines = wrapSpans([{ text: label, style }], Math.max(1, width - indent), m);
      const ruleCh = caps.unicode ? (b.level === 1 ? "═" : "─") : b.level === 1 ? "=" : "-";
      if (b.level <= 2) {
        lines.push([
          { text: " ".repeat(indent), style: {} },
          {
            text: ruleCh.repeat(Math.max(1, width - indent)),
            style: resolveRole(theme, "border", diags),
          },
        ]);
      }
      return lines.map((line) =>
        indent > 0 ? [{ text: " ".repeat(indent), style: {} }, ...line] : line,
      );
    }

    case "thematicBreak":
      return [
        [
          { text: " ".repeat(indent), style: {} },
          {
            text: (caps.unicode ? "─" : "-").repeat(Math.max(1, width - indent)),
            style: resolveRole(theme, "border", diags),
          },
        ],
      ];

    case "list":
      return layoutList(b, opts, indent);

    case "quote": {
      const gutter = caps.unicode ? "▎ " : "> ";
      const gutterW = cellWidth(gutter, m);
      const inner = layoutBlocks(
        b.children,
        { ...opts, width: Math.max(1, width - indent - gutterW) },
        true,
        0,
      );
      const gutterStyle = resolveRole(theme, "muted", diags);
      return inner.map((line) => [
        { text: " ".repeat(indent), style: {} },
        { text: gutter, style: gutterStyle },
        ...line.map((s) => ({ ...s, style: { ...gutterStyle, ...s.style } })),
      ]);
    }

    case "codeBlock": {
      const style = resolveRole(theme, "codeBlock", diags);
      const muted = resolveRole(theme, "muted", diags);
      const lines: Line[] = [];
      const codePad = " ";
      const codePadW = cellWidth(codePad, m);
      const innerW = Math.max(1, width - indent - codePadW);

      if (b.language) {
        const lang = b.language;
        const langW = cellWidth(lang, m);
        const padW = Math.max(codePadW, innerW - langW);
        lines.push([
          { text: " ".repeat(indent), style: {} },
          { text: codePad + " ".repeat(Math.max(0, padW - codePadW)), style: {} },
          { text: lang, style: muted },
        ]);
      } else {
        lines.push([{ text: " ".repeat(indent) + codePad, style: {} }]);
      }

      for (const src of b.value.split("\n")) {
        const body = codePad + src;
        if (opts.wrapCode) {
          const codeSpans: Span[] = [{ text: body, style }];
          const wrapped = wrapSpans(codeSpans, innerW, m);
          for (const wl of wrapped) {
            lines.push([{ text: " ".repeat(indent), style: {} }, ...wl]);
          }
        } else if (cellWidth(body, m) > innerW) {
          diags.warn("code-truncated", `code line truncated at width ${width}`);
          lines.push([
            { text: " ".repeat(indent), style: {} },
            { text: truncateToWidth(body, innerW, "…", m), style },
          ]);
        } else {
          lines.push([
            { text: " ".repeat(indent), style: {} },
            { text: body, style },
          ]);
        }
      }

      lines.push([{ text: " ".repeat(indent) + codePad, style: {} }]);
      return lines;
    }

    case "container":
      return layoutContainer(b, opts, indent);

    case "leaf":
      return layoutLeaf(b, opts, indent);

    case "table":
      return layoutTable(b, opts, indent);

    case "definitionList":
      return layoutDefinitionList(b, opts, indent);

    case "footnoteDefinition":
      return [];
  }
}

function taskMarker(checked: boolean, caps: Capabilities): string {
  if (caps.unicode) return checked ? "☑ " : "☐ ";
  return checked ? "[x] " : "[ ] ";
}

function layoutDefinitionList(
  b: Extract<Block, { type: "definitionList" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { width } = opts;
  const m = measureOpts(opts);
  const lines: Line[] = [];
  const termStyle = mergeStyle({}, { bold: true });

  for (const item of b.items) {
    const termSpans = inlineToSpans(item.term, opts, termStyle);
    lines.push(
      ...wrapSpans(termSpans, Math.max(1, width - indent), m).map((line) =>
        indent > 0 ? [{ text: " ".repeat(indent), style: {} }, ...line] : line,
      ),
    );
    const defIndent = indent + 2;
    for (const def of item.definitions) {
      const rowOffset = visualHeight(lines);
      const regionStart = semanticStart(opts);
      const definitionLines = layoutBlocks(
        def,
        { ...opts, width: Math.max(1, width - 2) },
        true,
        defIndent,
      );
      shiftSemanticRows(opts, regionStart, rowOffset);
      lines.push(...definitionLines);
    }
  }
  return lines;
}

function layoutList(b: Extract<Block, { type: "list" }>, opts: LayoutOpts, indent: number): Line[] {
  const { width, theme, caps, diags } = opts;
  const m = measureOpts(opts);
  const lines: Line[] = [];
  b.items.forEach((item, i) => {
    let marker: string;
    if (item.checked === true || item.checked === false) {
      marker = taskMarker(item.checked, caps);
    } else {
      marker = b.ordered ? `${b.start + i}. ` : caps.unicode ? "• " : "* ";
    }
    const markerW = cellWidth(marker, m);
    const baseIndent = indent;
    const contentW = Math.max(1, width - baseIndent - markerW);

    item.blocks.forEach((block, bi) => {
      if (block.type === "list") {
        const rowOffset = visualHeight(lines);
        const hitStart = opts.hits?.length ?? 0;
        const regionStart = semanticStart(opts);
        const nested = layoutList(block, opts, baseIndent + markerW);
        shiftHits(opts, hitStart, rowOffset);
        shiftSemanticRows(opts, regionStart, rowOffset);
        lines.push(...nested);
        return;
      }
      const rowOffset = visualHeight(lines);
      const hitStart = opts.hits?.length ?? 0;
      const regionStart = semanticStart(opts);
      const inner = layoutBlock(block, { ...opts, width: contentW }, 0);
      shiftHits(opts, hitStart, rowOffset);
      shiftSemanticRows(opts, regionStart, rowOffset);
      inner.forEach((line, j) => {
        const showMarker = bi === 0 && j === 0;
        const prefix: Span = {
          text: showMarker ? marker : " ".repeat(markerW),
          style: resolveRole(theme, "listMarker", diags),
        };
        lines.push([{ text: " ".repeat(baseIndent), style: {} }, prefix, ...line]);
      });
    });
  });
  return lines;
}

function layoutContainer(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { width, theme, caps, diags } = opts;
  const m = measureOpts(opts);
  if (b.name === "card") return layoutCard(b, opts, indent);
  if (b.name === "grid") return layoutGrid(b, opts, indent, layoutBlock);
  if (b.name === "details") return layoutDetails(b, opts, indent, layoutBlocks);
  if (b.name === "figure") return layoutFigure(b, opts, indent, layoutBlocks);

  const dec = decoration(theme, b.name);
  if (dec && isAlertContainer(b.name)) {
    const roleStyle = resolveRole(theme, b.name, diags);
    const gutter = (caps.unicode ? dec.gutterUnicode : dec.gutterAscii) + " ";
    const gutterW = cellWidth(gutter, m);
    const label = caps.unicode ? dec.labelUnicode : dec.labelAscii;
    const title = b.attrs.title;
    const headerText = title ? `${label}: ${title}` : label;
    const regionStart = semanticStart(opts);
    const inner = layoutBlocks(
      b.children,
      { ...opts, width: Math.max(1, width - indent - gutterW) },
      true,
      0,
    );
    const headerSpans: Span[] = [
      { text: gutter, style: roleStyle },
      { text: headerText, style: roleStyle },
    ];
    const headerLines = wrapSpans(headerSpans, Math.max(1, width - indent), m);
    const out: Line[] = headerLines.map((line) => [
      { text: " ".repeat(indent), style: {} },
      ...line,
    ]);
    shiftSemanticRows(opts, regionStart, visualHeight(headerLines));
    for (const line of inner) {
      out.push([
        { text: " ".repeat(indent), style: {} },
        { text: gutter, style: roleStyle },
        ...line,
      ]);
    }
    return out;
  }
  const regionStart = semanticStart(opts);
  const inner = layoutBlocks(b.children, opts, true, indent);
  shiftSemanticRows(opts, regionStart, 1);
  return [
    [
      { text: " ".repeat(indent), style: {} },
      { text: `[${b.name}]`, style: resolveRole(theme, "muted", diags) },
    ],
    ...inner,
  ];
}

function layoutCard(
  b: Extract<Block, { type: "container" }>,
  opts: LayoutOpts,
  indent: number,
): Line[] {
  const { width, theme, caps, diags } = opts;
  const m = measureOpts(opts);
  const bd = borders(caps);
  const borderStyle = resolveRole(theme, "border", diags);
  const outerW = Math.max(1, width - indent);
  const innerWidth = Math.max(1, outerW - 4);
  const hitStart = opts.hits?.length ?? 0;
  const regionStart = semanticStart(opts);
  const inner = layoutBlocks(b.children, { ...opts, width: innerWidth }, true, 0);
  shiftHits(opts, hitStart, 1); // account for the "top" border/title line prepended below
  shiftSemanticRows(opts, regionStart, 1);

  // Reserve "┌─" (2) + "┐" (1) so the title itself is truncated instead of
  // letting topFill clamp to 0 while an oversized title still overflows outerW.
  const maxTitleW = Math.max(0, outerW - 3);
  const rawTitle = b.attrs.title ? ` ${b.attrs.title} ` : "";
  const title =
    cellWidth(rawTitle, m) > maxTitleW ? truncateToWidth(rawTitle, maxTitleW, "…", m) : rawTitle;
  const titleW = cellWidth(title, m);
  const topFill = Math.max(0, outerW - 2 - 1 - titleW);
  const top: Line = title
    ? [
        { text: " ".repeat(indent), style: {} },
        { text: bd.tl + bd.h, style: borderStyle },
        { text: title, style: resolveRole(theme, "cardTitle", diags) },
        { text: bd.h.repeat(topFill) + bd.tr, style: borderStyle },
      ]
    : [
        { text: " ".repeat(indent), style: {} },
        { text: bd.tl + bd.h.repeat(Math.max(0, outerW - 2)) + bd.tr, style: borderStyle },
      ];

  const rows: Line[] = inner.map((line) => {
    let content = line;
    let lw = lineWidth(content, m);
    if (lw > innerWidth) {
      const plain = content.map((s) => s.text).join("");
      content = [
        { text: truncateToWidth(plain, innerWidth, "…", m), style: content[0]?.style ?? {} },
      ];
      lw = lineWidth(content, m);
    }
    const pad = Math.max(0, innerWidth - lw);
    return [
      { text: " ".repeat(indent), style: {} },
      { text: bd.v + " ", style: borderStyle },
      ...content,
      { text: " ".repeat(pad), style: {} },
      { text: " " + bd.v, style: borderStyle },
    ];
  });
  const bottom: Line = [
    { text: " ".repeat(indent), style: {} },
    { text: bd.bl + bd.h.repeat(Math.max(0, outerW - 2)) + bd.br, style: borderStyle },
  ];
  return [top, ...rows, bottom];
}

function layoutLeaf(b: Extract<Block, { type: "leaf" }>, opts: LayoutOpts, indent: number): Line[] {
  const { width, theme, diags } = opts;
  const m = measureOpts(opts);
  const pad = " ".repeat(indent);
  const innerW = Math.max(1, width - indent);
  switch (b.name) {
    case "kv": {
      const entries = Object.entries(b.attrs);
      const keyW = Math.max(0, ...entries.map(([k]) => cellWidth(k, m)));
      return entries.map(([k, v]) => {
        const row = pad + k.padEnd(keyW + 2) + v;
        if (cellWidth(row, m) > innerW) {
          return [
            {
              text: truncateToWidth(row, innerW, "…", m),
              style: resolveRole(theme, "muted", diags),
            },
          ];
        }
        return [
          { text: pad, style: {} },
          { text: k.padEnd(keyW + 2), style: resolveRole(theme, "muted", diags) },
          { text: v, style: {} },
        ];
      });
    }
    case "image": {
      const label = `[Image: ${b.attrs.alt ?? b.attrs.src ?? "image"}]`;
      return [
        [
          { text: pad, style: {} },
          {
            text: truncateToWidth(label, innerW, "…", m),
            style: resolveRole(theme, "muted", diags),
          },
        ],
      ];
    }
    case "metric":
      return layoutMetric(b, opts, indent);
    case "progress":
      return layoutProgress(b, opts, indent);
    case "event":
      return layoutEvent(b, opts, indent);
    case "button": {
      const lines = layoutButton(b, opts, indent);
      recordWidgetHit(opts, b, lines);
      return lines;
    }
    case "input": {
      const lines = layoutInput(b, opts, indent);
      recordWidgetHit(opts, b, lines);
      return lines;
    }
    case "checkbox": {
      const lines = layoutCheckbox(b, opts, indent);
      recordWidgetHit(opts, b, lines);
      return lines;
    }
    case "break":
      return [[]];
    default:
      opts.diags.warn("unknown-directive", `unknown leaf directive ::${b.name}`);
      return [
        [
          { text: pad, style: {} },
          { text: `[${b.name}]`, style: resolveRole(theme, "muted", diags) },
        ],
      ];
  }
}

function layoutFootnoteAppendix(opts: LayoutOpts): Line[] {
  const index = opts.footnotes;
  if (!index || index.order.size === 0) return [];

  const { width, theme, caps, diags } = opts;
  const borderStyle = resolveRole(theme, "border", diags);
  const muted = resolveRole(theme, "muted", diags);
  const ruleCh = caps.unicode ? "─" : "-";
  const lines: Line[] = [
    [{ text: ruleCh.repeat(Math.max(1, width)), style: borderStyle }],
    [{ text: "Footnotes", style: mergeStyle(muted, { bold: true }) }],
    [],
  ];

  for (const id of footnoteAppendixOrder(index)) {
    const num = footnoteNumber(index, id)!;
    const def = index.definitions.get(id);
    if (!def) continue;
    lines.push(
      clampFootnoteLine([{ text: `${num}. [${id}]`, style: muted }], width, 0, measureOpts(opts)),
    );
    for (const line of layoutBlocks(
      def.children,
      { ...opts, width: Math.max(1, width - 4) },
      true,
      4,
    )) {
      lines.push(clampFootnoteLine(line, width, 0, measureOpts(opts)));
    }
    lines.push([]);
  }
  if (lines[lines.length - 1]?.length === 0) lines.pop();
  return lines;
}

function clampFootnoteLine(line: Line, outerW: number, indent: number, m: MeasureOpts): Line {
  const w = lineWidth(line, m);
  const max = Math.max(1, outerW);
  if (w <= max) return line;
  const plain = line.map((s) => s.text).join("");
  const style = line.find((s) => s.text.trim())?.style ?? {};
  return [
    { text: " ".repeat(indent), style: {} },
    { text: truncateToWidth(plain, max - indent, "…", m), style },
  ];
}

function layoutBlocks(
  blocks: Block[],
  opts: LayoutOpts,
  blankBetween: boolean,
  indent = 0,
): Line[] {
  const out: Line[] = [];
  let visualRow = 0;
  blocks.forEach((b, i) => {
    if (i > 0 && blankBetween) {
      out.push([]);
      visualRow += 1;
    }
    const hitStart = opts.hits?.length ?? 0;
    const regionStart = semanticStart(opts);
    const lines = layoutBlock(b, opts, indent);
    shiftHits(opts, hitStart, visualRow);
    shiftSemanticRows(opts, regionStart, visualRow);
    out.push(...lines);
    visualRow += visualHeight(lines);
  });
  return out;
}

export function layoutDocument(docNode: TDoc, opts: LayoutOpts): Line[] {
  const footnotes = buildFootnoteIndex(docNode.blocks, opts.diags);
  const layoutOpts: LayoutOpts = { ...opts, footnotes };
  const visible = docNode.blocks.filter((b) => b.type !== "footnoteDefinition");
  const out: Line[] = [];
  let visualRow = 0;
  visible.forEach((b, i) => {
    if (i > 0) {
      out.push([]);
      visualRow += 1;
    }
    const hitStart = layoutOpts.hits?.length ?? 0;
    const regionStart = semanticStart(layoutOpts);
    const lines = layoutBlock(b, layoutOpts, 0);
    shiftHits(layoutOpts, hitStart, visualRow);
    shiftSemanticRows(layoutOpts, regionStart, visualRow);
    out.push(...lines);
    visualRow += visualHeight(lines);
  });
  const appendix = layoutFootnoteAppendix(layoutOpts);
  if (appendix.length) {
    if (out.length) out.push([]);
    out.push(...appendix);
  }
  return out;
}

export { padLine };

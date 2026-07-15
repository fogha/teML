import type { TDoc } from "../core/ast.js";
import { inlineText } from "../core/ast.js";
import type { Line, Span } from "../render/styledLine.js";
import { cellWidth, graphemes, type MeasureOpts } from "./measure.js";
import { layoutDocument } from "./layout.js";
import type { LayoutOpts } from "./opts.js";

export type LinkRegion = {
  id: string;
  href: string;
  row: number;
  colStart: number;
  colEnd: number;
  label: string;
};

export type HeadingRegion = {
  id: string;
  level: 1 | 2 | 3 | 4;
  row: number;
  text: string;
};

export type SemanticRegions = {
  headings: HeadingRegion[];
};

export type DetailedLayout = {
  lines: Line[];
  links: LinkRegion[];
  headings: HeadingRegion[];
};

function spanSegments(span: Span): string[] {
  return span.text.split("\n");
}

export function collectLinkRegions(lines: readonly Line[], opts?: MeasureOpts): LinkRegion[] {
  const links: LinkRegion[] = [];
  let row = 0;
  let col = 0;
  let active: LinkRegion | null = null;

  const closeActive = (): void => {
    if (!active) return;
    const previous = links[links.length - 1];
    if (previous && previous.href === active.href && previous.row === active.row) {
      previous.label += " ".repeat(Math.max(0, active.colStart - previous.colEnd)) + active.label;
      previous.colEnd = active.colEnd;
    } else {
      active.id = `link-${links.length + 1}`;
      links.push(active);
    }
    active = null;
  };

  for (const line of lines) {
    col = 0;
    for (const span of line) {
      const segments = spanSegments(span);
      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        if (segmentIndex > 0) {
          closeActive();
          row += 1;
          col = 0;
        }
        const text = segments[segmentIndex]!;
        if (!text) continue;
        const width = graphemes(text).reduce((sum, grapheme) => sum + cellWidth(grapheme, opts), 0);
        const href = span.style.href;
        if (href) {
          if (!active || active.href !== href || active.row !== row || active.colEnd !== col) {
            closeActive();
            active = {
              id: "",
              href,
              row,
              colStart: col,
              colEnd: col + width,
              label: text,
            };
          } else {
            active.colEnd += width;
            active.label += text;
          }
        } else {
          closeActive();
        }
        col += width;
      }
    }
    closeActive();
    row += 1;
  }
  return links;
}

export function layoutDocumentDetailed(doc: TDoc, opts: LayoutOpts): DetailedLayout {
  const collector: SemanticRegions = { headings: [] };
  const lines = layoutDocument(doc, { ...opts, regions: collector });
  return {
    lines,
    links: collectLinkRegions(lines, { ambiguousWide: opts.caps.ambiguousWide }),
    headings: collector.headings,
  };
}

export function recordHeading(
  regions: SemanticRegions | undefined,
  level: 1 | 2 | 3 | 4,
  children: Parameters<typeof inlineText>[0],
): void {
  if (!regions) return;
  regions.headings.push({
    id: `heading-${regions.headings.length + 1}`,
    level,
    row: 0,
    text: inlineText(children),
  });
}

export function linkAt(
  links: readonly LinkRegion[],
  row: number,
  col: number,
): LinkRegion | undefined {
  return links.find((link) => link.row === row && col >= link.colStart && col < link.colEnd);
}

export function nextLink(
  links: readonly LinkRegion[],
  currentId: string | null,
  direction: 1 | -1,
): LinkRegion | undefined {
  if (links.length === 0) return undefined;
  const current = links.findIndex((link) => link.id === currentId);
  const start = current < 0 ? (direction === 1 ? -1 : 0) : current;
  const index = (start + direction + links.length) % links.length;
  return links[index];
}

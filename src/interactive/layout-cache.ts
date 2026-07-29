import { buildFootnoteIndex, type Block, type TDoc } from "../core/index.js";
import { collectWidgetHits, type WidgetHit } from "../layout/hits.js";
import { layoutBlock, layoutDocument } from "../layout/layout.js";
import type { LayoutOpts } from "../layout/opts.js";
import { physicalLines } from "../render/screen.js";
import type { Line } from "../render/styledLine.js";
import {
  isFocusableContainer,
  isFocusableLeaf,
  isMutationContainer,
  isUpdatableLeaf,
} from "../teml/directives.js";

type BlockRecord = {
  block: Block;
  rawStart: number;
  rawLength: number;
  physicalStart: number;
  physicalLength: number;
};

function collectWidgetIds(block: Block, out: string[]): void {
  switch (block.type) {
    case "leaf": {
      if (!isFocusableLeaf(block.name) && !isUpdatableLeaf(block.name)) return;
      const id = block.attrs.id?.trim();
      if (id) out.push(id);
      return;
    }
    case "list":
      for (const item of block.items) {
        for (const child of item.blocks) collectWidgetIds(child, out);
      }
      return;
    case "quote":
    case "footnoteDefinition":
      for (const child of block.children) collectWidgetIds(child, out);
      return;
    case "container": {
      if (isFocusableContainer(block.name) || isMutationContainer(block.name)) {
        const id = block.attrs.id?.trim();
        if (id) out.push(id);
        if (isFocusableContainer(block.name)) return;
      }
      for (const child of block.children) collectWidgetIds(child, out);
      return;
    }
    case "definitionList":
      for (const item of block.items) {
        for (const definition of item.definitions) {
          for (const child of definition) collectWidgetIds(child, out);
        }
      }
      return;
    default:
      return;
  }
}

/**
 * Caches the laid-out document while allowing the top-level subtree that
 * contains an edited/focused widget to be replaced independently. Static
 * blocks are never laid out again, so a viewport frame for a long document
 * costs roughly the visible row count rather than the document row count.
 */
export class InteractiveLayoutCache {
  private doc: TDoc;
  private records: BlockRecord[] = [];
  private blockByWidget = new Map<string, number>();
  private footnotes: ReturnType<typeof buildFootnoteIndex>;
  private raw: Line[] = [];
  private physical: Line[] = [];
  private widgetHits: WidgetHit[] = [];
  private focusedId: string | undefined;
  private cursorPos: number | undefined;
  private selectionActive: boolean | undefined;

  constructor(doc: TDoc, opts: LayoutOpts) {
    this.doc = doc;
    this.footnotes = buildFootnoteIndex(doc.blocks, opts.diags);
    this.rebuild(opts);
    this.rememberInteractiveOpts(opts);
  }

  rawLines(): Line[] {
    return this.raw;
  }

  physicalLines(): Line[] {
    return this.physical;
  }

  hits(): WidgetHit[] {
    return this.widgetHits;
  }

  update(opts: LayoutOpts, dirtyWidgetIds: ReadonlySet<string>): void {
    const effectiveDirty = new Set(dirtyWidgetIds);
    if (opts.focusedId !== this.focusedId) {
      if (this.focusedId) effectiveDirty.add(this.focusedId);
      if (opts.focusedId) effectiveDirty.add(opts.focusedId);
    } else if (
      opts.focusedId &&
      (opts.cursorPos !== this.cursorPos || opts.selectionActive !== this.selectionActive)
    ) {
      effectiveDirty.add(opts.focusedId);
    }
    if (effectiveDirty.size === 0) {
      this.rememberInteractiveOpts(opts);
      return;
    }
    const indexes = new Set<number>();
    for (const id of effectiveDirty) {
      const index = this.blockByWidget.get(id);
      if (index == null) {
        // A focusable inside a footnote appendix or another non-standard
        // layout location cannot be replaced as a visible top-level block.
        this.rebuild(opts);
        this.rememberInteractiveOpts(opts);
        return;
      }
      indexes.add(index);
    }

    for (const index of [...indexes].sort((a, b) => a - b)) {
      this.relayoutBlock(index, opts);
    }
    this.rememberInteractiveOpts(opts);
  }

  private rememberInteractiveOpts(opts: LayoutOpts): void {
    this.focusedId = opts.focusedId;
    this.cursorPos = opts.cursorPos;
    this.selectionActive = opts.selectionActive;
  }

  private rebuild(opts: LayoutOpts): void {
    this.records = [];
    this.blockByWidget.clear();
    this.raw = [];
    this.physical = [];

    const blockOpts: LayoutOpts = { ...opts, footnotes: this.footnotes, hits: undefined };
    const visible = this.doc.blocks.filter((block) => block.type !== "footnoteDefinition");
    for (let index = 0; index < visible.length; index++) {
      if (index > 0) {
        this.raw.push([]);
        this.physical.push([]);
      }

      const block = visible[index]!;
      const rawStart = this.raw.length;
      const physicalStart = this.physical.length;
      const rawLines = layoutBlock(block, blockOpts, 0);
      const physical = physicalLines(rawLines);
      this.raw.push(...rawLines);
      this.physical.push(...physical);
      this.records.push({
        block,
        rawStart,
        rawLength: rawLines.length,
        physicalStart,
        physicalLength: physical.length,
      });

      const ids: string[] = [];
      collectWidgetIds(block, ids);
      for (const id of ids) {
        if (!this.blockByWidget.has(id)) this.blockByWidget.set(id, index);
      }
    }

    // Footnote definitions are rendered as an appendix by layoutDocument.
    // Keep that static suffix byte-identical without making it part of the
    // incremental widget replacement model.
    if (this.footnotes.order.size > 0) {
      const complete = layoutDocument(this.doc, { ...opts, hits: undefined });
      if (complete.length > this.raw.length) {
        const suffix = complete.slice(this.raw.length);
        this.raw.push(...suffix);
        this.physical.push(...physicalLines(suffix));
      }
    }

    this.widgetHits = collectWidgetHits(this.raw, {
      ambiguousWide: opts.caps.ambiguousWide,
    });
  }

  private relayoutBlock(index: number, opts: LayoutOpts): void {
    const record = this.records[index]!;
    const blockOpts: LayoutOpts = { ...opts, footnotes: this.footnotes, hits: undefined };
    const nextRaw = layoutBlock(record.block, blockOpts, 0);
    const nextPhysical = physicalLines(nextRaw);
    const rawDelta = nextRaw.length - record.rawLength;
    const physicalDelta = nextPhysical.length - record.physicalLength;
    const oldPhysicalEnd = record.physicalStart + record.physicalLength;

    this.raw.splice(record.rawStart, record.rawLength, ...nextRaw);
    this.physical.splice(record.physicalStart, record.physicalLength, ...nextPhysical);

    this.widgetHits = this.widgetHits
      .filter((hit) => hit.row < record.physicalStart || hit.row >= oldPhysicalEnd)
      .map((hit) =>
        hit.row >= oldPhysicalEnd && physicalDelta !== 0
          ? { ...hit, row: hit.row + physicalDelta }
          : hit,
      );
    this.widgetHits.push(
      ...collectWidgetHits(nextRaw, { ambiguousWide: opts.caps.ambiguousWide }).map((hit) => ({
        ...hit,
        row: hit.row + record.physicalStart,
      })),
    );
    this.widgetHits.sort((a, b) => a.row - b.row || a.colStart - b.colStart);

    record.rawLength = nextRaw.length;
    record.physicalLength = nextPhysical.length;
    if (rawDelta !== 0 || physicalDelta !== 0) {
      for (let later = index + 1; later < this.records.length; later++) {
        this.records[later]!.rawStart += rawDelta;
        this.records[later]!.physicalStart += physicalDelta;
      }
    }
  }
}

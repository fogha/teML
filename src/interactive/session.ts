// interactive/session.ts — the state machine behind `teml run` (M-interactive
// step 5). Consumes decoded Commands (from protocol.ts), owns a mutable
// working copy of the document, and emits SessionEvents. No terminal I/O and
// no direct JSON handling here — the CLI (step 7) owns stdin/stdout framing.
//
// Values live directly on the document: focusable leafs' `attrs.value`/
// `attrs.checked` are mutated in place as the user types/toggles, and
// re-rendered through InteractiveLayoutCache. Static document blocks stay
// cached while the top-level subtree containing an edited/focused widget is
// replaced, avoiding a second value map and keeping large viewport sessions
// proportional to visible/changed rows.

import type { Diagnostics, SanitizeOpts, TDoc } from "../core/index.js";
import { normalize, sanitizeText } from "../core/index.js";
import { htmlToDoc } from "../html/index.js";
import { parseMarkdown } from "../markdown/parse.js";
import { parseTeml } from "../teml/parse.js";
import type { LayoutOpts } from "../layout/layout.js";
import { graphemes } from "../layout/measure.js";
import { hitAt, type WidgetHit } from "../layout/hits.js";
import {
  graphemeToTextareaVisual,
  keepTextareaCursorVisible as clampTextareaScroll,
  textareaRows,
  textareaVisualLines,
  textareaVisualToGrapheme,
} from "../layout/textarea.js";
import type { ScrollRegionRuntime } from "../layout/opts.js";
import {
  clampScrollRow,
  ensureRowVisible,
  scrollByPage,
  sliceDocumentLines,
} from "../reader/viewport.js";
import { renderAnsi } from "../render/ansi.js";
import { renderPlain } from "../render/plain.js";
import {
  clampTerminalHeight,
  clampTerminalWidth,
  type Capabilities,
} from "../terminal/capabilities.js";
import type { Theme } from "../terminal/theme.js";
import { nextFocusId, prevFocusId, type FocusableWidget } from "./focus.js";
import {
  applyUpdateProps,
  collectInteractiveWidgets,
  validateUpdateProps,
  type MutationTarget,
  type UpdatableWidget,
} from "./updatable.js";
import {
  applyScrollDelta,
  normalizeKey,
  routeKey,
  type InputContext,
  type NormalizedKey,
} from "./input-routing.js";
import { InteractiveLayoutCache } from "./layout-cache.js";
import { containsFootnoteContent, countBlocks, parseMutationFragment } from "./mutation.js";
import { radioOptionIndex } from "./radio.js";
import type {
  Command,
  DocFormat,
  FrameFormat,
  FrameMode,
  FramePatch,
  KeyModifiers,
  KeyName,
  ProtocolCapability,
  ScrollRegionMeta,
  SessionEvent,
  ViewportMeta,
} from "./protocol.js";
import {
  checkMarkupBudget,
  ENGINE_CAPABILITIES,
  MAX_DOCUMENT_BLOCKS,
  MAX_MUTATION_TARGET_CHILDREN,
  protocolMetadata,
} from "./protocol.js";

/** The parts of LayoutOpts that stay fixed for the lifetime of a session. */
export type SessionLayoutConfig = {
  width: number;
  /** Terminal content height. Oversized documents emit a viewport slice. */
  height?: number;
  theme: Theme;
  caps: Capabilities;
  wrapCode?: boolean;
  showUrls?: boolean;
};

export type SessionOptions = {
  diags: Diagnostics;
  layout: SessionLayoutConfig;
  /** Reused for both the initial doc and any `render` command's markup. */
  sanitize?: SanitizeOpts;
  /** Pre-negotiated frame payload (the `--frames` CLI flag). Equivalent to a
   * `configure` command sent before the session starts: negotiation is
   * already done, so a later `configure` is rejected. */
  frames?: FrameFormat;
  /** Pre-negotiated delivery mode (the `--mode` CLI flag). */
  mode?: FrameMode;
};

function isChecked(attrs: Record<string, string>): boolean {
  return attrs.checked?.trim().toLowerCase() === "true";
}

/** Rendered frames end with exactly one trailing "\n" (renderPlain/renderAnsi
 * join rows with "\n" and append one), so strip it and split into rows. */
function splitRows(rendered: string): string[] {
  return rendered.endsWith("\n") ? rendered.slice(0, -1).split("\n") : rendered.split("\n");
}

function widgetValue(w: FocusableWidget): string {
  if (w.name === "checkbox") return String(isChecked(w.attrs));
  return w.attrs.value ?? "";
}

export class InteractiveSession {
  private diags: Diagnostics;
  private layout: SessionLayoutConfig;
  private sanitizeOpts: SanitizeOpts;
  private doc: TDoc;
  private documentBlockCount: number;
  private focusables: FocusableWidget[];
  private updatables: UpdatableWidget[];
  private mutationTargets: MutationTarget[];
  private focusedId: string | null;
  /** Grapheme index into each input's value, keyed by widget id. Lazily
   * defaulted to "end of value" the first time a field is read; persists
   * across focus changes so returning to a field resumes where you left it. */
  private cursor = new Map<string, number>();
  /** Preferred terminal-cell column for textarea vertical navigation. */
  private preferredCol = new Map<string, number>();
  private textareaScrollOffsets = new Map<string, number>();
  private radioPending = new Map<string, number>();
  private scrollRegionRuntime = new Map<string, ScrollRegionRuntime>();
  /** Ids of inputs whose value is still exactly the document-supplied
   * default (set at construction or by a `render`) and hasn't been edited
   * by the user yet — mirrors a browser's "select all on focus" for a
   * pre-filled field. While an id is in here, the whole value renders as
   * selected (no caret) and the first edit replaces it outright: typing
   * overwrites it, backspace clears it. Any edit removes the id. */
  private untouchedDefault = new Set<string>();
  /** Row ranges from the most recently rendered frame, for `pointer` commands. */
  private lastHits: WidgetHit[] = [];
  /** Cached full layout plus independently replaceable widget subtrees. */
  private layoutCache: InteractiveLayoutCache | undefined;
  private dirtyWidgetIds = new Set<string>();
  private scrollOffset = 0;
  private lastFrameOffset = 0;
  private lastFrameRows = 0;
  private ensureFocusedVisible = true;
  private seq = 0;
  private done = false;
  /** Negotiated frame payload — v1 default is both renderings. */
  private framesFormat: FrameFormat = "both";
  /** Negotiated frame mode — v1 default is complete re-renders. */
  private frameMode: FrameMode = "full";
  /** Rows of the most recently emitted frame, per format — the base for
   * patches-mode diffs. `null` for formats the last frame didn't carry. */
  private prevRows: { plain: string[] | null; ansi: string[] | null } = {
    plain: null,
    ansi: null,
  };
  /** Why negotiation is closed, or `null` while `configure` is still accepted.
   * The cause is kept (not just the fact) so a rejection can name it: a host
   * told only "configure must be the first command" after passing `--frames`
   * has no way to tell that its own first command was not the problem. */
  private configureLock: "startup-flags" | "configure" | "command" | null = null;
  /** Capability metadata is additive, but only negotiated sessions emit it so
   * the original default-v1 transcript remains byte-identical. */
  private advertiseCapabilities = false;

  constructor(doc: TDoc, opts: SessionOptions) {
    this.diags = opts.diags;
    this.layout = opts.layout;
    this.sanitizeOpts = opts.sanitize ?? {};
    this.doc = doc;
    this.documentBlockCount = countBlocks(doc.blocks);
    if (this.documentBlockCount > MAX_DOCUMENT_BLOCKS) {
      // The budget bounds *growth*: every mutation path below rejects while the
      // count is over the limit. An oversized startup document still renders,
      // because per-frame cost is bounded by the viewport, not the block count.
      this.diags.warn(
        "document-blocks-over-budget",
        `document has ${this.documentBlockCount} blocks, above the ${MAX_DOCUMENT_BLOCKS}-block mutation budget; structural mutations will be rejected`,
      );
    }
    const identity = collectInteractiveWidgets(doc, this.diags);
    this.focusables = identity.focusables;
    this.updatables = identity.updatables;
    this.mutationTargets = identity.mutationTargets;
    this.focusedId = this.focusables[0]?.id ?? null;
    this.markDefaultsUntouched(this.focusables);
    if (opts.frames) {
      this.framesFormat = opts.frames;
    }
    if (opts.mode) {
      this.frameMode = opts.mode;
    }
    if (opts.frames || opts.mode) {
      this.configureLock = "startup-flags";
      this.advertiseCapabilities = true;
    }
    this.initializeRadioPending(this.currentWidget());
  }

  /** (Re)populate untouchedDefault: every input with a non-empty value
   * counts as an untouched default until the user edits it. */
  private markDefaultsUntouched(widgets: FocusableWidget[]): void {
    this.untouchedDefault.clear();
    for (const w of widgets) {
      if ((w.name === "input" || w.name === "textarea") && (w.attrs.value ?? "") !== "") {
        this.untouchedDefault.add(w.id);
      }
    }
  }

  /** True once an `exit` command has been processed; the host should stop sending commands. */
  isDone(): boolean {
    return this.done;
  }

  getFocusedId(): string | null {
    return this.focusedId;
  }

  getLayoutSize(): { width: number; height?: number } {
    return { width: this.layout.width, height: this.layout.height };
  }

  /** Snapshot of every focusable widget's current value ("true"/"false" for checkboxes). */
  values(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const w of this.focusables) {
      if (w.name !== "scroll") out[w.id] = widgetValue(w);
    }
    return out;
  }

  getCapabilities(): readonly ProtocolCapability[] {
    return ENGINE_CAPABILITIES;
  }

  /** Render and return the very first frame. Call once before reading any commands. */
  start(): SessionEvent[] {
    return [this.frame(true)];
  }

  /** Process one decoded command, returning the events it produces (in order). */
  handle(command: Command): SessionEvent[] {
    if (this.done) return [];
    if (command.type !== "configure") this.configureLock ??= "command";
    switch (command.type) {
      case "configure":
        return this.handleConfigure(command.frames, command.mode);
      case "key":
        return this.handleKey(command.key, command.modifiers);
      case "char":
        return this.handleChar(command.char);
      case "pointer":
        return this.handlePointer(command.row, command.col);
      case "scroll":
        return this.handleScroll(command.rows);
      case "resize":
        return this.handleResize(command.width, command.height);
      case "render":
        return this.handleRender(command.markup, command.format);
      case "update":
        return this.handleUpdate(command.id, command.props);
      case "replace":
        return this.handleReplace(command.target, command.markup, command.format);
      case "append":
        return this.handleAppend(command.target, command.markup, command.format);
      case "remove":
        return this.handleRemove(command.target);
      case "exit":
        this.done = true;
        return [{ type: "exit" }];
    }
  }

  /** Negotiate the frame payload and mode. Only valid before any other
   * command; the ack frame is itself emitted in the newly negotiated format —
   * and always in full, so the host re-syncs from a clean base. */
  private handleConfigure(frames: FrameFormat, mode: FrameMode | undefined): SessionEvent[] {
    if (this.configureLock) {
      return [{ type: "error", message: this.configureRejection(frames, mode) }, this.frame(true)];
    }
    this.framesFormat = frames;
    this.frameMode = mode ?? "full";
    this.configureLock = "configure";
    this.advertiseCapabilities = true;
    return [this.frame(true)];
  }

  /** Explain a rejected `configure`: the cause, then every requested setting
   * the session is *not* honoring. Without the second half a host that asked
   * for `mode: "patches"` and kept receiving full frames had nothing in the
   * error to connect the two. */
  private configureRejection(frames: FrameFormat, mode: FrameMode | undefined): string {
    const cause =
      this.configureLock === "startup-flags"
        ? "the --frames/--mode startup flags already negotiated this session"
        : this.configureLock === "configure"
          ? "an earlier configure already negotiated this session"
          : "another command already started the session";
    // Only settings the host actually asked for: `mode` is optional, so an
    // omitted one must not be reported as a rejected "full".
    const ignored: string[] = [];
    if (frames !== this.framesFormat) ignored.push(`frames=${frames} (still ${this.framesFormat})`);
    if (mode !== undefined && mode !== this.frameMode) {
      ignored.push(`mode=${mode} (still ${this.frameMode})`);
    }
    const detail = ignored.length > 0 ? `; ignored ${ignored.join(", ")}` : "";
    return `configure rejected: ${cause}${detail}`;
  }

  /** Re-layout the existing document at live terminal dimensions. Widget
   * values, focus, cursor positions, selections, and negotiation stay intact.
   * Width changes invalidate every host row, so resize is always a full-frame
   * resynchronization point even when patches mode is active. */
  private handleResize(width: number, height?: number): SessionEvent[] {
    const nextWidth = clampTerminalWidth(width);
    if (nextWidth !== this.layout.width) this.layoutCache = undefined;
    this.layout.width = nextWidth;
    this.layout.caps = { ...this.layout.caps, width: nextWidth };
    if (height !== undefined) {
      this.layout.height = clampTerminalHeight(height);
    }
    this.ensureFocusedVisible = true;
    return [this.frame(true)];
  }

  private currentWidget(): FocusableWidget | undefined {
    if (this.focusedId == null) return undefined;
    return this.focusables.find((w) => w.id === this.focusedId);
  }

  private inputContext(): InputContext {
    return this.currentWidget()?.name ?? "global";
  }

  private initializeRadioPending(widget: FocusableWidget | undefined): void {
    if (widget?.name !== "radio" || this.radioPending.has(widget.id)) return;
    const selected = radioOptionIndex(widget.options ?? [], widget.attrs.value);
    this.radioPending.set(widget.id, selected >= 0 ? selected : 0);
  }

  private markWidgetDirty(id: string | null | undefined): void {
    if (!id) return;
    this.dirtyWidgetIds.add(id);
    if (id === this.focusedId) this.ensureFocusedVisible = true;
  }

  private setFocusedId(id: string | null): void {
    if (id === this.focusedId) return;
    const previous = this.currentWidget();
    if (previous?.name === "radio") this.radioPending.delete(previous.id);
    this.markWidgetDirty(this.focusedId);
    this.focusedId = id;
    this.initializeRadioPending(this.currentWidget());
    this.markWidgetDirty(id);
    this.ensureFocusedVisible = true;
  }

  private keepFocusedWidgetVisible(
    hits: readonly WidgetHit[],
    totalRows: number,
    visibleRows: number,
  ): void {
    if (!this.focusedId) return;
    const focused = hits.filter((hit) => hit.id === this.focusedId);
    if (focused.length === 0) return;
    const first = Math.min(...focused.map((hit) => hit.row));
    const last = Math.max(...focused.map((hit) => hit.row));
    this.scrollOffset = ensureRowVisible(this.scrollOffset, first, totalRows, visibleRows);
    if (last - first + 1 <= visibleRows) {
      this.scrollOffset = ensureRowVisible(this.scrollOffset, last, totalRows, visibleRows);
    }
  }

  /** Cursor position for a given input, lazily defaulting to (and caching) end-of-value. */
  private cursorFor(w: FocusableWidget): number {
    const len = graphemes(w.attrs.value ?? "").length;
    let pos = this.cursor.get(w.id);
    if (pos == null || pos > len) {
      pos = len;
      this.cursor.set(w.id, pos);
    }
    return pos;
  }

  private moveCursor(w: FocusableWidget, delta: number): void {
    const len = graphemes(w.attrs.value ?? "").length;
    const pos = this.cursorFor(w);
    this.cursor.set(w.id, Math.max(0, Math.min(len, pos + delta)));
  }

  private textareaContentWidth(id: string): number {
    const hit = this.lastHits.find(
      (candidate) => candidate.id === id && candidate.kind === "textareaContent",
    );
    return Math.max(1, hit ? hit.colEnd - hit.colStart : this.layout.width - 4);
  }

  private textareaGeometry(w: FocusableWidget): {
    value: string;
    lines: ReturnType<typeof textareaVisualLines>;
    rows: number;
  } {
    const value = w.attrs.value ?? "";
    return {
      value,
      lines: textareaVisualLines(value, this.textareaContentWidth(w.id), {
        ambiguousWide: this.layout.caps.ambiguousWide,
      }),
      rows: textareaRows(w.attrs.rows),
    };
  }

  private keepTextareaCursorVisible(w: FocusableWidget): void {
    const geometry = this.textareaGeometry(w);
    const cursor = graphemeToTextareaVisual(geometry.value, this.cursorFor(w), geometry.lines, {
      ambiguousWide: this.layout.caps.ambiguousWide,
    });
    const current = this.textareaScrollOffsets.get(w.id) ?? 0;
    this.textareaScrollOffsets.set(
      w.id,
      clampTextareaScroll(current, cursor.line, geometry.lines.length, geometry.rows),
    );
  }

  private handleKey(key: KeyName, modifiers?: KeyModifiers): SessionEvent[] {
    const routed = routeKey(this.inputContext(), normalizeKey(key, modifiers));
    if (routed.target === "noop") return [this.frame()];
    if (routed.target === "widget") return this.handleWidgetKey(routed.key);
    return this.handleGlobalKey(routed.key.key);
  }

  private handleGlobalKey(key: KeyName): SessionEvent[] {
    switch (key) {
      case "tab":
      case "down":
        this.setFocusedId(nextFocusId(this.focusables, this.focusedId ?? undefined) ?? null);
        return [this.frame()];
      case "shiftTab":
      case "up":
        this.setFocusedId(prevFocusId(this.focusables, this.focusedId ?? undefined) ?? null);
        return [this.frame()];
      case "escape":
        this.setFocusedId(null);
        return [this.frame()];
      case "pageUp":
        return this.pageViewport(-1);
      case "pageDown":
        return this.pageViewport(1);
      case "f1":
      case "f2":
      case "f3":
      case "f4":
      case "f5":
      case "f6":
      case "f7":
      case "f8":
      case "f9":
      case "f10":
      case "f11":
      case "f12":
        return [this.frame()];
      default:
        return [this.frame()];
    }
  }

  private handleWidgetKey(key: NormalizedKey): SessionEvent[] {
    const widget = this.currentWidget();
    if (!widget) return [this.frame()];
    switch (widget.name) {
      case "button":
      case "checkbox":
        return key.key === "enter" ? this.activateFocused() : [this.frame()];
      case "input":
        return this.handleInputKey(widget, key);
      case "radio":
        return this.handleRadioKey(widget, key.key);
      case "textarea":
        return this.handleTextareaKey(widget, key);
      case "scroll":
        if (key.key === "pageUp" || key.key === "pageDown") {
          return this.scrollFocusedRegion(
            (key.key === "pageUp" ? -1 : 1) *
              Math.max(1, (this.scrollRegionRuntime.get(widget.id)?.rows ?? 1) - 1),
          );
        }
        return [this.frame()];
    }
  }

  private handleInputKey(widget: FocusableWidget, key: NormalizedKey): SessionEvent[] {
    switch (key.key) {
      case "enter":
        return this.activateFocused();
      case "backspace":
        return this.backspaceFocused();
      case "delete":
        return this.deleteFocused();
      case "left":
        if (this.untouchedDefault.delete(widget.id)) this.cursor.set(widget.id, 0);
        else this.moveCursor(widget, -1);
        break;
      case "right":
        if (this.untouchedDefault.delete(widget.id)) {
          this.cursor.set(widget.id, graphemes(widget.attrs.value ?? "").length);
        } else {
          this.moveCursor(widget, 1);
        }
        break;
      case "home":
        this.untouchedDefault.delete(widget.id);
        this.cursor.set(widget.id, 0);
        break;
      case "end":
        this.untouchedDefault.delete(widget.id);
        this.cursor.set(widget.id, graphemes(widget.attrs.value ?? "").length);
        break;
      default:
        return [this.frame()];
    }
    this.markWidgetDirty(widget.id);
    return [this.frame()];
  }

  private handleRadioKey(widget: FocusableWidget, key: KeyName): SessionEvent[] {
    const options = widget.options ?? [];
    if (options.length === 0) return [this.frame()];
    this.initializeRadioPending(widget);
    const current = this.radioPending.get(widget.id) ?? 0;
    if (key === "enter") return this.confirmRadio(widget);
    const delta = key === "left" || key === "up" ? -1 : key === "right" || key === "down" ? 1 : 0;
    if (delta !== 0) {
      this.radioPending.set(widget.id, Math.max(0, Math.min(options.length - 1, current + delta)));
      this.markWidgetDirty(widget.id);
    }
    return [this.frame()];
  }

  private handleTextareaKey(widget: FocusableWidget, key: NormalizedKey): SessionEvent[] {
    if (key.ctrl && key.key === "enter") {
      this.setFocusedId(nextFocusId(this.focusables, widget.id) ?? null);
      return [this.frame()];
    }
    switch (key.key) {
      case "enter":
        return this.insertText(widget, "\n");
      case "backspace":
        return this.backspaceFocused();
      case "delete":
        return this.deleteFocused();
      case "left":
      case "right": {
        if (this.untouchedDefault.delete(widget.id)) {
          this.cursor.set(
            widget.id,
            key.key === "left" ? 0 : graphemes(widget.attrs.value ?? "").length,
          );
        } else {
          this.moveCursor(widget, key.key === "left" ? -1 : 1);
        }
        this.updateTextareaPreferredColumn(widget);
        this.keepTextareaCursorVisible(widget);
        this.markWidgetDirty(widget.id);
        return [this.frame()];
      }
      case "up":
      case "down":
        this.moveTextareaVertically(widget, key.key === "up" ? -1 : 1);
        return [this.frame()];
      case "home":
      case "end":
        this.moveTextareaLineEdge(widget, key.key === "home" ? "start" : "end");
        return [this.frame()];
      case "pageUp":
      case "pageDown":
        return this.pageTextarea(widget, key.key === "pageUp" ? -1 : 1);
      default:
        return [this.frame()];
    }
  }

  private handleChar(char: string): SessionEvent[] {
    const w = this.currentWidget();
    if (!w) return [this.frame()];

    if (w.name === "button" || w.name === "checkbox") {
      // Space activates focused controls, same as Enter; other characters are ignored.
      return char === " " ? this.activateFocused() : [this.frame()];
    }
    if (w.name === "radio") return char === " " ? this.confirmRadio(w) : [this.frame()];
    if (w.name === "scroll") return [this.frame()];

    const normalized = char.replace(/\r\n?/g, "\n");
    const clean =
      w.name === "textarea"
        ? sanitizeText(normalized)
        : sanitizeText(normalized).replace(/\n/g, "");
    if (clean === "") return [this.frame()];
    return this.insertText(w, clean);
  }

  private insertText(w: FocusableWidget, clean: string): SessionEvent[] {
    const inserted = graphemes(clean);

    if (this.untouchedDefault.delete(w.id)) {
      // The default was "selected" — typing overwrites it outright, like a browser.
      const value = clean;
      w.attrs.value = value;
      this.cursor.set(w.id, inserted.length);
      if (w.name === "textarea") {
        this.updateTextareaPreferredColumn(w);
        this.keepTextareaCursorVisible(w);
      }
      this.markWidgetDirty(w.id);
      return [{ type: "change", id: w.id, value }, this.frame()];
    }

    const chars = graphemes(w.attrs.value ?? "");
    const pos = this.cursorFor(w);
    chars.splice(pos, 0, ...inserted);
    const value = chars.join("");
    w.attrs.value = value;
    this.cursor.set(w.id, pos + inserted.length);
    if (w.name === "textarea") {
      this.updateTextareaPreferredColumn(w);
      this.keepTextareaCursorVisible(w);
    }
    this.markWidgetDirty(w.id);
    return [{ type: "change", id: w.id, value }, this.frame()];
  }

  private backspaceFocused(): SessionEvent[] {
    const w = this.currentWidget();
    if (!w || (w.name !== "input" && w.name !== "textarea")) return [this.frame()];

    if (this.untouchedDefault.delete(w.id)) {
      // The default was "selected" — Backspace clears it in one press, like a browser.
      w.attrs.value = "";
      this.cursor.set(w.id, 0);
      if (w.name === "textarea") this.textareaScrollOffsets.set(w.id, 0);
      this.markWidgetDirty(w.id);
      return [{ type: "change", id: w.id, value: "" }, this.frame()];
    }

    const chars = graphemes(w.attrs.value ?? "");
    const pos = this.cursorFor(w);
    if (pos === 0) return [this.frame()];
    chars.splice(pos - 1, 1);
    const value = chars.join("");
    w.attrs.value = value;
    this.cursor.set(w.id, pos - 1);
    if (w.name === "textarea") {
      this.updateTextareaPreferredColumn(w);
      this.keepTextareaCursorVisible(w);
    }
    this.markWidgetDirty(w.id);
    return [{ type: "change", id: w.id, value }, this.frame()];
  }

  private deleteFocused(): SessionEvent[] {
    const w = this.currentWidget();
    if (!w || (w.name !== "input" && w.name !== "textarea")) return [this.frame()];

    if (this.untouchedDefault.delete(w.id)) {
      w.attrs.value = "";
      this.cursor.set(w.id, 0);
      if (w.name === "textarea") this.textareaScrollOffsets.set(w.id, 0);
      this.markWidgetDirty(w.id);
      return [{ type: "change", id: w.id, value: "" }, this.frame()];
    }

    const chars = graphemes(w.attrs.value ?? "");
    const pos = this.cursorFor(w);
    if (pos >= chars.length) return [this.frame()];
    chars.splice(pos, 1);
    const value = chars.join("");
    w.attrs.value = value;
    if (w.name === "textarea") {
      this.updateTextareaPreferredColumn(w);
      this.keepTextareaCursorVisible(w);
    }
    this.markWidgetDirty(w.id);
    return [{ type: "change", id: w.id, value }, this.frame()];
  }

  private updateTextareaPreferredColumn(w: FocusableWidget): void {
    const geometry = this.textareaGeometry(w);
    const visual = graphemeToTextareaVisual(geometry.value, this.cursorFor(w), geometry.lines, {
      ambiguousWide: this.layout.caps.ambiguousWide,
    });
    this.preferredCol.set(w.id, visual.col);
  }

  private moveTextareaVertically(w: FocusableWidget, direction: 1 | -1): void {
    this.untouchedDefault.delete(w.id);
    const geometry = this.textareaGeometry(w);
    const measure = { ambiguousWide: this.layout.caps.ambiguousWide };
    const current = graphemeToTextareaVisual(
      geometry.value,
      this.cursorFor(w),
      geometry.lines,
      measure,
    );
    const preferred = this.preferredCol.get(w.id) ?? current.col;
    const targetLine = Math.max(0, Math.min(geometry.lines.length - 1, current.line + direction));
    this.cursor.set(
      w.id,
      textareaVisualToGrapheme(geometry.value, targetLine, preferred, geometry.lines, measure),
    );
    this.preferredCol.set(w.id, preferred);
    this.keepTextareaCursorVisible(w);
    this.markWidgetDirty(w.id);
  }

  private moveTextareaLineEdge(w: FocusableWidget, edge: "start" | "end"): void {
    this.untouchedDefault.delete(w.id);
    const geometry = this.textareaGeometry(w);
    const current = graphemeToTextareaVisual(geometry.value, this.cursorFor(w), geometry.lines, {
      ambiguousWide: this.layout.caps.ambiguousWide,
    });
    const line = geometry.lines[current.line];
    if (line) this.cursor.set(w.id, edge === "start" ? line.start : line.end);
    this.updateTextareaPreferredColumn(w);
    this.keepTextareaCursorVisible(w);
    this.markWidgetDirty(w.id);
  }

  private pageTextarea(w: FocusableWidget, direction: 1 | -1): SessionEvent[] {
    const geometry = this.textareaGeometry(w);
    const current = this.textareaScrollOffsets.get(w.id) ?? 0;
    const delta = direction * Math.max(1, geometry.rows - 1);
    const result = applyScrollDelta(current, delta, geometry.lines.length, geometry.rows);
    this.textareaScrollOffsets.set(w.id, result.next);
    if (result.consumed !== 0) this.markWidgetDirty(w.id);
    if (result.residual !== 0) this.applyDocumentScroll(result.residual);
    return [this.frame()];
  }

  private confirmRadio(w: FocusableWidget): SessionEvent[] {
    const options = w.options ?? [];
    if (options.length === 0) return [this.frame()];
    this.initializeRadioPending(w);
    const index = Math.max(0, Math.min(options.length - 1, this.radioPending.get(w.id) ?? 0));
    const value = options[index]!.value;
    if (w.attrs.value === value) return [this.frame()];
    w.attrs.value = value;
    this.markWidgetDirty(w.id);
    return [{ type: "change", id: w.id, value }, this.frame()];
  }

  private pageViewport(direction: 1 | -1): SessionEvent[] {
    const visibleRows = this.layout.height;
    if (!this.layoutCache || visibleRows === undefined) return [this.frame()];
    const totalRows = this.layoutCache.physicalLines().length;
    if (totalRows <= visibleRows) return [this.frame()];
    this.scrollOffset = scrollByPage(this.scrollOffset, direction, totalRows, visibleRows);
    this.ensureFocusedVisible = false;
    return [this.frame()];
  }

  private applyDocumentScroll(rows: number): number {
    const visibleRows = this.layout.height;
    if (!this.layoutCache || visibleRows === undefined) return rows;
    const totalRows = this.layoutCache.physicalLines().length;
    if (totalRows <= visibleRows) return rows;
    const result = applyScrollDelta(this.scrollOffset, rows, totalRows, visibleRows);
    this.scrollOffset = result.next;
    this.ensureFocusedVisible = false;
    return result.residual;
  }

  private handleScroll(rows: number): SessionEvent[] {
    const widget = this.currentWidget();
    if (widget?.name === "scroll") return this.scrollFocusedRegion(rows);
    if (widget?.name === "textarea") {
      const geometry = this.textareaGeometry(widget);
      const current = this.textareaScrollOffsets.get(widget.id) ?? 0;
      const result = applyScrollDelta(current, rows, geometry.lines.length, geometry.rows);
      this.textareaScrollOffsets.set(widget.id, result.next);
      if (result.consumed !== 0) this.markWidgetDirty(widget.id);
      if (result.residual !== 0) this.applyDocumentScroll(result.residual);
      return [this.frame()];
    }
    this.applyDocumentScroll(rows);
    return [this.frame()];
  }

  private scrollFocusedRegion(rows: number): SessionEvent[] {
    const widget = this.currentWidget();
    if (widget?.name !== "scroll") {
      this.applyDocumentScroll(rows);
      return [this.frame()];
    }
    const state = this.scrollRegionRuntime.get(widget.id);
    if (!state) {
      this.applyDocumentScroll(rows);
      return [this.frame()];
    }
    const result = applyScrollDelta(state.offset, rows, state.total, state.rows);
    state.offset = result.next;
    if (result.consumed !== 0) this.markWidgetDirty(widget.id);
    if (result.residual !== 0) this.applyDocumentScroll(result.residual);
    return [this.frame()];
  }

  private activateFocused(): SessionEvent[] {
    const w = this.currentWidget();
    if (!w) return [this.frame()];
    switch (w.name) {
      case "button":
        return [{ type: "click", id: w.id, values: this.values() }, this.frame()];
      case "checkbox": {
        const checked = !isChecked(w.attrs);
        w.attrs.checked = String(checked);
        this.markWidgetDirty(w.id);
        return [{ type: "toggle", id: w.id, checked }, this.frame()];
      }
      case "input":
        // Enter commits the value (already live via "change" events) and
        // moves on, rather than submitting — there's no form-grouping concept in v1.
        this.setFocusedId(nextFocusId(this.focusables, this.focusedId ?? undefined) ?? null);
        return [this.frame()];
      case "radio":
        return this.confirmRadio(w);
      case "textarea":
      case "scroll":
        return [this.frame()];
    }
  }

  /** Resolve a click at `(row, col)` (0-indexed into the last frame) to a widget,
   * focus it, and activate it if it's a button/checkbox (matches Enter). */
  private handlePointer(row: number, col: number): SessionEvent[] {
    if (row >= this.lastFrameRows) return [this.frame()];
    const hit = hitAt(this.lastHits, this.lastFrameOffset + row, col);
    if (!hit) return [this.frame()];
    const renderedFocusedId = this.focusedId;
    this.setFocusedId(hit.id);
    const w = this.currentWidget();
    if (w?.name === "button" || w?.name === "checkbox") return this.activateFocused();
    if (w?.name === "radio" && hit.kind === "radioOption" && hit.value !== undefined) {
      const index = radioOptionIndex(w.options ?? [], hit.value);
      if (index >= 0) {
        this.radioPending.set(w.id, index);
        this.markWidgetDirty(w.id);
        return this.confirmRadio(w);
      }
    }
    if (w?.name === "textarea" && hit.kind === "textareaContent") {
      const line = Number(hit.value);
      if (Number.isInteger(line)) {
        const geometry = this.textareaGeometry(w);
        let visualCol = col - hit.colStart;
        // A focused textarea paints a one-cell caret into its content. That
        // cell is presentation-only, so clicks after it must be translated
        // back into the underlying text's cell coordinates.
        if (renderedFocusedId === w.id && !this.untouchedDefault.has(w.id)) {
          const renderedCursor = graphemeToTextareaVisual(
            geometry.value,
            this.cursorFor(w),
            geometry.lines,
            { ambiguousWide: this.layout.caps.ambiguousWide },
          );
          if (renderedCursor.line === line && visualCol > renderedCursor.col) {
            visualCol -= 1;
          }
        }
        this.untouchedDefault.delete(w.id);
        this.cursor.set(
          w.id,
          textareaVisualToGrapheme(geometry.value, line, visualCol, geometry.lines, {
            ambiguousWide: this.layout.caps.ambiguousWide,
          }),
        );
        this.updateTextareaPreferredColumn(w);
        this.keepTextareaCursorVisible(w);
        this.markWidgetDirty(w.id);
      }
    }
    return [this.frame()];
  }

  private handleUpdate(id: string, props: Record<string, string>): SessionEvent[] {
    const widget = this.updatables.find((candidate) => candidate.id === id);
    if (!widget) {
      return [{ type: "error", message: `unknown update id '${id}'` }, this.frame()];
    }
    const validated = validateUpdateProps(widget, props);
    if (!validated.ok) {
      return [{ type: "error", message: validated.error }, this.frame()];
    }
    applyUpdateProps(widget, validated.sanitized);
    this.markWidgetDirty(id);
    return [this.frame()];
  }

  private mutationTarget(id: string): MutationTarget | undefined {
    return this.mutationTargets.find((candidate) => candidate.id === id);
  }

  private mutationError(target: string, detail?: string): SessionEvent[] {
    const message =
      detail ??
      (this.focusables.some((widget) => widget.id === target) ||
      this.updatables.some((widget) => widget.id === target)
        ? `target '${target}' is not a mutation container`
        : `unknown mutation target '${target}'`);
    return [{ type: "error", message }, this.frame()];
  }

  private parsedMutationFragment(
    operation: "append" | "replace",
    markup: string,
    format: DocFormat | undefined,
    context: { inScroll?: boolean } = {},
  ): ReturnType<typeof parseMutationFragment> {
    const budget = checkMarkupBudget(operation, markup);
    if (!budget.ok) return budget;
    return parseMutationFragment(markup, format, this.sanitizeOpts, this.diags, context);
  }

  /** Refresh addressable indexes after structural surgery while carrying
   * user-owned state for ids that survive (including ids recreated by a
   * replacement fragment). */
  private reconcileAfterMutation(
    previousFocusables: FocusableWidget[],
    previousUntouched: ReadonlySet<string>,
  ): void {
    const previousRadioPending = new Map(this.radioPending);
    const identity = collectInteractiveWidgets(this.doc, this.diags);
    const nextFocusables = identity.focusables;
    const previousById = new Map(previousFocusables.map((widget) => [widget.id, widget] as const));

    for (const widget of nextFocusables) {
      const previous = previousById.get(widget.id);
      if (!previous) continue;
      if (widget.name === "input" && previous.name === "input") {
        widget.attrs.value = previous.attrs.value;
      }
      if (widget.name === "textarea" && previous.name === "textarea") {
        widget.attrs.value = previous.attrs.value;
      }
      if (widget.name === "checkbox" && previous.name === "checkbox") {
        widget.attrs.checked = previous.attrs.checked;
      }
      if (widget.name === "radio" && previous.name === "radio") {
        const value = previous.attrs.value;
        if (value && (widget.options ?? []).some((option) => option.value === value)) {
          widget.attrs.value = value;
        }
      }
    }

    const previousFocus = this.focusedId;
    this.focusables = nextFocusables;
    this.updatables = identity.updatables;
    this.mutationTargets = identity.mutationTargets;
    if (this.focusedId == null || !nextFocusables.some((widget) => widget.id === this.focusedId)) {
      this.focusedId = nextFocusables[0]?.id ?? null;
    }
    if (this.focusedId !== previousFocus) this.ensureFocusedVisible = true;

    const survivingIds = new Set(nextFocusables.map((widget) => widget.id));
    for (const map of [this.cursor, this.preferredCol, this.textareaScrollOffsets]) {
      for (const id of map.keys()) {
        if (!survivingIds.has(id)) map.delete(id);
      }
    }
    const survivingScrollIds = new Set(
      nextFocusables.filter((widget) => widget.name === "scroll").map((widget) => widget.id),
    );
    for (const id of this.scrollRegionRuntime.keys()) {
      if (!survivingScrollIds.has(id)) this.scrollRegionRuntime.delete(id);
    }

    this.untouchedDefault.clear();
    for (const widget of nextFocusables) {
      if (widget.name !== "input" && widget.name !== "textarea") continue;
      const previous = previousById.get(widget.id);
      const sameKind = previous?.name === widget.name;
      if (
        (sameKind && previousUntouched.has(widget.id)) ||
        (!sameKind && (widget.attrs.value ?? "") !== "")
      ) {
        this.untouchedDefault.add(widget.id);
      }
    }
    this.radioPending.clear();
    for (const widget of nextFocusables) {
      if (widget.name !== "radio" || previousById.get(widget.id)?.name !== "radio") continue;
      const pending = previousRadioPending.get(widget.id);
      const optionCount = widget.options?.length ?? 0;
      if (pending !== undefined && optionCount > 0) {
        this.radioPending.set(widget.id, Math.max(0, Math.min(optionCount - 1, pending)));
      }
    }
    this.initializeRadioPending(this.currentWidget());
  }

  private handleAppend(
    targetId: string,
    markup: string,
    format: DocFormat | undefined,
  ): SessionEvent[] {
    const target = this.mutationTarget(targetId);
    if (!target) return this.mutationError(targetId);
    const parsed = this.parsedMutationFragment("append", markup, format, {
      inScroll: target.name === "scroll",
    });
    if (!parsed.ok) {
      return this.mutationError(targetId, `append failed for '${targetId}': ${parsed.error}`);
    }
    if (target.block.children.length + parsed.blocks.length > MAX_MUTATION_TARGET_CHILDREN) {
      return this.mutationError(
        targetId,
        `append would exceed the ${MAX_MUTATION_TARGET_CHILDREN}-child target limit`,
      );
    }
    const appendedBlockCount = countBlocks(parsed.blocks);
    if (this.documentBlockCount + appendedBlockCount > MAX_DOCUMENT_BLOCKS) {
      return this.mutationError(
        targetId,
        `append would exceed the ${MAX_DOCUMENT_BLOCKS}-block document limit`,
      );
    }

    const previousFocusables = this.focusables;
    const previousUntouched = new Set(this.untouchedDefault);
    target.block.children = [...target.block.children, ...parsed.blocks];
    this.documentBlockCount += appendedBlockCount;
    this.reconcileAfterMutation(previousFocusables, previousUntouched);

    const forceFull = containsFootnoteContent(parsed.blocks);
    if (forceFull) {
      this.layoutCache = undefined;
      this.dirtyWidgetIds.clear();
    } else {
      this.markWidgetDirty(targetId);
    }
    return [this.frame(forceFull)];
  }

  private handleReplace(
    targetId: string,
    markup: string,
    format: DocFormat | undefined,
  ): SessionEvent[] {
    const target = this.mutationTarget(targetId);
    if (!target) return this.mutationError(targetId);
    const parsed = this.parsedMutationFragment("replace", markup, format);
    if (!parsed.ok) {
      return this.mutationError(targetId, `replace failed for '${targetId}': ${parsed.error}`);
    }
    const removedBlockCount = countBlocks([target.block]);
    const nextCount = this.documentBlockCount - removedBlockCount + countBlocks(parsed.blocks);
    if (nextCount > MAX_DOCUMENT_BLOCKS) {
      return this.mutationError(
        targetId,
        `replace would exceed the ${MAX_DOCUMENT_BLOCKS}-block document limit`,
      );
    }

    const previousFocusables = this.focusables;
    const previousUntouched = new Set(this.untouchedDefault);
    target.parent.splice(target.index, 1, ...parsed.blocks);
    this.documentBlockCount = nextCount;
    this.reconcileAfterMutation(previousFocusables, previousUntouched);
    this.layoutCache = undefined;
    this.dirtyWidgetIds.clear();
    return [this.frame(true)];
  }

  private handleRemove(targetId: string): SessionEvent[] {
    const target = this.mutationTarget(targetId);
    if (!target) return this.mutationError(targetId);
    const previousFocusables = this.focusables;
    const previousUntouched = new Set(this.untouchedDefault);
    const removedBlockCount = countBlocks([target.block]);
    target.parent.splice(target.index, 1);
    this.documentBlockCount -= removedBlockCount;
    this.reconcileAfterMutation(previousFocusables, previousUntouched);
    this.layoutCache = undefined;
    this.dirtyWidgetIds.clear();
    return [this.frame(true)];
  }

  private handleRender(markup: string, format: DocFormat | undefined): SessionEvent[] {
    const budget = checkMarkupBudget("render", markup);
    if (!budget.ok) return [{ type: "error", message: budget.error }, this.frame(true)];
    let raw: TDoc;
    try {
      const ctx = { sanitize: this.sanitizeOpts };
      switch (format ?? "teml") {
        case "html":
          raw = htmlToDoc(markup, { sanitize: this.sanitizeOpts }, this.diags);
          break;
        case "markdown":
          raw = parseMarkdown(markup, this.diags, ctx);
          break;
        default:
          raw = parseTeml(markup, this.diags, ctx);
          break;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return [{ type: "error", message: `render failed: ${msg}` }, this.frame(true)];
    }

    const newDoc = normalize(raw, this.diags);
    const renderedBlockCount = countBlocks(newDoc.blocks);
    if (renderedBlockCount > MAX_DOCUMENT_BLOCKS) {
      return [
        {
          type: "error",
          message: `render would exceed the ${MAX_DOCUMENT_BLOCKS}-block document limit`,
        },
        this.frame(true),
      ];
    }
    const identity = collectInteractiveWidgets(newDoc, this.diags);
    const newFocusables = identity.focusables;
    const prevById = new Map(this.focusables.map((w) => [w.id, w] as const));
    for (const w of newFocusables) {
      const prev = prevById.get(w.id);
      if (!prev) continue;
      if (w.name === "input" && prev.name === "input") w.attrs.value = prev.attrs.value;
      if (w.name === "textarea" && prev.name === "textarea") w.attrs.value = prev.attrs.value;
      if (w.name === "checkbox" && prev.name === "checkbox") w.attrs.checked = prev.attrs.checked;
      if (w.name === "radio" && prev.name === "radio") {
        const previousValue = prev.attrs.value;
        if (previousValue && (w.options ?? []).some((option) => option.value === previousValue)) {
          w.attrs.value = previousValue;
        }
      }
    }

    this.doc = newDoc;
    this.documentBlockCount = renderedBlockCount;
    this.focusables = newFocusables;
    this.updatables = identity.updatables;
    this.mutationTargets = identity.mutationTargets;
    const keepFocus = this.focusedId != null && newFocusables.some((w) => w.id === this.focusedId);
    if (!keepFocus) this.focusedId = newFocusables[0]?.id ?? null;
    this.layoutCache = undefined;
    this.dirtyWidgetIds.clear();
    this.scrollOffset = 0;
    this.ensureFocusedVisible = true;

    // Drop cursor positions for widgets that no longer exist; surviving ids
    // keep their position, clamped lazily on next read by cursorFor.
    const survivingIds = new Set(newFocusables.map((w) => w.id));
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
    this.radioPending.clear();
    this.initializeRadioPending(this.currentWidget());

    // A render is a fresh document: every non-empty input value (whether
    // freshly parsed or carried over above) is an untouched default again.
    this.markDefaultsUntouched(newFocusables);

    // A swapped document invalidates the host's row state — re-sync in full.
    return [this.frame(true)];
  }

  private frame(forceFull = false): SessionEvent {
    const focused = this.currentWidget();
    const isText = focused?.name === "input" || focused?.name === "textarea";
    const selectionActive = isText && this.untouchedDefault.has(focused.id);
    const cursorPos = isText && !selectionActive ? this.cursorFor(focused) : undefined;
    const hits: WidgetHit[] = [];
    const opts: LayoutOpts = {
      width: this.layout.width,
      theme: this.layout.theme,
      caps: this.layout.caps,
      wrapCode: this.layout.wrapCode,
      showUrls: this.layout.showUrls,
      diags: this.diags,
      focusedId: this.focusedId ?? undefined,
      cursorPos,
      selectionActive,
      radioPending: this.radioPending,
      textareaScrollOffsets: this.textareaScrollOffsets,
      scrollRegionRuntime: this.scrollRegionRuntime,
      hits,
    };
    if (!this.layoutCache) {
      this.layoutCache = new InteractiveLayoutCache(this.doc, opts);
    } else {
      this.layoutCache.update(opts, this.dirtyWidgetIds);
    }
    this.dirtyWidgetIds.clear();

    const physical = this.layoutCache.physicalLines();
    const totalRows = physical.length;
    const visibleRows = this.layout.height;
    const viewportActive = visibleRows !== undefined && totalRows > visibleRows;
    let lines = physical;
    let viewport: ViewportMeta | undefined;
    if (viewportActive) {
      this.scrollOffset = clampScrollRow(this.scrollOffset, totalRows, visibleRows);
      if (this.ensureFocusedVisible) {
        this.keepFocusedWidgetVisible(this.layoutCache.hits(), totalRows, visibleRows);
      }
      lines = sliceDocumentLines(physical, this.scrollOffset, visibleRows);
      viewport = {
        offset: this.scrollOffset,
        height: lines.length,
        total: totalRows,
      };
    } else {
      this.scrollOffset = 0;
    }
    this.ensureFocusedVisible = false;
    this.lastHits = this.layoutCache.hits();
    this.lastFrameOffset = this.scrollOffset;
    this.lastFrameRows = viewport?.height ?? totalRows;
    this.seq += 1;
    // Only the negotiated payload is rendered at all (null for the rest).
    const plain = this.framesFormat !== "ansi" ? renderPlain(lines) : null;
    const ansi = this.framesFormat !== "plain" ? renderAnsi(lines, this.layout.caps) : null;
    const rows = {
      plain: plain === null ? null : splitRows(plain),
      ansi: ansi === null ? null : splitRows(ansi),
    };
    const visibleStart = viewport?.offset ?? 0;
    const visibleEnd = visibleStart + (viewport?.height ?? totalRows);
    const scrollRegions: ScrollRegionMeta[] = [];
    for (const widget of this.focusables) {
      if (widget.name !== "scroll") continue;
      const state = this.scrollRegionRuntime.get(widget.id);
      if (!state) continue;
      const regionHits = this.lastHits.filter(
        (hit) => hit.id === widget.id && hit.kind === "scroll",
      );
      if (
        regionHits.length === 0 ||
        regionHits.every((hit) => hit.row < visibleStart || hit.row >= visibleEnd)
      ) {
        continue;
      }
      scrollRegions.push({
        id: widget.id,
        offset: state.offset,
        height: state.rows,
        total: state.total,
      });
    }

    // Patches mode diffs against the previously emitted frame — but only when
    // that frame is a trustworthy base in the negotiated format. Anything
    // uncertain (first frame, negotiation change, document swap, error path)
    // forces a full frame so the host can never desync.
    const canPatch =
      this.frameMode === "patches" &&
      !forceFull &&
      (rows.plain === null || this.prevRows.plain !== null) &&
      (rows.ansi === null || this.prevRows.ansi !== null);
    if (canPatch) return this.patchFrame(rows, viewport, scrollRegions);

    this.prevRows = rows;
    return {
      type: "frame",
      seq: this.seq,
      focusedId: this.focusedId,
      plain,
      ansi,
      ...(viewport ? { viewport } : {}),
      ...(scrollRegions.length > 0 ? { scrollRegions } : {}),
      ...(this.advertiseCapabilities ? protocolMetadata() : {}),
    };
  }

  /** Diff freshly rendered rows against the previous frame, per negotiated
   * format; a changed row in either format ships both payloads (per the
   * negotiation) so hosts repaint a row wholesale. Truncation/extension is
   * expressed by `rows`, not by patches. */
  private patchFrame(
    rows: { plain: string[] | null; ansi: string[] | null },
    viewport?: ViewportMeta,
    scrollRegions: ScrollRegionMeta[] = [],
  ): SessionEvent {
    const newRows = rows.plain ?? rows.ansi ?? [];
    const patches: FramePatch[] = [];
    for (let row = 0; row < newRows.length; row++) {
      const plainChanged = rows.plain !== null && this.prevRows.plain?.[row] !== rows.plain[row];
      const ansiChanged = rows.ansi !== null && this.prevRows.ansi?.[row] !== rows.ansi[row];
      if (plainChanged || ansiChanged) {
        patches.push({ row, plain: rows.plain?.[row] ?? null, ansi: rows.ansi?.[row] ?? null });
      }
    }
    this.prevRows = rows;
    return {
      type: "frame",
      seq: this.seq,
      focusedId: this.focusedId,
      rows: newRows.length,
      patches,
      ...(viewport ? { viewport } : {}),
      ...(scrollRegions.length > 0 ? { scrollRegions } : {}),
    };
  }
}

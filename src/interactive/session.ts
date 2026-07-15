// interactive/session.ts — the state machine behind `teml run` (M-interactive
// step 5). Consumes decoded Commands (from protocol.ts), owns a mutable
// working copy of the document, and emits SessionEvents. No terminal I/O and
// no direct JSON handling here — the CLI (step 7) owns stdin/stdout framing.
//
// Values live directly on the document: focusable leafs' `attrs.value`/
// `attrs.checked` are mutated in place as the user types/toggles, and
// re-rendered on every command via the existing pure layoutDocument. This
// avoids a second, parallel state map that could drift from what's on screen.

import type { Diagnostics, SanitizeOpts, TDoc } from "../core/index.js";
import { normalize, sanitizeText } from "../core/index.js";
import { htmlToDoc } from "../html/index.js";
import { parseMarkdown } from "../markdown/parse.js";
import { parseTeml } from "../teml/parse.js";
import { layoutDocument, type LayoutOpts } from "../layout/layout.js";
import { graphemes } from "../layout/measure.js";
import { widgetAtRow, type WidgetHit } from "../layout/hits.js";
import { renderAnsi } from "../render/ansi.js";
import { renderPlain } from "../render/plain.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { Theme } from "../terminal/theme.js";
import { collectFocusable, nextFocusId, prevFocusId, type FocusableWidget } from "./focus.js";
import type { Command, DocFormat, KeyName, SessionEvent } from "./protocol.js";

/** The parts of LayoutOpts that stay fixed for the lifetime of a session. */
export type SessionLayoutConfig = {
  width: number;
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
};

function isChecked(attrs: Record<string, string>): boolean {
  return attrs.checked?.trim().toLowerCase() === "true";
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
  private focusables: FocusableWidget[];
  private focusedId: string | null;
  /** Grapheme index into each input's value, keyed by widget id. Lazily
   * defaulted to "end of value" the first time a field is read; persists
   * across focus changes so returning to a field resumes where you left it. */
  private cursor = new Map<string, number>();
  /** Ids of inputs whose value is still exactly the document-supplied
   * default (set at construction or by a `render`) and hasn't been edited
   * by the user yet — mirrors a browser's "select all on focus" for a
   * pre-filled field. While an id is in here, the whole value renders as
   * selected (no caret) and the first edit replaces it outright: typing
   * overwrites it, backspace clears it. Any edit removes the id. */
  private untouchedDefault = new Set<string>();
  /** Row ranges from the most recently rendered frame, for `pointer` commands. */
  private lastHits: WidgetHit[] = [];
  private seq = 0;
  private done = false;

  constructor(doc: TDoc, opts: SessionOptions) {
    this.diags = opts.diags;
    this.layout = opts.layout;
    this.sanitizeOpts = opts.sanitize ?? {};
    this.doc = doc;
    this.focusables = collectFocusable(doc, this.diags);
    this.focusedId = this.focusables[0]?.id ?? null;
    this.markDefaultsUntouched(this.focusables);
  }

  /** (Re)populate untouchedDefault: every input with a non-empty value
   * counts as an untouched default until the user edits it. */
  private markDefaultsUntouched(widgets: FocusableWidget[]): void {
    this.untouchedDefault.clear();
    for (const w of widgets) {
      if (w.name === "input" && (w.attrs.value ?? "") !== "") this.untouchedDefault.add(w.id);
    }
  }

  /** True once an `exit` command has been processed; the host should stop sending commands. */
  isDone(): boolean {
    return this.done;
  }

  getFocusedId(): string | null {
    return this.focusedId;
  }

  /** Snapshot of every focusable widget's current value ("true"/"false" for checkboxes). */
  values(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const w of this.focusables) out[w.id] = widgetValue(w);
    return out;
  }

  /** Render and return the very first frame. Call once before reading any commands. */
  start(): SessionEvent[] {
    return [this.frame()];
  }

  /** Process one decoded command, returning the events it produces (in order). */
  handle(command: Command): SessionEvent[] {
    if (this.done) return [];
    switch (command.type) {
      case "key":
        return this.handleKey(command.key);
      case "char":
        return this.handleChar(command.char);
      case "pointer":
        return this.handlePointer(command.row);
      case "render":
        return this.handleRender(command.markup, command.format);
      case "exit":
        this.done = true;
        return [{ type: "exit" }];
    }
  }

  private currentWidget(): FocusableWidget | undefined {
    if (this.focusedId == null) return undefined;
    return this.focusables.find((w) => w.id === this.focusedId);
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

  private handleKey(key: KeyName): SessionEvent[] {
    switch (key) {
      case "tab":
        this.focusedId = nextFocusId(this.focusables, this.focusedId ?? undefined) ?? null;
        return [this.frame()];
      case "shiftTab":
        this.focusedId = prevFocusId(this.focusables, this.focusedId ?? undefined) ?? null;
        return [this.frame()];
      case "enter":
        return this.activateFocused();
      case "backspace":
        return this.backspaceFocused();
      case "escape":
        this.focusedId = null;
        return [this.frame()];
      case "left": {
        const w = this.currentWidget();
        if (w?.name === "input") {
          // Matches a browser: an arrow key on selected text collapses the
          // selection to that edge (left → start) rather than moving from
          // wherever the cursor conceptually was underneath it.
          if (this.untouchedDefault.delete(w.id)) this.cursor.set(w.id, 0);
          else this.moveCursor(w, -1);
        }
        return [this.frame()];
      }
      case "right": {
        const w = this.currentWidget();
        if (w?.name === "input") {
          if (this.untouchedDefault.delete(w.id)) {
            this.cursor.set(w.id, graphemes(w.attrs.value ?? "").length);
          } else {
            this.moveCursor(w, 1);
          }
        }
        return [this.frame()];
      }
    }
  }

  private handleChar(char: string): SessionEvent[] {
    const w = this.currentWidget();
    if (!w) return [this.frame()];

    if (w.name === "button" || w.name === "checkbox") {
      // Space activates focused controls, same as Enter; other characters are ignored.
      return char === " " ? this.activateFocused() : [this.frame()];
    }

    // Inputs are single-line: strip newlines a paste might carry, then run
    // through the same ingestion sanitizer every other string in the AST uses.
    const clean = sanitizeText(char).replace(/[\r\n]/g, "");
    if (clean === "") return [this.frame()];
    const inserted = graphemes(clean);

    if (this.untouchedDefault.delete(w.id)) {
      // The default was "selected" — typing overwrites it outright, like a browser.
      const value = clean;
      w.attrs.value = value;
      this.cursor.set(w.id, inserted.length);
      return [{ type: "change", id: w.id, value }, this.frame()];
    }

    const chars = graphemes(w.attrs.value ?? "");
    const pos = this.cursorFor(w);
    chars.splice(pos, 0, ...inserted);
    const value = chars.join("");
    w.attrs.value = value;
    this.cursor.set(w.id, pos + inserted.length);
    return [{ type: "change", id: w.id, value }, this.frame()];
  }

  private backspaceFocused(): SessionEvent[] {
    const w = this.currentWidget();
    if (!w || w.name !== "input") return [this.frame()];

    if (this.untouchedDefault.delete(w.id)) {
      // The default was "selected" — Backspace clears it in one press, like a browser.
      w.attrs.value = "";
      this.cursor.set(w.id, 0);
      return [{ type: "change", id: w.id, value: "" }, this.frame()];
    }

    const chars = graphemes(w.attrs.value ?? "");
    const pos = this.cursorFor(w);
    if (pos === 0) return [this.frame()];
    chars.splice(pos - 1, 1);
    const value = chars.join("");
    w.attrs.value = value;
    this.cursor.set(w.id, pos - 1);
    return [{ type: "change", id: w.id, value }, this.frame()];
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
        return [{ type: "toggle", id: w.id, checked }, this.frame()];
      }
      case "input":
        // Enter commits the value (already live via "change" events) and
        // moves on, rather than submitting — there's no form-grouping concept in v1.
        this.focusedId = nextFocusId(this.focusables, this.focusedId ?? undefined) ?? null;
        return [this.frame()];
    }
  }

  /** Resolve a click at `row` (0-indexed into the last frame) to a widget,
   * focus it, and activate it if it's a button/checkbox (matches Enter). */
  private handlePointer(row: number): SessionEvent[] {
    const id = widgetAtRow(this.lastHits, row);
    if (!id) return [this.frame()];
    this.focusedId = id;
    const w = this.currentWidget();
    if (w?.name === "button" || w?.name === "checkbox") return this.activateFocused();
    return [this.frame()];
  }

  private handleRender(markup: string, format: DocFormat | undefined): SessionEvent[] {
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
      return [{ type: "error", message: `render failed: ${msg}` }, this.frame()];
    }

    const newDoc = normalize(raw, this.diags);
    const newFocusables = collectFocusable(newDoc, this.diags);
    const prevById = new Map(this.focusables.map((w) => [w.id, w] as const));
    for (const w of newFocusables) {
      const prev = prevById.get(w.id);
      if (!prev) continue;
      if (w.name === "input" && prev.name === "input") w.attrs.value = prev.attrs.value;
      if (w.name === "checkbox" && prev.name === "checkbox") w.attrs.checked = prev.attrs.checked;
    }

    this.doc = newDoc;
    this.focusables = newFocusables;
    const keepFocus = this.focusedId != null && newFocusables.some((w) => w.id === this.focusedId);
    if (!keepFocus) this.focusedId = newFocusables[0]?.id ?? null;

    // Drop cursor positions for widgets that no longer exist; surviving ids
    // keep their position, clamped lazily on next read by cursorFor.
    const survivingIds = new Set(newFocusables.map((w) => w.id));
    for (const id of this.cursor.keys()) {
      if (!survivingIds.has(id)) this.cursor.delete(id);
    }

    // A render is a fresh document: every non-empty input value (whether
    // freshly parsed or carried over above) is an untouched default again.
    this.markDefaultsUntouched(newFocusables);

    return [this.frame()];
  }

  private frame(): SessionEvent {
    const focused = this.currentWidget();
    const isInput = focused?.name === "input";
    const selectionActive = isInput && this.untouchedDefault.has(focused.id);
    const cursorPos = isInput && !selectionActive ? this.cursorFor(focused) : undefined;
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
      hits,
    };
    const lines = layoutDocument(this.doc, opts);
    this.lastHits = hits;
    this.seq += 1;
    return {
      type: "frame",
      seq: this.seq,
      focusedId: this.focusedId,
      plain: renderPlain(lines),
      ansi: renderAnsi(lines, this.layout.caps),
    };
  }
}

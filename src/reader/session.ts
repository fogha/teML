import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DetailedLayout, LinkRegion } from "../layout/regions.js";
import { nextLink } from "../layout/regions.js";
import { renderPlain } from "../render/plain.js";
import { linesToScreen, physicalLines, type ScreenFrame } from "../render/screen.js";
import type { Line } from "../render/styledLine.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { TerminalInputEvent } from "../terminal/client/input.js";
import type { Style } from "../terminal/theme.js";
import type { ReaderHistoryEntry, ReaderModel, ReaderSearch, ViewportSize } from "./model.js";
import {
  clampScrollRow,
  ensureRowVisible,
  scrollByLine,
  scrollByPage,
  sliceDocumentLines,
  statusText,
  visibleBodyRows,
} from "./viewport.js";

export type ReaderEffect =
  | { type: "frame"; frame: ScreenFrame }
  | { type: "navigate"; path: string; anchor?: string; history: "push" | "restore" }
  | { type: "openExternal"; url: string }
  | { type: "exit"; code: number }
  | { type: "warning"; message: string };

export type ReaderSessionOptions = {
  rootPath: string;
  currentPath: string;
  title?: string;
  detailed: DetailedLayout;
  viewport: ViewportSize;
  caps: Capabilities;
  allowFileLinks?: boolean;
  focusStyle?: Style;
  statusStyle?: Style;
};

const HELP_LINES = [
  "TeML Reader keys",
  "j/k or arrows  scroll",
  "PgUp/PgDn       page",
  "Home/End        start/end",
  "Tab/Shift+Tab   links",
  "Enter           activate",
  "/ n N           search",
  "t               table of contents",
  "b/f             history",
  "q/Escape        quit",
];

function historyEntry(model: ReaderModel): ReaderHistoryEntry {
  return {
    path: model.currentPath,
    scrollRow: model.scrollRow,
    focusedLinkId: model.focusedLinkId,
  };
}

function physicalPlainLines(lines: readonly Line[]): string[] {
  return renderPlain([...lines])
    .replace(/\n$/, "")
    .split("\n");
}

function searchRows(lines: readonly string[], query: string): number[] {
  if (!query) return [];
  const needle = query.toLocaleLowerCase();
  return lines
    .map((line, row) => (line.toLocaleLowerCase().includes(needle) ? row : -1))
    .filter((row) => row >= 0);
}

function withinRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-|-$/g, "");
}

export function resolveReaderTarget(
  href: string,
  currentPath: string,
  rootPath: string,
  allowFileLinks = false,
):
  | { kind: "anchor"; anchor: string }
  | { kind: "local"; path: string; anchor?: string }
  | { kind: "external"; url: string }
  | { kind: "rejected"; reason: string } {
  if (href.startsWith("#")) return { kind: "anchor", anchor: href.slice(1) };
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return { kind: "external", url: url.href };
    }
    if (url.protocol === "file:") {
      if (!allowFileLinks) return { kind: "rejected", reason: "file links are disabled" };
      const target = path.resolve(fileURLToPath(url));
      return withinRoot(rootPath, target)
        ? { kind: "local", path: target, anchor: url.hash.slice(1) || undefined }
        : { kind: "rejected", reason: "link is outside the document root" };
    }
    return { kind: "rejected", reason: `unsupported link scheme '${url.protocol}'` };
  } catch {
    const hashIndex = href.indexOf("#");
    const pathname = hashIndex >= 0 ? href.slice(0, hashIndex) : href;
    const anchor = hashIndex >= 0 ? href.slice(hashIndex + 1) : undefined;
    let decodedPathname: string;
    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      // A stray '%' or truncated escape (e.g. "notes%.md") makes
      // decodeURIComponent throw; one malformed link must not take down the
      // whole Reader session, so reject just this link instead.
      return { kind: "rejected", reason: "link target has a malformed URI escape" };
    }
    const target = path.resolve(path.dirname(currentPath), decodedPathname);
    return withinRoot(rootPath, target)
      ? { kind: "local", path: target, anchor: anchor || undefined }
      : { kind: "rejected", reason: "link is outside the document root" };
  }
}

export class ReaderSession {
  private model: ReaderModel;
  private detailed: DetailedLayout;
  private viewport: ViewportSize;
  private readonly caps: Capabilities;
  private readonly allowFileLinks: boolean;
  private readonly focusStyle: Style;
  private readonly statusStyle: Style;
  private tocIndex = 0;
  private plainLines: string[];
  private documentLines: Line[];

  constructor(options: ReaderSessionOptions) {
    this.detailed = options.detailed;
    this.documentLines = physicalLines(options.detailed.lines);
    this.plainLines = physicalPlainLines(this.documentLines);
    this.viewport = options.viewport;
    this.caps = options.caps;
    this.allowFileLinks = options.allowFileLinks ?? false;
    this.focusStyle = options.focusStyle ?? { bold: true, underline: true };
    this.statusStyle = options.statusStyle ?? { bold: true };
    this.model = {
      mode: "document",
      rootPath: path.resolve(options.rootPath),
      currentPath: path.resolve(options.currentPath),
      title: options.title ?? path.basename(options.currentPath),
      scrollRow: 0,
      focusedLinkId: null,
      history: [],
      historyIndex: 0,
      search: null,
      pendingExternalUrl: null,
      message: null,
    };
    this.model.history = [historyEntry(this.model)];
  }

  state(): Readonly<ReaderModel> {
    return this.model;
  }

  layout(): Readonly<DetailedLayout> {
    return this.detailed;
  }

  start(): ReaderEffect[] {
    return [this.frameEffect()];
  }

  setViewport(viewport: ViewportSize): ReaderEffect[] {
    this.viewport = viewport;
    this.clampScroll();
    return [this.frameEffect()];
  }

  replaceLayout(detailed: DetailedLayout, viewport = this.viewport): ReaderEffect[] {
    this.detailed = detailed;
    this.documentLines = physicalLines(detailed.lines);
    this.plainLines = physicalPlainLines(this.documentLines);
    this.viewport = viewport;
    this.clampScroll();
    return [this.frameEffect()];
  }

  report(message: string): ReaderEffect[] {
    this.model.message = message;
    return [{ type: "warning", message }, this.frameEffect()];
  }

  setDocument(
    currentPath: string,
    title: string,
    detailed: DetailedLayout,
    navigation: "push" | "restore" = "push",
    anchor?: string,
  ): ReaderEffect[] {
    if (navigation === "push") {
      this.model.history[this.model.historyIndex] = historyEntry(this.model);
    }
    this.detailed = detailed;
    this.documentLines = physicalLines(detailed.lines);
    this.plainLines = physicalPlainLines(this.documentLines);
    this.model.currentPath = path.resolve(currentPath);
    this.model.title = title;
    this.model.mode = "document";
    this.model.search = null;
    this.model.message = null;
    if (navigation === "push") {
      this.model.history = this.model.history.slice(0, this.model.historyIndex + 1);
      this.model.scrollRow = 0;
      this.model.focusedLinkId = null;
      this.model.history.push(historyEntry(this.model));
      this.model.historyIndex = this.model.history.length - 1;
    } else {
      const saved = this.model.history[this.model.historyIndex];
      this.model.scrollRow = saved?.scrollRow ?? 0;
      this.model.focusedLinkId = saved?.focusedLinkId ?? null;
    }
    if (anchor) this.goToAnchor(anchor);
    this.clampScroll();
    return [this.frameEffect()];
  }

  handle(event: TerminalInputEvent): ReaderEffect[] {
    this.model.message = null;
    if (event.type === "interrupt" || event.type === "end") return [{ type: "exit", code: 0 }];
    if (event.type === "resize") {
      return this.setViewport({ cols: event.cols, rows: event.rows, statusRows: 1 });
    }
    if (event.type === "wheel") {
      // Overlays (TOC/help/confirm/search) render over the document instead
      // of the scrolled body, so wheel input outside "document" mode would
      // silently move scrollRow without visible feedback until the overlay
      // closes. Ignore it there rather than surprise the user with a jump.
      if (this.model.mode !== "document") return [];
      this.scroll(event.delta * 3);
      return [this.frameEffect()];
    }
    if (event.type === "pointer") {
      // Same reasoning: link hit-testing below is only meaningful against the
      // document body, so a click while an overlay is showing must not be
      // able to activate a link (and possibly navigate away) hidden behind it.
      if (this.model.mode !== "document") return [];
      const absoluteRow = this.model.scrollRow + event.row;
      const link = this.detailed.links.find(
        (candidate) =>
          candidate.row === absoluteRow &&
          event.col >= candidate.colStart &&
          event.col < candidate.colEnd,
      );
      if (!link) return [];
      this.model.focusedLinkId = link.id;
      return this.activateLink(link);
    }
    if (event.type === "char") return this.handleChar(event.char);
    return this.handleKey(event.key);
  }

  private handleChar(char: string): ReaderEffect[] {
    if (this.model.mode === "search") {
      if (!/[\p{C}]/u.test(char)) this.updateSearch((this.model.search?.query ?? "") + char);
      return [this.frameEffect()];
    }
    if (this.model.mode === "toc") {
      if (char === "j") return this.handleTocKey("down");
      if (char === "k") return this.handleTocKey("up");
      if (char === "t" || char === "q") {
        this.model.mode = "document";
        return [this.frameEffect()];
      }
      return [];
    }
    if (this.model.mode === "confirmExternal") {
      if (char === "q") {
        this.model.pendingExternalUrl = null;
        this.model.mode = "document";
        return [this.frameEffect()];
      }
      return [];
    }
    if (this.model.mode === "help") {
      if (char === "?" || char === "q") this.model.mode = "document";
      return [this.frameEffect()];
    }
    switch (char) {
      case "q":
        return [{ type: "exit", code: 0 }];
      case "j":
        this.scroll(1);
        break;
      case "k":
        this.scroll(-1);
        break;
      case " ":
        this.page(1);
        break;
      case "g":
        this.model.scrollRow = 0;
        break;
      case "G":
        this.model.scrollRow = Number.MAX_SAFE_INTEGER;
        this.clampScroll();
        break;
      case "/":
        this.model.mode = "search";
        this.updateSearch("");
        break;
      case "n":
        this.moveSearch(1);
        break;
      case "N":
        this.moveSearch(-1);
        break;
      case "t":
        this.model.mode = "toc";
        this.tocIndex = 0;
        break;
      case "b":
        return this.navigateHistory(-1);
      case "f":
        return this.navigateHistory(1);
      case "?":
        this.model.mode = "help";
        break;
      default:
        return [];
    }
    return [this.frameEffect()];
  }

  private handleKey(key: Extract<TerminalInputEvent, { type: "key" }>["key"]): ReaderEffect[] {
    if (this.model.mode === "confirmExternal") {
      if (key === "enter" && this.model.pendingExternalUrl) {
        const url = this.model.pendingExternalUrl;
        this.model.pendingExternalUrl = null;
        this.model.mode = "document";
        return [{ type: "openExternal", url }, this.frameEffect()];
      }
      if (key === "escape" || key === "backspace") {
        this.model.pendingExternalUrl = null;
        this.model.mode = "document";
        return [this.frameEffect()];
      }
      return [];
    }
    if (this.model.mode === "toc") return this.handleTocKey(key);
    if (this.model.mode === "help") {
      if (key === "escape" || key === "backspace" || key === "enter") this.model.mode = "document";
      return [this.frameEffect()];
    }
    if (this.model.mode === "search") {
      if (key === "escape" || key === "enter") this.model.mode = "document";
      else if (key === "backspace") {
        const query = this.model.search?.query ?? "";
        if (query) this.updateSearch(Array.from(query).slice(0, -1).join(""));
        else this.model.mode = "document";
      }
      return [this.frameEffect()];
    }

    switch (key) {
      case "up":
        this.scroll(-1);
        break;
      case "down":
        this.scroll(1);
        break;
      case "pageUp":
        this.page(-1);
        break;
      case "pageDown":
        this.page(1);
        break;
      case "home":
        this.model.scrollRow = 0;
        break;
      case "end":
        this.model.scrollRow = Number.MAX_SAFE_INTEGER;
        this.clampScroll();
        break;
      case "tab":
        this.focusLink(1);
        break;
      case "shiftTab":
        this.focusLink(-1);
        break;
      case "enter": {
        const link = this.focusedLink();
        return link ? this.activateLink(link) : [];
      }
      case "backspace":
        return this.navigateHistory(-1);
      case "escape":
        return [{ type: "exit", code: 0 }];
      case "left":
      case "right":
        return [];
    }
    return [this.frameEffect()];
  }

  private handleTocKey(key: Extract<TerminalInputEvent, { type: "key" }>["key"]): ReaderEffect[] {
    const count = this.detailed.headings.length;
    if (key === "escape" || key === "backspace") this.model.mode = "document";
    else if ((key === "up" || key === "shiftTab") && count) {
      this.tocIndex = (this.tocIndex - 1 + count) % count;
    } else if ((key === "down" || key === "tab") && count) {
      this.tocIndex = (this.tocIndex + 1) % count;
    } else if (key === "enter" && count) {
      this.model.scrollRow = this.detailed.headings[this.tocIndex]!.row;
      this.model.mode = "document";
      this.clampScroll();
    }
    return [this.frameEffect()];
  }

  private activateLink(link: LinkRegion): ReaderEffect[] {
    const target = resolveReaderTarget(
      link.href,
      this.model.currentPath,
      this.model.rootPath,
      this.allowFileLinks,
    );
    if (target.kind === "anchor") {
      this.goToAnchor(target.anchor);
      return [this.frameEffect()];
    }
    if (target.kind === "external") {
      this.model.mode = "confirmExternal";
      this.model.pendingExternalUrl = target.url;
      return [this.frameEffect()];
    }
    if (target.kind === "rejected") {
      this.model.message = target.reason;
      return [{ type: "warning", message: target.reason }, this.frameEffect()];
    }
    return [
      {
        type: "navigate",
        path: target.path,
        anchor: target.anchor,
        history: "push",
      },
    ];
  }

  private navigateHistory(direction: -1 | 1): ReaderEffect[] {
    const targetIndex = this.model.historyIndex + direction;
    if (targetIndex < 0 || targetIndex >= this.model.history.length) return [];
    this.model.history[this.model.historyIndex] = historyEntry(this.model);
    this.model.historyIndex = targetIndex;
    return [
      {
        type: "navigate",
        path: this.model.history[targetIndex]!.path,
        history: "restore",
      },
    ];
  }

  private goToAnchor(anchor: string): void {
    const heading = this.detailed.headings.find(
      (candidate) => candidate.id === anchor || slug(candidate.text) === slug(anchor),
    );
    if (heading) {
      this.model.scrollRow = heading.row;
      this.clampScroll();
    } else {
      this.model.message = `anchor not found: #${anchor}`;
    }
  }

  private focusLink(direction: 1 | -1): void {
    const link = nextLink(this.detailed.links, this.model.focusedLinkId, direction);
    if (!link) return;
    this.model.focusedLinkId = link.id;
    this.model.scrollRow = ensureRowVisible(
      this.model.scrollRow,
      link.row,
      this.totalRows(),
      visibleBodyRows(this.viewport),
    );
  }

  private focusedLink(): LinkRegion | undefined {
    return this.detailed.links.find((link) => link.id === this.model.focusedLinkId);
  }

  private updateSearch(query: string): void {
    const previous = this.model.search;
    const rows = searchRows(this.plainLines, query);
    const search: ReaderSearch = { query, rows, index: rows.length ? 0 : -1 };
    this.model.search = search;
    if (rows.length && (previous?.query !== query || previous.index < 0)) {
      this.model.scrollRow = rows[0]!;
      this.clampScroll();
    }
  }

  private moveSearch(direction: 1 | -1): void {
    const search = this.model.search;
    if (!search?.rows.length) return;
    search.index = (search.index + direction + search.rows.length) % search.rows.length;
    this.model.scrollRow = search.rows[search.index]!;
    this.clampScroll();
  }

  private scroll(delta: number): void {
    this.model.scrollRow = scrollByLine(
      this.model.scrollRow,
      delta,
      this.totalRows(),
      visibleBodyRows(this.viewport),
    );
  }

  private page(direction: 1 | -1): void {
    this.model.scrollRow = scrollByPage(
      this.model.scrollRow,
      direction,
      this.totalRows(),
      visibleBodyRows(this.viewport),
    );
  }

  private clampScroll(): void {
    this.model.scrollRow = clampScrollRow(
      this.model.scrollRow,
      this.totalRows(),
      visibleBodyRows(this.viewport),
    );
  }

  private totalRows(): number {
    return this.plainLines.length;
  }

  private displayDocumentLines(): Line[] {
    const visible = visibleBodyRows(this.viewport);
    const lines = sliceDocumentLines(this.documentLines, this.model.scrollRow, visible);
    const focused = this.focusedLink();
    if (!focused) return lines;
    return lines.map((line, localRow) => {
      if (this.model.scrollRow + localRow !== focused.row) return line;
      return line.map((span) =>
        span.style.href === focused.href
          ? { ...span, style: { ...span.style, ...this.focusStyle } }
          : span,
      );
    });
  }

  private overlayLines(): Line[] | null {
    if (this.model.mode === "confirmExternal") {
      return [
        [{ text: "Open external link?", style: { bold: true } }],
        [{ text: this.model.pendingExternalUrl ?? "", style: {} }],
        [],
        [{ text: "Enter: Open   Escape: Cancel (default)", style: {} }],
      ];
    }
    if (this.model.mode === "help") {
      return HELP_LINES.map((text, index) => [{ text, style: index === 0 ? { bold: true } : {} }]);
    }
    if (this.model.mode === "toc") {
      const lines: Line[] = [[{ text: "Table of contents", style: { bold: true } }]];
      this.detailed.headings.forEach((heading, index) => {
        const marker = index === this.tocIndex ? "▸ " : "  ";
        lines.push([
          {
            text: `${marker}${"  ".repeat(heading.level - 1)}${heading.text}`,
            style: index === this.tocIndex ? this.focusStyle : {},
          },
        ]);
      });
      return lines;
    }
    return null;
  }

  private frameEffect(): ReaderEffect {
    const bodyRows = visibleBodyRows(this.viewport);
    const overlay = this.overlayLines();
    const body = (overlay ?? this.displayDocumentLines()).slice(0, bodyRows);
    const status =
      this.model.mode === "search"
        ? `/${this.model.search?.query ?? ""} · ${Math.max(0, (this.model.search?.index ?? -1) + 1)}/${this.model.search?.rows.length ?? 0}`
        : statusText(this.model, this.totalRows(), bodyRows);
    const lines: Line[] = [
      ...body,
      ...Array.from({ length: Math.max(0, bodyRows - body.length) }, () => []),
      [{ text: status, style: this.statusStyle }],
    ];
    return {
      type: "frame",
      frame: linesToScreen(lines, this.viewport.cols, this.viewport.rows, {
        ambiguousWide: this.caps.ambiguousWide,
      }),
    };
  }
}

// html/map.ts — DOM → TDoc semantic mapper (Milestone 5).

import type { Block, DefinitionItem, Inline, ListItem, Meta, TDoc } from "../core/ast.js";
import { inlineText } from "../core/ast.js";
import type { Diagnostics } from "../core/diagnostics.js";
import { sanitizeText } from "../core/sanitize.js";
import { processHref, type SanitizeOpts } from "../core/href.js";
import { DIRECTIVE_REGISTRY } from "../teml/directives.js";
import {
  findContainerRule,
  findSpanRole,
  titleFromSelectors,
  type Profile,
} from "./profiles/loader.js";

export type MapOptions = {
  profile?: Profile;
  sanitize?: SanitizeOpts;
};

const VOID = new Set(["br", "hr", "img", "input", "meta", "link"]);
const BLOCK_WRAPPERS = new Set([
  "div",
  "section",
  "article",
  "aside",
  "main",
  "header",
  "body",
  "html",
  "figcaption",
]);
const DATA_TEML_CONTAINERS = new Set(["grid", "details", "figure"]);
const DATA_TEML_LEAFS = new Set(["metric", "progress", "event"]);
const PROGRESS_ROLE_CLASSES: Record<string, string> = {
  "text-success": "success",
  "text-warning": "warning",
  "text-danger": "error",
  "text-info": "info",
};
const PLACEHOLDER_TAGS = new Set(["canvas", "video", "iframe", "form", "object", "embed"]);

function tagName(el: Element): string {
  return el.tagName.toLowerCase();
}

function getAttrs(el: Element): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const attr of el.attributes) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) continue;
    attrs[name] = attr.value;
  }
  return attrs;
}

function textOfElement(el: Element): string {
  return el.textContent ?? "";
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ");
}

function copyDataDirectiveAttrs(
  el: Element,
  allowed: readonly string[] | undefined,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (!allowed) return attrs;
  for (const key of allowed) {
    const raw = el.getAttribute(`data-${key}`);
    if (raw == null || raw === "") continue;
    attrs[key] = sanitizeText(raw);
  }
  return attrs;
}

function dataTemlDirective(el: Element): string | undefined {
  const raw = el.getAttribute("data-teml")?.trim().toLowerCase();
  return raw || undefined;
}

function inferProgressRole(el: Element): string | undefined {
  const dataRole = el.getAttribute("data-role")?.trim();
  if (dataRole) return sanitizeText(dataRole);
  for (const cls of (el.getAttribute("class") ?? "").split(/\s+/)) {
    const role = PROGRESS_ROLE_CLASSES[cls];
    if (role) return role;
  }
  return undefined;
}

function progressLabel(el: Element): string | undefined {
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return sanitizeText(aria);
  const title = el.getAttribute("title")?.trim();
  if (title) return sanitizeText(title);
  const text = collapseWhitespace(textOfElement(el)).trim();
  if (text) return sanitizeText(text);
  return undefined;
}

function directChild(el: Element, tag: string): Element | undefined {
  for (const child of el.children) {
    if (tagName(child) === tag) return child;
  }
  return undefined;
}

function childNodesExcluding(el: Element, excludeTags: Set<string>): Node[] {
  const nodes: Node[] = [];
  for (const child of el.childNodes) {
    if (child.nodeType === 1 && excludeTags.has(tagName(child as Element))) continue;
    nodes.push(child);
  }
  return nodes;
}

function mapImageLeaf(
  el: Element,
  opts: MapOptions,
  diags: Diagnostics,
): Block {
  const attrs = getAttrs(el);
  const alt = sanitizeText(attrs.alt ?? "");
  const rawSrc = attrs.src ?? "";
  const href = rawSrc ? processHref(rawSrc, opts.sanitize) : null;
  if (href) {
    return { type: "leaf", name: "image", attrs: { src: href, ...(alt ? { alt } : {}) } };
  }
  if (rawSrc) {
    diags.warn("link-dropped", `unsafe image src '${rawSrc.slice(0, 40)}' dropped`);
  }
  const label = alt || sanitizeText(rawSrc) || "image";
  return {
    type: "paragraph",
    children: [{ type: "text", value: `[Image: ${label}]` }],
  };
}

function mapInlineImage(el: Element, opts: MapOptions, diags: Diagnostics): Inline[] {
  const attrs = getAttrs(el);
  const alt = sanitizeText(attrs.alt ?? "");
  const rawSrc = attrs.src ?? "";
  const href = rawSrc ? processHref(rawSrc, opts.sanitize) : null;
  if (href) {
    return [{ type: "link", href, children: [{ type: "text", value: alt || "image" }] }];
  }
  if (rawSrc) {
    diags.warn("link-dropped", `unsafe image src '${rawSrc.slice(0, 40)}' dropped`);
  }
  const label = alt || sanitizeText(rawSrc) || "image";
  return [{ type: "text", value: `[Image: ${label}]` }];
}

function mapNativeProgressLeaf(el: Element): Block {
  const attrs = getAttrs(el);
  const leafAttrs: Record<string, string> = {};
  const label = progressLabel(el);
  if (label) leafAttrs.label = label;
  if (attrs.value) leafAttrs.value = sanitizeText(attrs.value);
  if (attrs.max) leafAttrs.max = sanitizeText(attrs.max);
  const role = inferProgressRole(el);
  if (role) leafAttrs.role = role;
  return { type: "leaf", name: "progress", attrs: leafAttrs };
}

function mapNativeDetails(el: Element, opts: MapOptions, diags: Diagnostics): Block {
  const summaryEl = directChild(el, "summary");
  const attrs: Record<string, string> = {
    open: el.hasAttribute("open") ? "true" : "false",
  };
  if (summaryEl) {
    const summary = collapseWhitespace(textOfElement(summaryEl)).trim();
    if (summary) attrs.summary = sanitizeText(summary);
  }
  return {
    type: "container",
    name: "details",
    attrs,
    children: mapBlocks(childNodesExcluding(el, new Set(["summary"])), opts, diags),
  };
}

function mapNativeFigure(el: Element, opts: MapOptions, diags: Diagnostics): Block {
  const captionEl = directChild(el, "figcaption");
  const attrs: Record<string, string> = {};
  if (captionEl) {
    const caption = collapseWhitespace(textOfElement(captionEl)).trim();
    if (caption) attrs.caption = sanitizeText(caption);
  }
  return {
    type: "container",
    name: "figure",
    attrs,
    children: mapBlocks(childNodesExcluding(el, new Set(["figcaption"])), opts, diags),
  };
}

function mapDataTemlBlock(
  el: Element,
  directive: string,
  opts: MapOptions,
  diags: Diagnostics,
): Block[] | null {
  if (DATA_TEML_CONTAINERS.has(directive)) {
    const spec = DIRECTIVE_REGISTRY.containers[directive as keyof typeof DIRECTIVE_REGISTRY.containers];
    const allowed = "attrs" in spec ? spec.attrs : undefined;
    const attrs = copyDataDirectiveAttrs(el, allowed);
    return [
      {
        type: "container",
        name: directive,
        attrs,
        children: mapBlocks([...el.childNodes], opts, diags),
      },
    ];
  }
  if (DATA_TEML_LEAFS.has(directive)) {
    const spec = DIRECTIVE_REGISTRY.leafs[directive as keyof typeof DIRECTIVE_REGISTRY.leafs];
    const allowed = "attrs" in spec ? spec.attrs : undefined;
    const attrs = copyDataDirectiveAttrs(el, allowed);
    const text = collapseWhitespace(textOfElement(el)).trim();
    if (directive === "metric" && !attrs.value && text) attrs.value = sanitizeText(text);
    if (directive === "event" && !attrs.title && text) attrs.title = sanitizeText(text);
    return [{ type: "leaf", name: directive, attrs }];
  }
  diags.warn("unknown-directive", `unknown HTML data-teml directive '${directive}'`);
  return mapBlocks([...el.childNodes], opts, diags);
}

function extractMeta(document: Document | Element): Meta {
  const meta: Meta = {};
  const owner = elOwnerDocument(document);
  const titleEl = owner?.querySelector("title");
  const title = titleEl?.textContent?.trim();
  if (title) meta.title = sanitizeText(title);
  const metaTitle = owner?.querySelector('meta[name="title"]')?.getAttribute("content")?.trim();
  if (metaTitle && !meta.title) meta.title = sanitizeText(metaTitle);
  return meta;
}

function isDomDocument(node: Document | Element): node is Document {
  return (node as Document).nodeType === 9;
}

function elOwnerDocument(node: Document | Element): Document | null {
  if (isDomDocument(node)) return node;
  return node.ownerDocument;
}

export function htmlToDocFromRoot(
  root: Element,
  opts: MapOptions = {},
  diags: Diagnostics,
  document?: Document,
): TDoc {
  const meta = document ? extractMeta(document) : extractMeta(root);
  const blocks = mapBlocks(collectBlockNodes(root), opts, diags);
  return { meta, blocks };
}

function collectBlockNodes(root: Element): Node[] {
  const nodes: Node[] = [];
  for (const child of root.childNodes) nodes.push(child);
  return nodes;
}

function mapInlineNodes(nodes: Node[], opts: MapOptions, diags: Diagnostics): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    if (n.nodeType === 3) {
      const raw = n.textContent ?? "";
      if (raw === "") continue;
      const value = sanitizeText(collapseWhitespace(raw));
      if (value === "") continue;
      out.push({ type: "text", value });
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const kids = () => mapInlineNodes([...el.childNodes], opts, diags);
    switch (tagName(el)) {
      case "strong":
      case "b":
        out.push({ type: "bold", children: kids() });
        break;
      case "em":
      case "i":
        out.push({ type: "italic", children: kids() });
        break;
      case "u":
        out.push({ type: "underline", children: kids() });
        break;
      case "code":
        out.push({ type: "code", value: sanitizeText(textOfElement(el), "code") });
        break;
      case "br":
        out.push({ type: "text", value: " " });
        break;
      case "a": {
        const href = processHref(getAttrs(el).href ?? "", opts.sanitize);
        if (href) out.push({ type: "link", href, children: kids() });
        else {
          const rawHref = getAttrs(el).href;
          if (rawHref) diags.warn("link-dropped", `unsafe link '${rawHref.slice(0, 40)}' dropped`);
          out.push(...kids());
        }
        break;
      }
      case "del":
      case "s":
      case "strike":
        out.push({ type: "strike", children: kids() });
        break;
      case "kbd":
        out.push({ type: "span", role: "kbd", children: kids() });
        break;
      case "mark":
        out.push({ type: "span", role: "highlight", children: kids() });
        break;
      case "span": {
        const role = findSpanRole(el, opts.profile);
        if (role) out.push({ type: "span", role, children: kids() });
        else out.push(...kids());
        break;
      }
      case "img":
        out.push(...mapInlineImage(el, opts, diags));
        break;
      default:
        out.push(...kids());
    }
  }
  return out;
}

function inlineTextOf(nodes: Inline[]): string {
  return inlineText(nodes);
}

function mapBlocks(nodes: Node[], opts: MapOptions, diags: Diagnostics): Block[] {
  const blocks: Block[] = [];
  let inlineRun: Node[] = [];

  const flushInline = () => {
    if (!inlineRun.length) return;
    const children = mapInlineNodes(inlineRun, opts, diags);
    inlineRun = [];
    if (inlineTextOf(children).trim()) blocks.push({ type: "paragraph", children });
  };

  for (const n of nodes) {
    if (n.nodeType === 3) {
      inlineRun.push(n);
      continue;
    }
    if (n.nodeType !== 1) continue;
    const el = n as Element;
    const tag = tagName(el);

    const hMatch = /^h([1-6])$/.exec(tag);
    if (hMatch) {
      flushInline();
      let level = parseInt(hMatch[1]!, 10);
      if (level > 4) {
        diags.warn("heading-clamped", `h${level} clamped to 4`);
        level = 4;
      }
      blocks.push({
        type: "heading",
        level: level as 1 | 2 | 3 | 4,
        children: mapInlineNodes([...el.childNodes], opts, diags),
      });
      continue;
    }

    if (tag === "p") {
      flushInline();
      const children = mapInlineNodes([...el.childNodes], opts, diags);
      if (inlineTextOf(children).trim()) blocks.push({ type: "paragraph", children });
      continue;
    }

    if (tag === "hr") {
      flushInline();
      blocks.push({ type: "thematicBreak" });
      continue;
    }

    if (tag === "pre") {
      flushInline();
      const codeEl = el.querySelector("code");
      const langMatch = codeEl
        ? /language-([\w-]+)/.exec(getAttrs(codeEl).class ?? "")
        : null;
      const sourceEl = codeEl ?? el;
      const value = sanitizeText(
        (sourceEl.textContent ?? "").replace(/^\n|\n$/g, ""),
        "code",
      );
      blocks.push({ type: "codeBlock", language: langMatch?.[1], value });
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      flushInline();
      const items: ListItem[] = [];
      for (const child of el.children) {
        if (tagName(child) !== "li") continue;
        items.push(mapListItem(child, opts, diags));
      }
      const startAttr = getAttrs(el).start;
      blocks.push({
        type: "list",
        ordered: tag === "ol",
        start: parseInt(startAttr ?? "1", 10) || 1,
        items,
      });
      continue;
    }

    if (tag === "blockquote") {
      flushInline();
      blocks.push({ type: "quote", children: mapBlocks([...el.childNodes], opts, diags) });
      continue;
    }

    if (tag === "table") {
      flushInline();
      blocks.push(mapTable(el, opts, diags));
      continue;
    }

    if (tag === "dl") {
      flushInline();
      blocks.push(...mapDl(el, opts, diags));
      continue;
    }

    if (tag === "img") {
      flushInline();
      blocks.push(mapImageLeaf(el, opts, diags));
      continue;
    }

    const temlDirective = dataTemlDirective(el);
    if (temlDirective) {
      flushInline();
      blocks.push(...(mapDataTemlBlock(el, temlDirective, opts, diags) ?? []));
      continue;
    }

    if (tag === "details") {
      flushInline();
      blocks.push(mapNativeDetails(el, opts, diags));
      continue;
    }

    if (tag === "figure") {
      flushInline();
      blocks.push(mapNativeFigure(el, opts, diags));
      continue;
    }

    if (tag === "progress" || tag === "meter") {
      flushInline();
      blocks.push(mapNativeProgressLeaf(el));
      continue;
    }

    const containerRule = findContainerRule(el, opts.profile);
    if (containerRule) {
      flushInline();
      const attrs: Record<string, string> = {};
      if (containerRule.titleFrom) {
        const title = titleFromSelectors(el, containerRule.titleFrom);
        if (title) attrs.title = sanitizeText(title);
      }
      let children = mapBlocks([...el.childNodes], opts, diags);
      if (
        attrs.title &&
        children[0]?.type === "heading" &&
        inlineText(children[0].children).trim() === attrs.title
      ) {
        children = children.slice(1);
      }
      blocks.push({
        type: "container",
        name: containerRule.directive,
        attrs,
        children,
      });
      continue;
    }

    if (BLOCK_WRAPPERS.has(tag)) {
      flushInline();
      blocks.push(...mapBlocks([...el.childNodes], opts, diags));
      continue;
    }

    if (PLACEHOLDER_TAGS.has(tag)) {
      flushInline();
      diags.warn("placeholder", `<${tag}> converted to placeholder`);
      blocks.push({ type: "paragraph", children: [{ type: "text", value: `[${tag}]` }] });
      continue;
    }

    if (VOID.has(tag)) {
      inlineRun.push(el);
      continue;
    }

    inlineRun.push(el);
  }

  flushInline();
  return blocks;
}

function mapListItem(el: Element, opts: MapOptions, diags: Diagnostics): ListItem {
  const input = el.querySelector(':scope > input[type="checkbox"]');
  if (input) {
    const checked = input.hasAttribute("checked");
    const clone = el.cloneNode(true) as Element;
    clone.querySelectorAll(':scope > input[type="checkbox"]').forEach((n) => n.remove());
    return { blocks: mapBlocks([...clone.childNodes], opts, diags), checked };
  }
  return { blocks: mapBlocks([...el.childNodes], opts, diags) };
}

function mapDl(el: Element, opts: MapOptions, diags: Diagnostics): Block[] {
  const items: DefinitionItem[] = [];
  let pendingTerm: Inline[] | null = null;
  let pendingDefs: Block[][] = [];

  const flushTerm = () => {
    if (pendingTerm && pendingDefs.length) {
      items.push({ term: pendingTerm, definitions: pendingDefs });
    }
    pendingTerm = null;
    pendingDefs = [];
  };

  for (const child of el.children) {
    const tag = tagName(child);
    if (tag === "dt") {
      flushTerm();
      pendingTerm = mapInlineNodes([...child.childNodes], opts, diags);
    } else if (tag === "dd") {
      if (!pendingTerm) continue;
      pendingDefs.push(mapBlocks([...child.childNodes], opts, diags));
    }
  }
  flushTerm();

  if (items.length === 0) return [];
  return [{ type: "definitionList", items }];
}

function mapTable(el: Element, opts: MapOptions, diags: Diagnostics): Block {
  const rows: { header: boolean; cells: Inline[][] }[] = [];
  const carry = new Map<string, Inline[]>();

  const walkRows = (node: Element, inHead: boolean) => {
    for (const child of node.children) {
      const tag = tagName(child);
      if (tag === "thead") walkRows(child, true);
      else if (tag === "tbody" || tag === "tfoot") walkRows(child, false);
      else if (tag === "tr") {
        const cells: Inline[][] = [];
        let header = inHead;
        let col = 0;
        const rowIndex = rows.length;

        const takeCarry = () => {
          while (carry.has(`${rowIndex},${col}`)) {
            cells.push(carry.get(`${rowIndex},${col}`)!);
            col++;
          }
        };

        takeCarry();
        for (const cell of child.children) {
          if (tagName(cell) !== "th" && tagName(cell) !== "td") continue;
          if (tagName(cell) === "th") header = true;
          takeCarry();
          const colspan = parseInt(getAttrs(cell).colspan ?? "1", 10) || 1;
          const rowspan = parseInt(getAttrs(cell).rowspan ?? "1", 10) || 1;
          if (colspan > 1 || rowspan > 1) {
            diags.warnOnce("table-span-flattened", "table colspan/rowspan flattened");
          }
          const content = mapInlineNodes([...cell.childNodes], opts, diags);
          cells.push(content);
          for (let c = 1; c < colspan; c++) cells.push([]);
          if (rowspan > 1) {
            for (let r = 1; r < rowspan; r++) {
              for (let c = 0; c < colspan; c++) {
                carry.set(`${rowIndex + r},${col + c}`, r === 1 && c === 0 ? content : []);
              }
            }
          }
          col += colspan;
        }
        rows.push({ header, cells });
      }
    }
  };

  walkRows(el, false);
  return { type: "table", align: [], rows };
}

export function htmlToDoc(
  root: Element,
  opts: MapOptions = {},
  diags: Diagnostics,
  document?: Document,
): TDoc {
  return htmlToDocFromRoot(root, opts, diags, document);
}

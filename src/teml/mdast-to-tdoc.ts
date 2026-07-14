// teml/mdast-to-tdoc.ts — shared mdast → TDoc transform (Milestone 3).

import type {
  BlockContent,
  Content,
  DefinitionContent,
  PhrasingContent,
  Root,
  RootContent,
} from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import { parse as parseYaml } from "yaml";
import type { Align, Block, Inline, ListItem, Meta, RoleStyle, TDoc } from "../core/ast.js";
import type { Diagnostics } from "../core/diagnostics.js";
import { sanitizeText } from "../core/sanitize.js";
import { processHref, type SanitizeOpts } from "../core/href.js";
import {
  isKnownContainer,
  isKnownInlineDirective,
  isKnownLeaf,
  isShorthandInlineRole,
  sanitizeDirectiveAttrs,
} from "./directives.js";

const fragmentProcessor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective);

type Positioned = { position?: { start: { line: number } } };

function lineOf(node: Positioned): number | undefined {
  return node.position?.start.line;
}

function mdAlign(a: "left" | "right" | "center" | null | undefined): Align {
  return a ?? null;
}

export type ParseContext = {
  sanitize?: SanitizeOpts;
};

function hrefOpts(ctx: ParseContext): SanitizeOpts {
  return ctx.sanitize ?? {};
}

function mdToInlines(nodes: PhrasingContent[], diags: Diagnostics, ctx: ParseContext): Inline[] {
  const out: Inline[] = [];
  for (const node of nodes) {
    const mapped = mdToInline(node, diags, ctx);
    if (mapped == null) continue;
    if (Array.isArray(mapped)) out.push(...mapped);
    else out.push(mapped);
  }
  return out;
}

function mdToInline(
  node: PhrasingContent | DefinitionContent,
  diags: Diagnostics,
  ctx: ParseContext,
): Inline | Inline[] | null {
  const line = lineOf(node);
  const hrefOpts_ = hrefOpts(ctx);
  switch (node.type) {
    case "text":
      return { type: "text", value: sanitizeText(node.value) };
    case "strong":
      return { type: "bold", children: mdToInlines(node.children, diags, ctx) };
    case "emphasis":
      return { type: "italic", children: mdToInlines(node.children, diags, ctx) };
    case "inlineCode":
      return { type: "code", value: sanitizeText(node.value, "code") };
    case "link": {
      const href = processHref(node.url, hrefOpts_);
      const children = mdToInlines(node.children, diags, ctx);
      if (!href) {
        diags.warn("link-dropped", "unsafe link target dropped", line);
        return children;
      }
      return { type: "link", href, children };
    }
    case "image": {
      const href = processHref(node.url, hrefOpts_);
      const alt = sanitizeText(node.alt ?? "");
      if (!href) {
        diags.warn("link-dropped", "unsafe image target dropped", line);
        return alt ? { type: "text", value: `[Image: ${alt}]` } : null;
      }
      return { type: "link", href, children: [{ type: "text", value: alt || "image" }] };
    }
    case "break":
      return { type: "text", value: "\n" };
    case "delete":
      return { type: "strike", children: mdToInlines(node.children, diags, ctx) };
    case "textDirective": {
      const name = node.name;
      const attrs = sanitizeDirectiveAttrs(node.attributes);
      const children = mdToInlines(node.children, diags, ctx);
      if (!isKnownInlineDirective(name)) {
        diags.warn("unknown-directive", `unknown inline directive :${name}`, line);
        return children;
      }
      if (name === "fn") {
        const id = attrs.id;
        if (!id) {
          diags.warn("footnote-missing", "footnote inline directive missing id attribute", line);
          return children;
        }
        return { type: "footnoteRef", id };
      }
      if (name === "status") {
        return { type: "span", role: attrs.role ?? "info", children };
      }
      if (isShorthandInlineRole(name)) {
        return { type: "span", role: name, children };
      }
      diags.warn("unknown-directive", `unknown inline directive :${name}`, line);
      return children;
    }
    case "footnoteReference":
      return { type: "footnoteRef", id: sanitizeText(node.identifier) };
    case "html":
      diags.warn("raw-html-ignored", "raw HTML ignored in restricted profile", line);
      return null;
    default:
      diags.warn("unsupported-node", `unsupported inline node '${(node as Content).type}'`, line);
      return null;
  }
}

function paragraphToBlocks(
  children: PhrasingContent[],
  diags: Diagnostics,
  ctx: ParseContext,
): Block[] {
  const blocks: Block[] = [];
  let batch: PhrasingContent[] = [];

  const flush = () => {
    if (!batch.length) return;
    const inlines = mdToInlines(batch, diags, ctx);
    if (inlines.length) blocks.push({ type: "paragraph", children: inlines });
    batch = [];
  };

  for (const child of children) {
    if (child.type === "image") {
      flush();
      const href = processHref(child.url, hrefOpts(ctx));
      const alt = sanitizeText(child.alt ?? "");
      if (!href) {
        diags.warn("link-dropped", "unsafe image target dropped", lineOf(child));
        if (alt) {
          blocks.push({
            type: "paragraph",
            children: [{ type: "text", value: `[Image: ${alt}]` }],
          });
        }
      } else {
        blocks.push({ type: "leaf", name: "image", attrs: { src: href, alt } });
      }
    } else {
      batch.push(child);
    }
  }
  flush();
  return blocks.length ? blocks : [{ type: "paragraph", children: [] }];
}

function listItemFromMdast(
  item: { children: (BlockContent | DefinitionContent)[]; checked?: boolean | null },
  diags: Diagnostics,
  ctx: ParseContext,
): ListItem {
  const blocks: Block[] = [];
  for (const child of item.children) {
    if (child.type === "definition") continue;
    const mapped = mdToBlock(child, diags, ctx);
    if (mapped == null) continue;
    if (Array.isArray(mapped)) blocks.push(...mapped);
    else blocks.push(mapped);
  }
  const out: ListItem = { blocks };
  if (item.checked === true || item.checked === false) out.checked = item.checked;
  return out;
}

function mdToBlock(node: Content, diags: Diagnostics, ctx: ParseContext): Block | Block[] | null {
  const line = lineOf(node);
  switch (node.type) {
    case "heading": {
      let level = node.depth;
      if (level > 4) {
        diags.warn("heading-clamped", `heading level ${level} clamped to 4`, line);
        level = 4;
      }
      return {
        type: "heading",
        level: level as 1 | 2 | 3 | 4,
        children: mdToInlines(node.children, diags, ctx),
      };
    }
    case "paragraph":
      return paragraphToBlocks(node.children, diags, ctx);
    case "list":
      return {
        type: "list",
        ordered: node.ordered ?? false,
        start: node.start ?? 1,
        items: node.children.map((item) => listItemFromMdast(item, diags, ctx)),
      };
    case "footnoteDefinition":
      return {
        type: "footnoteDefinition",
        id: sanitizeText(node.identifier),
        children: mdToBlocks(node.children as RootContent[], diags, ctx),
      };
    case "blockquote":
      return {
        type: "quote",
        children: mdToBlocks(node.children as RootContent[], diags, ctx),
      };
    case "code":
      return {
        type: "codeBlock",
        language: node.lang || undefined,
        value: sanitizeText(node.value, "code"),
      };
    case "thematicBreak":
      return { type: "thematicBreak" };
    case "table": {
      const rows = node.children.map((row, i) => ({
        header: i === 0,
        cells: row.children.map((cell) => mdToInlines(cell.children, diags, ctx)),
      }));
      return { type: "table", align: (node.align ?? []).map(mdAlign), rows };
    }
    case "containerDirective": {
      const name = node.name;
      const attrs = sanitizeDirectiveAttrs(node.attributes);
      if (!isKnownContainer(name)) {
        diags.warn("unknown-directive", `unknown container :::${name}`, line);
      }
      if (name === "definition" && attrs.term) {
        return {
          type: "container",
          name: "definition",
          attrs,
          children: mdToBlocks(node.children as RootContent[], diags, ctx),
        };
      }
      if (name === "footnote" && attrs.id) {
        return {
          type: "footnoteDefinition",
          id: attrs.id,
          children: mdToBlocks(node.children as RootContent[], diags, ctx),
        };
      }
      return {
        type: "container",
        name,
        attrs,
        children: mdToBlocks(node.children as RootContent[], diags, ctx),
      };
    }
    case "leafDirective": {
      const name = node.name;
      const attrs = sanitizeDirectiveAttrs(node.attributes);
      if (!isKnownLeaf(name)) {
        diags.warn("unknown-directive", `unknown leaf ::${name}`, line);
      }
      return { type: "leaf", name, attrs };
    }
    case "html":
      diags.warn("raw-html-ignored", "raw HTML ignored in restricted profile", line);
      return null;
    case "yaml":
      return null;
    default:
      diags.warn("unsupported-node", `unsupported block node '${node.type}'`, line);
      return null;
  }
}

export function mdToBlocks(nodes: RootContent[], diags: Diagnostics, ctx: ParseContext = {}): Block[] {
  const blocks: Block[] = [];
  for (const node of nodes) {
    const mapped = mdToBlock(node, diags, ctx);
    if (mapped == null) continue;
    if (Array.isArray(mapped)) blocks.push(...mapped);
    else blocks.push(mapped);
  }
  return blocks;
}

const META_STRING_KEYS = new Set(["title", "theme", "lang", "base"]);
const ROLE_STYLE_KEYS = new Set(["fg", "bg", "bold", "italic", "underline", "strike"]);
const ANSI_COLORS = new Set([
  "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
  "brightBlack", "brightRed", "brightGreen", "brightYellow",
  "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
]);

function parseRoleStyle(raw: unknown, diags: Diagnostics, line?: number): RoleStyle | null {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const style: RoleStyle = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ROLE_STYLE_KEYS.has(k)) {
      diags.warn("frontmatter-ignored-key", `frontmatter roles key '${k}' ignored`, line);
      continue;
    }
    if (k === "fg" || k === "bg") {
      if (typeof v !== "string") continue;
      const val = sanitizeText(v);
      style[k] = val.startsWith("#") || ANSI_COLORS.has(val) ? val as RoleStyle["fg"] : val as RoleStyle["fg"];
    } else if (typeof v === "boolean") {
      (style as Record<string, boolean>)[k] = v;
    }
  }
  return Object.keys(style).length ? style : null;
}

function parseRoles(raw: unknown, diags: Diagnostics, line?: number): Record<string, RoleStyle> | undefined {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    if (raw != null) diags.warn("frontmatter-ignored-key", "frontmatter key 'roles' ignored", line);
    return undefined;
  }
  const roles: Record<string, RoleStyle> = {};
  for (const [role, styleRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (styleRaw != null && typeof styleRaw === "object" && !Array.isArray(styleRaw)) {
      const hasNested = Object.values(styleRaw as Record<string, unknown>).some(
        (v) => v != null && typeof v === "object",
      );
      if (hasNested) {
        diags.warn("frontmatter-ignored-key", `frontmatter roles entry '${role}' ignored`, line);
        continue;
      }
    }
    const style = parseRoleStyle(styleRaw, diags, line);
    if (style) roles[sanitizeText(role)] = style;
  }
  return Object.keys(roles).length ? roles : undefined;
}

/** Extract Meta from a yaml frontmatter node and remove it from the tree. */
export function extractMeta(tree: Root, diags: Diagnostics): Meta {
  const meta: Meta = {};
  const idx = tree.children.findIndex((n) => n.type === "yaml");
  if (idx === -1) return meta;

  const yamlNode = tree.children[idx] as { type: "yaml"; value: string; position?: { start: { line: number } } };
  const line = lineOf(yamlNode);
  tree.children.splice(idx, 1);

  let doc: unknown;
  try {
    doc = parseYaml(yamlNode.value);
  } catch {
    diags.warn("frontmatter-ignored-key", "frontmatter YAML could not be parsed", line);
    return meta;
  }

  if (doc == null || typeof doc !== "object" || Array.isArray(doc)) return meta;

  for (const [key, value] of Object.entries(doc as Record<string, unknown>)) {
    if (key === "roles") {
      const roles = parseRoles(value, diags, line);
      if (roles) meta.roles = roles;
      continue;
    }
    if (META_STRING_KEYS.has(key)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        (meta as Record<string, string>)[key] = sanitizeText(String(value));
      } else {
        diags.warn("frontmatter-ignored-key", `frontmatter key '${key}' ignored`, line);
      }
      continue;
    }
    diags.warn("frontmatter-ignored-key", `frontmatter key '${key}' ignored`, line);
  }

  return meta;
}

export function mdastToTDoc(tree: Root, diags: Diagnostics, ctx: ParseContext = {}): TDoc {
  const meta = extractMeta(tree, diags);
  const parseCtx: ParseContext = {
    sanitize: {
      ...ctx.sanitize,
      base: ctx.sanitize?.base ?? meta.base,
      allowFile: ctx.sanitize?.allowFile,
    },
  };
  return { meta, blocks: mdToBlocks(tree.children, diags, parseCtx) };
}

/** Parse inline-ish markdown fragment to Inline[] (test/helper seam). */
export function mdastInlinesFromFragment(
  source: string,
  diags: Diagnostics,
  ctx: ParseContext = {},
): Inline[] {
  const tree = parseFragmentToMdast(source);
  const blocks: Inline[] = [];
  for (const node of tree.children) {
    if (node.type === "paragraph") blocks.push(...mdToInlines(node.children, diags, ctx));
    else {
      const mapped = mdToBlock(node, diags, ctx);
      if (mapped == null) continue;
      if (Array.isArray(mapped)) {
        for (const b of mapped) {
          if (b.type === "heading" || b.type === "paragraph") {
            blocks.push(...b.children);
          }
        }
      } else if (mapped.type === "heading" || mapped.type === "paragraph") {
        blocks.push(...mapped.children);
      }
    }
  }
  return blocks;
}

function parseFragmentToMdast(source: string): Root {
  return fragmentProcessor.parse(source.replace(/\r\n?/g, "\n")) as Root;
}

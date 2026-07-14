// teml/serialize.ts — AST → .teml text. Inverse of parse; used by `convert`.

import { stringify as yamlStringify } from "yaml";
import type { Align, Block, Inline, ListItem, Meta, RoleStyle, TDoc } from "../core/index.js";
import { isShorthandInlineRole } from "./directives.js";
import { codeFenceLength, escapeTemlText } from "./escape.js";

function serializeInline(
  nodes: Inline[],
  ctx: "prose" | "link" | "tableCell" = "prose",
): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += escapeTemlText(n.value, ctx);
        break;
      case "bold":
        out += `**${serializeInline(n.children, ctx)}**`;
        break;
      case "italic":
        out += `*${serializeInline(n.children, ctx)}*`;
        break;
      case "underline":
        out += serializeInline(n.children, ctx);
        break;
      case "strike":
        out += `~~${serializeInline(n.children, ctx)}~~`;
        break;
      case "code":
        out += "`" + escapeTemlText(n.value, "codeInline") + "`";
        break;
      case "link":
        out += `[${serializeInline(n.children, "link")}](${escapeTemlText(n.href, "prose")})`;
        break;
      case "span": {
        const children = serializeInline(n.children, ctx);
        if (isShorthandInlineRole(n.role)) {
          out += `:${n.role}[${children}]`;
        } else {
          out += `:status[${children}]{role=${escapeTemlText(n.role, "attr")}}`;
        }
        break;
      }
      case "footnoteRef":
        out += `:fn{id="${escapeTemlText(n.id, "attr")}"}`;
        break;
    }
  }
  return out;
}

function attrStr(attrs: Record<string, string>): string {
  const entries = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "";
  return (
    "{" +
    entries.map(([k, v]) => `${k}="${escapeTemlText(v, "attr")}"`).join(" ") +
    "}"
  );
}

function childDirectiveDepth(b: Block): number {
  if (b.type !== "container") return 0;
  return 1 + Math.max(0, ...b.children.map(childDirectiveDepth));
}

function alignSep(align: Align): string {
  switch (align) {
    case "left":
      return ":---";
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

function serializeListItem(
  item: ListItem,
  ordered: boolean,
  markerNum: number,
  indent: number,
): string {
  const pad = " ".repeat(indent);
  let marker: string;
  if (item.checked === true) marker = "- [x] ";
  else if (item.checked === false) marker = "- [ ] ";
  else marker = ordered ? `${markerNum}. ` : "- ";
  const contentIndent = indent + marker.length;
  const contPad = " ".repeat(contentIndent);
  const lines: string[] = [];

  for (let i = 0; i < item.blocks.length; i++) {
    const b = item.blocks[i]!;
    if (b.type === "list") {
      lines.push(serializeList(b, contentIndent));
      continue;
    }
    const body = serializeBlock(b);
    const bodyLines = body.split("\n");
    if (lines.length === 0) {
      lines.push(
        bodyLines
          .map((l, j) => (j === 0 ? pad + marker + l : contPad + l))
          .join("\n"),
      );
    } else {
      lines.push(bodyLines.map((l) => contPad + l).join("\n"));
    }
  }
  return lines.join("\n");
}

function serializeList(b: Extract<Block, { type: "list" }>, indent = 0): string {
  return b.items
    .map((item, i) => serializeListItem(item, b.ordered, b.start + i, indent))
    .join("\n");
}

function serializeQuote(b: Extract<Block, { type: "quote" }>): string {
  const parts = b.children.map((c) => serializeBlock(c));
  return parts
    .map((part) =>
      part
        .split("\n")
        .map((l) => "> " + l)
        .join("\n"),
    )
    .join("\n>\n");
}

function serializeTable(b: Extract<Block, { type: "table" }>): string {
  const rows = b.rows.map(
    (r) => "| " + r.cells.map((c) => serializeInline(c, "tableCell")).join(" | ") + " |",
  );
  if (b.rows.length > 0) {
    const cols = b.rows[0].cells.length;
    const seps = Array.from({ length: cols }, (_, i) => alignSep(b.align[i] ?? null));
    rows.splice(1, 0, "| " + seps.join(" | ") + " |");
  }
  return rows.join("\n");
}

function serializeDefinitionList(b: Extract<Block, { type: "definitionList" }>): string {
  return b.items
    .map((item) => {
      const term = serializeInline(item.term);
      const body = item.definitions.map((def) => def.map(serializeBlock).join("\n\n")).join("\n\n");
      return `:::definition{term="${escapeTemlText(term, "attr")}"}\n${body}\n:::`;
    })
    .join("\n\n");
}

function serializeFootnoteDefinition(b: Extract<Block, { type: "footnoteDefinition" }>): string {
  const body = b.children.map(serializeBlock).join("\n\n");
  return `:::footnote{id="${escapeTemlText(b.id, "attr")}"}\n${body}\n:::`;
}

function serializeBlock(b: Block): string {
  switch (b.type) {
    case "heading":
      return "#".repeat(b.level) + " " + serializeInline(b.children);
    case "paragraph":
      return serializeInline(b.children);
    case "thematicBreak":
      return "---";
    case "codeBlock": {
      const fence = "`".repeat(codeFenceLength(b.value));
      const lang = b.language ?? "";
      return `${fence}${lang}\n${b.value}\n${fence}`;
    }
    case "quote":
      return serializeQuote(b);
    case "list":
      return serializeList(b);
    case "table":
      return serializeTable(b);
    case "definitionList":
      return serializeDefinitionList(b);
    case "footnoteDefinition":
      return serializeFootnoteDefinition(b);
    case "container": {
      const depth = Math.max(0, ...b.children.map(childDirectiveDepth));
      const colons = ":".repeat(3 + depth);
      const body = b.children.map(serializeBlock).join("\n\n");
      return `${colons}${b.name}${attrStr(b.attrs)}\n${body}\n${colons}`;
    }
    case "leaf":
      return `::${b.name}${attrStr(b.attrs)}`;
  }
}

function metaToYaml(meta: Meta): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (meta.title != null) out.title = meta.title;
  if (meta.theme != null) out.theme = meta.theme;
  if (meta.lang != null) out.lang = meta.lang;
  if (meta.base != null) out.base = meta.base;
  if (meta.roles && Object.keys(meta.roles).length) {
    const roles: Record<string, RoleStyle> = {};
    for (const [k, v] of Object.entries(meta.roles).sort(([a], [b]) => a.localeCompare(b))) {
      roles[k] = v;
    }
    out.roles = roles;
  }
  return Object.keys(out).length ? out : null;
}

function serializeFrontmatter(meta: Meta): string | null {
  const doc = metaToYaml(meta);
  if (!doc) return null;
  return "---\n" + yamlStringify(doc).trimEnd() + "\n---";
}

export function serializeTeml(docNode: TDoc): string {
  const parts: string[] = [];
  const fm = serializeFrontmatter(docNode.meta);
  if (fm) parts.push(fm);
  for (const b of docNode.blocks) parts.push(serializeBlock(b));
  return parts.join("\n\n") + "\n";
}

export { escapeTemlText, codeFenceLength } from "./escape.js";

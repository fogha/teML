// core/tokensView.ts — depth-first token stream for inspect --tokens (design doc §8).

import type { Block, Inline, Meta, TDoc } from "./ast.js";

function q(value: string): string {
  return JSON.stringify(value);
}

function emitMeta(lines: string[], meta: Meta): void {
  if (meta.title) lines.push(`meta title=${q(meta.title)}`);
  if (meta.theme) lines.push(`meta theme=${q(meta.theme)}`);
  if (meta.base) lines.push(`meta base=${q(meta.base)}`);
  if (meta.lang) lines.push(`meta lang=${q(meta.lang)}`);
  if (meta.roles) {
    for (const [role, style] of Object.entries(meta.roles)) {
      const parts = [`meta role=${q(role)}`];
      if (style.fg) parts.push(`fg=${q(String(style.fg))}`);
      if (style.bg) parts.push(`bg=${q(String(style.bg))}`);
      if (style.bold) parts.push("bold=true");
      if (style.italic) parts.push("italic=true");
      if (style.underline) parts.push("underline=true");
      if (style.strike) parts.push("strike=true");
      lines.push(parts.join(" "));
    }
  }
}

function emitAttrs(lines: string[], attrs: Record<string, string>): void {
  for (const [key, value] of Object.entries(attrs)) {
    lines.push(`attr ${key}=${q(value)}`);
  }
}

function emitInline(lines: string[], nodes: Inline[]): void {
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        lines.push(`text value=${q(n.value)}`);
        break;
      case "bold":
        lines.push("bold_start");
        emitInline(lines, n.children);
        lines.push("bold_end");
        break;
      case "italic":
        lines.push("italic_start");
        emitInline(lines, n.children);
        lines.push("italic_end");
        break;
      case "underline":
        lines.push("underline_start");
        emitInline(lines, n.children);
        lines.push("underline_end");
        break;
      case "strike":
        lines.push("strike_start");
        emitInline(lines, n.children);
        lines.push("strike_end");
        break;
      case "code":
        lines.push(`code value=${q(n.value)}`);
        break;
      case "link":
        lines.push(`link_start href=${q(n.href)}`);
        emitInline(lines, n.children);
        lines.push("link_end");
        break;
      case "span":
        lines.push(`span_start role=${q(n.role)}`);
        emitInline(lines, n.children);
        lines.push("span_end");
        break;
      case "footnoteRef":
        lines.push(`footnote_ref id=${q(n.id)}`);
        break;
    }
  }
}

function emitBlocks(lines: string[], blocks: Block[]): void {
  for (const b of blocks) emitBlock(lines, b);
}

function emitBlock(lines: string[], b: Block): void {
  switch (b.type) {
    case "heading":
      lines.push(`heading_start level=${b.level}`);
      emitInline(lines, b.children);
      lines.push(`heading_end level=${b.level}`);
      break;
    case "paragraph":
      lines.push("paragraph_start");
      emitInline(lines, b.children);
      lines.push("paragraph_end");
      break;
    case "list":
      lines.push(`list_start ordered=${b.ordered} start=${b.start}`);
      for (const item of b.items) {
        lines.push(`list_item_start checked=${item.checked ?? "null"}`);
        emitBlocks(lines, item.blocks);
        lines.push("list_item_end");
      }
      lines.push("list_end");
      break;
    case "quote":
      lines.push("quote_start");
      emitBlocks(lines, b.children);
      lines.push("quote_end");
      break;
    case "codeBlock":
      lines.push(`code_block_start language=${q(b.language ?? "")}`);
      lines.push(`text value=${q(b.value)}`);
      lines.push("code_block_end");
      break;
    case "thematicBreak":
      lines.push("thematic_break");
      break;
    case "table":
      lines.push("table_start");
      for (const row of b.rows) {
        lines.push(`table_row header=${row.header}`);
        for (const cell of row.cells) {
          lines.push("table_cell_start");
          emitInline(lines, cell);
          lines.push("table_cell_end");
        }
      }
      lines.push("table_end");
      break;
    case "definitionList":
      lines.push("definition_list_start");
      for (const item of b.items) {
        lines.push("definition_term_start");
        emitInline(lines, item.term);
        lines.push("definition_term_end");
        for (const def of item.definitions) {
          lines.push("definition_body_start");
          emitBlocks(lines, def);
          lines.push("definition_body_end");
        }
      }
      lines.push("definition_list_end");
      break;
    case "footnoteDefinition":
      lines.push(`footnote_definition_start id=${q(b.id)}`);
      emitBlocks(lines, b.children);
      lines.push(`footnote_definition_end id=${q(b.id)}`);
      break;
    case "container":
      lines.push(`container_start name=${q(b.name)}`);
      emitAttrs(lines, b.attrs);
      emitBlocks(lines, b.children);
      lines.push(`container_end name=${q(b.name)}`);
      break;
    case "leaf":
      lines.push(`leaf name=${q(b.name)}`);
      emitAttrs(lines, b.attrs);
      break;
  }
}

/** Depth-first walk emitting one token per line (e.g. `heading_start level=1`). */
export function tokensView(doc: TDoc): string {
  const lines: string[] = ["document_start"];
  emitMeta(lines, doc.meta);
  emitBlocks(lines, doc.blocks);
  lines.push("document_end");
  return lines.join("\n") + "\n";
}

// markdown/serialize.ts — TDoc → Markdown with TeML-only degradation rules.

import type { Align, Block, Inline, ListItem, TDoc } from "../core/ast.js";
import { inlineText } from "../core/ast.js";
import type { Diagnostics } from "../core/diagnostics.js";
import { sanitizeHref, sanitizeText } from "../core/sanitize.js";
import { isAlertContainer, isShorthandInlineRole } from "../teml/directives.js";
import { codeFenceLength } from "../teml/escape.js";

function lossy(diags: Diagnostics, message: string): void {
  diags.warnOnce("markdown-lossy-conversion", message);
}

function escapeMdText(s: string): string {
  return sanitizeText(s).replace(/([\\`*_{}[\]#+.!|>-])/g, "\\$1");
}

function serializeMdInline(nodes: Inline[], diags: Diagnostics): string {
  let out = "";
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out += escapeMdText(n.value);
        break;
      case "bold":
        out += `**${serializeMdInline(n.children, diags)}**`;
        break;
      case "italic":
        out += `*${serializeMdInline(n.children, diags)}*`;
        break;
      case "underline":
        lossy(diags, "underline dropped in Markdown output");
        out += serializeMdInline(n.children, diags);
        break;
      case "strike":
        out += `~~${serializeMdInline(n.children, diags)}~~`;
        break;
      case "code":
        out += "`" + n.value.replace(/`/g, "\\`") + "`";
        break;
      case "link": {
        const href = sanitizeHref(n.href);
        const label = serializeMdInline(n.children, diags);
        if (!href) {
          diags.warn("link-dropped", "unsafe link target dropped in Markdown output");
          out += label;
        } else {
          out += `[${label}](${href})`;
        }
        break;
      }
      case "span":
        if (n.role === "kbd") {
          out += "`" + inlineText(n.children).replace(/`/g, "\\`") + "`";
        } else if (isShorthandInlineRole(n.role)) {
          lossy(diags, `span role '${n.role}' degraded to plain text in Markdown output`);
          out += serializeMdInline(n.children, diags);
        } else {
          lossy(diags, `custom span role '${n.role}' degraded to plain text in Markdown output`);
          out += serializeMdInline(n.children, diags);
        }
        break;
      case "footnoteRef":
        out += `[^${escapeMdText(n.id)}]`;
        break;
    }
  }
  return out;
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

function serializeMdListItem(
  item: ListItem,
  ordered: boolean,
  markerNum: number,
  indent: number,
  diags: Diagnostics,
): string {
  const pad = " ".repeat(indent);
  let marker: string;
  if (item.checked === true) marker = "- [x] ";
  else if (item.checked === false) marker = "- [ ] ";
  else marker = ordered ? `${markerNum}. ` : "- ";
  const contentIndent = indent + marker.length;
  const contPad = " ".repeat(contentIndent);
  const lines: string[] = [];

  for (const b of item.blocks) {
    if (b.type === "list") {
      lines.push(serializeMdList(b, contentIndent, diags));
      continue;
    }
    const body = serializeMdBlock(b, diags);
    const bodyLines = body.split("\n");
    if (lines.length === 0) {
      lines.push(bodyLines.map((l, j) => (j === 0 ? pad + marker + l : contPad + l)).join("\n"));
    } else {
      lines.push(bodyLines.map((l) => contPad + l).join("\n"));
    }
  }
  return lines.join("\n");
}

function serializeMdList(
  b: Extract<Block, { type: "list" }>,
  indent: number,
  diags: Diagnostics,
): string {
  return b.items
    .map((item, i) => serializeMdListItem(item, b.ordered, b.start + i, indent, diags))
    .join("\n");
}

function serializeMdQuote(b: Extract<Block, { type: "quote" }>, diags: Diagnostics): string {
  const parts = b.children.map((c) => serializeMdBlock(c, diags));
  return parts
    .map((part) =>
      part
        .split("\n")
        .map((l) => "> " + l)
        .join("\n"),
    )
    .join("\n>\n");
}

function serializeMdTable(b: Extract<Block, { type: "table" }>, diags: Diagnostics): string {
  const rows = b.rows.map(
    (r) => "| " + r.cells.map((c) => serializeMdInline(c, diags)).join(" | ") + " |",
  );
  if (b.rows.length > 0) {
    const cols = b.rows[0].cells.length;
    const seps = Array.from({ length: cols }, (_, i) => alignSep(b.align[i] ?? null));
    rows.splice(1, 0, "| " + seps.join(" | ") + " |");
  }
  return rows.join("\n");
}

function serializeAlertContainer(
  name: string,
  attrs: Record<string, string>,
  children: Block[],
  diags: Diagnostics,
): string {
  const label = name.toUpperCase();
  const title = attrs.title;
  const header = title ? `**${label} — ${escapeMdText(title)}:**` : `**${label}:**`;
  const body = children.map((c) => serializeMdBlock(c, diags)).join("\n\n");
  return [header, body]
    .filter(Boolean)
    .join("\n\n")
    .split("\n")
    .map((l) => "> " + l)
    .join("\n");
}

function serializeCardContainer(
  attrs: Record<string, string>,
  children: Block[],
  diags: Diagnostics,
): string {
  const parts: string[] = [];
  const title = attrs.title;
  if (title) parts.push(`## ${escapeMdText(title)}`);
  else if (Object.keys(attrs).length)
    lossy(diags, "card without title degraded to body-only heading");
  parts.push(...children.map((c) => serializeMdBlock(c, diags)));
  return parts.filter(Boolean).join("\n\n");
}

function serializeDefinitionList(
  b: Extract<Block, { type: "definitionList" }>,
  diags: Diagnostics,
): string {
  lossy(diags, "definition list degraded to bold term plus indented definition in Markdown output");
  const parts: string[] = [];
  for (const item of b.items) {
    const term = serializeMdInline(item.term, diags);
    parts.push(`**${term}**`);
    for (const def of item.definitions) {
      const body = def.map((block) => serializeMdBlock(block, diags)).join("\n\n");
      parts.push(
        body
          .split("\n")
          .map((l) => "    " + l)
          .join("\n"),
      );
    }
  }
  return parts.join("\n\n");
}

function serializeFootnoteDefinition(
  b: Extract<Block, { type: "footnoteDefinition" }>,
  diags: Diagnostics,
): string {
  const body = b.children.map((c) => serializeMdBlock(c, diags)).join("\n");
  return `[^${escapeMdText(b.id)}]: ${body.replace(/\n/g, "\n  ")}`;
}

function serializeKvLeaf(attrs: Record<string, string>, diags: Diagnostics): string {
  lossy(diags, "kv leaf degraded to two-column GFM table");
  const entries = Object.entries(attrs).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return "| Key | Value |\n| --- | --- |";
  const rows = ["| Key | Value |", "| --- | --- |"];
  for (const [k, v] of entries) {
    rows.push(`| ${escapeMdText(k)} | ${escapeMdText(v)} |`);
  }
  return rows.join("\n");
}

function serializeImageLeaf(attrs: Record<string, string>, diags: Diagnostics): string {
  const alt = attrs.alt ?? "";
  const src = attrs.src ? sanitizeHref(attrs.src) : null;
  if (src) return `![${escapeMdText(alt)}](${src})`;
  lossy(diags, "image with unsafe or missing src degraded to placeholder");
  return `[Image: ${escapeMdText(alt || "image")}]`;
}

function serializeGridContainer(children: Block[], diags: Diagnostics): string {
  lossy(diags, "grid container degraded to row-major flattened blocks in Markdown output");
  return children
    .map((c) => serializeMdBlock(c, diags))
    .filter(Boolean)
    .join("\n\n");
}

function serializeDetailsContainer(
  attrs: Record<string, string>,
  children: Block[],
  diags: Diagnostics,
): string {
  lossy(diags, "details container degraded to summary heading and body in Markdown output");
  const summary = attrs.summary?.trim() || "Details";
  const open = attrs.open?.trim().toLowerCase() !== "false";
  const header = `**${escapeMdText(summary)}**`;
  if (!open) return header;
  const body = children
    .map((c) => serializeMdBlock(c, diags))
    .filter(Boolean)
    .join("\n\n");
  return body ? `${header}\n\n${body}` : header;
}

function serializeFigureContainer(
  attrs: Record<string, string>,
  children: Block[],
  diags: Diagnostics,
): string {
  lossy(diags, "figure container degraded to body plus caption line in Markdown output");
  const body = children
    .map((c) => serializeMdBlock(c, diags))
    .filter(Boolean)
    .join("\n\n");
  const caption = attrs.caption?.trim();
  const captionLine = caption ? `*Figure: ${escapeMdText(caption)}*` : "*Figure:*";
  return body ? `${body}\n\n${captionLine}` : captionLine;
}

function serializeMetricLeaf(attrs: Record<string, string>, diags: Diagnostics): string {
  lossy(diags, "metric leaf degraded to bold label and value in Markdown output");
  const label = attrs.label?.trim() || "Metric";
  const value = attrs.value?.trim() || "—";
  const change = attrs.change?.trim();
  const changePart = change ? ` (${escapeMdText(change)})` : "";
  return `**${escapeMdText(label)}:** ${escapeMdText(value)}${changePart}`;
}

function serializeProgressLeaf(attrs: Record<string, string>, diags: Diagnostics): string {
  lossy(diags, "progress leaf degraded to label and numeric fraction in Markdown output");
  const label = attrs.label?.trim() || "Progress";
  let max = Number.parseFloat(attrs.max ?? "100");
  if (!Number.isFinite(max) || max <= 0) max = 100;
  let value = Number.parseFloat(attrs.value ?? "0");
  if (!Number.isFinite(value) || value < 0) value = 0;
  value = Math.min(max, value);
  const pct = Math.round((value / max) * 100);
  return `**${escapeMdText(label)}:** ${value}/${max} (${pct}%)`;
}

function serializeEventLeaf(attrs: Record<string, string>, diags: Diagnostics): string {
  lossy(diags, "event leaf degraded to list item in Markdown output");
  const time = attrs.time?.trim();
  const title = attrs.title?.trim() || "Event";
  const detail = attrs.detail?.trim();
  const timePart = time ? `**${escapeMdText(time)}** ` : "";
  const detailPart = detail ? ` — ${escapeMdText(detail)}` : "";
  return `- ${timePart}${escapeMdText(title)}${detailPart}`;
}

function serializeMdBlock(b: Block, diags: Diagnostics): string {
  switch (b.type) {
    case "heading":
      return "#".repeat(b.level) + " " + serializeMdInline(b.children, diags);
    case "paragraph":
      return serializeMdInline(b.children, diags);
    case "thematicBreak":
      return "---";
    case "codeBlock": {
      const fence = "`".repeat(codeFenceLength(b.value));
      const lang = b.language ?? "";
      return `${fence}${lang}\n${sanitizeText(b.value, "code")}\n${fence}`;
    }
    case "quote":
      return serializeMdQuote(b, diags);
    case "list":
      return serializeMdList(b, 0, diags);
    case "table":
      return serializeMdTable(b, diags);
    case "definitionList":
      return serializeDefinitionList(b, diags);
    case "footnoteDefinition":
      return serializeFootnoteDefinition(b, diags);
    case "container":
      if (isAlertContainer(b.name)) {
        lossy(diags, `alert container '${b.name}' degraded to labeled blockquote`);
        return serializeAlertContainer(b.name, b.attrs, b.children, diags);
      }
      if (b.name === "card") {
        lossy(diags, "card container degraded to heading and body");
        return serializeCardContainer(b.attrs, b.children, diags);
      }
      if (b.name === "grid") return serializeGridContainer(b.children, diags);
      if (b.name === "details") return serializeDetailsContainer(b.attrs, b.children, diags);
      if (b.name === "figure") return serializeFigureContainer(b.attrs, b.children, diags);
      lossy(diags, `container '${b.name}' degraded to its children`);
      return b.children.map((c) => serializeMdBlock(c, diags)).join("\n\n");
    case "leaf":
      if (b.name === "kv") return serializeKvLeaf(b.attrs, diags);
      if (b.name === "image") return serializeImageLeaf(b.attrs, diags);
      if (b.name === "metric") return serializeMetricLeaf(b.attrs, diags);
      if (b.name === "progress") return serializeProgressLeaf(b.attrs, diags);
      if (b.name === "event") return serializeEventLeaf(b.attrs, diags);
      if (b.name === "break") return "---";
      lossy(diags, `leaf '${b.name}' degraded to empty output`);
      return "";
  }
}

/** Serialize a TDoc to deterministic Markdown (no control characters). */
export function serializeMarkdown(doc: TDoc, diags: Diagnostics): string {
  const bodyParts: string[] = [];
  const footnotes: string[] = [];

  for (const b of doc.blocks) {
    if (b.type === "footnoteDefinition") {
      const s = serializeFootnoteDefinition(b, diags);
      if (s.length) footnotes.push(s);
      continue;
    }
    const s = serializeMdBlock(b, diags);
    if (s.length) bodyParts.push(s);
  }

  const parts = [...bodyParts];
  if (footnotes.length) {
    if (parts.length) parts.push("");
    parts.push(...footnotes);
  }

  const out = parts.join("\n\n") + (parts.length ? "\n" : "");
  return sanitizeText(out);
}

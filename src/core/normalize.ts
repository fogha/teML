// core/normalize.ts — post-parse cleanup so layout sees predictable trees.

import type { Block, DefinitionItem, Inline, ListItem, TDoc } from "./ast.js";
import { inlineText } from "./ast.js";
import type { Diagnostics } from "./diagnostics.js";
import { buildFootnoteIndex } from "./footnotes.js";
import { sanitizeText } from "./sanitize.js";
import { isFocusableContainer, isFocusableLeaf, isKnownContainer } from "../teml/directives.js";
import { DEFAULT_TEXTAREA_ROWS, MAX_TEXTAREA_ROWS } from "../layout/textarea.js";

type NormalizeContext = {
  inRadio?: boolean;
  inScroll?: boolean;
};

export type NormalizeFragmentContext = {
  inScroll?: boolean;
};

function mergeText(nodes: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const n of nodes) {
    const withKids = "children" in n ? ({ ...n, children: mergeText(n.children) } as Inline) : n;
    const prev = out[out.length - 1];
    if (withKids.type === "text" && prev?.type === "text") prev.value += withKids.value;
    else out.push(withKids);
  }
  return out;
}

function normalizeListItem(
  item: ListItem,
  diags?: Diagnostics,
  context: NormalizeContext = {},
): ListItem {
  const blocks = normalizeBlocks(item.blocks, diags, context);
  const out: ListItem = { blocks };
  if (item.checked === true || item.checked === false) out.checked = item.checked;
  return out;
}

function normalizeBlocks(
  blocks: Block[],
  diags?: Diagnostics,
  context: NormalizeContext = {},
): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    const n = normalizeBlock(b, diags, context);
    if (n == null) continue;
    if (Array.isArray(n)) out.push(...n);
    else out.push(n);
  }
  return coalesceDefinitionContainers(out);
}

function definitionItemFromContainer(
  b: Extract<Block, { type: "container" }>,
  diags?: Diagnostics,
  context: NormalizeContext = {},
): DefinitionItem | null {
  if (b.name !== "definition") return null;
  const termStr = b.attrs.term;
  if (!termStr) return null;
  return {
    term: [{ type: "text", value: termStr }],
    definitions: [normalizeBlocks(b.children, diags, context)],
  };
}

/** Merge adjacent :::definition{term="..."} containers into one definitionList. */
function coalesceDefinitionContainers(blocks: Block[]): Block[] {
  const out: Block[] = [];
  let pending: DefinitionItem[] | null = null;

  const flush = () => {
    if (pending?.length) {
      out.push({ type: "definitionList", items: pending });
      pending = null;
    }
  };

  for (const b of blocks) {
    if (b.type === "container" && b.name === "definition") {
      const item = definitionItemFromContainer(b);
      if (item) {
        if (!pending) pending = [];
        pending.push(item);
        continue;
      }
    }
    flush();
    out.push(b);
  }
  flush();
  return out;
}

function normalizedRows(
  raw: string | undefined,
  fallback: number,
  max: number,
  code: string,
  label: string,
  diags?: Diagnostics,
): string {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    if (raw !== undefined) {
      diags?.warn(code, `${label} rows must be an integer from 1 to ${max}; using ${fallback}`);
    }
    return String(fallback);
  }
  return String(parsed);
}

function normalizeRadio(
  b: Extract<Block, { type: "container" }>,
  children: Block[],
  attrs: Record<string, string>,
  diags?: Diagnostics,
): Block {
  const options: Block[] = [];
  const seen = new Set<string>();
  for (const child of children) {
    if (child.type !== "leaf" || child.name !== "option") {
      diags?.warn("radio-invalid-child", "radio groups may contain only ::option leaves");
      continue;
    }
    const value = child.attrs.value?.trim();
    if (!value) {
      diags?.warn("radio-option-missing-value", "radio option without a value was ignored");
      continue;
    }
    if (seen.has(value)) {
      diags?.warn("radio-duplicate-value", `duplicate radio option value '${value}' was ignored`);
      continue;
    }
    seen.add(value);
    options.push({
      ...child,
      attrs: { value, label: child.attrs.label?.trim() || value },
    });
  }
  if (options.length === 0) {
    diags?.warn("radio-no-options", "radio group has no valid options");
  }
  const value = attrs.value?.trim();
  const nextAttrs = { ...attrs };
  if (value && !seen.has(value)) {
    diags?.warn("radio-invalid-default", `radio default '${value}' does not match an option`);
    delete nextAttrs.value;
  } else if (value) {
    nextAttrs.value = value;
  }
  return { ...b, attrs: nextAttrs, children: options };
}

function normalizeBlock(
  b: Block,
  diags?: Diagnostics,
  context: NormalizeContext = {},
): Block | Block[] | null {
  switch (b.type) {
    case "paragraph": {
      const children = mergeText(b.children);
      if (inlineText(children).trim() === "") return null;
      const first = children[0];
      const last = children[children.length - 1];
      if (first?.type === "text") first.value = first.value.replace(/^\s+/, "");
      if (last?.type === "text") last.value = last.value.replace(/\s+$/, "");
      return { ...b, children };
    }
    case "heading":
      return { ...b, children: mergeText(b.children) };
    case "list":
      return { ...b, items: b.items.map((item) => normalizeListItem(item, diags, context)) };
    case "quote":
      return { ...b, children: normalizeBlocks(b.children, diags, context) };
    case "table":
      return {
        ...b,
        rows: b.rows.map((row) => ({
          ...row,
          cells: row.cells.map((cell) => mergeText(cell)),
        })),
      };
    case "definitionList":
      return {
        ...b,
        items: b.items.map((item) => ({
          term: mergeText(item.term),
          definitions: item.definitions.map((def) => normalizeBlocks(def, diags, context)),
        })),
      };
    case "footnoteDefinition":
      return { ...b, id: b.id.trim(), children: normalizeBlocks(b.children, diags, context) };
    case "container": {
      if (b.name === "footnote") {
        const id = b.attrs.id?.trim();
        if (!id) return null;
        return {
          type: "footnoteDefinition",
          id,
          children: normalizeBlocks(b.children, diags, context),
        };
      }
      if (context.inScroll && b.name === "scroll") {
        diags?.warn("scroll-nested-scroll", "nested scroll regions are not supported");
        return normalizeBlocks(b.children, diags, { ...context, inScroll: true });
      }
      const childContext: NormalizeContext =
        b.name === "radio"
          ? { ...context, inRadio: true }
          : b.name === "scroll"
            ? { inScroll: true }
            : context;
      let children = normalizeBlocks(b.children, diags, childContext);
      let attrs = { ...b.attrs };
      if (context.inScroll && isFocusableContainer(b.name) && attrs.id) {
        diags?.warn(
          "scroll-nested-widget",
          `focusable :::${b.name} inside :::scroll was made static`,
        );
        delete attrs.id;
      }
      if (b.name === "card" && !attrs.title && children[0]?.type === "heading") {
        const h = children[0];
        if (h.level >= 2) {
          attrs = { ...attrs, title: inlineText(h.children) };
          children = children.slice(1);
        }
      }
      if (b.name === "radio") return normalizeRadio(b, children, attrs, diags);
      if (b.name === "scroll") {
        attrs.rows = normalizedRows(
          attrs.rows,
          10,
          500,
          "scroll-invalid-rows",
          "scroll region",
          diags,
        );
      }
      const normalized: Block = { ...b, attrs, children };
      if (!isKnownContainer(b.name) && children.length === 1) {
        return children[0];
      }
      return normalized;
    }
    case "leaf": {
      const attrs = { ...b.attrs };
      if (b.name === "textarea") {
        attrs.rows = normalizedRows(
          attrs.rows,
          DEFAULT_TEXTAREA_ROWS,
          MAX_TEXTAREA_ROWS,
          "textarea-invalid-rows",
          "textarea",
          diags,
        );
        if (attrs.value !== undefined) {
          attrs.value = sanitizeText(attrs.value.replace(/\r\n?/g, "\n"));
        }
      }
      if (b.name === "option" && !context.inRadio) {
        diags?.warn("radio-option-outside-group", "::option outside :::radio is static");
      }
      if (context.inScroll && isFocusableLeaf(b.name) && attrs.id) {
        diags?.warn(
          "scroll-nested-widget",
          `focusable ::${b.name} inside :::scroll was made static`,
        );
        delete attrs.id;
      }
      return { ...b, attrs };
    }
    default:
      return b;
  }
}

export function normalize(docNode: TDoc, diags?: Diagnostics): TDoc {
  const blocks = normalizeBlocks(docNode.blocks, diags);
  if (diags) buildFootnoteIndex(blocks, diags);
  return { meta: docNode.meta, blocks };
}

/** Normalize blocks for insertion at a structural mutation graft site. */
export function normalizeFragment(
  blocks: Block[],
  diags?: Diagnostics,
  context: NormalizeFragmentContext = {},
): Block[] {
  return normalizeBlocks(blocks, diags, context);
}

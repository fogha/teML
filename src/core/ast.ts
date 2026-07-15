// core/ast.ts — the Terminal Document AST (design doc §8). Every frontend
// produces this; layout and every backend consume it. Nothing else is shared.

/** Named ANSI palette entries and 24-bit hex colors for document-defined roles. */
export type AnsiColorName =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite";

export type HexColor = `#${string}`;

export type ColorValue = AnsiColorName | HexColor;

/** Flat style record stored on Meta.roles — no Theme import to avoid cycles. */
export type RoleStyle = {
  fg?: ColorValue;
  bg?: ColorValue;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
};

export type Meta = {
  title?: string;
  theme?: string;
  base?: string;
  lang?: string;
  roles?: Record<string, RoleStyle>;
};

export type TDoc = { meta: Meta; blocks: Block[] };

export type Align = "left" | "right" | "center" | null;

/** List item with block content and optional GFM task-list checked state. */
export type ListItem = {
  blocks: Block[];
  checked?: boolean;
};

/** Definition list entry: inline term and one-or-more definition block groups. */
export type DefinitionItem = {
  term: Inline[];
  definitions: Block[][];
};

export type Block =
  | { type: "heading"; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { type: "paragraph"; children: Inline[] }
  | { type: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { type: "quote"; children: Block[] }
  | { type: "codeBlock"; language?: string; value: string }
  | { type: "thematicBreak" }
  | { type: "table"; align: Align[]; rows: { header: boolean; cells: Inline[][] }[] }
  | { type: "container"; name: string; attrs: Record<string, string>; children: Block[] }
  | { type: "leaf"; name: string; attrs: Record<string, string> }
  | { type: "definitionList"; items: DefinitionItem[] }
  | { type: "footnoteDefinition"; id: string; children: Block[] };

export type Inline =
  | { type: "text"; value: string }
  | { type: "bold"; children: Inline[] }
  | { type: "italic"; children: Inline[] }
  | { type: "underline"; children: Inline[] }
  | { type: "strike"; children: Inline[] }
  | { type: "code"; value: string }
  | { type: "link"; href: string; children: Inline[] }
  | { type: "span"; role: string; children: Inline[] }
  | { type: "footnoteRef"; id: string };

export function doc(blocks: Block[], meta: Meta = {}): TDoc {
  return { meta, blocks };
}

export function text(value: string): Inline {
  return { type: "text", value };
}

export function listItem(...blocks: Block[]): ListItem {
  return { blocks };
}

export function checkedListItem(checked: boolean, ...blocks: Block[]): ListItem {
  return { blocks, checked };
}

/** Flatten an inline tree to its plain text (for measurements, titles, alt text). */
export function inlineText(nodes: Inline[]): string {
  let out = "";
  for (const n of nodes) {
    if (n.type === "text" || n.type === "code") out += n.value;
    else if (n.type === "footnoteRef") out += `[${n.id}]`;
    else if ("children" in n) out += inlineText(n.children);
  }
  return out;
}

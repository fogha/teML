// teml/escape.ts — context-aware TeML text escaping (inverse of parse).

export type EscapeContext = "prose" | "link" | "attr" | "codeInline" | "codeFence" | "tableCell";

const PROSE_SPECIAL = /[\\*`[\]{}_#|]/g;
const LINK_SPECIAL = /[\\*`[\]]/g;
const TABLE_CELL_SPECIAL = /[\\|]/g;

/** Escape text so re-parsing yields the same literal / structure. */
export function escapeTemlText(s: string, ctx: EscapeContext = "prose"): string {
  switch (ctx) {
    case "prose": {
      let out = s.replace(PROSE_SPECIAL, "\\$&");
      out = out.replace(/(?<!\\):(?=[a-zA-Z0-9])/g, "\\:");
      return out;
    }
    case "tableCell":
      return s.replace(TABLE_CELL_SPECIAL, "\\$&");
    case "link":
      return s.replace(LINK_SPECIAL, "\\$&");
    case "attr":
      return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    case "codeInline": {
      const out = s.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
      return out;
    }
    case "codeFence":
      return s;
  }
}

function longestBacktickRun(value: string): number {
  let max = 0;
  const re = /`+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value))) max = Math.max(max, match[0].length);
  return max;
}

export function serializeCodeSpan(value: string): string {
  const delimiter = "`".repeat(longestBacktickRun(value) + 1);
  const padded =
    value.startsWith("`") ||
    value.endsWith("`") ||
    (value.startsWith(" ") && value.endsWith(" ") && value.trim().length > 0);
  const padding = padded ? " " : "";
  return `${delimiter}${padding}${value}${padding}${delimiter}`;
}

export function serializeLinkDestination(href: string): string {
  const escaped = href.replace(/\\/g, "\\\\");
  if (!/[\s()<>]/.test(href)) return escaped;
  return `<${escaped.replace(/</g, "\\<").replace(/>/g, "\\>")}>`;
}

/** Minimum fence length for a code block (>=3, longer if content contains backticks). */
export function codeFenceLength(value: string): number {
  return Math.max(3, longestBacktickRun(value) + 1);
}

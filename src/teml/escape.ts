// teml/escape.ts — context-aware TeML text escaping (inverse of parse).

export type EscapeContext = "prose" | "link" | "attr" | "codeInline" | "codeFence" | "tableCell";

const PROSE_SPECIAL = /[\\*`\[\]{}_#|]/g;
const LINK_SPECIAL = /[\\*`[\]]/g;
const TABLE_CELL_SPECIAL = /[\\|]/g;

/** Escape text so re-parsing yields the same literal / structure. */
export function escapeTemlText(s: string, ctx: EscapeContext = "prose"): string {
  switch (ctx) {
    case "prose": {
      let out = s.replace(PROSE_SPECIAL, "\\$&");
      out = out.replace(/(?<!\\):(?=[a-zA-Z])/g, "\\:");
      return out;
    }
    case "tableCell":
      return s.replace(TABLE_CELL_SPECIAL, "\\$&");
    case "link":
      return s.replace(LINK_SPECIAL, "\\$&");
    case "attr":
      return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    case "codeInline": {
      let out = s.replace(/\\/g, "\\\\").replace(/`/g, "\\`");
      return out;
    }
    case "codeFence":
      return s;
  }
}

/** Minimum fence length for a code block (>=3, longer if content contains backticks). */
export function codeFenceLength(value: string): number {
  let max = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value))) max = Math.max(max, m[0].length);
  return Math.max(3, max + 1);
}

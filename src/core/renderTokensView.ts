// core/renderTokensView.ts — deterministic layout token stream for inspect --render-tokens.

import type { Line } from "../render/styledLine.js";
import type { Style } from "../terminal/theme.js";

function q(value: string): string {
  return JSON.stringify(value);
}

function styleParts(style: Style): string[] {
  const parts: string[] = [];
  if (style.bold) parts.push("bold=true");
  if (style.italic) parts.push("italic=true");
  if (style.underline) parts.push("underline=true");
  if (style.strike) parts.push("strike=true");
  if (style.fg != null) parts.push(`fg=${q(String(style.fg))}`);
  if (style.bg != null) parts.push(`bg=${q(String(style.bg))}`);
  if (style.href) parts.push(`href=${q(style.href)}`);
  return parts;
}

/** Emit one token per styled span in layout order (deterministic snapshot aid). */
export function renderTokensView(lines: Line[]): string {
  const out: string[] = ["render_start"];
  for (let i = 0; i < lines.length; i++) {
    out.push(`line_start index=${i}`);
    for (const span of lines[i]!) {
      const parts = [`span text=${q(span.text)}`, ...styleParts(span.style)];
      out.push(parts.join(" "));
    }
    out.push(`line_end index=${i}`);
  }
  out.push("render_end");
  return out.join("\n") + "\n";
}

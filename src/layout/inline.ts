// layout/inline.ts — AST inline nodes → styled spans.

import type { Diagnostics, FootnoteIndex, Inline } from "../core/index.js";
import { footnoteNumber } from "../core/index.js";
import { colorsEnabled, type Capabilities } from "../terminal/capabilities.js";
import type { Style, Theme } from "../terminal/theme.js";
import { decoration, mergeStyle, resolveRole } from "../terminal/theme.js";
import type { Span } from "../render/styledLine.js";

export type InlineOpts = {
  theme: Theme;
  caps: Capabilities;
  diags: Diagnostics;
  footnotes?: FootnoteIndex;
  showUrls?: boolean;
};

export function inlineToSpans(nodes: Inline[], opts: InlineOpts, inherited: Style = {}): Span[] {
  const t = opts.theme;
  const out: Span[] = [];
  for (const n of nodes) {
    switch (n.type) {
      case "text":
        out.push({ text: n.value, style: inherited });
        break;
      case "bold":
        out.push(...inlineToSpans(n.children, opts, mergeStyle(inherited, { bold: true })));
        break;
      case "italic":
        out.push(...inlineToSpans(n.children, opts, mergeStyle(inherited, { italic: true })));
        break;
      case "underline":
        out.push(...inlineToSpans(n.children, opts, mergeStyle(inherited, { underline: true })));
        break;
      case "strike":
        out.push(...inlineToSpans(n.children, opts, mergeStyle(inherited, { strike: true })));
        break;
      case "code":
        out.push({
          text: n.value,
          style: mergeStyle(inherited, resolveRole(t, "code", opts.diags)),
        });
        break;
      case "link": {
        const style = mergeStyle(inherited, {
          ...resolveRole(t, "link", opts.diags),
          href: n.href,
        });
        const childSpans = inlineToSpans(n.children, opts, style);
        const showUrl = Boolean(opts.showUrls ?? opts.caps.showUrls) || !opts.caps.hyperlinks;
        if (showUrl && n.href) {
          const muted = resolveRole(t, "muted", opts.diags);
          childSpans.push({ text: ` (${n.href})`, style: mergeStyle(inherited, muted) });
        }
        out.push(...childSpans);
        break;
      }
      case "span": {
        const role = n.role === "status" ? "info" : n.role;
        const roleStyle = resolveRole(t, role, opts.diags);
        const inner = inlineToSpans(n.children, opts, mergeStyle(inherited, roleStyle));
        if (n.role === "kbd") {
          out.push({ text: "[", style: resolveRole(t, "muted", opts.diags) }, ...inner, {
            text: "]",
            style: resolveRole(t, "muted", opts.diags),
          });
        } else if ((n.role === "success" || n.role === "error") && opts.caps.unicode) {
          const glyph = n.role === "success" ? "✓ " : "✗ ";
          out.push({ text: glyph, style: roleStyle }, ...inner);
        } else if (
          (n.role === "success" || n.role === "error" || n.role === "warning") &&
          !colorsEnabled(opts.caps)
        ) {
          const dec = decoration(opts.theme, n.role);
          const tag = dec ? (opts.caps.unicode ? "" : dec.labelAscii + " ") : "";
          out.push({ text: tag, style: roleStyle }, ...inner);
        } else {
          out.push(...inner);
        }
        break;
      }
      case "footnoteRef": {
        const num = opts.footnotes ? footnoteNumber(opts.footnotes, n.id) : undefined;
        const label = num != null ? `[${num}]` : `[?]`;
        out.push({
          text: label,
          style: mergeStyle(inherited, resolveRole(t, "muted", opts.diags)),
        });
        break;
      }
    }
  }
  return out;
}

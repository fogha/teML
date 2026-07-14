// teml/directives.ts — v1 directive registry and attribute sanitization (F-2).

import { sanitizeText } from "../core/sanitize.js";

export type DirectiveSpec = {
  attrs?: readonly string[];
};

export const ALERT_CONTAINERS = ["info", "success", "warning", "error", "note"] as const;

export const DIRECTIVE_REGISTRY = {
  containers: {
    card: { attrs: ["title"] },
    info: { attrs: ["title"] },
    success: { attrs: ["title"] },
    warning: { attrs: ["title"] },
    error: { attrs: ["title"] },
    note: { attrs: ["title"] },
    definition: { attrs: ["term"] },
    footnote: { attrs: ["id"] },
    grid: { attrs: ["columns", "gap"] },
    details: { attrs: ["summary", "open"] },
    figure: { attrs: ["caption"] },
  },
  leafs: {
    kv: {},
    image: { attrs: ["src", "alt"] },
    break: {},
    metric: { attrs: ["label", "value", "role", "change"] },
    progress: { attrs: ["label", "value", "max", "role"] },
    event: { attrs: ["time", "title", "detail", "role"] },
  },
  inline: {
    success: {},
    warning: {},
    error: {},
    info: {},
    muted: {},
    highlight: {},
    kbd: {},
    status: { attrs: ["role"] },
    fn: { attrs: ["id"] },
  },
} as const satisfies {
  containers: Record<string, DirectiveSpec>;
  leafs: Record<string, DirectiveSpec>;
  inline: Record<string, DirectiveSpec>;
};

export const CONTAINER_DIRECTIVES = new Set(Object.keys(DIRECTIVE_REGISTRY.containers));
export const LEAF_DIRECTIVES = new Set(Object.keys(DIRECTIVE_REGISTRY.leafs));
export const INLINE_DIRECTIVES = new Set(Object.keys(DIRECTIVE_REGISTRY.inline));

const INLINE_ROLE_NAMES = new Set(
  Object.keys(DIRECTIVE_REGISTRY.inline).filter((n) => n !== "status" && n !== "fn"),
);

/** Parse `{key="value" bare=val}` attribute strings (legacy helper). */
export function parseAttrs(src: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_][\w-]*)\s*=\s*("([^"]*)"|'([^']*)'|[^\s}]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const raw = m[3] ?? m[4] ?? m[2];
    attrs[sanitizeAttrKey(m[1])] = sanitizeAttrValue(raw);
  }
  return attrs;
}

export function sanitizeAttrKey(key: string): string {
  return sanitizeText(key).replace(/\s+/g, "");
}

export function sanitizeAttrValue(value: string): string {
  return sanitizeText(value);
}

/** Sanitize mdast/remark directive attributes at ingestion. */
export function sanitizeDirectiveAttrs(
  raw: Record<string, string | null | undefined> | null | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    const key = sanitizeAttrKey(k);
    if (!key) continue;
    out[key] = sanitizeAttrValue(String(v));
  }
  return out;
}

export function isKnownContainer(name: string): boolean {
  return CONTAINER_DIRECTIVES.has(name);
}

export function isKnownLeaf(name: string): boolean {
  return LEAF_DIRECTIVES.has(name);
}

export function isKnownInlineDirective(name: string): boolean {
  return INLINE_DIRECTIVES.has(name);
}

export function isShorthandInlineRole(name: string): boolean {
  return INLINE_ROLE_NAMES.has(name);
}

export function isAlertContainer(name: string): boolean {
  return (ALERT_CONTAINERS as readonly string[]).includes(name);
}

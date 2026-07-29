// teml/directives.ts — v1 directive registry and attribute sanitization (F-2).

import { sanitizeText } from "../core/sanitize.js";

export type DirectiveSpec = {
  attrs?: readonly string[];
};

export const ALERT_CONTAINERS = ["info", "success", "warning", "error", "note"] as const;

export const DIRECTIVE_REGISTRY = {
  containers: {
    card: { attrs: ["id", "title"] },
    info: { attrs: ["id", "title"] },
    success: { attrs: ["id", "title"] },
    warning: { attrs: ["id", "title"] },
    error: { attrs: ["id", "title"] },
    note: { attrs: ["id", "title"] },
    definition: { attrs: ["term"] },
    footnote: { attrs: ["id"] },
    grid: { attrs: ["id", "columns", "gap"] },
    details: { attrs: ["id", "summary", "open"] },
    figure: { attrs: ["id", "caption"] },
    radio: { attrs: ["id", "value"] },
    scroll: { attrs: ["id", "rows"] },
  },
  leafs: {
    kv: {},
    image: { attrs: ["src", "alt"] },
    break: {},
    metric: { attrs: ["id", "label", "value", "role", "change"] },
    progress: { attrs: ["id", "label", "value", "max", "role"] },
    event: { attrs: ["time", "title", "detail", "role"] },
    button: { attrs: ["id", "label"] },
    input: { attrs: ["id", "label", "placeholder", "value"] },
    checkbox: { attrs: ["id", "label", "checked"] },
    textarea: { attrs: ["id", "label", "placeholder", "value", "rows"] },
    option: { attrs: ["value", "label"] },
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

/** Leaf directives that can hold keyboard focus in an interactive session. */
export const FOCUSABLE_LEAFS = new Set(["button", "input", "checkbox", "textarea"]);
export const FOCUSABLE_CONTAINERS = new Set(["radio", "scroll"]);

/** Display leafs addressable by the interactive `update` command. */
export const UPDATABLE_LEAFS = new Set(["progress", "metric"]);

/** Containers that may be addressed by structural mutation commands. */
export const MUTATION_CONTAINERS = new Set([
  "card",
  ...ALERT_CONTAINERS,
  "grid",
  "details",
  "figure",
  "scroll",
]);

/** Mutable attribute allowlist per updatable leaf (sanitized at apply time). */
export const UPDATABLE_MUTABLE_ATTRS: Readonly<Record<string, readonly string[]>> = {
  progress: ["label", "value", "max"],
  metric: ["label", "value", "change"],
};

export function isFocusableLeaf(name: string): boolean {
  return FOCUSABLE_LEAFS.has(name);
}

export function isFocusableContainer(name: string): boolean {
  return FOCUSABLE_CONTAINERS.has(name);
}

export function isUpdatableLeaf(name: string): boolean {
  return UPDATABLE_LEAFS.has(name);
}

export function isMutationContainer(name: string): boolean {
  return MUTATION_CONTAINERS.has(name);
}

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

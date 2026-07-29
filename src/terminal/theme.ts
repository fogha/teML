// terminal/theme.ts — R-3. Roles → styles. The document says "success"; this
// file decides what success looks like, per theme, per capability tier.

import { readFileSync, existsSync } from "node:fs";
import { bundledFileExists, readBundledFile } from "../sea/runtime.js";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ColorValue, Meta, RoleStyle } from "../core/ast.js";
import type { Diagnostics } from "../core/diagnostics.js";

export type NamedColor =
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

export type Color = ColorValue;

export type Style = {
  fg?: Color;
  bg?: Color;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  href?: string; // carried through for OSC 8 emission
  /** Internal layout metadata used to derive interactive hit regions.
   * Renderers deliberately ignore it. */
  widgetId?: string;
  /** Generalized focus target metadata for container and composite widgets. */
  interactiveId?: string;
  interactiveKind?: "widget" | "radioOption" | "textareaContent" | "scroll";
  interactiveValue?: string;
};

export type Decoration = {
  gutterUnicode: string;
  gutterAscii: string;
  labelUnicode: string;
  labelAscii: string;
};

export type Theme = {
  name: string;
  roles: Record<string, Style>;
  decorations: Record<string, Decoration>;
};

/** Verified width-1 glyphs safe for decoration rendering. */
export const SAFE_GLYPHS = new Set([
  "•",
  "◦",
  "▸",
  "▪",
  "✓",
  "✗",
  "⚠",
  "ℹ",
  "›",
  "─",
  "│",
  "┌",
  "┐",
  "└",
  "┘",
  "├",
  "┤",
  "┬",
  "┴",
  "┼",
  "▎",
]);

export const NAMED_COLORS = new Set<string>([
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
]);

export const REQUIRED_ROLES = [
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "success",
  "warning",
  "error",
  "info",
  "muted",
  "highlight",
  "border",
  "link",
  "code",
  "codeBlock",
  "quote",
  "listMarker",
  "kbd",
  "cardTitle",
  "focus",
] as const;

export const REQUIRED_DECORATIONS = ["success", "warning", "error", "info"] as const;

const BUILTIN_THEMES = new Set(["dark", "light", "mono", "auto"]);
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const STYLE_KEYS = new Set(["fg", "bg", "bold", "italic", "underline", "strike"]);
const DECORATION_KEYS = new Set(["gutterUnicode", "gutterAscii", "labelUnicode", "labelAscii"]);

const __dirname = dirname(fileURLToPath(import.meta.url));

function themesDir(): string {
  return join(__dirname, "themes");
}

function isHexColor(value: string): value is `#${string}` {
  return HEX_COLOR.test(value);
}

export function isNamedColor(value: string): value is NamedColor {
  return NAMED_COLORS.has(value);
}

export function parseColor(value: unknown, diags?: Diagnostics, ctx?: string): Color | undefined {
  if (typeof value !== "string") return undefined;
  if (isNamedColor(value) || isHexColor(value)) return value;
  diags?.warn("theme-invalid-color", `invalid color${ctx ? ` in ${ctx}` : ""}: ${value}`);
  return undefined;
}

function parseStyle(raw: unknown, diags?: Diagnostics, ctx?: string): Style {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diags?.warn("theme-invalid-role", `invalid role style${ctx ? ` for ${ctx}` : ""}`);
    return {};
  }
  const style: Style = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!STYLE_KEYS.has(key)) {
      diags?.warn("theme-ignored-key", `ignored style key '${key}'${ctx ? ` in ${ctx}` : ""}`);
      continue;
    }
    if (key === "fg" || key === "bg") {
      const color = parseColor(value, diags, ctx ? `${ctx}.${key}` : key);
      if (color) style[key] = color;
    } else if (typeof value === "boolean") {
      style[key as "bold" | "italic" | "underline" | "strike"] = value;
    } else {
      diags?.warn("theme-invalid-role", `expected boolean for ${key}${ctx ? ` in ${ctx}` : ""}`);
    }
  }
  return style;
}

function validateDecorationGlyphs(text: string, diags?: Diagnostics, ctx?: string): boolean {
  for (const ch of text) {
    const codePoint = ch.codePointAt(0)!;
    const isControl =
      codePoint < 0x20 ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
    if (isControl || (codePoint > 0x7f && !SAFE_GLYPHS.has(ch))) {
      diags?.warn(
        "theme-unsafe-glyph",
        `unsafe decoration character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}${ctx ? ` in ${ctx}` : ""}`,
      );
      return false;
    }
  }
  return true;
}

function parseDecoration(raw: unknown, diags?: Diagnostics, ctx?: string): Decoration | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diags?.warn("theme-invalid-decoration", `invalid decoration${ctx ? ` for ${ctx}` : ""}`);
    return undefined;
  }
  const dec: Partial<Decoration> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!DECORATION_KEYS.has(key)) {
      diags?.warn("theme-ignored-key", `ignored decoration key '${key}'${ctx ? ` in ${ctx}` : ""}`);
      continue;
    }
    if (typeof value !== "string") {
      diags?.warn(
        "theme-invalid-decoration",
        `expected string for ${key}${ctx ? ` in ${ctx}` : ""}`,
      );
      continue;
    }
    if (validateDecorationGlyphs(value, diags, `${ctx}.${key}`)) {
      dec[key as keyof Decoration] = value;
    }
  }
  if (
    typeof dec.gutterUnicode === "string" &&
    typeof dec.gutterAscii === "string" &&
    typeof dec.labelUnicode === "string" &&
    typeof dec.labelAscii === "string"
  ) {
    return dec as Decoration;
  }
  diags?.warn("theme-invalid-decoration", `incomplete decoration${ctx ? ` for ${ctx}` : ""}`);
  return undefined;
}

export function validateThemeShape(raw: unknown, diags?: Diagnostics): Theme | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diags?.warn("theme-invalid", "theme root must be an object");
    return null;
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.trim() === "") {
    diags?.warn("theme-invalid", "theme.name must be a non-empty string");
    return null;
  }
  if (!obj.roles || typeof obj.roles !== "object" || Array.isArray(obj.roles)) {
    diags?.warn("theme-invalid", "theme.roles must be an object");
    return null;
  }
  if (!obj.decorations || typeof obj.decorations !== "object" || Array.isArray(obj.decorations)) {
    diags?.warn("theme-invalid", "theme.decorations must be an object");
    return null;
  }

  const roles: Record<string, Style> = {};
  for (const [role, styleRaw] of Object.entries(obj.roles as Record<string, unknown>)) {
    roles[role] = parseStyle(styleRaw, diags, role);
  }
  for (const role of REQUIRED_ROLES) {
    if (!(role in roles)) {
      diags?.warn("theme-missing-role", `theme missing required role '${role}'`);
      roles[role] = {};
    }
  }

  const decorations: Record<string, Decoration> = {};
  for (const [name, decRaw] of Object.entries(obj.decorations as Record<string, unknown>)) {
    const dec = parseDecoration(decRaw, diags, name);
    if (dec) decorations[name] = dec;
  }
  for (const name of REQUIRED_DECORATIONS) {
    if (!(name in decorations)) {
      diags?.warn("theme-missing-decoration", `theme missing required decoration '${name}'`);
    }
  }

  return { name: obj.name, roles, decorations };
}

function readThemeFile(path: string, diags?: Diagnostics, assetKey?: string): Theme | null {
  try {
    const raw = JSON.parse(
      assetKey ? readBundledFile(assetKey, path) : readFileSync(path, "utf8"),
    ) as unknown;
    return validateThemeShape(raw, diags);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    diags?.warn("theme-load-failed", `failed to load theme from ${path}: ${msg}`);
    return null;
  }
}

function loadBuiltinTheme(name: string, diags?: Diagnostics): Theme | null {
  const assetKey = `terminal/themes/${name}.json`;
  const path = join(themesDir(), `${name}.json`);
  if (!bundledFileExists(assetKey, path)) {
    diags?.warn("theme-not-found", `built-in theme '${name}' not found`);
    return null;
  }
  return readThemeFile(path, diags, assetKey);
}

/** Built-in theme by name, otherwise read a custom JSON file path. */
export function loadTheme(nameOrPath: string, diags?: Diagnostics): Theme {
  let theme: Theme | null = null;
  if (BUILTIN_THEMES.has(nameOrPath)) {
    theme = loadBuiltinTheme(nameOrPath, diags);
  } else if (
    existsSync(nameOrPath) ||
    isAbsolute(nameOrPath) ||
    nameOrPath.includes("/") ||
    nameOrPath.endsWith(".json")
  ) {
    theme = readThemeFile(nameOrPath, diags);
  } else {
    diags?.warn("theme-unknown", `unknown theme '${nameOrPath}', using dark`);
  }
  return theme ?? loadBuiltinTheme("dark", diags) ?? fallbackTheme();
}

/** Documents may select built-ins only; custom theme paths are a trusted CLI concern. */
export function loadDocumentTheme(name: string | undefined, diags?: Diagnostics): Theme {
  if (name == null || name === "") return loadTheme("auto", diags);
  if (!BUILTIN_THEMES.has(name)) {
    diags?.warn(
      "document-theme-rejected",
      `document theme '${name}' is not a built-in theme; using auto`,
    );
    return loadTheme("auto", diags);
  }
  return loadTheme(name, diags);
}

function fallbackTheme(): Theme {
  return {
    name: "dark",
    roles: Object.fromEntries(REQUIRED_ROLES.map((r) => [r, {}])),
    decorations: {
      success: {
        gutterUnicode: "▎",
        gutterAscii: "|",
        labelUnicode: "✓ success",
        labelAscii: "[OK]",
      },
      warning: {
        gutterUnicode: "▎",
        gutterAscii: "|",
        labelUnicode: "⚠ warning",
        labelAscii: "[WARN]",
      },
      error: {
        gutterUnicode: "▎",
        gutterAscii: "|",
        labelUnicode: "✗ error",
        labelAscii: "[FAIL]",
      },
      info: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "ℹ info", labelAscii: "[INFO]" },
    },
  };
}

export function roleStyleToStyle(role: RoleStyle): Style {
  return { ...role };
}

/** Merge document-defined custom roles from Meta into a loaded theme. */
export function applyMetaRoles(theme: Theme, meta: Meta, diags?: Diagnostics): Theme {
  if (!meta.roles || !Object.keys(meta.roles).length) return theme;
  const roles = { ...theme.roles };
  for (const [name, style] of Object.entries(meta.roles)) {
    roles[name] = mergeStyle(roles[name] ?? {}, roleStyleToStyle(style));
    if (!(name in theme.roles)) {
      diags?.warnOnce("custom-role-defined", `custom role '${name}' merged into theme`);
    }
  }
  return { ...theme, roles };
}

export function resolveRole(theme: Theme, role: string, diags?: Diagnostics): Style {
  const style = theme.roles[role];
  if (style) return style;
  if (role !== "text") {
    diags?.warnOnce("unknown-role", `unknown theme role '${role}'`);
  }
  return theme.roles.text ?? {};
}

export function decoration(theme: Theme, role: string): Decoration | undefined {
  return theme.decorations[role];
}

export function mergeStyle(a: Style, b: Style): Style {
  return { ...a, ...b };
}

export function isNamedColorValue(color: Color | undefined): color is NamedColor {
  return color != null && isNamedColor(color);
}

import { test, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Diagnostics } from "../../src/core/diagnostics.js";
import {
  SAFE_GLYPHS,
  REQUIRED_ROLES,
  applyMetaRoles,
  loadTheme,
  resolveRole,
  validateThemeShape,
} from "../../src/terminal/theme.js";

const BUILTINS = ["dark", "light", "mono", "auto"] as const;

test("all built-in themes load with required roles and decorations", () => {
  for (const name of BUILTINS) {
    const d = new Diagnostics();
    const theme = loadTheme(name, d);
    expect(theme.name).toBe(name);
    for (const role of REQUIRED_ROLES) {
      expect(theme.roles[role]).toBeDefined();
      expect(resolveRole(theme, role)).toEqual(theme.roles[role]);
    }
    for (const dec of ["success", "warning", "error", "info"] as const) {
      expect(theme.decorations[dec]).toBeDefined();
    }
    expect(d.hasWarnings()).toBe(false);
  }
});

test("mono theme has attributes but no colors", () => {
  const theme = loadTheme("mono");
  for (const style of Object.values(theme.roles)) {
    expect(style.fg).toBeUndefined();
    expect(style.bg).toBeUndefined();
  }
});

test("validateThemeShape accepts named and hex colors", () => {
  const d = new Diagnostics();
  const theme = validateThemeShape(
    {
      name: "custom",
      roles: {
        heading1: { fg: "#aabbcc", bold: true },
        heading2: {},
        heading3: {},
        heading4: {},
        success: { fg: "green" },
        warning: {},
        error: {},
        info: {},
        muted: {},
        highlight: { fg: "yellow" },
        border: {},
        link: {},
        code: {},
        codeBlock: {},
        quote: {},
        listMarker: {},
        kbd: {},
        cardTitle: {},
      },
      decorations: {
        success: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "✓", labelAscii: "[OK]" },
        warning: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "⚠", labelAscii: "[WARN]" },
        error: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "✗", labelAscii: "[FAIL]" },
        info: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "ℹ", labelAscii: "[INFO]" },
      },
    },
    d,
  );
  expect(theme?.roles.heading1.fg).toBe("#aabbcc");
  expect(d.has("theme-invalid-color")).toBe(false);
});

test("loadTheme reads custom JSON path", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-theme-"));
  const path = join(dir, "brand.json");
  writeFileSync(
    path,
    JSON.stringify({
      name: "brand",
      roles: Object.fromEntries(REQUIRED_ROLES.map((r) => [r, r === "link" ? { fg: "#112233", underline: true } : {}])),
      decorations: {
        success: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "✓ ok", labelAscii: "[OK]" },
        warning: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "⚠ warn", labelAscii: "[WARN]" },
        error: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "✗ err", labelAscii: "[FAIL]" },
        info: { gutterUnicode: "▎", gutterAscii: "|", labelUnicode: "ℹ info", labelAscii: "[INFO]" },
      },
    }),
  );
  const theme = loadTheme(path);
  expect(theme.name).toBe("brand");
  expect(theme.roles.link.fg).toBe("#112233");
});

test("resolveRole warns on unknown roles", () => {
  const d = new Diagnostics();
  const theme = loadTheme("dark", d);
  expect(resolveRole(theme, "mystery", d)).toEqual({});
  expect(d.has("unknown-role")).toBe(true);
  resolveRole(theme, "mystery", d);
  expect(d.count()).toBe(1);
});

test("applyMetaRoles merges custom roles", () => {
  const d = new Diagnostics();
  const base = loadTheme("dark", d);
  const merged = applyMetaRoles(base, { roles: { brand: { fg: "#ff00aa", bold: true }, link: { underline: false } } }, d);
  expect(merged.roles.brand).toEqual({ fg: "#ff00aa", bold: true });
  expect(merged.roles.link.underline).toBe(false);
  expect(d.has("custom-role-defined")).toBe(true);
});

test("SAFE_GLYPHS includes decoration glyphs used by built-ins", () => {
  const theme = loadTheme("dark");
  for (const dec of Object.values(theme.decorations)) {
    for (const field of [dec.gutterUnicode, dec.labelUnicode] as const) {
      for (const ch of field) {
        if (ch.charCodeAt(0) > 0x7f) expect(SAFE_GLYPHS.has(ch)).toBe(true);
      }
    }
  }
});

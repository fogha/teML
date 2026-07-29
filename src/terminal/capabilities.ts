// terminal/capabilities.ts — R-4. Detect terminal capabilities.

export type ColorMode = "none" | "ansi16" | "ansi256" | "truecolor";

export type Capabilities = {
  colors: ColorMode;
  unicode: boolean;
  hyperlinks: boolean;
  width: number;
  ambiguousWide: boolean;
  /** When true, visible URL text is emitted and OSC 8 is suppressed. */
  showUrls?: boolean;
};

export type CapOverrides = {
  width?: number;
  color?: boolean;
  ascii?: boolean;
  ambiguousWide?: boolean;
  showUrls?: boolean;
};

/** Minimum useful width for dimensions reported by a live terminal. Explicit
 * CLI `--width` values remain allowed below this threshold for testing and
 * constrained-output use cases. */
export const MIN_TERMINAL_WIDTH = 20;
/** Far above practical terminal dimensions, but bounded so a hostile resize
 * command cannot make layout allocate gigabyte-scale border/spacing strings. */
export const MAX_TERMINAL_DIMENSION = 10_000;

export function clampTerminalWidth(width: number): number {
  if (!Number.isFinite(width)) return MIN_TERMINAL_WIDTH;
  return Math.min(MAX_TERMINAL_DIMENSION, Math.max(MIN_TERMINAL_WIDTH, Math.trunc(width)));
}

export function clampTerminalHeight(height: number): number {
  if (!Number.isFinite(height)) return 1;
  return Math.min(MAX_TERMINAL_DIMENSION, Math.max(1, Math.trunc(height)));
}

export function colorsEnabled(caps: Capabilities): boolean {
  return caps.colors !== "none";
}

function detectColorMode(env: NodeJS.ProcessEnv, isTTY: boolean, override?: boolean): ColorMode {
  if (override === false) return "none";
  if (env.NO_COLOR != null && env.NO_COLOR !== "") return "none";
  if (!isTTY && override !== true) return "none";
  if ((env.COLORTERM ?? "").toLowerCase() === "truecolor") return "truecolor";
  const term = env.TERM ?? "";
  if (/256color|-256\b/i.test(term)) return "ansi256";
  return "ansi16";
}

function detectUnicode(env: NodeJS.ProcessEnv, ascii?: boolean): boolean {
  if (ascii) return false;
  const locale = (env.LC_ALL ?? env.LANG ?? "en_US.UTF-8").toUpperCase();
  if (locale.includes("UTF")) return true;
  return !/(^|\.)(C|POSIX)$/.test(env.LC_ALL ?? env.LANG ?? "");
}

function detectWidth(
  overrides: CapOverrides,
  env: NodeJS.ProcessEnv,
  isTTY: boolean,
  ttyColumns: number | undefined,
): number {
  const fromFlag = overrides.width;
  const fromTty = isTTY && ttyColumns ? ttyColumns : undefined;
  const fromEnv = env.COLUMNS ? parseInt(env.COLUMNS, 10) || undefined : undefined;
  // An explicit width may go below MIN_TERMINAL_WIDTH (documented above), but
  // the upper bound still applies: layout builds border and spacing strings the
  // full width, so `--width 99999999` produces no output for many seconds.
  if (fromFlag != null) {
    if (!Number.isFinite(fromFlag)) return clampTerminalWidth(fromFlag);
    return Math.min(MAX_TERMINAL_DIMENSION, Math.max(1, Math.trunc(fromFlag)));
  }
  const fallback = fromTty ?? fromEnv ?? 80;
  return clampTerminalWidth(fallback);
}

function detectHyperlinks(env: NodeJS.ProcessEnv, colors: ColorMode): boolean {
  if (colors === "none") return false;
  const prog = (env.TERM_PROGRAM ?? "").toLowerCase();
  if (prog.includes("iterm") || prog.includes("wezterm") || prog.includes("kitty")) return true;
  if (env.KITTY_WINDOW_ID != null) return true;
  const vte = env.VTE_VERSION ? parseInt(env.VTE_VERSION, 10) : 0;
  return vte >= 5000;
}

export function detectCapabilities(
  overrides: CapOverrides = {},
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdout.isTTY),
  ttyColumns: number | undefined = process.stdout.columns,
): Capabilities {
  const colors = detectColorMode(env, isTTY, overrides.color);
  const unicode = detectUnicode(env, overrides.ascii);
  const width = detectWidth(overrides, env, isTTY, ttyColumns);
  const hyperlinks = detectHyperlinks(env, colors);
  return {
    colors,
    unicode,
    hyperlinks,
    width,
    ambiguousWide: overrides.ambiguousWide ?? false,
    showUrls: overrides.showUrls,
  };
}

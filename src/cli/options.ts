// cli/options.ts — shared Commander flags and parsing helpers.

import type { Command } from "commander";
import type { FrameFormat, FrameMode } from "../interactive/protocol.js";

export type InputFormat = "teml" | "markdown" | "html";
export type OutputFormat = "teml" | "markdown" | "text" | "speech" | "json";

export type CliFlags = {
  from?: InputFormat;
  to?: OutputFormat;
  profile?: string;
  base?: string;
  width?: number;
  height?: number;
  theme?: string;
  color?: boolean;
  ascii?: boolean;
  ambiguousWide?: boolean;
  wrapCode?: boolean;
  showUrls?: boolean;
  allowFileLinks?: boolean;
  debug?: boolean;
  ast?: boolean;
  tokens?: boolean;
  renderTokens?: boolean;
  frames?: FrameFormat;
  frameMode?: FrameMode;
};

const INPUT_FORMATS = new Set<InputFormat>(["teml", "markdown", "html"]);
const OUTPUT_FORMATS = new Set<OutputFormat>(["teml", "markdown", "text", "speech", "json"]);
const FRAME_FORMATS = new Set<FrameFormat>(["ansi", "plain", "both"]);
const FRAME_MODES = new Set<FrameMode>(["full", "patches"]);

export function parseInputFormat(value: string): InputFormat {
  const v = value.toLowerCase() as InputFormat;
  if (!INPUT_FORMATS.has(v))
    throw new Error(`invalid --from format '${value}' (expected teml|markdown|html)`);
  return v;
}

export function parseOutputFormat(value: string): OutputFormat {
  const v = value.toLowerCase() as OutputFormat;
  if (!OUTPUT_FORMATS.has(v))
    throw new Error(`invalid --to format '${value}' (expected teml|markdown|text|speech|json)`);
  return v;
}

export function parseFrameFormat(value: string): FrameFormat {
  const v = value.toLowerCase() as FrameFormat;
  if (!FRAME_FORMATS.has(v))
    throw new Error(`invalid --frames format '${value}' (expected ansi|plain|both)`);
  return v;
}

export function parseFrameMode(value: string): FrameMode {
  const v = value.toLowerCase() as FrameMode;
  if (!FRAME_MODES.has(v)) throw new Error(`invalid --mode '${value}' (expected full|patches)`);
  return v;
}

export function parseWidth(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid --width '${value}'`);
  return n;
}

export function parseHeight(value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`invalid --height '${value}'`);
  return n;
}

export type SharedOptionConfig = {
  /** Input format/profile/base/link options. Default: true. */
  input?: boolean;
  /** The convert-only --to option. Default: false. */
  output?: boolean;
};

/** Attach the relevant input/output and layout flags to one command. */
export function addSharedOptions(cmd: Command, config: SharedOptionConfig = {}): Command {
  const includeInput = config.input ?? true;
  cmd.exitOverride();
  cmd.configureOutput({
    outputError: (message, write) => write(`teml: ${message}`),
  });
  if (includeInput) {
    cmd
      .option("--from <format>", "input format: teml, markdown, html", parseInputFormat)
      .option("--profile <name|path>", "HTML profile (bootstrap or path to JSON)")
      .option("--base <url|path>", "base URL or directory for relative links")
      .option("--allow-file-links", "allow file: scheme links");
  }
  if (config.output) {
    cmd.option(
      "--to <format>",
      "output format: teml, markdown, text, speech, json",
      parseOutputFormat,
    );
  }
  cmd
    .option("--width <n>", "layout width in columns", parseWidth)
    .option("--theme <name|path>", "theme: dark, light, mono, auto, or path to JSON")
    .option("--no-color", "disable ANSI colors")
    .option("--color", "force colors even when piped")
    .option("--ascii", "ASCII borders and decoration glyphs only")
    .option("--ambiguous-wide", "treat ambiguous-width Unicode as wide (2 cells)")
    .option("--wrap-code", "wrap code block lines instead of truncating")
    .option("--show-urls", "always show link URLs in visible text")
    .option("--debug", "print stage timings to stderr");
  // Commander initializes a negated option such as --no-color to `true`.
  // Preserve `undefined` as the auto-detect state; explicit --color/--no-color
  // will replace this value with a CLI-sourced true/false during parsing.
  cmd.setOptionValueWithSource("color", undefined, "default");
  return cmd;
}

export function addInspectOptions(cmd: Command): Command {
  return cmd
    .option("--ast", "dump normalized AST as JSON (default)")
    .option("--tokens", "dump AST token stream")
    .option("--render-tokens", "dump layout render token stream");
}

export function flagsFromOptions(opts: Record<string, unknown>): CliFlags {
  const color = opts.color as boolean | undefined;
  return {
    from: opts.from as InputFormat | undefined,
    to: opts.to as OutputFormat | undefined,
    profile: opts.profile as string | undefined,
    base: opts.base as string | undefined,
    width: opts.width as number | undefined,
    height: opts.height as number | undefined,
    theme: opts.theme as string | undefined,
    color: color === undefined ? undefined : color,
    ascii: Boolean(opts.ascii),
    ambiguousWide: Boolean(opts.ambiguousWide),
    wrapCode: Boolean(opts.wrapCode),
    showUrls: Boolean(opts.showUrls),
    allowFileLinks: Boolean(opts.allowFileLinks),
    debug: Boolean(opts.debug),
    ast: Boolean(opts.ast),
    tokens: Boolean(opts.tokens),
    renderTokens: Boolean(opts.renderTokens),
    frames: opts.frames as FrameFormat | undefined,
    frameMode: opts.mode as FrameMode | undefined,
  };
}

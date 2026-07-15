// render/ansi.ts — the ONLY file in the codebase allowed to produce \x1b.
// (S-2 single-emitter invariant; the security test greps for violations.)

import type { Capabilities, ColorMode } from "../terminal/capabilities.js";
import { colorsEnabled } from "../terminal/capabilities.js";
import type { Color, NamedColor, Style } from "../terminal/theme.js";
import { isNamedColorValue } from "../terminal/theme.js";
import type { Line } from "../render/styledLine.js";
import type { ScreenOp } from "./screen.js";

const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

const FG: Record<NamedColor, number> = {
  black: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  magenta: 35,
  cyan: 36,
  white: 37,
  brightBlack: 90,
  brightRed: 91,
  brightGreen: 92,
  brightYellow: 93,
  brightBlue: 94,
  brightMagenta: 95,
  brightCyan: 96,
  brightWhite: 97,
};

const ANSI16_RGB: [number, number, number][] = [
  [0, 0, 0],
  [128, 0, 0],
  [0, 128, 0],
  [128, 128, 0],
  [0, 0, 128],
  [128, 0, 128],
  [0, 128, 128],
  [192, 192, 192],
  [128, 128, 128],
  [255, 0, 0],
  [0, 255, 0],
  [255, 255, 0],
  [0, 0, 255],
  [255, 0, 255],
  [0, 255, 255],
  [255, 255, 255],
];

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function colorDist(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function rgbToAnsi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16;
    if (r > 248) return 231;
    return Math.round(((r - 8) / 247) * 24) + 232;
  }
  return (
    16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
  );
}

function rgbToAnsi16(r: number, g: number, b: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < ANSI16_RGB.length; i++) {
    const d = colorDist([r, g, b], ANSI16_RGB[i]!);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function colorCode(color: Color, mode: ColorMode, fg: boolean): number[] {
  if (mode === "none") return [];
  if (isNamedColorValue(color)) {
    const base = FG[color];
    return [fg ? base : base + 10];
  }
  if (typeof color === "string" && HEX_COLOR.test(color)) {
    const [r, g, b] = parseHex(color);
    if (mode === "truecolor") return fg ? [38, 2, r, g, b] : [48, 2, r, g, b];
    if (mode === "ansi256") {
      const n = rgbToAnsi256(r, g, b);
      return fg ? [38, 5, n] : [48, 5, n];
    }
    const n = rgbToAnsi16(r, g, b);
    return fg ? [30 + (n % 8), ...(n >= 8 ? [1] : [])] : [40 + (n % 8), ...(n >= 8 ? [1] : [])];
  }
  return [];
}

function styleKey(style: Style, mode: ColorMode): string {
  return [
    style.bold ? 1 : 0,
    style.italic ? 1 : 0,
    style.underline ? 1 : 0,
    style.strike ? 1 : 0,
    style.fg ?? "",
    style.bg ?? "",
    mode,
  ].join("|");
}

function sgrTransition(previous: Style, next: Style, mode: ColorMode): string {
  if (mode === "none") return "";
  const codes: number[] = [];
  if (previous.bold !== next.bold) codes.push(next.bold ? 1 : 22);
  if (previous.italic !== next.italic) codes.push(next.italic ? 3 : 23);
  if (previous.underline !== next.underline) codes.push(next.underline ? 4 : 24);
  if (previous.strike !== next.strike) codes.push(next.strike ? 9 : 29);
  if (previous.fg !== next.fg) {
    codes.push(...(next.fg ? colorCode(next.fg, mode, true) : [39]));
  }
  if (previous.bg !== next.bg) {
    codes.push(...(next.bg ? colorCode(next.bg, mode, false) : [49]));
  }
  return codes.length ? `${ESC}[${codes.join(";")}m` : "";
}

function osc8(url: string, text: string): string {
  return `${ESC}]8;;${url}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
}

export function renderAnsiLine(line: Line, caps: Capabilities): string {
  const mode = caps.colors;
  let s = "";
  let prevKey = "";
  let previousStyle: Style = {};
  let styled = false;
  for (const span of line) {
    if (span.text === "") continue;
    const key = styleKey(span.style, mode);
    if (key !== prevKey) {
      const open = sgrTransition(previousStyle, span.style, mode);
      if (open) styled = true;
      s += open;
      prevKey = key;
      previousStyle = span.style;
    }
    let body = span.text;
    if (span.style.href && caps.hyperlinks && !caps.showUrls && !hasControlChars(span.style.href)) {
      body = osc8(span.style.href, body);
    }
    s += body;
  }
  if (s.length && styled) s += RESET;
  return s;
}

export function renderAnsi(lines: Line[], caps: Capabilities): string {
  return lines.map((line) => renderAnsiLine(line, caps)).join("\n") + "\n";
}

/** Exported for unit tests. */
export function downgradeColor(color: Color, mode: ColorMode, fg: boolean): number[] {
  return colorCode(color, mode, fg);
}

export function stylesNeedSgr(a: Style, b: Style, mode: ColorMode): boolean {
  return styleKey(a, mode) !== styleKey(b, mode);
}

export function ansiColorEnabled(caps: Capabilities): boolean {
  return colorsEnabled(caps);
}

/**
 * Terminal *control* sequences (screen clear, SGR mouse tracking) used by
 * in-process interactive hosts (interactive/host.ts) to manage the terminal
 * itself — not document content, so none of the sanitize/theme machinery
 * above applies to them. They still have to live here, and only here, to
 * keep the S-2 single-emitter invariant this file's header describes true
 * for the whole of `src/`.
 */
export const TERMINAL_CONTROL = {
  clearScreen: `${ESC}[2J${ESC}[H`,
  mouseOn: `${ESC}[?1000h${ESC}[?1006h`,
  mouseOff: `${ESC}[?1000l${ESC}[?1006l`,
  wheelOn: `${ESC}[?1000h${ESC}[?1006h`,
  wheelOff: `${ESC}[?1000l${ESC}[?1006l`,
  altScreenEnter: `${ESC}[?1049h`,
  altScreenLeave: `${ESC}[?1049l`,
  hideCursor: `${ESC}[?25l`,
  showCursor: `${ESC}[?25h`,
  eraseLine: `${ESC}[2K`,
  /** The raw ESC byte itself, for hosts that need to *recognize* incoming
   *  escape sequences (arrow keys, mouse reports) in raw keyboard input —
   *  reading, not emitting, but kept here too so no other file needs its
   *  own copy of the literal. */
  escByte: ESC,
} as const;

export function cursorTo(row: number, col: number): string {
  return `${ESC}[${Math.max(0, Math.trunc(row)) + 1};${Math.max(0, Math.trunc(col)) + 1}H`;
}

/** Encode pure screen operations. This remains the sole screen-control emitter. */
export function encodeScreenOps(ops: readonly ScreenOp[], caps: Capabilities): string {
  let out = "";
  for (const op of ops) {
    if (op.type === "clear") {
      out += TERMINAL_CONTROL.clearScreen;
      continue;
    }
    out += cursorTo(op.row, 0);
    out += TERMINAL_CONTROL.eraseLine;
    out += renderAnsiLine(op.line, caps);
  }
  return out;
}

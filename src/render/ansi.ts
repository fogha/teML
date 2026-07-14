// render/ansi.ts — the ONLY file in the codebase allowed to produce \x1b.
// (S-2 single-emitter invariant; the security test greps for violations.)

import type { Capabilities, ColorMode } from "../terminal/capabilities.js";
import { colorsEnabled } from "../terminal/capabilities.js";
import type { Color, NamedColor, Style } from "../terminal/theme.js";
import { isNamedColorValue } from "../terminal/theme.js";
import type { Line } from "../render/styledLine.js";

const ESC = "\x1b";
const RESET = `${ESC}[0m`;

const FG: Record<NamedColor, number> = {
  black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37,
  brightBlack: 90, brightRed: 91, brightGreen: 92, brightYellow: 93,
  brightBlue: 94, brightMagenta: 95, brightCyan: 96, brightWhite: 97,
};

const ANSI16_RGB: [number, number, number][] = [
  [0, 0, 0], [128, 0, 0], [0, 128, 0], [128, 128, 0],
  [0, 0, 128], [128, 0, 128], [0, 128, 128], [192, 192, 192],
  [128, 128, 128], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [0, 0, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
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
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5);
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
  if (typeof color === "string" && color.startsWith("#")) {
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

function sgrCodes(style: Style, mode: ColorMode): number[] {
  if (mode === "none") return [];
  const codes: number[] = [];
  if (style.bold) codes.push(1);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.strike) codes.push(9);
  if (style.fg) codes.push(...colorCode(style.fg, mode, true));
  if (style.bg) codes.push(...colorCode(style.bg, mode, false));
  return codes;
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

export function renderAnsi(lines: Line[], caps: Capabilities): string {
  const mode = caps.colors;
  const out: string[] = [];
  for (const line of lines) {
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
    out.push(s);
  }
  return out.join("\n") + "\n";
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

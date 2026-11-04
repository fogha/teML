import type { Line, Span } from "../render/styledLine.js";
import type { Capabilities } from "../terminal/capabilities.js";
import type { CanvasSurface } from "./canvas.js";

function pushSpan(spans: Span[], text: string, style: Span["style"]): void {
  const previous = spans.at(-1);
  if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text;
  else spans.push({ text, style });
}

function renderHalfBlock(surface: CanvasSurface, width: number, caps: Capabilities): Line[] {
  const lines: Line[] = [];
  const columns = Math.min(surface.width, Math.max(1, width));
  const ascii = !caps.unicode || surface.renderer === "ascii";
  for (let y = 0; y < surface.height; y += 2) {
    const spans: Span[] = [];
    for (let x = 0; x < columns; x += 1) {
      const top = surface.pixels[y * surface.width + x];
      const bottom = surface.pixels[(y + 1) * surface.width + x];
      if (ascii) {
        pushSpan(spans, top || bottom ? "#" : " ", top ? { fg: top } : {});
      } else if (top && bottom) {
        pushSpan(spans, "▀", { fg: top, bg: bottom });
      } else if (top) {
        pushSpan(spans, "▀", { fg: top });
      } else if (bottom) {
        pushSpan(spans, "▄", { fg: bottom });
      } else {
        pushSpan(spans, " ", {});
      }
    }
    lines.push(spans);
  }
  return lines;
}

const BRAILLE_BITS = [
  [0, 3],
  [1, 4],
  [2, 5],
  [6, 7],
] as const;

function renderBraille(surface: CanvasSurface, width: number, caps: Capabilities): Line[] {
  if (!caps.unicode || surface.renderer === "ascii") return renderHalfBlock(surface, width, caps);
  const lines: Line[] = [];
  const columns = Math.min(Math.ceil(surface.width / 2), Math.max(1, width));
  for (let y = 0; y < surface.height; y += 4) {
    const spans: Span[] = [];
    for (let x = 0; x < columns; x += 1) {
      let bits = 0;
      let color;
      for (let dy = 0; dy < 4; dy += 1) {
        for (let dx = 0; dx < 2; dx += 1) {
          const pixel = surface.pixels[(y + dy) * surface.width + x * 2 + dx];
          if (pixel) {
            bits |= 1 << BRAILLE_BITS[dy]![dx]!;
            color ??= pixel;
          }
        }
      }
      pushSpan(spans, bits ? String.fromCodePoint(0x2800 + bits) : " ", color ? { fg: color } : {});
    }
    lines.push(spans);
  }
  return lines;
}

export function renderCanvas(surface: CanvasSurface, width: number, caps: Capabilities): Line[] {
  return surface.renderer === "braille"
    ? renderBraille(surface, width, caps)
    : renderHalfBlock(surface, width, caps);
}

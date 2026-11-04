import type { Block, TDoc } from "../core/ast.js";
import type { Line, Span } from "../render/styledLine.js";
import type { Color } from "../terminal/theme.js";
import type { Capabilities } from "../terminal/capabilities.js";

export type CanvasOperation =
  | { op: "clear" }
  | { op: "fillStyle"; color: Color }
  | { op: "fillRect"; x: number; y: number; width: number; height: number };

export type CanvasSurface = {
  width: number;
  height: number;
  pixels: Array<Color | undefined>;
  fillStyle: Color;
};

function dimension(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) ? Math.max(1, Math.min(256, value)) : fallback;
}

export function createCanvasSurface(attrs: Record<string, string>): CanvasSurface {
  const width = dimension(attrs.width, 80);
  const height = dimension(attrs.height, 24);
  return {
    width,
    height,
    pixels: Array.from({ length: width * height }, () => undefined),
    fillStyle: "#ffffff",
  };
}

export function applyCanvasOperations(
  surface: CanvasSurface,
  ops: readonly CanvasOperation[],
): void {
  for (const operation of ops) {
    if (operation.op === "clear") {
      surface.pixels.fill(undefined);
    } else if (operation.op === "fillStyle") {
      surface.fillStyle = operation.color;
    } else {
      const startX = Math.max(0, Math.trunc(operation.x));
      const startY = Math.max(0, Math.trunc(operation.y));
      const endX = Math.min(surface.width, startX + Math.max(0, Math.trunc(operation.width)));
      const endY = Math.min(surface.height, startY + Math.max(0, Math.trunc(operation.height)));
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          surface.pixels[y * surface.width + x] = surface.fillStyle;
        }
      }
    }
  }
}

export function collectCanvasSurfaces(doc: TDoc): Map<string, CanvasSurface> {
  const surfaces = new Map<string, CanvasSurface>();
  const visit = (block: Block): void => {
    if (block.type === "leaf") {
      if (block.name === "canvas") {
        const id = block.attrs.id?.trim();
        if (id && !surfaces.has(id)) surfaces.set(id, createCanvasSurface(block.attrs));
      }
      return;
    }
    if (
      block.type === "container" ||
      block.type === "quote" ||
      block.type === "footnoteDefinition"
    ) {
      for (const child of block.children) visit(child);
    } else if (block.type === "list") {
      for (const item of block.items) for (const child of item.blocks) visit(child);
    } else if (block.type === "definitionList") {
      for (const item of block.items) {
        for (const definition of item.definitions) for (const child of definition) visit(child);
      }
    }
  };
  for (const block of doc.blocks) visit(block);
  return surfaces;
}

function pushSpan(spans: Span[], text: string, style: Span["style"]): void {
  const previous = spans.at(-1);
  if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text;
  else spans.push({ text, style });
}

export function renderCanvas(surface: CanvasSurface, width: number, caps: Capabilities): Line[] {
  const lines: Line[] = [];
  const columns = Math.min(surface.width, Math.max(1, width));
  for (let y = 0; y < surface.height; y += 2) {
    const spans: Span[] = [];
    for (let x = 0; x < columns; x += 1) {
      const top = surface.pixels[y * surface.width + x];
      const bottom = surface.pixels[(y + 1) * surface.width + x];
      if (!caps.unicode) {
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

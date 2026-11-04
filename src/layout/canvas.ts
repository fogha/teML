import type { Block, CanvasOperation, TDoc } from "../core/ast.js";
import type { Color } from "../terminal/theme.js";

export type { CanvasOperation } from "../core/ast.js";

export type CanvasSurface = {
  width: number;
  height: number;
  pixels: Array<Color | undefined>;
  fillStyle: Color;
  renderer: "halfBlock" | "braille" | "ascii";
};

function dimension(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) ? Math.max(1, Math.min(256, value)) : fallback;
}

export function createCanvasSurface(attrs: Record<string, string>): CanvasSurface {
  const width = dimension(attrs.width, 80);
  const height = dimension(attrs.height, 24);
  const renderer =
    attrs.renderer === "braille" || attrs.renderer === "ascii" ? attrs.renderer : "halfBlock";
  return {
    width,
    height,
    pixels: Array.from({ length: width * height }, () => undefined),
    fillStyle: "#ffffff",
    renderer,
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
      const rawX = Math.trunc(operation.x);
      const rawY = Math.trunc(operation.y);
      const startX = Math.max(0, rawX);
      const startY = Math.max(0, rawY);
      const endX = Math.min(surface.width, rawX + Math.max(0, Math.trunc(operation.width)));
      const endY = Math.min(surface.height, rawY + Math.max(0, Math.trunc(operation.height)));
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

export function reconcileCanvasSurfaces(
  doc: TDoc,
  previous: ReadonlyMap<string, CanvasSurface> | undefined,
): Map<string, CanvasSurface> {
  const next = collectCanvasSurfaces(doc);
  if (!previous) return next;
  for (const [id, surface] of next) {
    const existing = previous.get(id);
    if (existing?.width === surface.width && existing.height === surface.height) {
      next.set(id, existing);
    }
  }
  return next;
}

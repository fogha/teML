import type { Block, CanvasOperation, TDoc } from "../core/ast.js";
import type { Diagnostics } from "../core/diagnostics.js";
import type { Color } from "../terminal/theme.js";

export const MAX_TOTAL_CANVAS_PIXELS = 1_048_576;
export const MAX_CANVAS_COMMAND_WORK = 1_048_576;

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

function clippedRectangle(
  surface: CanvasSurface,
  operation: Extract<CanvasOperation, { op: "fillRect" }>,
) {
  const rawX = Math.trunc(operation.x);
  const rawY = Math.trunc(operation.y);
  return {
    startX: Math.max(0, rawX),
    startY: Math.max(0, rawY),
    endX: Math.min(surface.width, rawX + Math.max(0, Math.trunc(operation.width))),
    endY: Math.min(surface.height, rawY + Math.max(0, Math.trunc(operation.height))),
  };
}

export function applyCanvasOperations(
  surface: CanvasSurface,
  ops: readonly CanvasOperation[],
): { ok: true } | { ok: false; error: string } {
  let work = 0;
  for (const operation of ops) {
    if (operation.op === "clear") {
      work += surface.pixels.length;
    } else if (operation.op === "fillRect") {
      const { startX, startY, endX, endY } = clippedRectangle(surface, operation);
      if (startX < endX && startY < endY) {
        work += (endY - startY) * (endX - startX + 1);
      }
    }
    if (work > MAX_CANVAS_COMMAND_WORK) {
      return {
        ok: false,
        error: `canvas command exceeds the ${MAX_CANVAS_COMMAND_WORK}-work-unit budget`,
      };
    }
  }

  for (const operation of ops) {
    if (operation.op === "clear") {
      surface.pixels.fill(undefined);
    } else if (operation.op === "fillStyle") {
      surface.fillStyle = operation.color;
    } else {
      const { startX, startY, endX, endY } = clippedRectangle(surface, operation);
      if (startX >= endX) continue;
      for (let y = startY; y < endY; y += 1) {
        const rowStart = y * surface.width;
        surface.pixels.fill(surface.fillStyle, rowStart + startX, rowStart + endX);
      }
    }
  }
  return { ok: true };
}

export function collectCanvasSurfaces(doc: TDoc, diags?: Diagnostics): Map<string, CanvasSurface> {
  return reconcileCanvasSurfaces(doc, undefined, diags);
}

export function reconcileCanvasSurfaces(
  doc: TDoc,
  previous: ReadonlyMap<string, CanvasSurface> | undefined,
  diags?: Diagnostics,
): Map<string, CanvasSurface> {
  const surfaces = new Map<string, CanvasSurface>();
  const seen = new Set<string>();
  let totalPixels = 0;
  const visit = (block: Block): void => {
    if (block.type === "leaf") {
      if (block.name === "canvas") {
        const id = block.attrs.id?.trim();
        if (id && !seen.has(id)) {
          seen.add(id);
          const width = dimension(block.attrs.width, 80);
          const height = dimension(block.attrs.height, 24);
          const pixels = width * height;
          if (totalPixels + pixels > MAX_TOTAL_CANVAS_PIXELS) {
            diags?.warnOnce(
              "canvas-pixels-over-budget",
              `canvas pixel budget of ${MAX_TOTAL_CANVAS_PIXELS} exceeded; excluded canvases render as placeholders`,
            );
          } else {
            const existing = previous?.get(id);
            const surface =
              existing?.width === width && existing.height === height
                ? existing
                : createCanvasSurface(block.attrs);
            surface.renderer =
              block.attrs.renderer === "braille" || block.attrs.renderer === "ascii"
                ? block.attrs.renderer
                : "halfBlock";
            surfaces.set(id, surface);
            totalPixels += pixels;
          }
        }
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

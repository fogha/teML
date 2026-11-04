import { expect, test } from "vitest";
import { applyCanvasOperations, createCanvasSurface } from "../../src/layout/canvas.js";
import { renderCanvas } from "../../src/layout/canvas-render.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps = (over: Partial<Capabilities> = {}): Capabilities => ({
  colors: "truecolor",
  unicode: true,
  hyperlinks: false,
  width: 40,
  ambiguousWide: false,
  ...over,
});

test("fillRect clips both edges against the original coordinates", () => {
  const surface = createCanvasSurface({ width: "8", height: "4" });
  applyCanvasOperations(surface, [
    { op: "fillStyle", color: "#50fa7b" },
    { op: "fillRect", x: -5, y: 0, width: 2, height: 1 },
    { op: "fillRect", x: -1, y: 0, width: 2, height: 1 },
    { op: "fillRect", x: 7, y: 0, width: 3, height: 1 },
  ]);
  expect(surface.pixels.slice(0, 8).filter(Boolean)).toHaveLength(2);
  expect(surface.pixels[0]).toBe("#50fa7b");
  expect(surface.pixels[7]).toBe("#50fa7b");
});

test("canvas renders half-block color cells and ASCII fallback", () => {
  const surface = createCanvasSurface({ width: "2", height: "2" });
  applyCanvasOperations(surface, [
    { op: "fillStyle", color: "#50fa7b" },
    { op: "fillRect", x: 0, y: 0, width: 1, height: 1 },
    { op: "fillStyle", color: "#ff5555" },
    { op: "fillRect", x: 0, y: 1, width: 1, height: 1 },
    { op: "fillRect", x: 1, y: 0, width: 1, height: 1 },
  ]);

  expect(renderCanvas(surface, 2, caps())).toEqual([
    [
      { text: "▀", style: { fg: "#50fa7b", bg: "#ff5555" } },
      { text: "▀", style: { fg: "#ff5555" } },
    ],
  ]);
  expect(renderCanvas(surface, 2, caps({ unicode: false }))).toEqual([
    [
      { text: "#", style: { fg: "#50fa7b" } },
      { text: "#", style: { fg: "#ff5555" } },
    ],
  ]);
});

test("braille renderer packs a 2 by 4 pixel cell", () => {
  const surface = createCanvasSurface({ width: "2", height: "4", renderer: "braille" });
  applyCanvasOperations(surface, [
    { op: "fillStyle", color: "#50fa7b" },
    { op: "fillRect", x: 0, y: 0, width: 2, height: 4 },
  ]);
  expect(renderCanvas(surface, 1, caps())).toEqual([[{ text: "⣿", style: { fg: "#50fa7b" } }]]);
});

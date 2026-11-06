import { expect, test } from "vitest";
import { Diagnostics } from "../../src/core/index.js";
import {
  applyCanvasOperations,
  collectCanvasSurfaces,
  createCanvasSurface,
} from "../../src/layout/canvas.js";
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

test("canvas dimensions are clamped and malformed dimensions use bounded defaults", () => {
  const clamped = createCanvasSurface({ width: "1000", height: "1000" });
  expect(clamped).toMatchObject({ width: 256, height: 256 });
  expect(clamped.pixels).toHaveLength(65_536);
  expect(createCanvasSurface({ width: "invalid", height: "2.5" })).toMatchObject({
    width: 80,
    height: 24,
  });
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

test("canvas collection caps aggregate pixels and diagnoses excluded surfaces", () => {
  const blocks = Array.from({ length: 17 }, (_, index) => ({
    type: "leaf" as const,
    name: "canvas",
    attrs: { id: `canvas-${index}`, width: "256", height: "256" },
  }));
  const diags = new Diagnostics();
  const surfaces = collectCanvasSurfaces({ meta: {}, blocks }, diags);
  expect(surfaces.size).toBe(16);
  expect(surfaces.has("canvas-15")).toBe(true);
  expect(surfaces.has("canvas-16")).toBe(false);
  expect(diags.has("canvas-pixels-over-budget")).toBe(true);
});

test("canvas work-budget rejection leaves the entire batch unapplied", () => {
  const surface = createCanvasSurface({ width: "256", height: "256" });
  applyCanvasOperations(surface, [
    { op: "fillStyle", color: "#50fa7b" },
    { op: "fillRect", x: 0, y: 0, width: 256, height: 256 },
  ]);
  const operations = [
    { op: "fillStyle" as const, color: "#ff5555" },
    ...Array.from({ length: 16 }, () => ({
      op: "fillRect" as const,
      x: 0,
      y: 0,
      width: 256,
      height: 256,
    })),
  ];
  expect(applyCanvasOperations(surface, operations)).toEqual({
    ok: false,
    error: "canvas command exceeds the 1048576-work-unit budget",
  });
  expect(surface.fillStyle).toBe("#50fa7b");
  expect(surface.pixels.every((pixel) => pixel === "#50fa7b")).toBe(true);
});

test("canvas reconciliation reuses pixels and updates renderer without allocating a replacement", async () => {
  const { reconcileCanvasSurfaces } = await import("../../src/layout/canvas.js");
  const doc = {
    meta: {},
    blocks: [
      {
        type: "leaf" as const,
        name: "canvas",
        attrs: { id: "board", width: "8", height: "4", renderer: "halfBlock" },
      },
    ],
  };
  const before = collectCanvasSurfaces(doc);
  const pixels = before.get("board")!.pixels;
  pixels[0] = "#123456";
  doc.blocks[0]!.attrs.renderer = "braille";
  const after = reconcileCanvasSurfaces(doc, before);
  expect(after.get("board")!.pixels).toBe(pixels);
  expect(after.get("board")!.renderer).toBe("braille");
  doc.blocks[0]!.attrs.width = "4";
  expect(reconcileCanvasSurfaces(doc, after).get("board")!.pixels).not.toBe(pixels);
  expect(reconcileCanvasSurfaces({ meta: {}, blocks: [] }, after).size).toBe(0);
});

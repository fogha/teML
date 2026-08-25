import { expect, test } from "vitest";
import {
  applyFrame,
  createFrameState,
  frameText,
} from "../../examples/interactive/interactive-frame.mjs";

test("JavaScript reference host reconstructs row growth and truncation", () => {
  const screen = createFrameState("plain");
  applyFrame(screen, {
    type: "frame",
    seq: 1,
    focusedId: null,
    plain: "one\ntwo\n",
    ansi: null,
  });
  applyFrame(screen, {
    type: "frame",
    seq: 2,
    focusedId: null,
    rows: 3,
    patches: [
      { row: 1, plain: "TWO", ansi: null },
      { row: 2, plain: "three", ansi: null },
    ],
  });
  expect(frameText(screen)).toBe("one\nTWO\nthree");

  applyFrame(screen, {
    type: "frame",
    seq: 3,
    focusedId: null,
    rows: 1,
    patches: [],
  });
  expect(frameText(screen)).toBe("one");
});

test("JavaScript reference host rejects patch gaps and accepts a full resync", () => {
  const screen = createFrameState("ansi");
  applyFrame(screen, {
    type: "frame",
    seq: 1,
    focusedId: null,
    plain: "plain\n",
    ansi: "ansi\n",
  });

  expect(() =>
    applyFrame(screen, {
      type: "frame",
      seq: 3,
      focusedId: null,
      rows: 1,
      patches: [],
    }),
  ).toThrow(/sequence gap/);

  applyFrame(screen, {
    type: "frame",
    seq: 3,
    focusedId: null,
    plain: null,
    ansi: "resynced\n",
  });
  expect(frameText(screen)).toBe("resynced");
});

test("JavaScript reference host preserves validated viewport metadata across patches", () => {
  const screen = createFrameState("plain");
  applyFrame(screen, {
    type: "frame",
    seq: 1,
    focusedId: "bottom",
    plain: "row 8\nrow 9\n",
    ansi: null,
    viewport: { offset: 8, height: 2, total: 10 },
  });
  expect(screen.viewport).toEqual({ offset: 8, height: 2, total: 10 });

  applyFrame(screen, {
    type: "frame",
    seq: 2,
    focusedId: "bottom",
    rows: 2,
    patches: [{ row: 1, plain: "ROW 9", ansi: null }],
    viewport: { offset: 8, height: 2, total: 10 },
  });
  expect(frameText(screen)).toBe("row 8\nROW 9");
  expect(screen.viewport).toEqual({ offset: 8, height: 2, total: 10 });
});

test("JavaScript reference host preserves discovery and validates scroll regions", () => {
  const screen = createFrameState("plain");
  applyFrame(screen, {
    type: "frame",
    seq: 1,
    focusedId: "logs",
    plain: "one\ntwo\n",
    ansi: null,
    protocol: { major: 1, minor: 1 },
    capabilities: ["scroll", "future"],
    scrollRegions: [{ id: "logs", offset: 2, height: 2, total: 8 }],
  });
  expect(screen.protocol).toEqual({ major: 1, minor: 1 });
  expect(screen.capabilities).toEqual(["scroll", "future"]);
  expect(screen.focusedId).toBe("logs");
  expect(screen.scrollRegions).toEqual([{ id: "logs", offset: 2, height: 2, total: 8 }]);

  expect(() =>
    applyFrame(screen, {
      type: "frame",
      seq: 2,
      focusedId: "logs",
      rows: 2,
      patches: [],
      scrollRegions: [{ id: "logs", offset: 7, height: 2, total: 8 }],
    }),
  ).toThrow(/scroll region/);
});

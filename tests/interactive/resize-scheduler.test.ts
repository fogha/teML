import { afterEach, expect, test, vi } from "vitest";
import {
  LatestResizeScheduler,
  type ResizeDimensions,
} from "../../src/interactive/resize-scheduler.js";

afterEach(() => {
  vi.useRealTimers();
});

test("continuous resizing is rate-limited and finishes at the latest dimensions", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const sent: Array<ResizeDimensions & { at: number }> = [];
  const scheduler = new LatestResizeScheduler((dimensions) => {
    sent.push({ ...dimensions, at: Date.now() });
    scheduler.complete();
  });

  for (let width = 80; width <= 180; width += 1) {
    scheduler.request({ width, height: 30 });
    vi.advanceTimersByTime(5);
  }
  vi.runAllTimers();

  expect(sent.at(-1)).toEqual({ width: 180, height: 30, at: 510 });
  expect(sent.length).toBeLessThanOrEqual(16);
  for (let index = 1; index < sent.length; index++) {
    expect(sent[index]!.at - sent[index - 1]!.at).toBeGreaterThanOrEqual(34);
  }
});

test("slow rendering leaves one resize in flight and retains only the latest pending size", () => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const sent: ResizeDimensions[] = [];
  const scheduler = new LatestResizeScheduler((dimensions) => sent.push(dimensions));

  scheduler.request({ width: 80, height: 24 });
  scheduler.request({ width: 90, height: 25 });
  scheduler.request({ width: 100, height: 26 });
  scheduler.request({ width: 110, height: 27 });
  vi.advanceTimersByTime(1_000);
  expect(sent).toEqual([{ width: 80, height: 24 }]);

  scheduler.complete();
  expect(sent).toEqual([
    { width: 80, height: 24 },
    { width: 110, height: 27 },
  ]);
  vi.runAllTimers();
  expect(sent).toHaveLength(2);
});

test("returning to the in-flight size cancels a newer pending resize", () => {
  vi.useFakeTimers();
  const sent: ResizeDimensions[] = [];
  const scheduler = new LatestResizeScheduler((dimensions) => sent.push(dimensions));

  scheduler.request({ width: 80, height: 24 });
  scheduler.request({ width: 100, height: 30 });
  scheduler.request({ width: 80, height: 24 });
  scheduler.complete();
  vi.runAllTimers();
  expect(sent).toEqual([{ width: 80, height: 24 }]);

  scheduler.request({ width: 80, height: 24 });
  vi.runAllTimers();
  expect(sent).toHaveLength(1);
});

test("stop cancels a trailing resize", () => {
  vi.useFakeTimers();
  const sent: ResizeDimensions[] = [];
  const scheduler = new LatestResizeScheduler((dimensions) => sent.push(dimensions));

  scheduler.request({ width: 80, height: 24 });
  scheduler.request({ width: 100, height: 30 });
  scheduler.stop();
  scheduler.complete();
  vi.runAllTimers();
  expect(sent).toEqual([{ width: 80, height: 24 }]);
});

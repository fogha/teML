import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { linesToScreen } from "../../../src/render/screen.js";
import { createTerminalDriver } from "../../../src/terminal/client/driver.js";
import type { TerminalInputEvent } from "../../../src/terminal/client/input.js";
import type { Capabilities } from "../../../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "none",
  unicode: true,
  hyperlinks: false,
  width: 20,
  ambiguousWide: false,
};

describe("terminal driver", () => {
  test("callback failure stops before dispatching the rest of an input batch", () => {
    vi.useFakeTimers();
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough();
    input.setRawMode = vi.fn();
    const onEvent = vi.fn(() => {
      throw new Error("event failed");
    });
    const onError = vi.fn();
    const driver = createTerminalDriver({ input, output, caps, signals: false, onEvent, onError });
    try {
      expect(() => input.emit("data", "ab")).not.toThrow();
      driver.resize();
      expect(onEvent).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "event failed" }));
      expect(input.setRawMode).toHaveBeenLastCalledWith(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      driver.stop();
      vi.useRealTimers();
    }
  });

  test("switching from encoded rendering resets the damage-diff baseline", () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let bytes = "";
    output.on("data", (chunk) => {
      bytes += chunk.toString();
    });
    const driver = createTerminalDriver({ input, output, caps, signals: false, onEvent() {} });
    try {
      const frame = linesToScreen([[{ text: "hello", style: {} }]], 20, 2);
      driver.paint(frame);
      driver.paintRendered("different screen");
      bytes = "";
      driver.paint(frame);
      expect(bytes).toContain("hello");
      driver.stop();
      bytes = "";
      driver.paintRendered("late");
      expect(bytes).toBe("");
    } finally {
      driver.stop();
    }
  });

  test("connects input, resize, damage paint, and cleanup", async () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    input.setRawMode = vi.fn();
    output.columns = 40;
    output.rows = 12;
    const events: TerminalInputEvent[] = [];
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(chunk.toString()));

    const driver = createTerminalDriver({
      input,
      output,
      caps,
      signals: false,
      onEvent: (event) => events.push(event),
    });
    input.write("j");
    output.emit("resize");
    driver.paint(linesToScreen([[{ text: "hello", style: {} }]], 40, 12));
    await new Promise((resolve) => setImmediate(resolve));

    expect(events).toContainEqual({ type: "char", char: "j" });
    expect(events).toContainEqual({ type: "resize", cols: 40, rows: 12 });
    expect(chunks.join("")).toContain("hello");
    expect(driver.previousFrame?.cols).toBe(40);
    driver.stop();
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });

  test("reports output failure and stops", () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    const onError = vi.fn();
    const driver = createTerminalDriver({
      input,
      output,
      caps,
      signals: false,
      onEvent: () => undefined,
      onError,
    });
    output.write = vi.fn(() => {
      throw new Error("write failed");
    }) as typeof output.write;
    driver.paint(linesToScreen([], 20, 2));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "write failed" }));
  });
});

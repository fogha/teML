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

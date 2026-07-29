import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import { enterTerminal } from "../../../src/terminal/client/lifecycle.js";

describe("terminal lifecycle", () => {
  test("enters and restores terminal modes exactly once", () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    const writes: string[] = [];
    output.on("data", (chunk) => writes.push(chunk.toString()));
    input.setRawMode = vi.fn();

    const lifecycle = enterTerminal({ input, output, signals: false });
    expect(input.setRawMode).toHaveBeenCalledWith(true);
    expect(lifecycle.active).toBe(true);

    lifecycle.cleanup();
    lifecycle.cleanup();
    expect(input.setRawMode).toHaveBeenCalledWith(false);
    expect(input.setRawMode).toHaveBeenCalledTimes(2);
    expect(writes.join("")).toContain("\x1b[?1049h");
    expect(writes.join("")).toContain("\x1b[?1049l");
    expect(lifecycle.active).toBe(false);
  });

  test("cleanup tolerates output failures", () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    output.write = vi.fn(() => {
      throw new Error("closed");
    }) as typeof output.write;
    const lifecycle = enterTerminal({ input, output, signals: false });
    expect(() => lifecycle.cleanup()).not.toThrow();
  });

  test("a setRawMode failure rolls back the modes already enabled", () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    const writes: string[] = [];
    output.on("data", (chunk) => writes.push(chunk.toString()));
    input.setRawMode = vi.fn(() => {
      throw new Error("cannot set raw mode");
    }) as unknown as NodeJS.ReadStream["setRawMode"];
    const before = new Set(process.listeners("SIGINT"));

    expect(() => enterTerminal({ input, output })).toThrow("cannot set raw mode");

    // The alternate screen, cursor, and mouse mode were all enabled before the
    // failure, so all three have to be undone or the caller's terminal is left
    // unusable.
    const rendered = writes.join("");
    expect(rendered).toContain("\x1b[?1049h");
    expect(rendered).toContain("\x1b[?1049l");
    expect(rendered).toContain("\x1b[?25l");
    expect(rendered).toContain("\x1b[?25h");
    expect(rendered).toContain("\x1b[?1000l");
    // Signal handlers are only installed after setup succeeds.
    expect(process.listeners("SIGINT").filter((l) => !before.has(l))).toEqual([]);
  });

  test("catchable signal handler requests exit and restores modes", () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    input.setRawMode = vi.fn();
    const before = new Set(process.listeners("SIGHUP"));
    const onSignal = vi.fn();
    const lifecycle = enterTerminal({ input, output, onSignal });
    const handler = process.listeners("SIGHUP").find((listener) => !before.has(listener));
    expect(handler).toBeDefined();
    handler?.("SIGHUP");
    expect(onSignal).toHaveBeenCalledWith("SIGHUP");
    expect(lifecycle.active).toBe(false);
    expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  });
});

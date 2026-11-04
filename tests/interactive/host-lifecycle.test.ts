import { PassThrough } from "node:stream";
import { afterEach, expect, test, vi } from "vitest";
import {
  bindings,
  runInteractiveApp,
  type InteractiveAppContext,
  type InteractiveAppOptions,
} from "../../src/interactive/host.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.useRealTimers();
});

function app(options: InteractiveAppOptions = {}) {
  const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  const output = new PassThrough();
  input.setRawMode = vi.fn();
  let bytes = "";
  output.on("data", (chunk) => {
    bytes += chunk.toString();
  });
  const state = bindings();
  const done = runInteractiveApp('::metric{id="cpu" value="0%"}\n::button{id="go" label="Go"}', {
    input,
    output,
    state,
    format: "teml",
    ...options,
  });
  // Observe rejection immediately, including failures occurring during startup.
  const outcome = done.then(
    (values) => ({ values, error: undefined }),
    (error: unknown) => ({ values: undefined, error }),
  );
  cleanups.push(() => {
    input.emit("end");
    return outcome;
  });
  return { input, output, state, outcome, bytes: () => bytes };
}

test("callback exceptions reject the app and restore the terminal", async () => {
  const failure = new Error("callback failed");
  const host = app({
    handlers: {
      onClick() {
        throw failure;
      },
    },
  });
  expect(() => host.input.emit("data", "\r")).not.toThrow();
  expect((await host.outcome).error).toBe(failure);
  expect(host.input.setRawMode).toHaveBeenLastCalledWith(false);
  expect(host.input.listenerCount("data")).toBe(0);
});

test("exit stops the current batch, timers, retained contexts, and bindings", async () => {
  vi.useFakeTimers();
  let afterExit = "";
  let context: InteractiveAppContext | undefined;
  const onClick = vi.fn((_id, _values, ctx) => {
    context = ctx;
    ctx.exit();
    afterExit = host.bytes();
  });
  const host = app({ handlers: { onClick } });
  host.input.emit("data", "\r\r");
  await host.outcome;
  host.state.cpu = "99%";
  context!.render("Too late");
  await vi.runAllTimersAsync();
  expect(host.bytes()).toBe(afterExit);
  expect(onClick).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["input", "output"] as const)(
  "%s errors reject and detach stream listeners",
  async (stream) => {
    const failure = new Error(`${stream} failed`);
    const host = app();
    expect(() => host[stream].emit("error", failure)).not.toThrow();
    expect((await host.outcome).error).toBe(failure);
    expect(host.input.setRawMode).toHaveBeenLastCalledWith(false);
    expect(host.input.listenerCount("data")).toBe(0);
    expect(host.output.listenerCount("resize")).toBe(0);
  },
);

test("rejected async callbacks are supervised by the application", async () => {
  const failure = new Error("async callback failed");
  const host = app({
    handlers: {
      async onClick() {
        throw failure;
      },
    },
  });
  host.input.emit("data", "\r");
  expect((await host.outcome).error).toBe(failure);
  expect(host.input.setRawMode).toHaveBeenLastCalledWith(false);
});

test("a closed output rejects instead of leaving the application pending", async () => {
  const host = app();
  host.output.emit("close");
  expect((await host.outcome).error).toEqual(new Error("terminal output closed"));
  expect(host.input.setRawMode).toHaveBeenLastCalledWith(false);
});

test("startup failure removes listeners and restores the terminal", async () => {
  const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  const output = new PassThrough();
  input.setRawMode = vi.fn(() => {
    throw new Error("raw mode failed");
  });
  const before = process.listenerCount("SIGINT");
  await expect(runInteractiveApp("hello", { input, output })).rejects.toThrow("raw mode failed");
  expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  expect(input.listenerCount("data")).toBe(0);
  expect(output.listenerCount("error")).toBe(0);
  expect(process.listenerCount("SIGINT")).toBe(before);
});

test("pointer activation waits for the resized frame", async () => {
  const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
  Object.assign(input, { isTTY: true, setRawMode: vi.fn() });
  Object.assign(output, { isTTY: true, columns: 60, rows: 24 });
  const clicks: string[] = [];
  const done = runInteractiveApp('::button{id="go" label="Go"}', {
    input,
    output,
    format: "teml",
    handlers: {
      onClick(id, _values, ctx) {
        clicks.push(id);
        ctx.exit();
      },
    },
  });
  await new Promise((resolve) => setImmediate(resolve));

  Object.assign(output, { columns: 50, rows: 22 });
  output.emit("resize");
  Object.assign(output, { columns: 40, rows: 20 });
  output.emit("resize");
  input.write("\x1b[<0;3;2M");
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clicks).toEqual([]);

  input.write("\x1b[<0;3;2M");
  await new Promise((resolve) => setTimeout(resolve, 100));
  await done;
  expect(clicks).toEqual(["go"]);
});

test("write failures during initial rendering reject after cleanup", async () => {
  const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  const output = new PassThrough();
  input.setRawMode = vi.fn();
  output.write = vi.fn(() => {
    throw new Error("write failed");
  });
  await expect(runInteractiveApp("hello", { input, output })).rejects.toThrow("write failed");
  expect(input.setRawMode).toHaveBeenLastCalledWith(false);
  expect(input.listenerCount("data")).toBe(0);
});

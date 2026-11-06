import { afterEach, expect, test, vi } from "vitest";
import { createSseParser, deepSeekStream } from "../../examples/apps/chat/stream.mjs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test("malformed SSE JSON fails as a controlled parse error", () => {
  const parser = createSseParser();
  expect(() => parser.push('data: {"not-json"}\n\n')).toThrow(SyntaxError);
});

test("SSE parsing rejects an unterminated event larger than 1 MiB", () => {
  const parser = createSseParser();
  parser.push(`data: ${"x".repeat(1_048_576 - 6)}`);
  expect(() => parser.push("x")).toThrow("SSE event exceeds 1048576 bytes");

  const multibyte = createSseParser();
  multibyte.push(`data: ${"é".repeat((1_048_576 - 6) / 2)}`);
  expect(() => multibyte.push("é")).toThrow("SSE event exceeds 1048576 bytes");
});

test("SSE parsing accepts a large chunk containing many small events", () => {
  const parser = createSseParser();
  const content = "x".repeat(1_024);
  const event = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
  const deltas = parser.push(event.repeat(1_025));
  expect(deltas).toHaveLength(1_025);
  expect(deltas[0]).toBe(content);
  expect(parser.flush()).toEqual([]);
});

test("a stalled DeepSeek stream aborts after the request deadline", async () => {
  vi.useFakeTimers();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => {
      controller.abort(new DOMException("The operation timed out", "TimeoutError"));
    }, milliseconds);
    return controller.signal;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(init?.signal?.reason);
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        },
      });
      return new Response(body, { status: 200 });
    }),
  );
  const stream = deepSeekStream({ model: "test", messages: [], apiKey: "secret" });
  const pending = stream.next();
  const rejection = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(timeout).toHaveBeenCalledWith(60_000);
  await rejection;
});

test("caller cancellation aborts an active DeepSeek response body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          const abort = () => controller.error(init?.signal?.reason);
          if (init?.signal?.aborted) abort();
          else init?.signal?.addEventListener("abort", abort, { once: true });
        },
      });
      return new Response(body, { status: 200 });
    }),
  );
  const controller = new AbortController();
  const stream = deepSeekStream({
    model: "test",
    messages: [],
    apiKey: "secret",
    signal: controller.signal,
  });
  const pending = stream.next();
  const rejection = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejection;
});

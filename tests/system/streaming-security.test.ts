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
  const rejection = expect(pending).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(timeout).toHaveBeenCalledWith(60_000);
  await rejection;
});

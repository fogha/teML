import { Readable, Writable } from "node:stream";
import { expect, test } from "vitest";
import { Diagnostics, normalize } from "../../src/core/index.js";
import { runInteractive } from "../../src/cli/commands/run.js";
import { MAX_NDJSON_LINE_BYTES } from "../../src/interactive/protocol.js";
import { parseTeml } from "../../src/teml/parse.js";
import { loadTheme } from "../../src/terminal/theme.js";
import type { Capabilities } from "../../src/terminal/capabilities.js";

const caps: Capabilities = {
  colors: "none",
  unicode: true,
  hyperlinks: false,
  width: 40,
  ambiguousWide: false,
};

class SlowOutput extends Writable {
  readonly chunks: Buffer[] = [];

  constructor() {
    super({ highWaterMark: 1 });
  }

  override _write(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(Buffer.from(chunk));
    setImmediate(callback);
  }

  text(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

test("runInteractive preserves split UTF-8 and waits for stdout backpressure", async () => {
  const source = Buffer.from('{"type":"char","char":"🙂"}\n{"type":"exit"}\n', "utf8");
  const emojiStart = source.indexOf(Buffer.from("🙂"));
  const stdin = Readable.from([
    source.subarray(0, emojiStart + 1),
    source.subarray(emojiStart + 1, emojiStart + 3),
    source.subarray(emojiStart + 3),
  ]);
  const stdout = new SlowOutput();
  const status = await runInteractive(
    normalize(parseTeml('::input{id="name" label="Name"}')),
    {
      diags: new Diagnostics(),
      layout: { width: 40, theme: loadTheme("dark"), caps },
      frames: "plain",
      mode: "patches",
    },
    stdin,
    stdout,
  );

  expect(status).toBe(0);
  const events = stdout
    .text()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(events).toContainEqual({ type: "change", id: "name", value: "🙂" });
  expect(events.at(-1)).toEqual({ type: "exit" });
});

test("an unexpected failure reports to stderr and to the host before exiting", async () => {
  const stdin = new Readable({
    read() {
      this.destroy(new Error("stdin exploded"));
    },
  });
  const stdout = new SlowOutput();
  const stderr = new SlowOutput();
  const status = await runInteractive(
    normalize(parseTeml('::input{id="name" label="Name"}')),
    {
      diags: new Diagnostics(),
      layout: { width: 40, theme: loadTheme("dark"), caps },
      frames: "plain",
    },
    stdin,
    stdout,
    stderr,
  );

  expect(status).toBe(1);
  expect(stderr.text()).toContain("teml: error: interactive session failed: stdin exploded");
  const events = stdout
    .text()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(events.at(-1)).toEqual({ type: "error", message: "stdin exploded" });
});

test("runInteractive reports an oversized line once and accepts later commands", async () => {
  const stdin = Readable.from([
    "x".repeat(MAX_NDJSON_LINE_BYTES + 1),
    '\n{"type":"key","key":"tab"}\n{"type":"exit"}\n',
  ]);
  const stdout = new SlowOutput();
  const status = await runInteractive(
    normalize(parseTeml('::input{id="name"}\n::button{id="next" label="Next"}')),
    {
      diags: new Diagnostics(),
      layout: { width: 40, theme: loadTheme("dark"), caps },
      frames: "plain",
    },
    stdin,
    stdout,
  );

  expect(status).toBe(0);
  const events = stdout
    .text()
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(events.filter((event) => event.type === "error")).toHaveLength(1);
  expect(events.filter((event) => event.type === "frame")).toHaveLength(2);
  expect(events.findLast((event) => event.type === "frame")?.focusedId).toBe("next");
  expect(events.at(-1)).toEqual({ type: "exit" });
});

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, test, vi } from "vitest";
import { executeRead, externalOpenCommand } from "../../src/cli/commands/read.js";
import { ReaderSession } from "../../src/reader/session.js";

function ttyPair(): {
  input: PassThrough & Partial<NodeJS.ReadStream>;
  output: PassThrough & Partial<NodeJS.WriteStream>;
  chunks: string[];
} {
  const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
  const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
  Object.assign(input, { isTTY: true, setRawMode: vi.fn() });
  Object.assign(output, { isTTY: true, columns: 50, rows: 8 });
  const chunks: string[] = [];
  output.on("data", (chunk) => chunks.push(chunk.toString()));
  return { input, output, chunks };
}

describe("teml read", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("a thrown error during startup still restores terminal modes", async () => {
    // reader.start() runs outside any effect-processing try/catch; a bug there
    // must not surface as an unhandled rejection that skips terminal cleanup.
    const startSpy = vi.spyOn(ReaderSession.prototype, "start").mockImplementation(() => {
      throw new Error("boom");
    });
    const dir = mkdtempSync(join(tmpdir(), "teml-reader-crash-"));
    const file = join(dir, "doc.teml");
    writeFileSync(file, "# Reader\n\nBody\n");
    const { input, output, chunks } = ttyPair();
    const error = new PassThrough();
    const errors: string[] = [];
    error.on("data", (chunk) => errors.push(chunk.toString()));

    const code = await executeRead(file, { color: false }, { input, output, error });

    rmSync(dir, { recursive: true, force: true });
    startSpy.mockRestore();
    expect(code).toBe(1);
    expect(errors.join("")).toContain("boom");
    const rendered = chunks.join("");
    expect(rendered).toContain("\x1b[?1049h");
    expect(rendered).toContain("\x1b[?1049l");
  });

  test("an unrelated uncaught exception during the session still restores terminal modes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "teml-reader-uncaught-"));
    const file = join(dir, "doc.teml");
    writeFileSync(file, "# Reader\n\nBody\n");
    const { input, output, chunks } = ttyPair();
    const error = new PassThrough();
    const errors: string[] = [];
    error.on("data", (chunk) => errors.push(chunk.toString()));

    const running = executeRead(file, { color: false }, { input, output, error });
    await new Promise((resolve) => setImmediate(resolve));
    process.emit("uncaughtException", new Error("out-of-band failure"));
    const code = await running;

    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(1);
    expect(errors.join("")).toContain("out-of-band failure");
    const rendered = chunks.join("");
    expect(rendered).toContain("\x1b[?1049h");
    expect(rendered).toContain("\x1b[?1049l");
  });

  test("Windows external links bypass cmd.exe shell parsing", () => {
    const url = "https://example.test/?a&calc.exe";
    expect(externalOpenCommand("win32", url)).toEqual({
      file: "explorer.exe",
      args: [url],
    });
    expect(() => externalOpenCommand("win32", "file:///C:/secret.txt")).toThrow(
      "unsupported external URL scheme",
    );
  });

  test("rejects non-TTY streams with view guidance", async () => {
    const input = new PassThrough() as PassThrough & Partial<NodeJS.ReadStream>;
    const output = new PassThrough() as PassThrough & Partial<NodeJS.WriteStream>;
    const error = new PassThrough();
    const errors: string[] = [];
    error.on("data", (chunk) => errors.push(chunk.toString()));
    const code = await executeRead("README.md", {}, { input, output, error });
    expect(code).toBe(2);
    expect(errors.join("")).toContain("use `teml view`");
  });

  test("starts, paints, accepts navigation, and restores terminal modes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "teml-reader-"));
    const file = join(dir, "doc.teml");
    writeFileSync(file, "# Reader\n\nFirst\n\nSecond\n\nThird\n");
    const { input, output, chunks } = ttyPair();
    const running = executeRead(file, { color: false }, { input, output });
    await new Promise((resolve) => setImmediate(resolve));
    input.write("j");
    input.write("q");
    const code = await running;
    rmSync(dir, { recursive: true, force: true });
    expect(code).toBe(0);
    const rendered = chunks.join("");
    expect(rendered).toContain("READER");
    expect(rendered).toContain("\x1b[?1049h");
    expect(rendered).toContain("\x1b[?1049l");
  });

  test("browses only supported directory entries", async () => {
    const dir = mkdtempSync(join(tmpdir(), "teml-reader-dir-"));
    writeFileSync(join(dir, "a.teml"), "# OPENED_DOCUMENT\n");
    writeFileSync(join(dir, "b.txt"), "ignored");
    const { input, output, chunks } = ttyPair();
    const running = executeRead(dir, { color: false }, { input, output });
    await new Promise((resolve) => setImmediate(resolve));
    input.write("\t\r");
    await new Promise((resolve) => setImmediate(resolve));
    input.write("q");
    expect(await running).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    expect(chunks.join("")).toContain("a.teml");
    expect(chunks.join("")).toContain("OPENED_DOCUMENT");
    expect(chunks.join("")).not.toContain("b.txt");
  });

  test("opens an external URL only after confirmation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "teml-reader-link-"));
    const file = join(dir, "doc.teml");
    writeFileSync(file, "[Example](https://example.test)\n");
    const { input, output } = ttyPair();
    const openExternal = vi.fn(async () => undefined);
    const running = executeRead(file, { color: false }, { input, output, openExternal });
    await new Promise((resolve) => setImmediate(resolve));
    input.write("\t\r");
    await new Promise((resolve) => setImmediate(resolve));
    expect(openExternal).not.toHaveBeenCalled();
    input.write("\r");
    await new Promise((resolve) => setImmediate(resolve));
    input.write("q");
    expect(await running).toBe(0);
    rmSync(dir, { recursive: true, force: true });
    expect(openExternal).toHaveBeenCalledOnce();
  });
});

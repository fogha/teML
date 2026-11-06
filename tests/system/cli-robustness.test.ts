// Regression tests for robustness defects found by the CLI sweep. These drive
// the built CLI over real pipes, which is where all three were visible.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, expect } from "vitest";
import { CLI } from "./harness.js";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "teml-robust-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Reading `process.stdin.isTTY` initializes the stdin stream and flips a pipe to
// non-blocking, so the subsequent synchronous read failed with EAGAIN whenever
// the producer had not written yet — e.g. the documented `curl … | teml view`.
test("a delayed stdin producer is read to EOF", async () => {
  const child = spawn("node", [CLI, "view", "--no-color"], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let err = "";
  child.stdout.on("data", (chunk) => (out += chunk.toString()));
  child.stderr.on("data", (chunk) => (err += chunk.toString()));

  // Write only after the child has started, so the pipe is empty at first read.
  await new Promise((resolve) => setTimeout(resolve, 300));
  child.stdin.end("# delayed\n");

  const code = await new Promise<number | null>((resolve) => child.on("close", resolve));
  expect(err).toBe("");
  expect(code).toBe(0);
  expect(out).toContain("DELAYED");
});

// `process.exit()` immediately after a single buffered write truncated every
// piped command at the OS pipe-buffer size, nondeterministically and with exit 0.
test("piped output matches redirected output byte for byte", () => {
  const doc = join(process.cwd(), "docs", "interactive-protocol.md");
  const args = ["render", doc, "--width", "200"];

  const redirected = withTempDir((dir) => {
    const out = join(dir, "out.txt");
    const fd = openSync(out, "w");
    try {
      const r = spawnSync("node", [CLI, ...args], { stdio: ["ignore", fd, "inherit"] });
      expect(r.status).toBe(0);
    } finally {
      closeSync(fd);
    }
    return readFileSync(out, "utf8");
  });

  // Guard the guard: this fixture must be larger than a pipe buffer, or the
  // comparison below would pass vacuously. Byte length, not string length —
  // box-drawing characters make the two different.
  expect(Buffer.byteLength(redirected, "utf8")).toBeGreaterThan(65536);

  const piped = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  expect(piped.status).toBe(0);
  expect(piped.stdout).toBe(redirected);
});

// `render` and `convert` used a raw --width while `view` used the clamped
// capability width, so an extreme value bypassed MAX_TERMINAL_DIMENSION and
// stalled for minutes building a gigantic line.
test("render clamps an extreme --width to the terminal dimension limit", () => {
  const doc = join(process.cwd(), "examples", "markup", "demo.teml");
  const r = spawnSync("node", [CLI, "render", doc, "--width", "200000"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  expect(r.status).toBe(0);
  const widest = Math.max(...r.stdout.split("\n").map((line) => [...line].length));
  expect(widest).toBeLessThanOrEqual(10_000);
});

test("pathological documents degrade through the built CLI", () => {
  withTempDir((dir) => {
    const cases = [
      {
        name: "delimiters.md",
        source: "prefix" + "*".repeat(3_400_000),
        diagnostic: "implausibly long run of emphasis delimiters",
        output: "prefix",
      },
      {
        name: "nested.html",
        source: "<div>".repeat(5_000) + "x" + "</div>".repeat(5_000),
        diagnostic: "nests inline markup too deeply for the parser",
        output: "<div><div>",
      },
    ];
    for (const { name, source, diagnostic, output } of cases) {
      const file = join(dir, name);
      writeFileSync(file, source);
      const result = spawnSync("node", [CLI, "view", file, "--no-color", "--width", "40"], {
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      expect(result.status, name).toBe(0);
      expect(result.stderr, name).toContain(diagnostic);
      expect(result.stdout, name).toContain(output);
    }
  });
});

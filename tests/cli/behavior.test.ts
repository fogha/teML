import { test, expect } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(process.cwd(), "dist/cli/main.js");
const FIXTURE = join(process.cwd(), "fixtures/teml/10-kitchen-sink.teml");
const MD_FIXTURE = join(process.cwd(), "fixtures/markdown/10-kitchen-sink.md");
const HTML_FIXTURE = join(process.cwd(), "fixtures/html/03-bootstrap.html");

function withoutColorEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  return env;
}

function run(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): {
  stdout: string;
  stderr: string;
  status: number | null;
} {
  const r = spawnSync("node", [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

test("default command: teml FILE behaves as view", () => {
  const out = execFileSync("node", [CLI, FIXTURE, "--width", "80", "--no-color"], {
    encoding: "utf8",
  });
  expect(out).toMatch(/kitchen sink/i);
});

test("demo renders the bundled showcase without an input file", () => {
  const r = run(["demo", "--width", "80", "--no-color"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/deploy report/i);
  expect(r.stderr).toBe("");
});

test("redirect stdout has zero ESC bytes", () => {
  const out = execFileSync("node", [CLI, FIXTURE, "--width", "80"], {
    encoding: "utf8",
    env: withoutColorEnv(),
  });
  expect(out.includes("\x1b")).toBe(false);
});

test("--color explicitly enables ANSI for redirected stdout", () => {
  const out = execFileSync("node", [CLI, FIXTURE, "--width", "80", "--color"], {
    encoding: "utf8",
    env: withoutColorEnv(),
  });
  expect(out.includes("\x1b")).toBe(true);
});

test("NO_COLOR=1 yields zero ESC bytes", () => {
  const out = execFileSync("node", [CLI, FIXTURE, "--width", "80", "--color"], {
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "1" },
  });
  expect(out.includes("\x1b")).toBe(false);
});

test("warnings go to stderr only", () => {
  const hostile = join(process.cwd(), "fixtures/teml/15-hostile.teml");
  const r = run(["render", hostile, "--width", "80"]);
  expect(r.stdout.includes("teml: warning:")).toBe(false);
  expect(r.stderr.includes("teml: warning:")).toBe(true);
});

test("missing file exits 1 with stderr message and empty stdout", () => {
  const r = run(["view", "missing-file-xyz.teml"]);
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/cannot read|ENOENT/i);
  expect(r.stdout).toBe("");
});

test("bad flag exits 2", () => {
  const r = run(["view", FIXTURE, "--not-a-flag"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("teml: error: unknown option");
  expect(r.stderr).not.toContain("error: error:");
});

test("stdin pipe renders html", () => {
  const html = "<html><body><h1>Pipe</h1><p>from stdin</p></body></html>";
  const r = spawnSync("node", [CLI, "--from", "html", "--width", "40", "--no-color"], {
    input: html,
    encoding: "utf8",
  });
  expect(r.status).toBe(0);
  expect(r.stdout).toMatch(/pipe/i);
});

test("render is byte-identical across two runs", () => {
  const a = execFileSync("node", [CLI, "render", FIXTURE, "--width", "80"], { encoding: "utf8" });
  const b = execFileSync("node", [CLI, "render", FIXTURE, "--width", "80"], { encoding: "utf8" });
  expect(a).toBe(b);
});

test("--version exits 0", () => {
  const r = run(["--version"]);
  expect(r.status).toBe(0);
  expect(r.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
});

test("convert all directions", () => {
  const temlOut = execFileSync(
    "node",
    [CLI, "convert", MD_FIXTURE, "--from", "markdown", "--to", "teml"],
    {
      encoding: "utf8",
    },
  );
  expect(temlOut).toContain("#");

  const mdOut = execFileSync("node", [CLI, "convert", FIXTURE, "--to", "markdown"], {
    encoding: "utf8",
  });
  expect(mdOut).toContain("#");

  const jsonOut = execFileSync("node", [CLI, "convert", FIXTURE, "--to", "json"], {
    encoding: "utf8",
  });
  expect(JSON.parse(jsonOut).blocks.length).toBeGreaterThan(0);

  const textOut = execFileSync("node", [CLI, "convert", FIXTURE, "--to", "text", "--width", "80"], {
    encoding: "utf8",
  });
  expect(textOut.length).toBeGreaterThan(20);
  expect(textOut.includes("\x1b")).toBe(false);

  const htmlOut = execFileSync(
    "node",
    [CLI, "convert", HTML_FIXTURE, "--from", "html", "--to", "teml"],
    {
      encoding: "utf8",
    },
  );
  expect(htmlOut).toContain(":::");
});

test("inspect --render-tokens is deterministic", () => {
  const a = execFileSync("node", [CLI, "inspect", FIXTURE, "--render-tokens", "--width", "60"], {
    encoding: "utf8",
  });
  const b = execFileSync("node", [CLI, "inspect", FIXTURE, "--render-tokens", "--width", "60"], {
    encoding: "utf8",
  });
  expect(a).toBe(b);
  expect(a).toContain("render_start");
  expect(a).toContain("span text=");
});

test("--allow-file-links accepts file href at parse time", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-file-link-"));
  const file = join(dir, "link.teml");
  writeFileSync(file, "[local](./sibling.txt)\n");
  const r = run(["inspect", file, "--allow-file-links"]);
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("sibling.txt");
  rmSync(dir, { recursive: true, force: true });
});

test("--show-urls prints URL in render output", () => {
  const file = join(process.cwd(), "fixtures/teml/12-links-images.teml");
  const out = execFileSync("node", [CLI, "render", file, "--width", "80", "--show-urls"], {
    encoding: "utf8",
  });
  expect(out).toMatch(/https?:\/\//);
});

test("--debug writes timings to stderr", () => {
  const r = run(["view", FIXTURE, "--width", "80", "--debug"]);
  expect(r.stderr).toContain("teml: debug:");
});

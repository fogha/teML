import { test, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CLI = join(process.cwd(), "dist/cli/main.js");

function withoutColorEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  return env;
}

function ndjson(commands: object[]): string {
  return commands.map((c) => JSON.stringify(c)).join("\n") + "\n";
}

function runSession(
  file: string,
  commands: object[],
  args: string[] = [],
): { events: unknown[]; stderr: string; status: number | null } {
  const r = spawnSync("node", [CLI, "run", file, "--width", "40", ...args], {
    input: ndjson(commands),
    encoding: "utf8",
    env: withoutColorEnv(),
  });
  const events = (r.stdout ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
  return { events, stderr: r.stderr ?? "", status: r.status };
}

function makeForm(dir: string): string {
  const file = join(dir, "form.teml");
  writeFileSync(
    file,
    [
      '::input{id="name" label="Name" placeholder="your name"}',
      '::checkbox{id="agree" label="I agree to the terms"}',
      '::button{id="submit" label="Submit"}',
    ].join("\n") + "\n",
  );
  return file;
}

test("teml run emits an initial frame before reading any command", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = makeForm(dir);
  const { events, status } = runSession(file, [{ type: "exit" }]);
  rmSync(dir, { recursive: true, force: true });

  expect(status).toBe(0);
  expect(events[0]).toMatchObject({ type: "frame", seq: 1, focusedId: "name" });
  expect((events[0] as { plain: string }).plain).toContain("your name");
  expect(events.at(-1)).toEqual({ type: "exit" });
});

test("teml run drives a full type → tab → toggle → tab → submit flow", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = makeForm(dir);
  const { events, status } = runSession(file, [
    { type: "char", char: "A" },
    { type: "char", char: "da" },
    { type: "key", key: "tab" },
    { type: "key", key: "enter" },
    { type: "key", key: "tab" },
    { type: "key", key: "enter" },
    { type: "exit" },
  ]);
  rmSync(dir, { recursive: true, force: true });

  expect(status).toBe(0);
  const semantic = events.filter((e) => (e as { type: string }).type !== "frame");
  expect(semantic).toEqual([
    { type: "change", id: "name", value: "A" },
    { type: "change", id: "name", value: "Ada" },
    { type: "toggle", id: "agree", checked: true },
    { type: "click", id: "submit", values: { name: "Ada", agree: "true", submit: "" } },
    { type: "exit" },
  ]);
});

test("teml run emits ANSI escapes in the frame's ansi field by default (host terminal assumed capable)", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = makeForm(dir);
  const r = spawnSync("node", [CLI, "run", file, "--width", "40"], {
    input: ndjson([{ type: "exit" }]),
    encoding: "utf8",
    env: withoutColorEnv(),
  });
  rmSync(dir, { recursive: true, force: true });
  const firstEvent = JSON.parse((r.stdout ?? "").split("\n")[0] ?? "{}") as {
    ansi: string;
    plain: string;
  };
  expect(firstEvent.ansi).toContain("\x1b[");
  expect(firstEvent.plain.includes("\x1b")).toBe(false);
});

test("--no-color yields zero escape bytes in the ansi field too", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = makeForm(dir);
  const { events } = runSession(file, [{ type: "exit" }], ["--no-color"]);
  rmSync(dir, { recursive: true, force: true });
  const firstEvent = events[0] as { ansi: string };
  expect(firstEvent.ansi.includes("\x1b")).toBe(false);
});

test("malformed NDJSON lines produce an error event and the session keeps going", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = makeForm(dir);
  const r = spawnSync("node", [CLI, "run", file, "--width", "40"], {
    input: '{not json\n{"type":"mystery"}\n{"type":"key","key":"tab"}\n{"type":"exit"}\n',
    encoding: "utf8",
  });
  rmSync(dir, { recursive: true, force: true });

  const events = (r.stdout ?? "")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l));
  expect(r.status).toBe(0);
  const errors = events.filter((e) => e.type === "error");
  expect(errors).toHaveLength(2);
  expect(errors[0].message).toContain("malformed JSON");
  expect(errors[1].message).toContain("unknown command type");
  expect(events.at(-1)).toEqual({ type: "exit" });
});

test("a render command replaces the document and preserves matching values by id", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = makeForm(dir);
  const { events } = runSession(file, [
    { type: "char", char: "Ada" },
    { type: "key", key: "tab" },
    { type: "key", key: "enter" }, // check "agree"
    {
      type: "render",
      markup: [
        '::input{id="name" label="Full name"}',
        '::checkbox{id="agree" label="I agree"}',
        '::button{id="submit" label="Send"}',
      ].join("\n"),
    },
    { type: "exit" },
  ]);
  rmSync(dir, { recursive: true, force: true });

  const frames = events.filter((e) => (e as { type: string }).type === "frame") as {
    plain: string;
  }[];
  const lastFrame = frames.at(-1)!;
  expect(lastFrame.plain).toContain("Ada");
  expect(lastFrame.plain).toContain("☑");
  expect(lastFrame.plain).toContain("Send");
});

test("missing file exits 1 with a stderr message and empty stdout", () => {
  const r = spawnSync("node", [CLI, "run", "missing-file-xyz.teml"], {
    input: ndjson([{ type: "exit" }]),
    encoding: "utf8",
  });
  expect(r.status).toBe(1);
  expect(r.stderr).toMatch(/cannot read|ENOENT/i);
  expect(r.stdout).toBe("");
});

test("a static document with no focusable widgets still runs and exits cleanly", () => {
  const dir = mkdtempSync(join(tmpdir(), "teml-run-"));
  const file = join(dir, "static.teml");
  writeFileSync(file, "# Just a heading\n\nSome text.\n");
  const { events, status } = runSession(file, [
    { type: "key", key: "tab" },
    { type: "char", char: "x" },
    { type: "exit" },
  ]);
  rmSync(dir, { recursive: true, force: true });

  expect(status).toBe(0);
  expect(events.every((e) => (e as { type: string }).type !== "change")).toBe(true);
  expect(events[0]).toMatchObject({ focusedId: null });
  expect(events.at(-1)).toEqual({ type: "exit" });
});

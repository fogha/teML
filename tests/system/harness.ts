import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFrame, createFrameState, frameText } from "../../examples/interactive-frame.mjs";

export const CLI = join(process.cwd(), "dist/cli/main.js");

export type ProcessResult = {
  stdout: string;
  stderr: string;
  status: number | null;
};

export type WirePatch = {
  row: number;
  plain: string | null;
  ansi: string | null;
};

export type WireFrame = {
  type: "frame";
  seq: number;
  focusedId: string | null;
  plain?: string | null;
  ansi?: string | null;
  rows?: number;
  patches?: WirePatch[];
  viewport?: { offset: number; height: number; total: number };
  scrollRegions?: { id: string; offset: number; height: number; total: number }[];
  protocol?: { major: number; minor: number };
  capabilities?: string[];
};

export type WireEvent = WireFrame | ({ type: string } & Record<string, unknown>);

export function withoutColorEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  return env;
}

export function runCli(
  args: string[],
  options: {
    input?: string;
    env?: NodeJS.ProcessEnv;
    cwd?: string;
  } = {},
): ProcessResult {
  const result = spawnSync("node", [CLI, ...args], {
    cwd: options.cwd,
    input: options.input,
    encoding: "utf8",
    env: options.env ?? process.env,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status,
  };
}

export function runRawSession(
  file: string,
  input: string,
  args: string[] = [],
): ProcessResult & { events: WireEvent[] } {
  const result = runCli(["run", file, "--width", "40", ...args], {
    input,
    env: withoutColorEnv(),
  });
  const events = result.stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as WireEvent);
  return { ...result, events };
}

export function runSession(
  file: string,
  commands: object[],
  args: string[] = [],
): ProcessResult & { events: WireEvent[] } {
  return runRawSession(
    file,
    commands.map((command) => JSON.stringify(command)).join("\n") + "\n",
    args,
  );
}

export function makeInteractiveForm(): {
  dir: string;
  file: string;
  cleanup(): void;
} {
  const dir = mkdtempSync(join(tmpdir(), "teml-system-"));
  const file = join(dir, "form.teml");
  writeFileSync(
    file,
    [
      "Complete this deliberately long account profile before continuing.",
      "",
      '::input{id="name" label="Name" placeholder="your name"}',
      '::checkbox{id="agree" label="I agree to the terms"}',
      '::button{id="submit" label="Submit"}',
    ].join("\n") + "\n",
  );
  return {
    dir,
    file,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function frames(events: WireEvent[]): WireFrame[] {
  return events.filter((event): event is WireFrame => event.type === "frame");
}

export function semanticEvents(events: WireEvent[]): WireEvent[] {
  return events.filter((event) => event.type !== "frame");
}

export function findRow(rendered: string | null | undefined, text: string): number {
  const row = (rendered ?? "").split("\n").findIndex((line) => line.includes(text));
  if (row < 0) throw new Error(`could not find ${JSON.stringify(text)} in frame`);
  return row;
}

export function replayFrames(
  events: WireEvent[],
  preferred: "plain" | "ansi",
): ReturnType<typeof createFrameState> {
  const state = createFrameState(preferred);
  for (const event of frames(events)) applyFrame(state, event);
  return state;
}

export { applyFrame, createFrameState, frameText };

/**
 * The text a user would see, with SGR styling and cursor control removed.
 *
 * Styled output splits a heading into one escape-wrapped span per word, so
 * `expect(chunks).toContain("UPDATED ACCOUNT")` holds only where colour is
 * disabled — it passes on a developer machine with NO_COLOR/FORCE_COLOR=0 and
 * fails in CI. Assert on this instead of raw output whenever the claim is
 * about words rather than about the escapes themselves.
 */
export function visibleText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
}

export function assertNoForeignEsc(text: string): void {
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "\x1b") continue;
    const next = text.slice(index + 1, index + 3);
    if (!next.startsWith("[") && !next.startsWith("]8") && !next.startsWith("\\")) {
      throw new Error(`foreign escape sequence at offset ${index}`);
    }
  }
}

export function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

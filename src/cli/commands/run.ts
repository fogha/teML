// cli/commands/run.ts — `teml run`: a pure NDJSON transform over an
// interactive document. teml never touches the terminal here — it just reads
// Commands from stdin and writes SessionEvents to stdout, one JSON object
// per line. The host owns the real TTY (raw mode, keypress capture, and
// deciding how to redraw each frame).

import type { Readable, Writable } from "node:stream";
import type { TDoc } from "../../core/index.js";
import { decodeCommand, encodeEvent, NdjsonSplitter } from "../../interactive/protocol.js";
import { InteractiveSession, type SessionOptions } from "../../interactive/session.js";
import type { CliFlags } from "../options.js";
import { readInput, sanitizeOpts, toDoc } from "../run.js";

export type RunOpts = SessionOptions;

/**
 * Drive one interactive session end-to-end over the given streams: emit the
 * first frame immediately, then decode NDJSON commands from `stdin` and
 * write NDJSON events to `stdout` until the host sends `exit` or closes
 * stdin. Resolves with a process exit code. Pure stream plumbing — no
 * process.* globals — so this is directly unit-testable without spawning a
 * subprocess.
 */
export function runInteractive(
  doc: TDoc,
  opts: RunOpts,
  stdin: Readable,
  stdout: Writable,
): Promise<number> {
  const session = new InteractiveSession(doc, opts);
  const splitter = new NdjsonSplitter();
  const write = (line: string): void => {
    stdout.write(line);
  };

  for (const event of session.start()) write(encodeEvent(event));

  return new Promise((resolve) => {
    let resolved = false;
    const finish = (code: number): void => {
      if (resolved) return;
      resolved = true;
      stdin.removeListener("data", onData);
      stdin.removeListener("end", onEnd);
      resolve(code);
    };

    const processLine = (line: string): void => {
      const decoded = decodeCommand(line);
      if (!decoded.ok) {
        write(encodeEvent({ type: "error", message: decoded.error }));
        return;
      }
      for (const event of session.handle(decoded.command)) write(encodeEvent(event));
      if (session.isDone()) finish(0);
    };

    const onData = (chunk: Buffer | string): void => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of splitter.push(text)) {
        processLine(line);
        if (resolved) return;
      }
    };

    const onEnd = (): void => {
      for (const line of splitter.flush()) {
        processLine(line);
        if (resolved) return;
      }
      finish(0);
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.resume();
  });
}

/** CLI entry point: load the initial document, then hand off to runInteractive on real stdio. */
export async function executeRun(file: string | undefined, flags: CliFlags): Promise<number> {
  let input;
  try {
    input = readInput(file);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`teml: error: cannot read ${file ?? "input"}: ${msg}\n`);
    return 1;
  }

  let doc: TDoc;
  let diags: import("../../core/diagnostics.js").Diagnostics;
  try {
    ({ doc, diags } = await toDoc(input.source, input.name, flags));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`teml: error: parse failed: ${msg}\n`);
    return 1;
  }

  const { detectCapabilities } = await import("../../terminal/capabilities.js");
  const { loadTheme, loadDocumentTheme, applyMetaRoles } = await import("../../terminal/theme.js");
  // `run`'s own stdout is always a pipe (the NDJSON protocol channel), never
  // the terminal a human is looking at, so isTTY-based auto-detection would
  // wrongly zero out the `ansi` frame field by default. Assume the *host's*
  // real terminal supports color/hyperlinks unless told otherwise via
  // --no-color/NO_COLOR (both still respected — see detectCapabilities).
  const caps = detectCapabilities(
    {
      width: flags.width,
      color: flags.color,
      ascii: flags.ascii,
      ambiguousWide: flags.ambiguousWide,
      showUrls: flags.showUrls,
    },
    process.env,
    true,
  );
  const baseTheme = flags.theme
    ? loadTheme(flags.theme, diags)
    : loadDocumentTheme(doc.meta.theme, diags);
  const theme = applyMetaRoles(baseTheme, doc.meta, diags);

  const code = await runInteractive(
    doc,
    {
      diags,
      layout: {
        width: caps.width,
        theme,
        caps,
        wrapCode: flags.wrapCode,
        showUrls: flags.showUrls,
      },
      sanitize: sanitizeOpts(flags),
    },
    process.stdin,
    process.stdout,
  );

  diags.print();
  return code;
}

// cli/commands/run.ts — `teml run`: a pure NDJSON transform over an
// interactive document. teml never touches the terminal here — it just reads
// Commands from stdin and writes SessionEvents to stdout, one JSON object
// per line. The host owns the real TTY (raw mode, keypress capture, and
// deciding how to redraw each frame).

import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
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
 * stdin. Resolves with a process exit code. Every stream is injected, so this
 * is directly unit-testable without spawning a subprocess; `stderr` only falls
 * back to the process global when a caller does not supply one.
 */
export async function runInteractive(
  doc: TDoc,
  opts: RunOpts,
  stdin: Readable,
  stdout: Writable,
  stderr: Writable = process.stderr,
): Promise<number> {
  const session = new InteractiveSession(doc, opts);
  const splitter = new NdjsonSplitter();
  const utf8 = new StringDecoder("utf8");
  let outputFailed = false;
  const onOutputError = (): void => {
    outputFailed = true;
    if (!stdin.destroyed) stdin.destroy();
  };
  stdout.on("error", onOutputError);

  const write = async (line: string): Promise<boolean> => {
    if (outputFailed) return false;
    try {
      if (stdout.write(line)) return true;
    } catch {
      outputFailed = true;
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const cleanup = (): void => {
        stdout.removeListener("drain", onDrain);
        stdout.removeListener("error", onError);
      };
      const onDrain = (): void => {
        cleanup();
        resolve(true);
      };
      const onError = (): void => {
        cleanup();
        outputFailed = true;
        resolve(false);
      };
      stdout.once("drain", onDrain);
      stdout.once("error", onError);
    });
  };

  const writeEvents = async (events: ReturnType<InteractiveSession["start"]>): Promise<boolean> => {
    for (const event of events) {
      if (!(await write(encodeEvent(event)))) return false;
    }
    return true;
  };

  const processLine = async (line: string): Promise<boolean> => {
    const decoded = decodeCommand(line);
    if (!decoded.ok) {
      return writeEvents([{ type: "error", message: decoded.error }]);
    }
    return writeEvents(session.handle(decoded.command));
  };

  try {
    if (!(await writeEvents(session.start()))) return 1;
    for await (const chunk of stdin) {
      const text = typeof chunk === "string" ? chunk : utf8.write(chunk as Buffer);
      for (const input of splitter.push(text)) {
        const written = input.ok
          ? await processLine(input.line)
          : await writeEvents([{ type: "error", message: input.error }]);
        if (!written) return 1;
        if (session.isDone()) return 0;
      }
    }
    const trailingText = utf8.end();
    for (const input of splitter.push(trailingText)) {
      const written = input.ok
        ? await processLine(input.line)
        : await writeEvents([{ type: "error", message: input.error }]);
      if (!written) return 1;
      if (session.isDone()) return 0;
    }
    for (const input of splitter.flush()) {
      const written = input.ok
        ? await processLine(input.line)
        : await writeEvents([{ type: "error", message: input.error }]);
      if (!written) return 1;
      if (session.isDone()) return 0;
    }
    return outputFailed ? 1 : 0;
  } catch (error) {
    // Failing silently here left a host with a closed stream and no reason,
    // and an operator with an exit code and nothing on stderr.
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`teml: error: interactive session failed: ${message}\n`);
    if (!outputFailed) {
      try {
        stdout.write(encodeEvent({ type: "error", message }));
      } catch {
        // The channel is already gone; the stderr line is the only record.
      }
    }
    return 1;
  } finally {
    stdout.removeListener("error", onOutputError);
  }
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

  const { clampTerminalHeight, detectCapabilities } =
    await import("../../terminal/capabilities.js");
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
        height: flags.height === undefined ? undefined : clampTerminalHeight(flags.height),
        theme,
        caps,
        wrapCode: flags.wrapCode,
        showUrls: flags.showUrls,
      },
      sanitize: sanitizeOpts(flags),
      frames: flags.frames,
      mode: flags.frameMode,
    },
    process.stdin,
    process.stdout,
  );

  diags.print();
  return code;
}

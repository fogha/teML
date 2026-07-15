// interactive/host.ts — in-process terminal host for Node apps.
//
// `teml run` (protocol.ts + session.ts) exists so *any* language can drive
// an interactive document over NDJSON, because the host owns the terminal
// and teml never touches it directly. That's the right shape for a
// cross-process/cross-language integration, but it's needless overhead for
// a plain Node CLI app: spawning a subprocess of itself and JSON-encoding
// every keystroke just to talk to its own dependency.
//
// This module drives the exact same InteractiveSession engine directly,
// in-process: it puts stdin in raw mode, decodes keypresses/mouse clicks
// into Commands itself (the same decoding `examples/interactive-host.mjs`
// does for the subprocess case), calls `session.handle()` directly — no
// JSON in between — and dispatches the resulting events to typed callbacks
// instead of writing NDJSON to a pipe.

import { Diagnostics, normalize, type SanitizeOpts, type TDoc } from "../core/index.js";
import { htmlToDoc } from "../html/index.js";
import { parseMarkdown } from "../markdown/parse.js";
import { parseTeml } from "../teml/parse.js";
import { TERMINAL_CONTROL } from "../render/ansi.js";
import { detectCapabilities } from "../terminal/capabilities.js";
import { createInputDecoder, type TerminalInputEvent } from "../terminal/client/input.js";
import { enterTerminal, type TerminalLifecycle } from "../terminal/client/lifecycle.js";
import { applyMetaRoles, loadTheme } from "../terminal/theme.js";
import { InteractiveSession, type SessionLayoutConfig } from "./session.js";
import type { Command, DocFormat, SessionEvent } from "./protocol.js";

export type { DocFormat } from "./protocol.js";

/** Passed to every handler so it can act on the live session without reaching into internals. */
export type InteractiveAppContext = {
  /** Ends the interactive loop; runInteractiveApp's promise resolves with the final values. */
  exit(): void;
  /** Swaps in a new document — e.g. moving to another "screen" of a multi-step app. */
  render(source: string, format?: DocFormat): void;
  /** Current value of every focusable widget (id -> value; checkboxes as "true"/"false"). */
  values(): Record<string, string>;
};

export type InteractiveAppHandlers = {
  onChange?(id: string, value: string, ctx: InteractiveAppContext): void;
  onToggle?(id: string, checked: boolean, ctx: InteractiveAppContext): void;
  onClick?(id: string, values: Record<string, string>, ctx: InteractiveAppContext): void;
  onError?(message: string, ctx: InteractiveAppContext): void;
};

export type InteractiveAppOptions = {
  /** Markup format for `source` (and the default for ctx.render() when it omits one). Default: "html". */
  format?: DocFormat;
  theme?: string;
  width?: number;
  sanitize?: SanitizeOpts;
  handlers?: InteractiveAppHandlers;
  /** Extra line(s) written under every frame — e.g. key hints. */
  footer?: string;
  /** Enable SGR mouse click-to-focus/activate. Default: true. */
  mouse?: boolean;
  input?: NodeJS.ReadableStream & Partial<NodeJS.ReadStream>;
  output?: NodeJS.WritableStream & Partial<NodeJS.WriteStream>;
  diags?: Diagnostics;
};

function parseSource(
  source: string,
  format: DocFormat,
  sanitize: SanitizeOpts,
  diags: Diagnostics,
): TDoc {
  const ctx = { sanitize };
  switch (format) {
    case "html":
      return htmlToDoc(source, { sanitize }, diags);
    case "markdown":
      return parseMarkdown(source, diags, ctx);
    case "teml":
    default:
      return parseTeml(source, diags, ctx);
  }
}

/**
 * Run an interactive TeML/HTML/Markdown document in *this* process's own
 * terminal. Resolves with the final widget values once a handler calls
 * `ctx.exit()`, the user presses Ctrl+C, or stdin ends.
 *
 * `input`/`output` default to `process.stdin`/`process.stdout` but accept
 * any readable/writable stream (e.g. a `PassThrough` in tests) — raw mode
 * and mouse tracking are only engaged when the stream actually looks like a
 * TTY (has a callable `setRawMode`), so this works headlessly too.
 */
export function runInteractiveApp(
  source: string,
  options: InteractiveAppOptions = {},
): Promise<Record<string, string>> {
  const input = options.input ?? process.stdin;
  const output = options.output ?? process.stdout;
  const diags = options.diags ?? new Diagnostics();
  const format = options.format ?? "html";
  const sanitize = options.sanitize ?? {};
  const handlers = options.handlers ?? {};
  const useMouse = options.mouse ?? true;

  const outIsTTY = Boolean((output as Partial<NodeJS.WriteStream>).isTTY);
  const caps = detectCapabilities(
    { width: options.width },
    process.env,
    outIsTTY,
    (output as Partial<NodeJS.WriteStream>).columns,
  );
  const baseTheme = loadTheme(options.theme ?? "auto", diags);
  const theme = applyMetaRoles(baseTheme, {}, diags);
  const layout: SessionLayoutConfig = { width: caps.width, theme, caps };

  const raw = parseSource(source, format, sanitize, diags);
  const session = new InteractiveSession(normalize(raw, diags), { diags, layout, sanitize });

  return new Promise((resolve) => {
    let settled = false;
    // Assigned once below, but referenced by closures defined earlier that
    // only run after the assignment — `const` isn't an option since it
    // requires the initializer at the declaration site.
    // eslint-disable-next-line prefer-const
    let lifecycle: TerminalLifecycle | undefined;
    let escapeTimer: ReturnType<typeof setTimeout> | undefined;
    const decoder = createInputDecoder();

    const dispatchInput = (event: TerminalInputEvent): void => {
      switch (event.type) {
        case "interrupt":
        case "end":
          send({ type: "exit" });
          break;
        case "pointer":
          if (event.button === 0) send({ type: "pointer", row: event.row, col: event.col });
          break;
        case "wheel":
          send({ type: "key", key: event.delta < 0 ? "shiftTab" : "tab" });
          break;
        case "char":
          send({ type: "char", char: event.char });
          break;
        case "key": {
          const key =
            event.key === "up"
              ? "shiftTab"
              : event.key === "down"
                ? "tab"
                : event.key === "pageUp"
                  ? "shiftTab"
                  : event.key === "pageDown"
                    ? "tab"
                    : event.key === "home" || event.key === "end"
                      ? undefined
                      : event.key;
          if (key) send({ type: "key", key });
          break;
        }
        case "resize":
          break;
      }
    };

    const onData = (data: Buffer | string): void => {
      if (escapeTimer) clearTimeout(escapeTimer);
      for (const event of decoder.push(data)) dispatchInput(event);
      escapeTimer = setTimeout(() => {
        for (const event of decoder.flush()) dispatchInput(event);
      }, 25);
    };

    const cleanup = (): void => {
      if (escapeTimer) clearTimeout(escapeTimer);
      input.removeListener("data", onData);
      input.removeListener("end", finish);
      lifecycle?.cleanup();
    };

    function finish(): void {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(session.values());
    }

    const ctx: InteractiveAppContext = {
      exit: finish,
      render: (src, fmt) => {
        for (const event of session.handle({
          type: "render",
          markup: src,
          format: fmt ?? format,
        })) {
          dispatch(event);
        }
      },
      values: () => session.values(),
    };

    function dispatch(event: SessionEvent): void {
      switch (event.type) {
        case "frame":
          output.write(TERMINAL_CONTROL.clearScreen);
          output.write(caps.colors !== "none" ? event.ansi : event.plain);
          if (options.footer) output.write(`\n${options.footer}\n`);
          break;
        case "change":
          handlers.onChange?.(event.id, event.value, ctx);
          break;
        case "toggle":
          handlers.onToggle?.(event.id, event.checked, ctx);
          break;
        case "click":
          handlers.onClick?.(event.id, event.values, ctx);
          break;
        case "error":
          handlers.onError?.(event.message, ctx);
          break;
        case "exit":
          finish();
          break;
      }
    }

    function send(command: Command): void {
      for (const event of session.handle(command)) dispatch(event);
    }

    lifecycle = enterTerminal({
      input,
      output,
      alternateScreen: false,
      hideCursor: false,
      mouse: useMouse,
      onSignal: finish,
    });
    input.on("data", onData);
    input.on("end", finish);

    for (const event of session.start()) dispatch(event);
  });
}

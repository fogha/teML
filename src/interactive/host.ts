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
import stringWidth from "string-width";
import { htmlToDoc } from "../html/index.js";
import { parseMarkdown } from "../markdown/parse.js";
import { parseTeml } from "../teml/parse.js";
import { TERMINAL_CONTROL } from "../render/ansi.js";
import { detectCapabilities, MIN_TERMINAL_WIDTH } from "../terminal/capabilities.js";
import { createInputDecoder, type TerminalInputEvent } from "../terminal/client/input.js";
import { enterTerminal, type TerminalLifecycle } from "../terminal/client/lifecycle.js";
import { applyMetaRoles, loadTheme } from "../terminal/theme.js";
import { InteractiveSession, type SessionLayoutConfig } from "./session.js";
import type { Command, DocFormat, SessionEvent } from "./protocol.js";
import { MAX_SCROLL_ROWS } from "./protocol.js";

export {
  decodeCommand,
  encodeEvent,
  ENGINE_CAPABILITIES,
  hasProtocolCapability,
  MAX_CHAR_BYTES,
  MAX_DOCUMENT_BLOCKS,
  MAX_MUTATION_TARGET_CHILDREN,
  MAX_NDJSON_LINE_BYTES,
  MAX_RENDER_MARKUP_BYTES,
  MAX_SCROLL_ROWS,
  NdjsonSplitter,
  PROTOCOL_VERSION,
  readProtocolMetadata,
} from "./protocol.js";
export type {
  Command,
  DecodeResult,
  DocFormat,
  FrameFormat,
  FrameMode,
  FramePatch,
  FullFrame,
  KeyModifiers,
  KeyName,
  PatchFrame,
  ProtocolCapability,
  ProtocolMetadata,
  ProtocolVersion,
  ScrollRegionMeta,
  SessionEvent,
  ViewportMeta,
} from "./protocol.js";

/** Passed to every handler so it can act on the live session without reaching into internals. */
export type InteractiveAppContext = {
  /** Ends the interactive loop; runInteractiveApp's promise resolves with the final values. */
  exit(): void;
  /** Swaps in a new document — e.g. moving to another "screen" of a multi-step app. */
  render(source: string, format?: DocFormat): void;
  /** Replaces one addressable container block with normalized fragment blocks. */
  replace(target: string, source: string, format?: DocFormat): void;
  /** Appends normalized fragment blocks to an addressable container. */
  append(target: string, source: string, format?: DocFormat): void;
  /** Removes one addressable container and its subtree. */
  remove(target: string): void;
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
  /** Maximum live terminal width. Values below 20 remain fixed because live
   * resize commands use the protocol's 20-column terminal minimum. */
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

function reservedFooterRows(footer: string | undefined, columns: number): number {
  if (!footer) return 0;
  // dispatch() writes one blank separator before the footer, followed by
  // each physical footer line (including terminal wrapping).
  const width = Math.max(1, columns);
  return (
    footer
      .split(/\r?\n/)
      .reduce((rows, line) => rows + Math.max(1, Math.ceil(stringWidth(line) / width)), 0) + 1
  );
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
  const outputTty = output as NodeJS.WritableStream & Partial<NodeJS.WriteStream>;

  const outIsTTY = Boolean(outputTty.isTTY);
  const caps = detectCapabilities(
    { width: options.width },
    process.env,
    outIsTTY,
    outputTty.columns,
  );
  const baseTheme = loadTheme(options.theme ?? "auto", diags);
  const theme = applyMetaRoles(baseTheme, {}, diags);
  const initialTerminalWidth = Math.max(1, outputTty.columns ?? caps.width);
  const footerRows = reservedFooterRows(options.footer, initialTerminalWidth);
  const terminalRows = Math.max(1, outputTty.rows ?? 24);
  const layout: SessionLayoutConfig = {
    width: caps.width,
    height: Math.max(1, terminalRows - footerRows),
    theme,
    caps,
  };
  const liveResizeEnabled = options.width == null || options.width >= MIN_TERMINAL_WIDTH;

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
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingWheelRows = 0;
    let lastResize = { width: layout.width, height: layout.height ?? 24 };
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
          pendingWheelRows = Math.max(
            -MAX_SCROLL_ROWS,
            Math.min(MAX_SCROLL_ROWS, pendingWheelRows + event.delta * 3),
          );
          if (!wheelTimer) {
            wheelTimer = setTimeout(() => {
              wheelTimer = undefined;
              const rows = pendingWheelRows;
              pendingWheelRows = 0;
              if (!settled && rows !== 0) send({ type: "scroll", rows });
            }, 16);
          }
          break;
        case "char":
          send({ type: "char", char: event.char });
          break;
        case "key":
          send({
            type: "key",
            key: event.key,
            ...(event.modifiers ? { modifiers: event.modifiers } : {}),
          });
          break;
        case "resize":
          send({ type: "resize", width: event.cols, height: event.rows });
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

    const dimensions = (): { width: number; height: number } => {
      const terminalWidth = Math.max(1, outputTty.columns ?? caps.width);
      const reservedRows = reservedFooterRows(options.footer, terminalWidth);
      return {
        width: Math.min(options.width ?? Number.MAX_SAFE_INTEGER, terminalWidth),
        height: Math.max(1, (outputTty.rows ?? lastResize.height + reservedRows) - reservedRows),
      };
    };

    const flushResize = (): void => {
      resizeTimer = undefined;
      if (settled) return;
      const next = dimensions();
      if (next.width === lastResize.width && next.height === lastResize.height) return;
      lastResize = next;
      dispatchInput({ type: "resize", cols: next.width, rows: next.height });
    };

    const onResize = (): void => {
      if (!liveResizeEnabled || settled) return;
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(flushResize, 75);
    };

    const cleanup = (): void => {
      if (escapeTimer) clearTimeout(escapeTimer);
      if (resizeTimer) clearTimeout(resizeTimer);
      if (wheelTimer) clearTimeout(wheelTimer);
      input.removeListener("data", onData);
      input.removeListener("end", finish);
      output.removeListener("resize", onResize);
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
        send({
          type: "render",
          markup: src,
          format: fmt ?? format,
        });
      },
      replace: (target, src, fmt) =>
        send({ type: "replace", target, markup: src, format: fmt ?? format }),
      append: (target, src, fmt) =>
        send({ type: "append", target, markup: src, format: fmt ?? format }),
      remove: (target) => send({ type: "remove", target }),
      values: () => session.values(),
    };

    function dispatch(event: SessionEvent): void {
      switch (event.type) {
        case "frame": {
          // In-process sessions never negotiate patches mode, so every frame
          // here is a complete render.
          if ("patches" in event) break;
          output.write(TERMINAL_CONTROL.clearScreen);
          // With format negotiation a frame may carry only one payload;
          // fall back to whichever is present.
          const preferred = caps.colors !== "none" ? event.ansi : event.plain;
          output.write(preferred ?? event.ansi ?? event.plain ?? "");
          if (options.footer) output.write(`\n${options.footer}\n`);
          break;
        }
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
    if (liveResizeEnabled) output.on("resize", onResize);

    for (const event of session.start()) dispatch(event);
  });
}

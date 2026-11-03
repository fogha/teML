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
// into Commands itself (the same decoding `examples/interactive/interactive-host.mjs`
// does for the subprocess case), calls `session.handle()` directly — no
// JSON in between — and dispatches the resulting events to typed callbacks
// instead of writing NDJSON to a pipe.

import { Diagnostics, type SanitizeOpts } from "../core/index.js";
import stringWidth from "string-width";
import { documentCompilers } from "../document/frontends.js";
import { TERMINAL_CONTROL } from "../render/ansi.js";
import { detectCapabilities, MIN_TERMINAL_WIDTH } from "../terminal/capabilities.js";
import type { TerminalInputEvent } from "../terminal/client/input.js";
import { createTerminalDriver, type TerminalDriver } from "../terminal/client/driver.js";
import { applyMetaRoles, loadTheme } from "../terminal/theme.js";
import { InteractiveSession, type SessionLayoutConfig } from "./session.js";
import { LatestResizeScheduler } from "./resize-scheduler.js";
import { ATTACH_BINDING_SINK, bindings, type Bindings } from "./bindings.js";
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

export { bindings, type Bindings };

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
  /** Mutates one live updatable widget (`::metric`/`::progress`) by id. */
  update(id: string, props: Record<string, string>): void;
  /** Current value of every focusable widget (id -> value; checkboxes as "true"/"false"). */
  values(): Record<string, string>;
};

export type InteractiveAppHandlers = {
  onChange?(id: string, value: string, ctx: InteractiveAppContext): void;
  onToggle?(id: string, checked: boolean, ctx: InteractiveAppContext): void;
  onClick?(id: string, values: Record<string, string>, ctx: InteractiveAppContext): void;
  /** A `::button{submit}` inside a `:::form` activated with every field valid.
   * Inside a form this fires *instead of* `onClick`; forms are the opt-in
   * boundary, so a host with only `onClick` keeps working on form-free
   * documents. */
  onSubmit?(form: string, values: Record<string, string>, ctx: InteractiveAppContext): void;
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
  /** Id-keyed binding set; assigning a string to a key mutates that widget live. */
  state?: Bindings;
};

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
export async function runInteractiveApp(
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

  const doc = documentCompilers[format].document(source, diags, { sanitize });
  const session = new InteractiveSession(doc, { diags, layout, sanitize });

  return new Promise((resolve, reject) => {
    let settled = false;
    // Setup callbacks can finish the app before driver acquisition returns.
    let driver: TerminalDriver | undefined;
    let detachBindings: (() => void) | undefined;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingWheelRows = 0;
    /** Commands a handler asked for while its own command was being dispatched. */
    const queued: Command[] = [];
    let dispatching = false;
    const resizeScheduler = new LatestResizeScheduler((next) => {
      try {
        send({ type: "resize", width: next.width, height: next.height });
      } finally {
        resizeScheduler.complete();
      }
    });

    const dispatchInput = (event: TerminalInputEvent): void => {
      if (settled) return;
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
          onResize();
          break;
      }
    };

    const dimensions = (): { width: number; height: number } => {
      const terminalWidth = Math.max(1, outputTty.columns ?? caps.width);
      const reservedRows = reservedFooterRows(options.footer, terminalWidth);
      return {
        width: Math.min(options.width ?? Number.MAX_SAFE_INTEGER, terminalWidth),
        height: Math.max(
          1,
          (outputTty.rows ?? (layout.height ?? 24) + reservedRows) - reservedRows,
        ),
      };
    };

    const onResize = (): void => {
      if (!liveResizeEnabled || settled) return;
      resizeScheduler.request(dimensions());
    };

    const cleanup = (): void => {
      resizeScheduler.stop();
      if (wheelTimer) clearTimeout(wheelTimer);
      queued.length = 0;
      detachBindings?.();
      driver?.stop();
    };

    function finish(error?: Error): void {
      if (settled) return;
      settled = true;
      cleanup();
      session.handle({ type: "exit" });
      if (error) reject(error);
      else resolve(session.values());
    }

    function fail(cause: unknown): void {
      finish(cause instanceof Error ? cause : new Error(String(cause)));
    }

    // Callbacks remain non-blocking: commands issued synchronously retain their
    // event-batch ordering, while returned promises have supervised rejection.
    function observe(result: unknown): void {
      if (result != null) void Promise.resolve(result).catch(fail);
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
      update: (id, props) => send({ type: "update", id, props }),
      values: () => session.values(),
    };

    function dispatch(event: SessionEvent): void {
      if (settled) return;
      switch (event.type) {
        case "frame": {
          // In-process sessions never negotiate patches mode, so every frame
          // here is a complete render.
          if ("patches" in event) break;
          // With format negotiation a frame may carry only one payload;
          // fall back to whichever is present.
          const preferred = caps.colors !== "none" ? event.ansi : event.plain;
          driver?.paintRendered(
            TERMINAL_CONTROL.clearScreen +
              (preferred ?? event.ansi ?? event.plain ?? "") +
              (options.footer ? `\n${options.footer}\n` : ""),
          );
          break;
        }
        case "change":
          observe(handlers.onChange?.(event.id, event.value, ctx));
          break;
        case "toggle":
          observe(handlers.onToggle?.(event.id, event.checked, ctx));
          break;
        case "click":
          observe(handlers.onClick?.(event.id, event.values, ctx));
          break;
        case "submit":
          observe(handlers.onSubmit?.(event.form, event.values, ctx));
          break;
        case "error":
          observe(handlers.onError?.(event.message, ctx));
          break;
        case "exit":
          finish();
          break;
        default: {
          // Forward compatibility: an engine newer than this host may emit an
          // event type this switch does not know. Surface it and keep the loop
          // alive rather than dropping it silently.
          const unknown = (event as { type?: string }).type ?? "unknown";
          const message = `unrecognized session event '${unknown}'`;
          if (handlers.onError) handlers.onError(message, ctx);
          else if (!settled) process.stderr.write(`${message}\n`);
          break;
        }
      }
    }

    // `session.handle()` builds its whole event array before returning, so the
    // frame for the triggering command already exists while a handler runs. A
    // handler's own command must therefore wait until that array is fully
    // dispatched, or its fresh frame would be painted and then immediately
    // overwritten by the stale one. This matches the queueing contract the
    // Rust/Go/Python drivers follow over the wire.
    function send(command: Command): void {
      if (settled) return;
      if (dispatching) {
        queued.push(command);
        return;
      }
      dispatching = true;
      try {
        let next: Command | undefined = command;
        while (next && !settled) {
          for (const event of session.handle(next)) dispatch(event);
          next = queued.shift();
        }
      } catch (cause) {
        fail(cause);
      } finally {
        dispatching = false;
        queued.length = 0;
      }
    }

    // Assignment to a binding is the notification: it routes through `send`
    // so a value set from a handler is queued behind the frame already built
    // for the triggering command, exactly like the context actions above.
    try {
      detachBindings = options.state?.[ATTACH_BINDING_SINK]((id, value) => {
        send({ type: "update", id, props: { value } });
      });
      driver = createTerminalDriver({
        input,
        output,
        caps,
        alternateScreen: false,
        hideCursor: false,
        mouse: useMouse,
        onEvent: dispatchInput,
        onError: fail,
      });
      if (settled) driver.stop();
      else for (const event of session.start()) dispatch(event);
    } catch (cause) {
      fail(cause);
    }
  });
}

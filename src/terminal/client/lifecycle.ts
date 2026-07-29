import { TERMINAL_CONTROL } from "../../render/ansi.js";

export type TerminalReadable = NodeJS.ReadableStream & Partial<NodeJS.ReadStream>;
export type TerminalWritable = NodeJS.WritableStream & Partial<NodeJS.WriteStream>;

export type TerminalLifecycleOptions = {
  input: TerminalReadable;
  output: TerminalWritable;
  alternateScreen?: boolean;
  mouse?: boolean;
  hideCursor?: boolean;
  signals?: boolean;
  onSignal?: (signal: NodeJS.Signals) => void;
};

export type TerminalLifecycle = {
  cleanup(): void;
  readonly active: boolean;
};

function safeWrite(output: TerminalWritable, value: string): void {
  try {
    output.write(value);
  } catch {
    // Cleanup must remain best-effort and idempotent after output failure.
  }
}

export function enterTerminal(options: TerminalLifecycleOptions): TerminalLifecycle {
  const alternateScreen = options.alternateScreen ?? true;
  const mouse = options.mouse ?? true;
  const hideCursor = options.hideCursor ?? true;
  const useSignals = options.signals ?? true;
  const canRawMode = typeof options.input.setRawMode === "function";
  let active = true;

  const signalHandlers = new Map<NodeJS.Signals, () => void>();

  const cleanup = (): void => {
    if (!active) return;
    active = false;
    for (const [signal, handler] of signalHandlers) process.removeListener(signal, handler);
    if (mouse) safeWrite(options.output, TERMINAL_CONTROL.mouseOff);
    if (hideCursor) safeWrite(options.output, TERMINAL_CONTROL.showCursor);
    if (alternateScreen) safeWrite(options.output, TERMINAL_CONTROL.altScreenLeave);
    if (canRawMode) {
      try {
        options.input.setRawMode!(false);
      } catch {
        // A closed input stream may reject mode changes.
      }
    }
    options.input.pause();
  };

  try {
    if (alternateScreen) safeWrite(options.output, TERMINAL_CONTROL.altScreenEnter);
    if (hideCursor) safeWrite(options.output, TERMINAL_CONTROL.hideCursor);
    if (mouse) safeWrite(options.output, TERMINAL_CONTROL.mouseOn);
    if (canRawMode) options.input.setRawMode!(true);
    options.input.resume();
    options.input.setEncoding?.("utf8");
  } catch (error) {
    // setRawMode can reject a stream the alternate-screen and mouse writes
    // already succeeded on. Without this the caller's terminal is left on the
    // alternate buffer with a hidden cursor and mouse reporting still enabled.
    cleanup();
    throw error;
  }

  if (useSignals) {
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      const handler = (): void => {
        options.onSignal?.(signal);
        cleanup();
      };
      signalHandlers.set(signal, handler);
      process.on(signal, handler);
    }
  }

  return {
    cleanup,
    get active() {
      return active;
    },
  };
}

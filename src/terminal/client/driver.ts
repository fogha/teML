import { encodeScreenOps } from "../../render/ansi.js";
import { diffFrames, type ScreenFrame } from "../../render/screen.js";
import type { Capabilities } from "../capabilities.js";
import { createInputDecoder, type TerminalInputEvent } from "./input.js";
import {
  enterTerminal,
  type TerminalLifecycle,
  type TerminalLifecycleOptions,
  type TerminalWritable,
} from "./lifecycle.js";

export type TerminalDriverOptions = TerminalLifecycleOptions & {
  caps: Capabilities;
  onEvent(event: TerminalInputEvent): void;
  onError?(error: Error): void;
  escapeDelayMs?: number;
};

export type TerminalDriver = {
  paint(frame: ScreenFrame): void;
  /** Complete, already-encoded output from a trusted renderer (no damage diff). */
  paintRendered(text: string): void;
  resize(): void;
  stop(): void;
  readonly previousFrame: ScreenFrame | null;
};

export function createTerminalDriver(options: TerminalDriverOptions): TerminalDriver {
  const decoder = createInputDecoder();
  let previousFrame: ScreenFrame | null = null;
  let stopped = false;
  let escapeTimer: ReturnType<typeof setTimeout> | null = null;
  let lifecycle: TerminalLifecycle | undefined;

  const fail = (cause: unknown): void => {
    if (stopped) return;
    stop();
    options.onError?.(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const guard = (action: () => void): void => {
    if (stopped) return;
    try {
      action();
    } catch (cause) {
      fail(cause);
    }
  };

  const emit = (events: TerminalInputEvent[]): void => {
    for (const event of events) {
      if (stopped) break;
      guard(() => options.onEvent(event));
    }
  };

  const clearEscapeTimer = (): void => {
    if (escapeTimer) clearTimeout(escapeTimer);
    escapeTimer = null;
  };

  const onData = (chunk: Buffer | string): void => {
    guard(() => {
      clearEscapeTimer();
      emit(decoder.push(chunk));
      if (!stopped)
        escapeTimer = setTimeout(() => {
          escapeTimer = null;
          guard(() => emit(decoder.flush()));
        }, options.escapeDelayMs ?? 25);
    });
  };

  const onEnd = (): void => {
    guard(() => {
      clearEscapeTimer();
      emit(decoder.flush());
      emit([{ type: "end" }]);
    });
  };

  const dimensions = (): { cols: number; rows: number } => {
    const output = options.output as TerminalWritable;
    return {
      cols: Math.max(1, output.columns ?? options.caps.width),
      rows: Math.max(1, output.rows ?? 24),
    };
  };

  const onResize = (): void => {
    guard(() => emit([{ type: "resize", ...dimensions() }]));
  };

  const onStreamError = (error: Error): void => fail(error);
  const onOutputClose = (): void => fail(new Error("terminal output closed"));

  options.input.on("data", onData);
  options.input.on("end", onEnd);
  options.input.on("close", onEnd);
  options.input.on("error", onStreamError);
  options.output.on?.("resize", onResize);
  options.output.on?.("error", onStreamError);
  options.output.on?.("close", onOutputClose);

  try {
    lifecycle = enterTerminal({
      ...options,
      onSignal: (signal) =>
        guard(() => {
          options.onSignal?.(signal);
          emit([{ type: "interrupt" }]);
        }),
    });
    // A synchronous stream callback may stop the driver during acquisition.
    if (stopped) lifecycle.cleanup();
  } catch (cause) {
    stop();
    throw cause;
  }

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearEscapeTimer();
    options.input.removeListener("data", onData);
    options.input.removeListener("end", onEnd);
    options.input.removeListener("close", onEnd);
    options.input.removeListener("error", onStreamError);
    options.output.removeListener?.("resize", onResize);
    lifecycle?.cleanup();
    options.output.removeListener?.("error", onStreamError);
    options.output.removeListener?.("close", onOutputClose);
  }

  return {
    paint(frame) {
      guard(() => {
        options.output.write(encodeScreenOps(diffFrames(previousFrame, frame), options.caps));
        if (!stopped) previousFrame = frame;
      });
    },
    paintRendered(text) {
      guard(() => {
        previousFrame = null;
        options.output.write(text);
      });
    },
    resize: onResize,
    stop,
    get previousFrame() {
      return previousFrame;
    },
  };
}

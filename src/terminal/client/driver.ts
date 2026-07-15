import { encodeScreenOps } from "../../render/ansi.js";
import { diffFrames, type ScreenFrame } from "../../render/screen.js";
import type { Capabilities } from "../capabilities.js";
import { createInputDecoder, type TerminalInputEvent } from "./input.js";
import {
  enterTerminal,
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
  resize(): void;
  stop(): void;
  readonly previousFrame: ScreenFrame | null;
};

export function createTerminalDriver(options: TerminalDriverOptions): TerminalDriver {
  const decoder = createInputDecoder();
  let previousFrame: ScreenFrame | null = null;
  let stopped = false;
  let escapeTimer: ReturnType<typeof setTimeout> | null = null;

  const lifecycle = enterTerminal({
    ...options,
    onSignal: (signal) => {
      options.onSignal?.(signal);
      options.onEvent({ type: "interrupt" });
    },
  });

  const emit = (events: TerminalInputEvent[]): void => {
    for (const event of events) options.onEvent(event);
  };

  const clearEscapeTimer = (): void => {
    if (escapeTimer) clearTimeout(escapeTimer);
    escapeTimer = null;
  };

  const onData = (chunk: Buffer | string): void => {
    clearEscapeTimer();
    emit(decoder.push(chunk));
    escapeTimer = setTimeout(() => emit(decoder.flush()), options.escapeDelayMs ?? 25);
  };

  const onEnd = (): void => {
    emit(decoder.flush());
    options.onEvent({ type: "end" });
  };

  const dimensions = (): { cols: number; rows: number } => {
    const output = options.output as TerminalWritable;
    return {
      cols: Math.max(1, output.columns ?? options.caps.width),
      rows: Math.max(1, output.rows ?? 24),
    };
  };

  const onResize = (): void => {
    options.onEvent({ type: "resize", ...dimensions() });
  };

  const onOutputError = (error: Error): void => {
    options.onError?.(error);
    stop();
  };

  options.input.on("data", onData);
  options.input.on("end", onEnd);
  options.output.on?.("resize", onResize);
  options.output.on?.("error", onOutputError);

  function stop(): void {
    if (stopped) return;
    stopped = true;
    clearEscapeTimer();
    options.input.removeListener("data", onData);
    options.input.removeListener("end", onEnd);
    options.output.removeListener?.("resize", onResize);
    options.output.removeListener?.("error", onOutputError);
    lifecycle.cleanup();
  }

  return {
    paint(frame) {
      if (stopped) return;
      try {
        options.output.write(encodeScreenOps(diffFrames(previousFrame, frame), options.caps));
        previousFrame = frame;
      } catch (error) {
        onOutputError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    resize: onResize,
    stop,
    get previousFrame() {
      return previousFrame;
    },
  };
}

import { TERMINAL_CONTROL } from "../../render/ansi.js";

export type TerminalKey =
  | "tab"
  | "shiftTab"
  | "enter"
  | "escape"
  | "backspace"
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageUp"
  | "pageDown"
  | "home"
  | "end";

export type TerminalInputEvent =
  | { type: "key"; key: TerminalKey }
  | { type: "char"; char: string }
  | { type: "pointer"; row: number; col: number; button: number }
  | { type: "wheel"; delta: -1 | 1 }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }
  | { type: "end" };

export type InputDecoder = {
  push(chunk: string | Buffer): TerminalInputEvent[];
  /** Resolve a pending standalone Escape key. */
  flush(): TerminalInputEvent[];
  reset(): void;
};

const ESC = TERMINAL_CONTROL.escByte;
const SGR_MOUSE_RE = new RegExp(`^${ESC}\\[<(\\d+);(\\d+);(\\d+)([Mm])`);
const CSI_KEYS: Record<string, TerminalKey> = {
  [`${ESC}[A`]: "up",
  [`${ESC}[B`]: "down",
  [`${ESC}[C`]: "right",
  [`${ESC}[D`]: "left",
  [`${ESC}[H`]: "home",
  [`${ESC}[F`]: "end",
  [`${ESC}[1~`]: "home",
  [`${ESC}[4~`]: "end",
  [`${ESC}[5~`]: "pageUp",
  [`${ESC}[6~`]: "pageDown",
  [`${ESC}[Z`]: "shiftTab",
  [`${ESC}[1;3D`]: "left",
  [`${ESC}[1;3C`]: "right",
};
const CSI_PREFIXES = new Set(
  Object.keys(CSI_KEYS).flatMap((sequence) =>
    Array.from({ length: sequence.length - 1 }, (_, index) => sequence.slice(0, index + 1)),
  ),
);

export function createInputDecoder(): InputDecoder {
  let pending = "";

  const decode = (final: boolean): TerminalInputEvent[] => {
    const events: TerminalInputEvent[] = [];
    while (pending.length > 0) {
      const mouse = SGR_MOUSE_RE.exec(pending);
      if (mouse) {
        const [whole, buttonText, colText, rowText, state] = mouse;
        const button = Number(buttonText);
        if (state === "M") {
          if (button === 64) events.push({ type: "wheel", delta: -1 });
          else if (button === 65) events.push({ type: "wheel", delta: 1 });
          else
            events.push({
              type: "pointer",
              row: Math.max(0, Number(rowText) - 1),
              col: Math.max(0, Number(colText) - 1),
              button,
            });
        }
        pending = pending.slice(whole.length);
        continue;
      }

      const keySequence = Object.keys(CSI_KEYS).find((sequence) => pending.startsWith(sequence));
      if (keySequence) {
        events.push({ type: "key", key: CSI_KEYS[keySequence]! });
        pending = pending.slice(keySequence.length);
        continue;
      }

      if (
        !final &&
        (pending === ESC || CSI_PREFIXES.has(pending) || pending.startsWith(`${ESC}[<`))
      ) {
        break;
      }

      const first = Array.from(pending)[0]!;
      if (first === "\u0003") events.push({ type: "interrupt" });
      else if (first === "\t") events.push({ type: "key", key: "tab" });
      else if (first === "\r" || first === "\n") events.push({ type: "key", key: "enter" });
      else if (first === "\u007f" || first === "\b") events.push({ type: "key", key: "backspace" });
      else if (first === ESC) {
        events.push({ type: "key", key: "escape" });
        if (pending.startsWith(`${ESC}[`)) {
          const terminator = pending.slice(2).search(/[A-Za-z~]/);
          pending = terminator >= 0 ? pending.slice(terminator + 3) : "";
          continue;
        }
      } else {
        events.push({ type: "char", char: first });
      }
      pending = pending.slice(first.length);
    }
    return events;
  };

  return {
    push(chunk) {
      pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      return decode(false);
    },
    flush() {
      return decode(true);
    },
    reset() {
      pending = "";
    },
  };
}

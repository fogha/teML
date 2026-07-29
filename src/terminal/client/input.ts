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
  | "end"
  | "delete"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12";

export type TerminalKeyModifiers = {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

export type TerminalInputEvent =
  | { type: "key"; key: TerminalKey; modifiers?: TerminalKeyModifiers }
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
const SS3_KEYS: Record<string, TerminalKey> = {
  [`${ESC}OA`]: "up",
  [`${ESC}OB`]: "down",
  [`${ESC}OC`]: "right",
  [`${ESC}OD`]: "left",
  [`${ESC}OH`]: "home",
  [`${ESC}OF`]: "end",
  [`${ESC}OP`]: "f1",
  [`${ESC}OQ`]: "f2",
  [`${ESC}OR`]: "f3",
  [`${ESC}OS`]: "f4",
};
const CSI_FINAL_KEYS: Partial<Record<string, TerminalKey>> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  Z: "shiftTab",
};
const TILDE_KEYS: Partial<Record<number, TerminalKey>> = {
  1: "home",
  3: "delete",
  4: "end",
  5: "pageUp",
  6: "pageDown",
  11: "f1",
  12: "f2",
  13: "f3",
  14: "f4",
  15: "f5",
  17: "f6",
  18: "f7",
  19: "f8",
  20: "f9",
  21: "f10",
  23: "f11",
  24: "f12",
};
const CSI_U_KEYS: Partial<Record<number, TerminalKey>> = {
  8: "backspace",
  9: "tab",
  13: "enter",
  27: "escape",
  127: "backspace",
};
const CSI_RE = new RegExp(`^${ESC}\\[([0-9;]*)([A-Za-z~])`);
const COMPLETE_CSI_RE = new RegExp(`^${ESC}\\[[0-9;<]*[A-Za-z~]`);

function xtermModifiers(parameter: number | undefined): TerminalKeyModifiers | undefined {
  if (parameter == null || parameter < 2 || parameter > 8) return undefined;
  const mask = parameter - 1;
  const modifiers: TerminalKeyModifiers = {};
  if ((mask & 1) !== 0) modifiers.shift = true;
  if ((mask & 2) !== 0) modifiers.alt = true;
  if ((mask & 4) !== 0) modifiers.ctrl = true;
  return modifiers;
}

function csiKey(
  input: string,
): { length: number; event: Extract<TerminalInputEvent, { type: "key" }> } | undefined {
  const match = CSI_RE.exec(input);
  if (!match) return undefined;
  const [whole, parametersText, final] = match;
  const parameters =
    parametersText === ""
      ? []
      : parametersText.split(";").map((part) => Number.parseInt(part || "1", 10));
  const key =
    final === "~"
      ? TILDE_KEYS[parameters[0] ?? 0]
      : final === "u"
        ? CSI_U_KEYS[parameters[0] ?? 0]
        : final === "Z" && parameters.length === 0
          ? "shiftTab"
          : CSI_FINAL_KEYS[final];
  if (!key) return undefined;
  const modifierParameter =
    final === "~"
      ? parameters.length > 1
        ? parameters[parameters.length - 1]
        : undefined
      : parameters.length > 1
        ? parameters[parameters.length - 1]
        : undefined;
  const modifiers = xtermModifiers(modifierParameter);
  return {
    length: whole.length,
    event: { type: "key", key, ...(modifiers ? { modifiers } : {}) },
  };
}

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

      const ss3Sequence = Object.keys(SS3_KEYS).find((sequence) => pending.startsWith(sequence));
      if (ss3Sequence) {
        events.push({ type: "key", key: SS3_KEYS[ss3Sequence]! });
        pending = pending.slice(ss3Sequence.length);
        continue;
      }

      const parsedKey = csiKey(pending);
      if (parsedKey) {
        events.push(parsedKey.event);
        pending = pending.slice(parsedKey.length);
        continue;
      }

      if (
        !final &&
        (pending === ESC ||
          pending === `${ESC}O` ||
          (pending.startsWith(`${ESC}[`) && !COMPLETE_CSI_RE.test(pending)))
      ) {
        break;
      }

      const first = Array.from(pending)[0]!;
      if (first === "\u0003") events.push({ type: "interrupt" });
      else if (first === "\t") events.push({ type: "key", key: "tab" });
      else if (first === "\r" || first === "\n") events.push({ type: "key", key: "enter" });
      else if (first === "\u007f" || first === "\b") events.push({ type: "key", key: "backspace" });
      else if (first === ESC) {
        if (pending.startsWith(`${ESC}[`)) {
          const unknown = COMPLETE_CSI_RE.exec(pending);
          if (unknown) {
            pending = pending.slice(unknown[0].length);
            continue;
          }
          events.push({ type: "key", key: "escape" });
          pending = "";
          continue;
        }
        if (pending.startsWith(`${ESC}O`)) {
          if (pending.length >= 3) {
            pending = pending.slice(3);
            continue;
          }
          events.push({ type: "key", key: "escape" });
          pending = "";
          continue;
        }
        events.push({ type: "key", key: "escape" });
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

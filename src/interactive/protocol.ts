// interactive/protocol.ts — NDJSON wire protocol for `teml run` (M-interactive
// step 6). teml is a pure NDJSON transform: it never touches the terminal
// directly. The host reads real keypresses (and mouse events, translated
// into `pointer`) and a real TTY; it normalizes them into `Command`s and
// pipes them to teml's stdin, one JSON object per line. teml replies on
// stdout with `SessionEvent`s — semantic events (change/toggle/click)
// followed by a `frame` carrying both plain and ANSI renders, so the host
// can display whichever it can support.
//
// `pointer` carries the 0-indexed (row, col) of a click within the last
// frame's text; teml resolves it to whichever focusable widget rendered at
// that row using layout/hits.ts, focuses it, and activates it (same as
// Enter) if it's a button/checkbox. Column hit-testing is not implemented
// in v1 — see layout/hits.ts's header for why and what that means in
// practice (row-only disambiguation).
//
// This module is pure wire format: no session state, no terminal I/O, no
// imports from the rest of the pipeline. Malformed input never throws —
// decodeCommand reports a typed error so the caller can emit an `error`
// event and keep the session alive instead of crashing on one bad line.

export type KeyName = "tab" | "shiftTab" | "enter" | "backspace" | "escape" | "left" | "right";

/** Same three formats `teml convert`/`teml view` already accept via --from. */
export type DocFormat = "teml" | "markdown" | "html";

/** Messages the host sends to teml on stdin, one JSON object per line. */
export type Command =
  | { type: "key"; key: KeyName }
  | { type: "char"; char: string }
  | { type: "pointer"; row: number; col: number }
  | { type: "render"; markup: string; format?: DocFormat }
  | { type: "exit" };

/** Messages teml sends to the host on stdout, one JSON object per line. */
export type SessionEvent =
  | { type: "frame"; seq: number; focusedId: string | null; plain: string; ansi: string }
  | { type: "change"; id: string; value: string }
  | { type: "toggle"; id: string; checked: boolean }
  | { type: "click"; id: string; values: Record<string, string> }
  | { type: "error"; message: string }
  | { type: "exit" };

export type DecodeResult = { ok: true; command: Command } | { ok: false; error: string };

const KEY_NAMES: ReadonlySet<string> = new Set([
  "tab",
  "shiftTab",
  "enter",
  "backspace",
  "escape",
  "left",
  "right",
]);
const DOC_FORMATS: ReadonlySet<string> = new Set(["teml", "markdown", "html"]);
const MAX_ERROR_SNIPPET = 80;

function snippet(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_ERROR_SNIPPET ? `${trimmed.slice(0, MAX_ERROR_SNIPPET)}…` : trimmed;
}

/** Decode one NDJSON line into a Command. Never throws — see module header. */
export function decodeCommand(line: string): DecodeResult {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return { ok: false, error: `malformed JSON: ${snippet(line)}` };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: `command must be a JSON object: ${snippet(line)}` };
  }

  const obj = raw as Record<string, unknown>;
  switch (obj.type) {
    case "key":
      if (typeof obj.key !== "string" || !KEY_NAMES.has(obj.key)) {
        return {
          ok: false,
          error: `key command needs a valid "key" (got ${JSON.stringify(obj.key)})`,
        };
      }
      return { ok: true, command: { type: "key", key: obj.key as KeyName } };

    case "char":
      if (typeof obj.char !== "string" || obj.char.length === 0) {
        return { ok: false, error: 'char command needs a non-empty "char" string' };
      }
      return { ok: true, command: { type: "char", char: obj.char } };

    case "pointer": {
      if (typeof obj.row !== "number" || !Number.isInteger(obj.row) || obj.row < 0) {
        return {
          ok: false,
          error: `pointer command needs a non-negative integer "row" (got ${JSON.stringify(obj.row)})`,
        };
      }
      if (typeof obj.col !== "number" || !Number.isInteger(obj.col) || obj.col < 0) {
        return {
          ok: false,
          error: `pointer command needs a non-negative integer "col" (got ${JSON.stringify(obj.col)})`,
        };
      }
      return { ok: true, command: { type: "pointer", row: obj.row, col: obj.col } };
    }

    case "render": {
      if (typeof obj.markup !== "string") {
        return { ok: false, error: 'render command needs a "markup" string' };
      }
      if (
        obj.format !== undefined &&
        (typeof obj.format !== "string" || !DOC_FORMATS.has(obj.format))
      ) {
        return {
          ok: false,
          error: `render command has unknown "format" (got ${JSON.stringify(obj.format)})`,
        };
      }
      return {
        ok: true,
        command: {
          type: "render",
          markup: obj.markup,
          format: obj.format as DocFormat | undefined,
        },
      };
    }

    case "exit":
      return { ok: true, command: { type: "exit" } };

    default:
      return { ok: false, error: `unknown command type ${JSON.stringify(obj.type)}` };
  }
}

/** Encode one event as a single NDJSON line, including the trailing newline. */
export function encodeEvent(event: SessionEvent): string {
  return `${JSON.stringify(event)}\n`;
}

/**
 * Buffers arbitrary stdin chunks into complete NDJSON lines. Node's stdin
 * "data" events don't align to line boundaries (a single JSON object can
 * arrive split across chunks, or several lines can arrive in one chunk), so
 * this is the one place that has to think about partial reads. Blank lines
 * (keepalives some hosts may send) are silently dropped.
 */
export class NdjsonSplitter {
  private buffer = "";

  /** Feed a raw chunk of text; returns zero or more complete, non-blank lines. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx).replace(/\r$/, "");
      this.buffer = this.buffer.slice(idx + 1);
      if (line.trim() !== "") lines.push(line);
    }
    return lines;
  }

  /** Whatever remains unterminated when the stream ends (e.g. no final \n). */
  flush(): string[] {
    const rest = this.buffer;
    this.buffer = "";
    return rest.trim() !== "" ? [rest] : [];
  }
}

// interactive/protocol.ts — NDJSON wire protocol for `teml run` (M-interactive
// step 6). teml is a pure NDJSON transform: it never touches the terminal
// directly. The host reads real keypresses (and mouse events, translated
// into `pointer`) and a real TTY; it normalizes them into `Command`s and
// pipes them to teml's stdin, one JSON object per line. teml replies on
// stdout with `SessionEvent`s — semantic events (change/toggle/click)
// followed by a negotiated full or row-patch `frame`.
//
// `pointer` carries the 0-indexed (row, col) of a click within the last
// frame's text; teml resolves it to whichever focusable widget rendered at
// that terminal-cell region using layout/hits.ts, focuses it, and activates
// it (same as Enter) if it's a button/checkbox. When a frame carries a
// viewport, pointer rows and patch rows are local to that visible buffer.
//
// This module is pure wire format: no session state, no terminal I/O, no
// imports from the rest of the pipeline. Malformed input never throws —
// decodeCommand reports a typed error so the caller can emit an `error`
// event and keep the session alive instead of crashing on one bad line.

export type KeyName =
  | "tab"
  | "shiftTab"
  | "enter"
  | "backspace"
  | "escape"
  | "left"
  | "right"
  | "up"
  | "down"
  | "home"
  | "end"
  | "delete"
  | "pageUp"
  | "pageDown"
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

export type KeyModifiers = {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
};

/** Same three formats `teml convert`/`teml view` already accept via --from. */
export type DocFormat = "teml" | "markdown" | "html";

/** Which frame payload a host wants: styled, unstyled, or (v1 default) both. */
export type FrameFormat = "ansi" | "plain" | "both";

/** How frames are emitted: complete re-renders (v1 default) or row-level diffs. */
export type FrameMode = "full" | "patches";

/** Protocol compatibility is independent from the Node package version.
 * Major changes are breaking; minor changes are additive and capability-gated. */
export const PROTOCOL_VERSION = { major: 1, minor: 3 } as const;
export type ProtocolVersion = { major: number; minor: number };

export type ProtocolCapability =
  | "frameFormats"
  | "patches"
  | "resize"
  | "viewport"
  | "pointerColumns"
  | "keyModifiers"
  | "scroll"
  | "contextualInput"
  | "radio"
  | "textarea"
  | "scrollRegions"
  | "update"
  | "documentMutations";

/** Finite capability vocabulary emitted by this engine version. */
export const ENGINE_CAPABILITIES: readonly ProtocolCapability[] = [
  "frameFormats",
  "patches",
  "resize",
  "viewport",
  "pointerColumns",
  "keyModifiers",
  "scroll",
  "contextualInput",
  "radio",
  "textarea",
  "scrollRegions",
  "update",
  "documentMutations",
];

/** Messages the host sends to teml on stdin, one JSON object per line. */
export type Command =
  | { type: "configure"; frames: FrameFormat; mode?: FrameMode }
  | { type: "key"; key: KeyName; modifiers?: KeyModifiers }
  | { type: "char"; char: string }
  | { type: "pointer"; row: number; col: number }
  | { type: "scroll"; rows: number }
  | { type: "resize"; width: number; height?: number }
  | { type: "render"; markup: string; format?: DocFormat }
  | { type: "update"; id: string; props: Record<string, string> }
  | { type: "replace"; target: string; markup: string; format?: DocFormat }
  | { type: "append"; target: string; markup: string; format?: DocFormat }
  | { type: "remove"; target: string }
  | { type: "exit" };

/** One changed row in a `patches`-mode frame: the row's full new content in
 * each negotiated format (`null` for the format negotiated away, mirroring
 * the full-frame convention). */
export type FramePatch = {
  row: number;
  plain: string | null;
  ansi: string | null;
};

/** Visible window into a larger laid-out document. Rows in frame payloads
 * and patches are local to this window; `offset` is the first document row. */
export type ViewportMeta = {
  offset: number;
  height: number;
  total: number;
};

/** Visible state for a fixed-height nested scroll container. */
export type ScrollRegionMeta = {
  id: string;
  offset: number;
  height: number;
  total: number;
};

export type ProtocolMetadata = {
  protocol: ProtocolVersion;
  capabilities: ProtocolCapability[];
};

/** A complete re-render of the document — the v1 frame shape. */
export type FullFrame = {
  type: "frame";
  seq: number;
  focusedId: string | null;
  plain: string | null;
  ansi: string | null;
  viewport?: ViewportMeta;
  scrollRegions?: ScrollRegionMeta[];
  protocol?: ProtocolVersion;
  capabilities?: ProtocolCapability[];
};

/** A row-level diff against the previous frame (`patches` mode). `rows` is
 * the total row count of the new frame: hosts apply each patch at its index
 * (extending as needed), then truncate/extend their screen to `rows`. */
export type PatchFrame = {
  type: "frame";
  seq: number;
  focusedId: string | null;
  rows: number;
  patches: FramePatch[];
  viewport?: ViewportMeta;
  scrollRegions?: ScrollRegionMeta[];
};

/** Messages teml sends to the host on stdout, one JSON object per line. */
export type SessionEvent =
  | FullFrame
  | PatchFrame
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
  "up",
  "down",
  "home",
  "end",
  "delete",
  "pageUp",
  "pageDown",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);
const KEY_MODIFIERS: ReadonlySet<string> = new Set(["ctrl", "alt", "shift"]);
const DOC_FORMATS: ReadonlySet<string> = new Set(["teml", "markdown", "html"]);
const FRAME_FORMATS: ReadonlySet<string> = new Set(["ansi", "plain", "both"]);
const FRAME_MODES: ReadonlySet<string> = new Set(["full", "patches"]);
const MAX_ERROR_SNIPPET = 80;
/** Resource limits are deliberately part of the wire contract. A host can
 * split input arbitrarily, so limits must be enforced before parse/layout. */
export const MAX_CHAR_BYTES = 64 * 1024;
export const MAX_RENDER_MARKUP_BYTES = 4 * 1024 * 1024;
export const MAX_NDJSON_LINE_BYTES = 8 * 1024 * 1024;
export const MAX_SCROLL_ROWS = 10_000;
/** Structural mutations reject growth beyond these normalized AST bounds. */
export const MAX_DOCUMENT_BLOCKS = 10_000;
export const MAX_MUTATION_TARGET_CHILDREN = 2_000;

/**
 * Shared markup budget check. `decodeCommand` is not the only way into a
 * session — `runInteractiveApp`'s context methods call `handle()` directly —
 * so the limit lives here and is applied on both paths rather than only at
 * the wire boundary.
 */
export function checkMarkupBudget(
  operation: "render" | "replace" | "append",
  markup: string,
): { ok: true } | { ok: false; error: string } {
  if (utf8Length(markup) > MAX_RENDER_MARKUP_BYTES) {
    return {
      ok: false,
      error: `${operation} command exceeds the ${MAX_RENDER_MARKUP_BYTES}-byte markup limit`,
    };
  }
  return { ok: true };
}

export function protocolMetadata(): ProtocolMetadata {
  return {
    protocol: { ...PROTOCOL_VERSION },
    capabilities: [...ENGINE_CAPABILITIES],
  };
}

/** Parse additive discovery fields without rejecting unknown future
 * capabilities. Missing/malformed metadata is treated as an older engine. */
export function readProtocolMetadata(value: unknown): ProtocolMetadata | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const protocol = record.protocol;
  const capabilities = record.capabilities;
  if (
    protocol === null ||
    typeof protocol !== "object" ||
    Array.isArray(protocol) ||
    !Number.isInteger((protocol as Record<string, unknown>).major) ||
    !Number.isInteger((protocol as Record<string, unknown>).minor) ||
    ((protocol as Record<string, number>).major ?? -1) < 0 ||
    ((protocol as Record<string, number>).minor ?? -1) < 0 ||
    !Array.isArray(capabilities)
  ) {
    return null;
  }
  const known = new Set<string>(ENGINE_CAPABILITIES);
  return {
    protocol: {
      major: (protocol as Record<string, number>).major,
      minor: (protocol as Record<string, number>).minor,
    },
    capabilities: capabilities.filter(
      (capability): capability is ProtocolCapability =>
        typeof capability === "string" && known.has(capability),
    ),
  };
}

export function hasProtocolCapability(
  metadata: ProtocolMetadata | null,
  capability: ProtocolCapability,
): boolean {
  return metadata?.capabilities.includes(capability) ?? false;
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

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
    case "configure":
      if (typeof obj.frames !== "string" || !FRAME_FORMATS.has(obj.frames)) {
        return {
          ok: false,
          error: `configure command needs "frames" of ansi|plain|both (got ${JSON.stringify(obj.frames)})`,
        };
      }
      if (obj.mode !== undefined && (typeof obj.mode !== "string" || !FRAME_MODES.has(obj.mode))) {
        return {
          ok: false,
          error: `configure command has unknown "mode" (got ${JSON.stringify(obj.mode)})`,
        };
      }
      return {
        ok: true,
        command: {
          type: "configure",
          frames: obj.frames as FrameFormat,
          mode: (obj.mode as FrameMode | undefined) ?? "full",
        },
      };

    case "key":
      if (typeof obj.key !== "string" || !KEY_NAMES.has(obj.key)) {
        return {
          ok: false,
          error: `key command needs a valid "key" (got ${JSON.stringify(obj.key)})`,
        };
      }
      if (
        obj.modifiers !== undefined &&
        (obj.modifiers === null ||
          typeof obj.modifiers !== "object" ||
          Array.isArray(obj.modifiers))
      ) {
        return { ok: false, error: 'key command "modifiers" must be an object when provided' };
      }
      if (obj.modifiers !== undefined) {
        const rawModifiers = obj.modifiers as Record<string, unknown>;
        for (const [name, value] of Object.entries(rawModifiers)) {
          if (!KEY_MODIFIERS.has(name) || typeof value !== "boolean") {
            return {
              ok: false,
              error: `key command has invalid modifier ${JSON.stringify(name)}`,
            };
          }
        }
      }
      return {
        ok: true,
        command: {
          type: "key",
          key: obj.key as KeyName,
          ...(obj.modifiers !== undefined ? { modifiers: obj.modifiers as KeyModifiers } : {}),
        },
      };

    case "char":
      if (typeof obj.char !== "string" || obj.char.length === 0) {
        return { ok: false, error: 'char command needs a non-empty "char" string' };
      }
      if (utf8Length(obj.char) > MAX_CHAR_BYTES) {
        return {
          ok: false,
          error: `char command exceeds the ${MAX_CHAR_BYTES}-byte limit`,
        };
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

    case "scroll": {
      if (
        typeof obj.rows !== "number" ||
        !Number.isInteger(obj.rows) ||
        Math.abs(obj.rows) > MAX_SCROLL_ROWS
      ) {
        return {
          ok: false,
          error: `scroll command needs integer "rows" between -${MAX_SCROLL_ROWS} and ${MAX_SCROLL_ROWS} (got ${JSON.stringify(obj.rows)})`,
        };
      }
      return { ok: true, command: { type: "scroll", rows: obj.rows } };
    }

    case "resize": {
      if (typeof obj.width !== "number" || !Number.isInteger(obj.width) || obj.width < 1) {
        return {
          ok: false,
          error: `resize command needs a positive integer "width" (got ${JSON.stringify(obj.width)})`,
        };
      }
      if (
        obj.height !== undefined &&
        (typeof obj.height !== "number" || !Number.isInteger(obj.height) || obj.height < 1)
      ) {
        return {
          ok: false,
          error: `resize command needs a positive integer "height" when provided (got ${JSON.stringify(obj.height)})`,
        };
      }
      return {
        ok: true,
        command: {
          type: "resize",
          width: obj.width,
          height: obj.height as number | undefined,
        },
      };
    }

    case "render": {
      if (typeof obj.markup !== "string") {
        return { ok: false, error: 'render command needs a "markup" string' };
      }
      const budget = checkMarkupBudget("render", obj.markup);
      if (!budget.ok) return budget;
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

    case "update": {
      if (typeof obj.id !== "string" || obj.id.trim() === "") {
        return {
          ok: false,
          error: 'update command needs a non-empty "id" string',
        };
      }
      if (obj.props === null || typeof obj.props !== "object" || Array.isArray(obj.props)) {
        return { ok: false, error: 'update command needs a "props" object' };
      }
      const props: Record<string, string> = {};
      for (const [key, value] of Object.entries(obj.props as Record<string, unknown>)) {
        if (typeof value !== "string") {
          return {
            ok: false,
            error: `update command prop ${JSON.stringify(key)} must be a string`,
          };
        }
        props[key] = value;
      }
      if (Object.keys(props).length === 0) {
        return { ok: false, error: 'update command needs at least one prop in "props"' };
      }
      return { ok: true, command: { type: "update", id: obj.id.trim(), props } };
    }

    case "replace":
    case "append": {
      const type = obj.type;
      if (typeof obj.target !== "string" || obj.target.trim() === "") {
        return { ok: false, error: `${type} command needs a non-empty "target" string` };
      }
      if (typeof obj.markup !== "string") {
        return { ok: false, error: `${type} command needs a "markup" string` };
      }
      const budget = checkMarkupBudget(type, obj.markup);
      if (!budget.ok) return budget;
      if (
        obj.format !== undefined &&
        (typeof obj.format !== "string" || !DOC_FORMATS.has(obj.format))
      ) {
        return {
          ok: false,
          error: `${type} command has unknown "format" (got ${JSON.stringify(obj.format)})`,
        };
      }
      return {
        ok: true,
        command: {
          type,
          target: obj.target.trim(),
          markup: obj.markup,
          format: obj.format as DocFormat | undefined,
        },
      };
    }

    case "remove":
      if (typeof obj.target !== "string" || obj.target.trim() === "") {
        return { ok: false, error: 'remove command needs a non-empty "target" string' };
      }
      return { ok: true, command: { type: "remove", target: obj.target.trim() } };

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

export type NdjsonInput = { ok: true; line: string } | { ok: false; error: string };

/**
 * Buffers arbitrary stdin chunks into complete NDJSON lines. Node's stdin
 * "data" events don't align to line boundaries (a single JSON object can
 * arrive split across chunks, or several lines can arrive in one chunk), so
 * this is the one place that has to think about partial reads. Blank lines
 * (keepalives some hosts may send) are silently dropped.
 */
export class NdjsonSplitter {
  /** Pending segments of the line being assembled, joined once per line.
   * Repeated `+=` would rely on V8's rope representation to stay linear when a
   * host delivers a large line in tiny chunks; joining explicitly does not. */
  private parts: string[] = [];
  private bufferBytes = 0;
  private discardingOversizedLine = false;

  private reset(): void {
    if (this.parts.length > 0) this.parts = [];
    this.bufferBytes = 0;
  }

  private take(): string {
    const line = this.parts.length === 1 ? this.parts[0]! : this.parts.join("");
    this.reset();
    return line;
  }

  /** Feed a raw chunk of text. Oversized lines produce one recoverable error
   * and are discarded through their next newline without retaining the data. */
  push(chunk: string): NdjsonInput[] {
    const inputs: NdjsonInput[] = [];
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf("\n", start);
      const endsLine = newline !== -1;
      const end = endsLine ? newline : chunk.length;

      if (this.discardingOversizedLine) {
        if (!endsLine) return inputs;
        this.discardingOversizedLine = false;
        start = newline + 1;
        continue;
      }

      const segment = chunk.slice(start, end);
      const segmentBytes = utf8Length(segment);
      if (this.bufferBytes + segmentBytes > MAX_NDJSON_LINE_BYTES) {
        this.reset();
        inputs.push({
          ok: false,
          error: `NDJSON line exceeds the ${MAX_NDJSON_LINE_BYTES}-byte limit`,
        });
        if (!endsLine) {
          this.discardingOversizedLine = true;
          return inputs;
        }
        start = newline + 1;
        continue;
      }

      if (segment !== "") this.parts.push(segment);
      this.bufferBytes += segmentBytes;
      if (!endsLine) return inputs;
      const line = this.take().replace(/\r$/, "");
      if (line.trim() !== "") inputs.push({ ok: true, line });
      start = newline + 1;
    }
    return inputs;
  }

  /** Whatever remains unterminated when the stream ends (e.g. no final \n). */
  flush(): NdjsonInput[] {
    if (this.discardingOversizedLine) {
      this.discardingOversizedLine = false;
      this.reset();
      return [];
    }
    const rest = this.take();
    return rest.trim() !== "" ? [{ ok: true, line: rest }] : [];
  }
}

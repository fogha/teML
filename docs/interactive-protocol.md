# Interactive protocol (`teml run`)

> **Scope:** this document applies only to `teml run`, whose host owns the
> terminal. The v1.5 full-screen document viewer, `teml read`, owns its TTY
> directly and is documented in [reader.md](reader.md). Reader shares TeML's
> layout/render pipeline but keeps widgets inert and emits no host events.

`teml run` renders **interactive** TeML/Markdown/HTML documents — documents
containing buttons, inputs, checkboxes, textareas, radio groups, or bounded
scroll regions — as a session
instead of a one-shot snapshot. It communicates over **NDJSON** (newline-delimited
JSON): the host writes `Command` objects to teml's stdin, one per line, and
teml writes `SessionEvent` objects to stdout, one per line.

This is a **language-agnostic** integration point: the host process can be
written in any language capable of spawning a subprocess and speaking
line-delimited JSON. There is no TypeScript/Node-specific API required to
drive a session.

**Building a Node.js app instead?** Spawning a subprocess of yourself and
JSON-encoding every keystroke just to talk to your own dependency is pure
overhead. `teml/interactive`'s `runInteractiveApp()` drives the exact same
`InteractiveSession` engine described below directly, in-process — see
[In-process (Node) alternative: `runInteractiveApp`](#in-process-node-alternative-runinteractiveapp)
near the end of this doc. Everything above and below about the _protocol_
(Commands, SessionEvents, the session's behavior) still applies; only the
transport differs.
The same package subpath also exports the public `Command`/`SessionEvent`
types, `decodeCommand`, `encodeEvent`, and `NdjsonSplitter` for Node hosts that
intentionally use the subprocess boundary, plus `readProtocolMetadata` and
`hasProtocolCapability` for capability-gated host behavior.

## Design: teml never touches your terminal

`teml run`'s stdout is the protocol channel, not a terminal. teml never
enters raw mode, never captures keypresses, and never writes control
sequences to manage the screen (clear, cursor-move, alternate buffer, …).
The **host owns the real TTY**:

- The host puts its own terminal in raw mode and reads keypresses.
- The host translates each keypress into a `Command` and writes it to
  teml's stdin as one line of JSON.
- teml updates its internal document state, lays it out, and replies with
  zero or more `SessionEvent`s, always ending in exactly one `frame`
  (`exit` is the only command that does _not_ produce a frame).
- The host decides how to redraw using the `frame`'s `plain` or `ansi`
  field — clear-and-redraw, diff-based repaint, or anything else. teml has
  no opinion here.

Hosts must drain teml's stdout concurrently with writing stdin. The simplest
safe loop sends one command, reads semantic events through its terminating
frame, then sends the next command. TeML honors stdout backpressure and may
pause command processing while the pipe is full; a host that synchronously
fills stdin without reading stdout can deadlock on ordinary OS pipe limits.
If stdout itself breaks, the process exits non-zero and cannot reliably emit
a final `exit` event over the failed transport—hosts must also observe child
process termination.

This split keeps the security invariant that already governs the rest of
TeML intact: rendering is still the single, pure `layoutDocument` →
`renderAnsi`/`renderPlain` pipeline, and nothing in the interactive path
introduces a second place that can emit raw ANSI.

## Try it yourself

`examples/interactive-host.mjs` is a minimal reference host: it puts your
real terminal in raw mode, translates keypresses _and mouse clicks_ into
`Command`s, and repaints the screen from each `frame`'s `ansi` field, so you
can actually tab/type/click through a form. It also prints a persistent
confirmation banner under the form after a `click` event, so submitting is
visibly obvious (not just a value in the JSON stream). The primary journey
(`examples/interactive-form.teml`) combines a radio group, defaulted input,
fixed-height textarea, checkbox, and button. It demonstrates pending radio
selection, select-on-focus editing, multiline input, and contextual
Ctrl+Enter navigation in one compact screen.

```bash
pnpm run build
pnpm run demo:interactive          # runs examples/interactive-form.teml
pnpm run demo:log-viewer           # bounded region + residual scrolling
# or point it at any file:
node examples/interactive-host.mjs path/to/form.teml
```

The host's footer reports the discovered protocol version. When a bounded
region has focus, it switches to that region's visible row range and scrolling
keys, making `scrollRegions` metadata observable rather than silent.

If you just want to see the raw protocol without a real terminal, script
commands over a pipe (no TTY needed):

```bash
printf '%s\n' \
  '{"type":"key","key":"right"}' \
  '{"type":"key","key":"enter"}' \
  '{"type":"key","key":"tab"}' \
  '{"type":"char","char":"Mina"}' \
  '{"type":"key","key":"tab"}' \
  '{"type":"char","char":"Ready\nMonitoring"}' \
  '{"type":"key","key":"enter","modifiers":{"ctrl":true}}' \
  '{"type":"key","key":"enter"}' \
  '{"type":"key","key":"tab"}' \
  '{"type":"key","key":"enter"}' \
  '{"type":"exit"}' \
  | teml run examples/interactive-form.teml --width 60 --height 20 \
      --frames plain --mode patches
```

And the automated coverage: `tests/interactive/session.test.ts` (state
machine invariants), `tests/interactive/protocol.test.ts` (wire validation),
and `tests/system/interactive-journey.test.ts` (the real binary, patch replay,
resize, submission, rerendering, and the in-process Node host).

## Starting a session

```bash
teml run form.teml --width 60 --height 24 --theme dark \
  --frames ansi --mode patches
```

Accepts the same shared flags as `view`/`convert`/`render` (`--width`,
`--theme`, `--no-color`/`--color`, `--ascii`, `--base`, `--allow-file-links`,
`--wrap-code`, `--show-urls`, …) — see `docs/cli.md`, plus the run-only
`--frames ansi|plain|both`, `--mode full|patches`, and `--height <rows>`.
These pre-negotiate the initial frame so production hosts can avoid a
double-format/full-document startup frame. They are equivalent to a
first-command `configure` plus an initial height-bearing `resize` (see below).
`file` may be omitted
or `-` to read the initial document from stdin before the protocol takes
over (in that case, the first bytes on stdin are the document source, and
NDJSON commands begin only after `readInput` has consumed it — piping both
through the same stdin is unusual; passing a file path is the common case).

Unlike the other commands, `run` assumes the **host's terminal** — not
teml's own stdout, which is always a pipe here — supports color and Unicode
by default, so the `ansi` field in every frame is populated out of the box.
Pass `--no-color` or set `NO_COLOR` if the host only wants the `plain`
field.

As soon as the session starts, teml emits one `frame` event for the
document's initial state, before reading any command. From then on, every
successfully decoded command produces zero or more semantic events followed
by exactly one new `frame` (except `exit`, which produces only the `exit`
event). Malformed or unknown command lines produce an `error` without a
frame.

## Commands (host → teml)

One JSON object per line on stdin.

| `type`      | Fields                                                                               | Effect                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `configure` | `frames`: `"ansi"` \| `"plain"` \| `"both"`; `mode?`: `"full"` \| `"patches"`        | Negotiate the frame payload and delivery mode — first command only                                                    |
| `key`       | `key`: a name from the table below; `modifiers?`: `{ctrl?,alt?,shift?}` booleans     | Navigate, edit, scroll, activate, or report a best-effort host key                                                    |
| `char`      | `char`: string                                                                       | Insert into the focused input/textarea, or activate a focused button/checkbox/radio with `" "`                        |
| `pointer`   | `row`, `col`: non-negative integers                                                  | Focus (and activate, if applicable) whichever widget contains that terminal-cell position in the last frame           |
| `scroll`    | `rows`: integer from -10,000 to 10,000                                               | Scroll by terminal rows (positive down, negative up), routing to a focused textarea/scroll region before the document |
| `resize`    | `width`: positive integer; `height?`: positive integer                               | Re-layout at live terminal dimensions, preserving widget state                                                        |
| `render`    | `markup`: string, `format?`: `"teml"` \| `"markdown"` \| `"html"` (default `"teml"`) | Replace the document, preserving focus/values/cursor where ids match                                                  |
| `update`    | `id`: string, `props`: `{ [name]: string }`                                          | Mutate allowlisted props on an addressable display widget without re-parsing markup                                   |
| `replace`   | `target`: string, `markup`: string, optional `format`                                 | Replace one addressable container block with normalized fragment blocks                                               |
| `append`    | `target`: string, `markup`: string, optional `format`                                 | Append normalized fragment blocks to one addressable container                                                        |
| `remove`    | `target`: string                                                                     | Remove one addressable container and its subtree                                                                      |
| `exit`      | —                                                                                    | End the session                                                                                                       |

### Resource limits

The engine rejects a `char` payload larger than 64 KiB and a `render`,
`replace`, or `append` markup payload larger than 4 MiB (measured as UTF-8).
An NDJSON line
is capped at 8 MiB before JSON parsing; an oversized line emits one `error`,
is discarded through its terminating newline, and the session then accepts
later commands normally. These limits prevent a broken or hostile host from
turning an unterminated line, paste, or document replacement into unbounded
memory/CPU use. Hosts should chunk human paste input and use a file-backed
initial document for larger sources.
`scroll.rows` is independently bounded to ±10,000.

### `configure`

Optional **first command**. If present it must be the first successfully
decoded command the host sends; blank or malformed lines emit their normal
errors but do not become commands. A `configure` that arrives after any valid
command is rejected with an `error` event and the session continues unchanged.
It selects which
rendering(s) every subsequent `frame` event carries:

| `frames`           | Effect on subsequent `frame` events             |
| ------------------ | ----------------------------------------------- |
| `"both"` (default) | `plain` and `ansi` both populated (v1 behavior) |
| `"ansi"`           | `ansi` populated, `plain` is `null`             |
| `"plain"`          | `plain` populated, `ansi` is `null`             |

It also selects how frames are delivered:

| `mode`             | Effect                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------- |
| `"full"` (default) | Every `frame` contains a complete rendering                                            |
| `"patches"`        | Routine updates contain changed rows only; resynchronization points remain full frames |

The dropped field is `null`, not absent, so host decoders with optional
fields keep working. Only the negotiated payload is rendered at all, so a
session that never reads one field also skips that render pass and roughly
halves the bytes per frame. The command's own acknowledgement is a `frame`
emitted in the newly negotiated format. The acknowledgement is always a full
frame, even when `mode` is `"patches"`, giving the host a clean patch base.
That acknowledgement also carries `protocol` and `capabilities` discovery
metadata. Sessions pre-negotiated with `--frames` or `--mode` include the same
metadata on frame 1 and later full resynchronization frames.

The **initial** frame is emitted before any command can arrive, so runtime
negotiation cannot change it. Hosts that want the first frame optimized
should start teml with, for example,
`teml run --frames ansi --mode patches --height 24`. Either startup
negotiation flag (`--frames` or `--mode`) locks configuration, so a later
`configure` is an error. `--height` only seeds dimensions and does not lock
frame negotiation.

A rejected `configure` names which of the three causes applied — the startup
flags, an earlier `configure`, or another command having already started the
session — and lists every requested setting the session is not honoring, for
example:

```json
{
  "type": "error",
  "message": "configure rejected: the --frames/--mode startup flags already negotiated this session; ignored mode=patches (still full)"
}
```

The accompanying frame is a full resynchronization frame in the format the
session is actually using, so a host that ignores the error still stays in
sync. Treat the message as diagnostic text: it is not a stable contract, and
hosts should branch on the `error` event type rather than parse it.

### `key`

| Key          | Effect                                                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tab`        | Move focus to the next focusable widget (wraps around)                                                                                    |
| `shiftTab`   | Move focus to the previous focusable widget (wraps around)                                                                                |
| `enter`      | Activate the focused widget — see below                                                                                                   |
| `backspace`  | Delete the grapheme immediately before the text cursor in a focused input (or clear it entirely — see "select on focus" below)            |
| `escape`     | Clear focus (no widget focused)                                                                                                           |
| `left`       | Move the text cursor one grapheme left within a focused input (clamped at 0; collapses a selection to 0 instead — see below)              |
| `right`      | Move the text cursor one grapheme right within a focused input (clamped at the end; collapses a selection to the end instead — see below) |
| `up`         | Previous focus globally; previous visual line while a textarea is focused; previous option while a radio is focused                       |
| `down`       | Next focus globally; next visual line while a textarea is focused; next option while a radio is focused                                   |
| `home`       | Start of a single-line input, or current textarea visual line                                                                             |
| `end`        | End of a single-line input, or current textarea visual line                                                                               |
| `delete`     | Delete the grapheme after the cursor in a focused input (or clear an untouched selected default)                                          |
| `pageUp`     | Scroll an active document viewport up by one page with one row of overlap                                                                 |
| `pageDown`   | Scroll an active document viewport down by one page with one row of overlap                                                               |
| `f1` … `f12` | Reserved function keys; currently a state-preserving no-op frame                                                                          |

`enter` behavior depends on the focused widget:

- **button** — emits a `click` event carrying a snapshot of every
  widget's current value.
- **checkbox** — toggles `checked` and emits a `toggle` event.
- **input** — commits the value (it's already live via `change` events on
  every keystroke) and moves focus to the next widget. There is no form
  submission concept in v1 — `enter` on an input never fires `click`.
- **radio** — confirms the pending option and emits `change` only when its
  value changed.
- **textarea** — inserts `\n`; `Ctrl+Enter` moves to the next focus target.
- **scroll region** — no activation event.

`left`/`right` are no-ops on a focused button/checkbox, or when nothing is
focused (still return a fresh `frame`).

`modifiers` is optional. Hosts include only the Ctrl/Alt/Shift state their
terminal API reports; detection is best-effort and varies by terminal. A
recognized but unsupported modified combination (for example
`Ctrl+Enter` before a multiline widget binds it) is a state-preserving no-op
that still returns a frame. `Shift+Tab` may be encoded either as `shiftTab` or
as `tab` with `modifiers.shift: true`. For compatibility with common macOS
terminal bindings, Alt+Left/Right currently use the base cursor movement in
single-line inputs.
Unknown key names or malformed modifier objects are invalid wire commands and
produce an `error` event.

### Contextual input routing

Hosts send normalized keys only; they never need widget-specific commands.
Dispatch order is modifier normalization → focused widget → focused container
→ document/global behavior. Tab/Shift+Tab and Escape are always global.

| Focus context        | Consumed locally                               | Falls through globally                                     |
| -------------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| None/button/checkbox | Enter for activation where applicable          | Up/Down focus, PageUp/PageDown document                    |
| Single-line `input`  | Left/Right/Home/End/Backspace/Delete/Enter     | Up/Down focus, page keys document                          |
| `radio`              | arrows move the pending option; Enter confirms | page keys document                                         |
| `textarea`           | arrows, Home/End, edit keys, Enter, page keys  | Tab/Shift+Tab/Escape                                       |
| `scroll` container   | PageUp/PageDown and `scroll` rows              | Up/Down focus; residual scroll rows bubble to the document |

Inapplicable or unsupported modifier combinations preserve state and still
produce exactly one frame.

### Text cursor

Every input and textarea tracks its own cursor position (a grapheme index into its
value), independent of focus: moving away and back with `tab`/`shiftTab`
resumes editing at the same spot. New characters are inserted _at_ the
cursor (not always appended to the end), and `backspace` deletes the
grapheme immediately before it. A newly-focused input that's never been
visited before starts with the cursor at the end of its value. The `frame`
event's `ansi`/`plain` render the cursor as a caret (`▏`, or `|` without
Unicode) at its exact position within the value — see
`fixtures/teml/36-interactive-form.teml` / `tests/layout/interactive.test.ts`
for what that looks like.

For a textarea, wrapping derives a visual `(line,column)` from that canonical
grapheme offset at the current width. Up/Down preserve a preferred terminal-cell
column, resize/reflow never rewrites the canonical cursor, and the widget keeps
exactly its declared number of content rows by scrolling internally.

### "Select on focus" for untouched default values

An input can start a session with a non-empty `value` from the markup
itself (a _default_, as opposed to a `placeholder`, which is just a hint
shown when the value is empty). Until the user actually edits it, that
value is treated like a browser treats a pre-selected text field:

- The `frame` renders the whole value highlighted with no caret (via
  `LayoutOpts.selectionActive`), signaling "this is ready to be replaced."
- The first `char` command **overwrites** the entire value with what was
  typed, rather than inserting at a cursor position.
- The first `backspace` **clears** the entire value in one press, rather
  than deleting one grapheme.
- `left`/`right` instead **collapse** the selection to that edge (start or
  end respectively) without changing the value — matching how arrow keys
  behave on selected text in a browser — and switch the field into normal
  per-grapheme editing from then on.

Once any of the above happens, the field behaves exactly like any other
input for the rest of the session (per-grapheme insert/delete at the
cursor). A `render` command re-establishes this for whatever value ends up
in each input afterward — including a value restored from before the
render — since a fresh document is treated as a fresh set of defaults. An
input with only a `placeholder` (no `value`) is never affected by any of
this — there's nothing there to select.

### `char`

For a focused **input**, the character (or string — a host may deliver a
pasted blob as one `char` command) is sanitized with the same rules every
other string in the AST goes through (control characters and bidi/ZW
tricks stripped; embedded `\n`/`\r` are also stripped since inputs are
single-line) and inserted at the cursor position, then a `change` event is
emitted.

For a focused **textarea**, CRLF and CR normalize to LF and embedded newlines
are preserved. The whole sanitized paste is inserted at the grapheme cursor
and emitted in one `change` event.

For a focused **button**, **checkbox**, or **radio**, only `" "` (space) does
anything — it's treated exactly like `enter`. Any other character is
ignored. If nothing is focused, `char` is a no-op (still returns a fresh
`frame`).

### `pointer`

Represents a mouse click at the 0-indexed `(row, col)` terminal-cell position
within the _previous_ frame's text (row 0 is the first visible line of
`frame.plain`/`ansi`; a host reading raw SGR mouse-mode escape sequences
should subtract 1 from the 1-indexed coordinates those report). If the frame
has a viewport, teml adds its document offset internally. It then resolves
exact containment in the widget's per-row half-open cell interval
`[colStart,colEnd)`, focuses the widget, and — for a button or checkbox —
activates it too, exactly like `enter`. Clicking a radio option focuses its
group and confirms that option. Clicking textarea content repositions its
grapheme cursor using the clicked terminal-cell column; clicking its label or
brackets only focuses it.
Clicking an input just focuses it (the cursor is not repositioned to the
exact clicked character; it stays wherever it already was, or moves to the
end if the input had never been focused before). A click outside every widget
region—blank/static rows, grid gutters, or columns beyond a rendered
control—is a harmless no-op. Regions are measured in terminal cells, not
JavaScript string indices, so CJK and emoji widths match what the host paints.
Two widgets in side-by-side `grid` cells therefore resolve independently.

### `scroll`

```json
{ "type": "scroll", "rows": 3 }
```

Positive rows move down and negative rows move up. A focused textarea or
`:::scroll` container consumes as much of the delta as its internal range
allows; any residual rows then move the document viewport. Without such a
focus target, the document viewport receives the whole delta. At every bound,
the command remains a valid state-preserving command and still emits a frame
(an empty patch list in patches mode). Scrolling never changes focus and
temporarily permits the focused target to remain outside the document
viewport.

Hosts should map one wheel notch to three rows by default, accumulate rapid
trackpad/wheel input, and send at most one `scroll` command per rendered frame
or roughly every 16–50 ms. Reference Node and Rust hosts implement this
coalescing. If discovery metadata lacks the `scroll` capability, use one
PageUp/PageDown command as the compatibility fallback.

### `resize`

Updates the live terminal dimensions:

```json
{ "type": "resize", "width": 100, "height": 30 }
```

`width` is required and clamped to the useful live-terminal range of 20 to
10,000 columns. This differs from an explicit startup `--width`, which may be
smaller for deterministic testing or constrained output. `height` is
optional and capped at 10,000; when provided it enables viewport-bounded
rendering in the interactive session. If the laid-out document is taller, subsequent
frames contain only the visible slice and include `viewport` metadata.
Omitting height retains the last known value.

Resize changes layout only. The document, values, checkbox state, focused
widget, per-input cursor positions, and untouched-default selection state are
preserved. The response is always a complete full frame—even in
`mode:"patches"`—because reflow invalidates the host's old row buffer.
Subsequent routine commands resume patch delivery from that new full-frame
base.

Hosts should read dimensions from the TTY output (`process.stdout` in Node,
`Event::Resize`/`terminal::size()` in crossterm), not from teml's piped
stdout. Send the current dimensions after startup negotiation, then debounce
or coalesce drag-resize storms to the latest dimensions (roughly 50–150 ms)
and skip unchanged sizes. A width change invalidates the complete layout;
a height-only change reuses cached lines but still emits a full resync frame.
If the host paints a footer or other chrome below TeML's frame, subtract those
reserved rows before sending `height`; pointer coordinates are relative to the
frame origin, not the chrome.

### Viewport-bounded frames

When terminal `height` is known and the laid-out document is taller, every
full or patch frame includes:

```json
{ "viewport": { "offset": 42, "height": 20, "total": 300 } }
```

- `offset` is the zero-indexed document row at visible row 0.
- `height` is the number of rows in the emitted screen buffer.
- `total` is the complete laid-out document row count.

Frame payloads and patch row indices are always **viewport-local**. Therefore
`rows === viewport.height` for patch frames and every patch satisfies
`0 <= patch.row < viewport.height`. Hosts can keep using the same screen
reconstruction algorithm; `viewport` is useful for scroll indicators and
coordinate translation, not for indexing the host buffer.

Tab/Shift+Tab and global Up/Down auto-scroll only as needed to keep newly focused
widgets visible. Global PageUp/PageDown move by `height - 1` rows (minimum one) and
do not change focus. Pointer rows remain relative to the last visible frame;
teml translates them to document rows before hit-testing.

If the document fits, `viewport` is omitted and the frame payload remains
byte-identical to the original full-document shape. A resize, document
replacement, or negotiation acknowledgement is still a full-frame
resynchronization point; routine viewport edits/navigation can use patches.

### Bounded scroll regions

`:::scroll{id="logs" rows=10}` contributes exactly ten content rows plus two
border rows, regardless of child length. Its static child layout is cached;
changing only the offset slices cached physical rows instead of laying out the
whole child document again. Nested interactive widgets and nested scroll
regions are intentionally unsupported in this version and are made static or
flattened with diagnostics.

Frames containing a visible region include:

```json
{
  "scrollRegions": [{ "id": "logs", "offset": 42, "height": 10, "total": 5000 }]
}
```

`offset` and `total` are region-local physical rows; `height` is the declared
content-row count. This metadata is informational for indicators and
conformance checks—the painted full/patch rows remain authoritative and
viewport-local. Pointer commands remain frame-local; TeML translates them
through the document viewport before resolving the painted region.

### `render`

Re-parses `markup` (defaulting to the `teml` format) and swaps in the
resulting document, exactly like sending a _new_ file. Before swapping,
teml snapshots every existing focusable widget's value/`checked` by `id`;
after building the new document's list of focusable widgets, any id that
still exists gets its value/`checked` reapplied. Focus is kept on the same
id if it still exists; otherwise focus falls back to the new document's
first focusable widget (or stays unfocused if it has none). Cursor
positions are kept for surviving input ids too (clamped if the restored
value is now shorter) and dropped for ids that disappeared.

Textarea values/cursors and radio selections follow the same id-preservation
rule. A radio selection is retained only if the new group still contains that
option value; otherwise the new document's valid default wins. Scroll-region
offsets survive by id and are clamped after new content or width changes.

Use this to push updates from the host — e.g. after a `click` event, the
host might re-render the form with a "Submitted!" confirmation while
keeping whatever the user had already typed into any inputs.

If `markup` fails to parse, teml emits an `error` event (the session
continues with the previous document) followed by a `frame` of the
unchanged document.

## Async updates

The host may send `update` or `render` between input commands; teml still
honors strict request/response ordering — one decoded command yields one
or more events ending in a `frame`. Server-push therefore interleaves with
user input without breaking the NDJSON discipline: a progress tick can arrive
between keystrokes, and the next `key`/`char` command sees the updated
document while preserving focus, cursors, scroll offsets, and (for `update`)
the patch base.

Prefer `update` for high-frequency display widgets, targeted mutations for
bounded structural changes, and `render` for complete document swaps.

### `update`

Mutates one addressable display widget (`::progress`, `::metric`) in place.
The widget must carry a stable `id` as defined by the
[TeML specification](spec.md). Each prop name must be on that directive's
mutable allowlist (`::progress`: `label`, `value`, `max`; `::metric`: `label`,
`value`, `change`); values are sanitized the same way as ingestion. Unknown ids
or props, empty `props`, or invalid numeric `value`/`max` on progress produce an
`error` event followed by an unchanged `frame` (`seq` still advances).

Unlike `render`, `update` preserves focus, input cursors, untouched-default
state, document/region scroll offsets, and the current patch base. In
`patches` mode, routine progress ticks typically change only the widget's
rendered row span (two rows for `::progress`, two for `::metric`).

Hosts may interleave `update` and `render` between input commands; each
command still receives its own `frame` in order. For live dashboards, stay
near **≤ 20 updates/s** unless you have measured headroom — coalesce bursts
and apply backpressure when the host outruns layout.

```json
{ "type": "update", "id": "deploy", "props": { "value": "73", "max": "100" } }
```

### `replace`, `append`, and `remove`

Protocol 1.3 adds capability-gated **document mutations**. Their `target` is
the stable `id` of an eligible container (`card`, alerts, `grid`, `details`,
`figure`, or `scroll`):

```json
{ "type": "append", "target": "logs", "markup": "Worker ready" }
{ "type": "replace", "target": "summary", "markup": "**Complete**", "format": "markdown" }
{ "type": "remove", "target": "completed-card" }
```

`append` adds the normalized fragment blocks to the target's children.
`replace` replaces the target block itself with one or more normalized fragment
blocks; include a new addressable container with the same `id` when later
commands should keep using that target. `remove` deletes the target and its
whole subtree. Fragment frontmatter never changes document metadata.

Every fragment uses the same format frontend, sanitizer, pathological-nesting
guards, and normalizer as `render`. Hosts cannot send AST paths or prebuilt
nodes. Empty fragments, unknown/wrong-kind targets, or limit violations emit
`error` plus an unchanged frame. Duplicate addressable ids keep the first
document-order occurrence; later targets become inert.

Values, focus, cursors, selections, and document/region scroll offsets survive
when their ids survive. If a focused subtree is removed, focus moves to the
first surviving focusable (or `null`); scroll offsets clamp to the new valid
range. Safe appends invalidate and relayout only the owning top-level subtree
and may emit row patches. `replace` and `remove` are full-frame
resynchronization points.

Mutation growth is bounded to 10,000 normalized blocks per document and 2,000
direct children per append target. For log streams, coalesce to **≤ 10
appends/s** and retain substantially fewer than 2,000 entries (500 is the
recommended default); replace a bounded window or remove old containers before
the limit. A `status{text}` engine command is intentionally absent: status
bars and other chrome belong to the host outside the document frame.

### `exit`

Ends the session. teml emits exactly `{"type":"exit"}` and no further
frame; the process then exits 0. The host may also simply close stdin
without sending `exit` — the session ends the same way.

## Events (teml → host)

One JSON object per line on stdout.

| `type`   | Fields                                                                                                                                                                              | When                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `frame`  | Full: `seq`, `focusedId`, `plain`, `ansi`; patch: `seq`, `focusedId`, `rows`, `patches`; optional `viewport`/`scrollRegions`; negotiated full frames may include discovery metadata | After every command except `exit` (`seq` starts at 1 and increments monotonically)                             |
| `change` | `id`, `value`                                                                                                                                                                       | An input/textarea value changed, or a radio selection was confirmed                                            |
| `toggle` | `id`, `checked`                                                                                                                                                                     | A checkbox's checked state changed                                                                             |
| `click`  | `id`, `values`                                                                                                                                                                      | A button was activated; `values` maps every widget id to its current value (`"true"`/`"false"` for checkboxes) |
| `error`  | `message`                                                                                                                                                                           | A command line was malformed, unrecognized, a late `configure`, a failed `render`, or a rejected update/mutation |
| `exit`   | —                                                                                                                                                                                   | The session ended                                                                                              |

### Full frames

The default frame is the backward-compatible v1 shape:

```json
{
  "type": "frame",
  "seq": 3,
  "focusedId": "name",
  "plain": "complete plain rendering\n",
  "ansi": "complete ANSI rendering\n"
}
```

`plain` is always ANSI-free. `ansi` respects the theme and capabilities teml
started with. Negotiating a single format with `configure` or `--frames`
turns the other field `null`.

The initial frame, the `configure` acknowledgement, every successful
`resize`/`render`/`replace`/`remove`, and recovery paths that require
resynchronization are full frames. A full frame
replaces the host's complete row buffer and is a resynchronization point.
Every accepted frame has a strictly increasing `seq`. Patch frames must be
contiguous because they depend on their immediate predecessor; a full frame
is self-contained, so reference hosts accept a forward sequence gap while
replacing the complete buffer.

### Patch frames

With `configure.mode: "patches"`, routine interaction emits row-level diffs:

```json
{
  "type": "frame",
  "seq": 4,
  "focusedId": "name",
  "rows": 8,
  "patches": [{ "row": 2, "plain": "Name: [Ada|]", "ansi": null }]
}
```

Each patch contains the complete new content of one zero-indexed row, without
a trailing newline. Payloads excluded by `frames` are `null`, just as in full
frames. `rows` is the new reconstructed **screen-buffer** row count; it handles
both growth and truncation. Without a viewport that is the complete document
height; with one it equals `viewport.height`. A command that changes no
visible row legitimately emits an empty `patches` array.

A host applies a patch frame as follows:

1. Require a previously accepted full frame as the base.
2. Verify that `seq` follows the previous frame. On a gap, do not paint a
   potentially corrupt patch; restart the session or resend the document with
   `render`, which produces a full frame.
3. For each patch, replace `screen[patch.row]` with the non-null negotiated
   payload.
4. Resize the screen buffer to exactly `rows`, truncating stale rows or
   extending it as needed.
5. Paint the changed rows, or join and repaint the reconstructed buffer if
   the host uses a simple full-screen terminal driver.

The JavaScript and Rust reference hosts implement this algorithm. Hosts that
do not opt into `"patches"` continue receiving only v1 full frames.

## Versioning

The frame-first protocol is versioned independently from package semver.
Negotiated full frames carry:

```json
{
  "protocol": { "major": 1, "minor": 3 },
  "capabilities": [
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
    "documentMutations"
  ]
}
```

Major changes may break command/event meaning and are fatal when a host
requires another major. Minor changes are additive; hosts inspect the finite
capability list and use documented fallbacks for missing entries. Hosts must
ignore unknown JSON fields and unknown capability strings. The package's
major/minor version does not imply a protocol number—release notes record
their mapping.

Because frame 1 predates command input, discovery is emitted on frame 1 when
the session is pre-negotiated with `--frames` or `--mode`. Otherwise, a valid
first-command `configure` acknowledgement begins advertising it. Missing
metadata identifies an older v1 engine. This preserves the byte-identical
default v1 transcript while giving independently versioned hosts in-band
feature discovery. A host lacking `scroll` falls back to PageUp/PageDown;
other unsupported commands must not be sent.

Full resynchronization frames continue carrying metadata after negotiation;
patch frames do not repeat it. Machine-readable JS/Rust conformance tests
exercise unknown-field tolerance, capabilities, viewport, scroll-region
metadata, and patch reconstruction.

## Example transcript

Document:

```teml
::input{id="name" label="Name" placeholder="your name"}
::checkbox{id="agree" label="I agree to the terms"}
::button{id="submit" label="Submit"}
```

Host sends (one command per line):

```json
{"type":"char","char":"Ada"}
{"type":"key","key":"tab"}
{"type":"key","key":"enter"}
{"type":"pointer","row":4,"col":2}
{"type":"exit"}
```

(The `pointer` command above targets whatever row `submit` rendered at in
the previous frame — a host driving a real mouse would compute that from
its own terminal's reported click coordinates, not hardcode it.)

teml replies (frames abbreviated with `…`):

```json
{"type":"frame","seq":1,"focusedId":"name","plain":"…","ansi":"…"}
{"type":"change","id":"name","value":"Ada"}
{"type":"frame","seq":2,"focusedId":"name","plain":"…","ansi":"…"}
{"type":"frame","seq":3,"focusedId":"agree","plain":"…","ansi":"…"}
{"type":"toggle","id":"agree","checked":true}
{"type":"frame","seq":4,"focusedId":"agree","plain":"…","ansi":"…"}
{"type":"click","id":"submit","values":{"name":"Ada","agree":"true","submit":""}}
{"type":"frame","seq":5,"focusedId":"submit","plain":"…","ansi":"…"}
{"type":"exit"}
```

## Malformed input

`decodeCommand` never throws. A line that isn't valid JSON, isn't an
object, or doesn't match one of the command shapes above produces an
`error` event and the session keeps running — one bad line never crashes
`teml run`. Try it:

```bash
printf '%s\n' \
  '{not json' \
  '{"type":"mystery"}' \
  '{"type":"exit"}' \
  | teml run form.teml
```

## Focusable widgets and ids

Only `button`, `input`, and `checkbox` leaves participate in focus
navigation. Each needs a stable, unique `id` attribute:

- Missing `id` → the widget is skipped from the focus order with an
  `unknown-directive`-style diagnostic on stderr; it still renders, just
  never receives focus.
- Duplicate `id` → the first occurrence wins; later ones are skipped from
  the focus order (with a diagnostic) so `values`/`change`/`toggle`/`click`
  payloads always have unambiguous keys.

Tab order follows document order (depth-first, including widgets nested
inside containers like `card`, `details`, `grid`).

## Outside a session

Interactive leaf directives are ordinary, declarative TeML — `teml
view`/`convert`/`render` show them as static controls with no focus
marker, exactly like any other leaf (see `fixtures/teml/36-interactive-form.teml`).
They only become interactive when driven through `teml run`.

## In-process (Node) alternative: `runInteractiveApp`

If your host _is_ a Node.js process, `teml/interactive` exports a function
that drives an `InteractiveSession` directly — no subprocess, no NDJSON, no
hand-written keypress decoder:

```js
import { runInteractiveApp } from "teml/interactive";

const values = await runInteractiveApp(formHtml, {
  format: "html", // or "markdown" / "teml"; default "html"
  footer: "Tab to move, Enter/Space to activate, Ctrl+C to quit",
  handlers: {
    onChange(id, value, ctx) {
      /* live as the user types */
    },
    onToggle(id, checked, ctx) {
      /* checkbox flipped */
    },
    onClick(id, values, ctx) {
      if (id === "submit") ctx.exit(); // resolves runInteractiveApp's promise
      if (id === "cancel") ctx.exit();
    },
    onError(message, ctx) {
      /* a ctx.render() call failed to parse */
    },
  },
});
// values: { [widgetId]: string } snapshot at the moment the loop ended
```

It puts `process.stdin` in raw mode, enables SGR mouse tracking, decodes
keypresses/clicks into the same `Command`s described above, and calls
`InteractiveSession.handle()` directly — the session behavior (focus order,
cursor movement, "select on focus", click hit-testing) is byte-for-byte the
same engine `teml run` uses, just without the wire format in between.

`ctx.render(newSource, format?)` swaps in a different document — e.g. to
show a validation error inline, or move to another "screen" of a
multi-step flow — while carrying over any input/checkbox values whose ids
still exist, plus textarea and valid radio values (same behavior as the
`render` command above). `ctx.values()`
reads the live snapshot at any time; `ctx.exit()` ends the loop early from
any handler. The returned promise also resolves if the user presses Ctrl+C
or stdin ends, so a bare `await runInteractiveApp(html)` with no handlers
is a valid (if unadventurous) way to just let someone fill in a form.
`ctx.replace(target, source, format?)`, `ctx.append(target, source, format?)`,
and `ctx.remove(target)` expose the same protocol 1.3 document mutations
in-process; capability negotiation is unnecessary because the context and
engine come from the same package.

`input`/`output` default to `process.stdin`/`process.stdout` but accept any
readable/writable stream — raw mode and mouse tracking only engage when the
stream looks like a real TTY (has a callable `setRawMode`), so the same
function works against a `PassThrough` in tests. See
`examples/settings-app.mjs` (`pnpm run demo:settings`) for a complete
HTML-authored workspace profile with native radios, a textarea, and validation,
and
`tests/system/interactive-journey.test.ts` for the integrated test-harness
pattern.

## Implementation reference

| Concern                                                               | Module                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| Wire format (`Command`/`SessionEvent`, encode/decode, line buffering) | `src/interactive/protocol.ts`                                   |
| Session state machine (focus, cursor, values)                         | `src/interactive/session.ts`                                    |
| Focus collection/navigation over the AST                              | `src/interactive/focus.ts`                                      |
| Widget layout (buttons, inputs, checkboxes, radio groups, textareas)  | `src/layout/interactive.ts`                                     |
| Bounded scroll-region layout/cache                                    | `src/layout/scroll.ts`                                          |
| Widget hit-testing (document row + terminal-cell column → widget id)  | `src/layout/hits.ts`                                            |
| Cached interactive layout + viewport slicing                          | `src/interactive/layout-cache.ts`, `src/interactive/session.ts` |
| CLI wiring (`teml run`)                                               | `src/cli/commands/run.ts`                                       |
| JavaScript host frame reconstruction                                  | `examples/interactive-frame.mjs`                                |
| JavaScript reference host (real TTY, mouse, keys)                     | `examples/interactive-host.mjs`                                 |
| Rust reference host + equivalence tests                               | `examples/rust-host/`                                           |
| In-process Node host (`runInteractiveApp`)                            | `src/interactive/host.ts`                                       |
| Example app built on `runInteractiveApp`                              | `examples/settings-app.mjs`                                     |

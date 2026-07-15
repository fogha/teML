# Interactive protocol (`teml run`)

> **Scope:** this document applies only to `teml run`, whose host owns the
> terminal. The v1.5 full-screen document viewer, `teml read`, owns its TTY
> directly and is documented in [reader.md](reader.md). Reader shares TeML's
> layout/render pipeline but keeps widgets inert and emits no host events.

`teml run` renders **interactive** TeML/Markdown/HTML documents — documents
containing `button`, `input`, or `checkbox` leaf directives — as a session
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
near the end of this doc. Everything above and below about the *protocol*
(Commands, SessionEvents, the session's behavior) still applies; only the
transport differs.

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
  (`exit` is the only command that does *not* produce a frame).
- The host decides how to redraw using the `frame`'s `plain` or `ansi`
  field — clear-and-redraw, diff-based repaint, or anything else. teml has
  no opinion here.

This split keeps the security invariant that already governs the rest of
TeML intact: rendering is still the single, pure `layoutDocument` →
`renderAnsi`/`renderPlain` pipeline, and nothing in the interactive path
introduces a second place that can emit raw ANSI.

## Try it yourself

`examples/interactive-host.mjs` is a minimal reference host: it puts your
real terminal in raw mode, translates keypresses *and mouse clicks* into
`Command`s, and repaints the screen from each `frame`'s `ansi` field, so you
can actually tab/type/click through a form. It also prints a persistent
confirmation banner under the form after a `click` event, so submitting is
visibly obvious (not just a value in the JSON stream). Its form
(`examples/interactive-form.teml`) gives the Name field a default value, so
you can try "select on focus" first-hand: tab into it and either type or
press Backspace.

```bash
npm run build
npm run demo:interactive          # runs examples/interactive-form.teml
# or point it at any file:
node examples/interactive-host.mjs path/to/form.teml
```

If you just want to see the raw protocol without a real terminal, script
commands over a pipe (no TTY needed):

```bash
printf '%s\n' \
  '{"type":"char","char":"Ada"}' \
  '{"type":"key","key":"tab"}' \
  '{"type":"key","key":"enter"}' \
  '{"type":"exit"}' \
  | teml run examples/interactive-form.teml --width 60
```

And the automated coverage: `tests/interactive/session.test.ts` (state
machine, no subprocess), `tests/interactive/protocol.test.ts` (wire
format), and `tests/cli/run.test.ts` (spawns the real `teml run` binary and
scripts NDJSON over stdin).

## Starting a session

```bash
teml run form.teml --width 60 --theme dark
```

Accepts the same shared flags as `view`/`convert`/`render` (`--width`,
`--theme`, `--no-color`/`--color`, `--ascii`, `--base`, `--allow-file-links`,
`--wrap-code`, `--show-urls`, …) — see `docs/cli.md`. `file` may be omitted
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
command produces zero or more semantic events followed by exactly one new
`frame` (except `exit`, which produces only the `exit` event).

## Commands (host → teml)

One JSON object per line on stdin.

| `type` | Fields | Effect |
| --- | --- | --- |
| `key` | `key`: `"tab"` \| `"shiftTab"` \| `"enter"` \| `"backspace"` \| `"escape"` \| `"left"` \| `"right"` | Navigate/edit/activate the focused widget |
| `char` | `char`: string | Insert into the focused input at the cursor, or activate a focused button/checkbox with `" "` (see also "select on focus" below) |
| `pointer` | `row`, `col`: non-negative integers | Focus (and activate, if applicable) whichever widget rendered at `row` in the last frame |
| `render` | `markup`: string, `format?`: `"teml"` \| `"markdown"` \| `"html"` (default `"teml"`) | Replace the document, preserving focus/values/cursor where ids match |
| `exit` | — | End the session |

### `key`

| Key | Effect |
| --- | --- |
| `tab` | Move focus to the next focusable widget (wraps around) |
| `shiftTab` | Move focus to the previous focusable widget (wraps around) |
| `enter` | Activate the focused widget — see below |
| `backspace` | Delete the grapheme immediately before the text cursor in a focused input (or clear it entirely — see "select on focus" below) |
| `escape` | Clear focus (no widget focused) |
| `left` | Move the text cursor one grapheme left within a focused input (clamped at 0; collapses a selection to 0 instead — see below) |
| `right` | Move the text cursor one grapheme right within a focused input (clamped at the end; collapses a selection to the end instead — see below) |

`enter` behavior depends on the focused widget:

- **button** — emits a `click` event carrying a snapshot of every
  widget's current value.
- **checkbox** — toggles `checked` and emits a `toggle` event.
- **input** — commits the value (it's already live via `change` events on
  every keystroke) and moves focus to the next widget. There is no form
  submission concept in v1 — `enter` on an input never fires `click`.

`left`/`right` are no-ops on a focused button/checkbox, or when nothing is
focused (still return a fresh `frame`).

### Text cursor

Every input tracks its own cursor position (a grapheme index into its
value), independent of focus: moving away and back with `tab`/`shiftTab`
resumes editing at the same spot. New characters are inserted *at* the
cursor (not always appended to the end), and `backspace` deletes the
grapheme immediately before it. A newly-focused input that's never been
visited before starts with the cursor at the end of its value. The `frame`
event's `ansi`/`plain` render the cursor as a caret (`▏`, or `|` without
Unicode) at its exact position within the value — see
`fixtures/teml/36-interactive-form.teml` / `tests/layout/interactive.test.ts`
for what that looks like.

### "Select on focus" for untouched default values

An input can start a session with a non-empty `value` from the markup
itself (a *default*, as opposed to a `placeholder`, which is just a hint
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

For a focused **button** or **checkbox**, only `" "` (space) does
anything — it's treated exactly like `enter`. Any other character is
ignored. If nothing is focused, `char` is a no-op (still returns a fresh
`frame`).

### `pointer`

Represents a mouse click at the 0-indexed `(row, col)` position within the
*previous* frame's text (row 0 is the first line of `frame.plain`/`ansi`;
a host reading raw SGR mouse-mode escape sequences from its terminal
should subtract 1 from the 1-indexed coordinates those report). teml
resolves `row` to whichever focusable widget rendered there, focuses it,
and — for a button or checkbox — activates it too, exactly like `enter`.
Clicking an input just focuses it (the cursor is not repositioned to the
exact clicked character; it stays wherever it already was, or moves to the
end if the input had never been focused before). A click on a row with no
widget (blank lines, static text, …) is a harmless no-op.

`col` is accepted for forward-compatibility but not currently used —
hit-testing is row-only in v1. This means two widgets that happen to land
on the same row (e.g. side-by-side cells of a `grid` container) aren't
disambiguated by column; the first one recorded wins. See
`src/layout/hits.ts` for the exact mechanics and rationale.

### `render`

Re-parses `markup` (defaulting to the `teml` format) and swaps in the
resulting document, exactly like sending a *new* file. Before swapping,
teml snapshots every existing focusable widget's value/`checked` by `id`;
after building the new document's list of focusable widgets, any id that
still exists gets its value/`checked` reapplied. Focus is kept on the same
id if it still exists; otherwise focus falls back to the new document's
first focusable widget (or stays unfocused if it has none). Cursor
positions are kept for surviving input ids too (clamped if the restored
value is now shorter) and dropped for ids that disappeared.

Use this to push updates from the host — e.g. after a `click` event, the
host might re-render the form with a "Submitted!" confirmation while
keeping whatever the user had already typed into any inputs.

If `markup` fails to parse, teml emits an `error` event (the session
continues with the previous document) followed by a `frame` of the
unchanged document.

### `exit`

Ends the session. teml emits exactly `{"type":"exit"}` and no further
frame; the process then exits 0. The host may also simply close stdin
without sending `exit` — the session ends the same way.

## Events (teml → host)

One JSON object per line on stdout.

| `type` | Fields | When |
| --- | --- | --- |
| `frame` | `seq`, `focusedId`, `plain`, `ansi` | After every command except `exit` (`seq` starts at 1 and increments monotonically) |
| `change` | `id`, `value` | An input's value changed (typing or backspace) |
| `toggle` | `id`, `checked` | A checkbox's checked state changed |
| `click` | `id`, `values` | A button was activated; `values` maps every widget id to its current value (`"true"`/`"false"` for checkboxes) |
| `error` | `message` | A command line was malformed, unrecognized, or a `render` command failed to parse |
| `exit` | — | The session ended |

`frame.plain` is always ANSI-free. `frame.ansi` respects the theme/caps
teml was started with (see "Starting a session" above for the color
default). Both are complete renders of the whole document — teml does not
attempt incremental/diff frames; that's the host's job if it wants one.

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
object, or doesn't match one of the five command shapes produces an
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

If your host *is* a Node.js process, `teml/interactive` exports a function
that drives an `InteractiveSession` directly — no subprocess, no NDJSON, no
hand-written keypress decoder:

```js
import { runInteractiveApp } from "teml/interactive";

const values = await runInteractiveApp(formHtml, {
  format: "html", // or "markdown" / "teml"; default "html"
  footer: "Tab to move, Enter/Space to activate, Ctrl+C to quit",
  handlers: {
    onChange(id, value, ctx) { /* live as the user types */ },
    onToggle(id, checked, ctx) { /* checkbox flipped */ },
    onClick(id, values, ctx) {
      if (id === "submit") ctx.exit(); // resolves runInteractiveApp's promise
      if (id === "cancel") ctx.exit();
    },
    onError(message, ctx) { /* a ctx.render() call failed to parse */ },
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
still exist (same behavior as the `render` command above). `ctx.values()`
reads the live snapshot at any time; `ctx.exit()` ends the loop early from
any handler. The returned promise also resolves if the user presses Ctrl+C
or stdin ends, so a bare `await runInteractiveApp(html)` with no handlers
is a valid (if unadventurous) way to just let someone fill in a form.

`input`/`output` default to `process.stdin`/`process.stdout` but accept any
readable/writable stream — raw mode and mouse tracking only engage when the
stream looks like a real TTY (has a callable `setRawMode`), so the same
function works against a `PassThrough` in tests. See
`examples/settings-app.mjs` (`npm run demo:settings`) for a complete
single-screen form with validation, and `tests/interactive/host.test.ts`
for the test-harness pattern.

## Implementation reference

| Concern | Module |
| --- | --- |
| Wire format (`Command`/`SessionEvent`, encode/decode, line buffering) | `src/interactive/protocol.ts` |
| Session state machine (focus, cursor, values) | `src/interactive/session.ts` |
| Focus collection/navigation over the AST | `src/interactive/focus.ts` |
| Widget layout (buttons/inputs/checkboxes, focus marker, cursor caret) | `src/layout/interactive.ts` |
| Click hit-testing (row → widget id) | `src/layout/hits.ts` |
| CLI wiring (`teml run`) | `src/cli/commands/run.ts` |
| Reference host over NDJSON (real TTY, mouse tracking, arrow keys) | `examples/interactive-host.mjs` |
| In-process Node host (`runInteractiveApp`) | `src/interactive/host.ts` |
| Example app built on `runInteractiveApp` | `examples/settings-app.mjs` |

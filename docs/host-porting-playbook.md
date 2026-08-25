# Host porting playbook

Language-neutral checklist for implementing a TeML interactive host. A third
language should be able to ship a conforming library from this document alone,
without reading the Rust or Go reference sources.

TeML's subprocess boundary:

```text
host terminal/input
        │ normalized Command NDJSON (stdin)
        ▼
teml run ── parse/state/layout/render ──► SessionEvent NDJSON (stdout)
        ▲                                      │
        └──────────── host repaints ◄──────────┘
```

The engine **never** touches the terminal. The host **never** parses TeML markup
or layout — it reconstructs frames and paints them.

## 1. Wire model

Implement typed structs (or equivalent) mirroring
[`src/interactive/protocol.ts`](https://github.com/fogha/teML/blob/main/src/interactive/protocol.ts):

**Host → engine (`Command`, one JSON object per line on stdin)**

| `type`      | Fields                      | Notes                                                                                                                   |
| ----------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `configure` | `frames`, optional `mode`   | `frames`: `ansi` \| `plain` \| `both`; `mode`: `full` \| `patches`                                                      |
| `key`       | `key`, optional `modifiers` | Normalized key names; modifiers: `ctrl`, `alt`, `shift` booleans                                                        |
| `char`      | `char`                      | Single UTF-8 string, ≤ 64 KiB                                                                                           |
| `pointer`   | `row`, `col`                | **0-indexed** cell in the last frame's visible buffer                                                                   |
| `scroll`    | `rows`                      | Signed integer, bounded (±10 000)                                                                                       |
| `resize`    | `width`, optional `height`  | Positive integers; clamp zero terminal sizes to 1                                                                       |
| `render`    | `markup`, optional `format` | `teml` \| `markdown` \| `html`; markup ≤ 4 MiB                                                                          |
| `update`    | `id`, `props`               | Live widget mutation (protocol 1.2); requires engine `update` capability; `props` values are strings; at least one prop |
| `replace`   | `target`, `markup`, optional `format` | Structural document replacement (protocol 1.3); requires `documentMutations` capability |
| `append`    | `target`, `markup`, optional `format` | Structural append to an addressable container; requires `documentMutations` capability |
| `remove`    | `target`                            | Remove an addressable container subtree; requires `documentMutations` capability |
| `exit`      | —                           | Clean shutdown                                                                                                          |

**Engine → host (`SessionEvent`, one JSON object per line on stdout)**

| `type`   | Purpose                                       |
| -------- | --------------------------------------------- |
| `frame`  | Full re-render or row patches (see §3)        |
| `change` | Input value updated (`id`, `value`)           |
| `toggle` | Checkbox flipped (`id`, `checked`)            |
| `click`  | Button activated (`id`, `values` map)         |
| `error`  | Recoverable protocol/markup error (`message`) |
| `exit`   | Session ended                                 |

**Resource limits (enforce on both sides)**

| Limit                 |  Value |
| --------------------- | -----: |
| Max NDJSON line       |  8 MiB |
| Max `char` payload    | 64 KiB |
| Max `render.markup`   |  4 MiB |
| Max mutation markup   |  4 MiB |
| Max `\|scroll.rows\|` | 10 000 |
| Max normalized document | 10 000 blocks |
| Max append target       | 2 000 direct children |

Oversized NDJSON lines: emit one error, discard through the next newline, keep
the session alive. Enforce the same cap on **both read and send** — reject
oversized outbound commands before writing them to stdin.

**Protocol 1.2 — live `update`:** when the engine advertises the `update`
capability, hosts may send targeted prop changes to updatable widgets (e.g.
`::progress`) without a full `render`. The engine replies with semantic events
(if any) followed by a frame — usually bounded row patches in `patches` mode.
Hosts do not validate prop shapes; the engine returns `error` events for unknown
ids or invalid props.

**Protocol 1.3 — document mutations:** when the engine advertises
`documentMutations`, hosts may send `replace`, `append`, and `remove`.
Fragments use the same parse/sanitize/normalize path as `render`; hosts never
send AST paths. Safe append operations may produce patches, while replace and
remove produce full resynchronization frames. Gate the commands on the
capability and fall back to `render` with host-held source on older engines.

For logs, coalesce to ≤10 appends/s and retain about 500 entries by default.
Before a target reaches 2,000 direct children, replace its bounded contents or
remove old addressable child containers. Never treat the engine limits as a
retention policy. Status bars are host chrome and are not document mutations.

## 2. Engine discovery and spawn

Standard resolution order:

1. **Explicit API option** — caller-provided path to the engine executable or CLI entry script
2. **`TEML_CLI` environment variable** — path to the engine artifact
3. **Package-managed path** — vendored or monorepo-relative `dist/cli/main.js`
4. **`teml` on `PATH`**

**Launch rule:** JavaScript entry scripts (`.js`, `.mjs`, `.cjs`) spawn via
`node <script>`. Native executables — including Node SEA single-binary
artifacts described in [ADR 003](adr/003-host-engine-distribution.md) — execute
directly (`<binary> run …`). Do not wrap a native `teml` binary with `node`.

Record diagnostics: resolved program, arguments, absolute path, discovery
source, and `--version` output when available. **Do not silently skip** when no
engine is found — fail fast in tests and at application startup.

**Contract-test fixtures:** integration tests must **fail** (not skip) when a
required engine path is missing. Accept an explicit built artifact via API
option, `TEML_CLI`, or a known monorepo `dist/cli/main.js` — never fall back to
an unpinned download.

Spawn:

```text
<engine> run <view> --width W [--height H] [--no-color]
```

Optional startup flags `--frames` and `--mode` exist, but **do not combine**
them with a stdin `configure` command — the engine rejects `configure` unless
it is the first host command, and CLI flags already negotiate frame delivery.
Pick one path:

- **CLI flags** for fixed negotiation for the whole session (interactive apps), or
- **stdin `configure`** as the first command after the initial frame (headless tests).

Pipe stdin/stdout as **unbuffered binary pipes** (Python: `bufsize=0`; avoid
stdio block buffering that delays NDJSON delivery). Inherit stderr for engine
diagnostics. Flush stdin after every command line. The first stdout event must
be a `frame`.

Session surface (names vary by language):

| Method      | Behavior                                                                            |
| ----------- | ----------------------------------------------------------------------------------- |
| `Spawn`     | Resolve engine, start child, return handle                                          |
| `Send`      | Write one command + `\n`, flush                                                     |
| `Next`      | Read next non-blank event                                                           |
| `NextFrame` | Skip semantic events until `frame`; treat `error` as fatal, `exit` as premature end |
| `Close`     | Close stdin, terminate child, release pipes                                         |

## 3. Frame reconstruction (`ScreenBuffer`)

Maintain:

- `rows[]` — current terminal text (preferred format: ansi or plain)
- `lastSeq` — last applied frame sequence number
- `focusedId`, `viewport`, `scrollRegions`, `protocol`, `capabilities` — metadata from the latest frame

**Full frame** (`plain`/`ansi` string, no `patches`):

1. Require `seq > lastSeq` (seq starts at 1).
2. Split payload on `\n`; strip one trailing newline if present.
3. Replace `rows` entirely.
4. Validate optional metadata (below).

**Patch frame** (`patches` array + `rows` count):

1. Require a prior full frame (`lastSeq > 0`).
2. Require `seq == lastSeq + 1` exactly — **no gaps**. A gap is an error; a later **full** frame with `seq > lastSeq` resynchronizes.
3. For each patch, set `rows[patch.row]` from the patch payload (extend with empty strings as needed).
4. Resize `rows` to `rows` count (truncate or pad).

**Payload preference:** when configured for `ansi`, use `ansi` then fall back to `plain`; when configured for `plain`, reverse.

**Viewport validation** (when present):

- `height == len(rows)`
- `total >= height`
- `offset + height <= total`

**Scroll region validation** (each entry):

- non-empty `id`
- `height >= 1`
- `offset <= total - height`

Copy `focusedId`, `protocol`, and `capabilities` from every frame.

## 4. NDJSON codec

Stdin/stdout arrive in arbitrary chunk sizes. Buffer until `\n`, strip optional
`\r`, drop blank lines. Enforce the 8 MiB line cap while buffering **and**
before sending commands.

Never assume one `read()` equals one message. Read stdout in fixed-size binary
chunks (e.g. 4 KiB) and feed a line splitter.

**Package naming:** avoid stdlib collisions — e.g. do not name your wire-types
module `types` in Python or shadow common names like `protocol` with local
variables. Prefer `teml_host`, `wire`, or language-specific equivalents.

## 5. Terminal lifecycle

**Scope:** terminal helpers are **POSIX-first** (macOS/Linux tty). Windows
ConPTY support varies — document honestly and test on target terminals before
claiming parity.

On startup (host process, not the engine child):

1. Verify stdin/stdout are TTYs if the app is interactive.
2. Save terminal state; enter **raw mode** on stdin.
3. Optionally enable mouse tracking on stdout (xterm SGR: `?\1000h`, `?\1002h`, `?\1006h`).
4. Hide cursor if desired; clear screen before first paint.

On **every** exit path (normal, error, signal, panic):

1. Disable mouse capture.
2. Restore terminal attributes and canonical mode.
3. Show cursor; leave shell usable.

Use a scope guard / `defer` / `finally` so cleanup runs even on panic.

## 6. Painting (ONLCR)

Raw mode disables ONLCR on many platforms: a bare `\n` advances the cursor
down **without** returning to column 0, producing a staircase. Before writing
frame text to stdout, expand `\n` → `\r\n` (or write row-by-row with `\r\n`).

Typical repaint sequence:

1. Clear screen (`ESC [ 2 J`) and move cursor home (`ESC [ H`).
2. Write ONLCR-safe frame text.
3. Flush stdout.

## 7. Input mapping

Translate terminal bytes into `Command` values. Minimum coverage:

| Input                                 | Command                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| Printable (no Ctrl/Alt)               | `char`                                                             |
| Tab / Shift+Tab                       | `key`: `tab` / `shiftTab`                                          |
| Enter / Backspace / Escape            | `key`                                                              |
| Arrow, Home, End, Delete, PageUp/Down | `key`                                                              |
| F1–F12                                | `key`: `f1`…`f12`                                                  |
| Enter + Ctrl                          | `key` `enter` + `modifiers.ctrl`                                   |
| Ctrl+C                                | `exit` (raw mode suppresses SIGINT)                                |
| Terminal resize                       | `resize` with positive `width`/`height`                            |
| Mouse click                           | `pointer` with **0-indexed** row/col                               |
| Mouse wheel                           | `scroll` when engine advertises `scroll`; else `pageUp`/`pageDown` |

**Mouse indexing:** xterm SGR reports **1-based** row/col in the escape sequence. Subtract 1 before sending `pointer`. Some libraries already emit 0-based coordinates — do not double-adjust.

Coalesce resize storms: debounce (~50 ms), emit one `resize` for the final size, stash non-resize events for the next read.

## 8. Event loop contract

For each user input:

1. `Send(command)`
2. Read events until one `frame` (handle `change`/`toggle`/`click`/`error` in between)
3. `Apply(frame)` → `Paint(screen)`
4. On `click` with app logic, optionally `Send(render…)` or `Send(exit)`

Every command except `exit` yields zero or more semantic events followed by
exactly one `frame`. `exit` yields a bare `exit` event.

### Handler driver (the surface most apps should use)

The loop above is boilerplate, and a port that stops there pushes it onto every
application. Ship a driver that owns the loop and calls application handlers, so
app code contains only decisions. Reference implementations:
`crates/teml-host/src/app.rs`, `hosts/go/app/app.go`,
`hosts/python/src/teml_host/app.py`, and `src/interactive/host.ts`
(`runInteractiveApp`).

Keep the contract identical across languages — the point is that one view
behaves the same way whichever language drives it. Four optional handlers,
spelled for the host language:

| Handler                       | Fired on                                     |
| ----------------------------- | -------------------------------------------- |
| `on_change(id, value, ctx)`   | `change` — input or textarea edited          |
| `on_toggle(id, checked, ctx)` | `toggle` — checkbox flipped                  |
| `on_click(id, values, ctx)`   | `click` — button activated                   |
| `on_error(message, ctx)`      | `error` — recoverable protocol error         |

The context exposes exactly six actions: `exit`, `render`, `replace`, `append`,
`remove`, and `values`. Resist adding a seventh in one language only; parity is
the feature.

Required semantics:

- **Queue, don't send.** Handler requests are buffered and flushed after the
  handler returns and before the next input is read, so a handler can never
  interleave commands with the event stream it is being dispatched from.
- **Values.** Maintain a map: `change`/`toggle` update one key (checkboxes as
  `"true"`/`"false"`); a `click` payload is the engine's authoritative snapshot
  and replaces the map wholesale. Return it when the loop ends.
- **Exit.** `exit` produces no frame. After sending it, drain trailing events
  until the `exit` event and treat a closed pipe as an ordinary end. Also handle
  an `exit` event the engine raises on its own.
- **Errors.** A transport failure mid-session is a real error, not an end of
  session. Only the post-exit drain tolerates a closed pipe.
- **Terminal.** Restore raw mode and mouse capture even when the loop fails.
- **Testability.** Provide a headless variant with an injected input source and
  no painting, plus a way to read terminal size, so applications need no separate
  terminal dependency.

Cover the driver with two tests beyond the protocol scenarios: one that a
handler-queued `render` is actually delivered (assert the next keystroke lands in
the replacement document's widget), and one that Ctrl+C ends the session cleanly
with no handlers registered.

## 9. Contract tests

Port the shared scenarios (see `crates/teml-host/tests/session.rs` and
`hosts/go/engine/session_integration_test.go`). All require an **explicit built
engine** — set `TEML_CLI` or use the monorepo `dist/cli/main.js`. **Fail** when
missing; never skip.

Every decoder must also parse
`tests/system/snapshots/interactive-v1.ndjson`, the shared machine-readable
wire-compatibility transcript.

| Scenario                   | Asserts                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| Incident handoff HTML form | typing, radio, textarea, scroll regions, toggle, submit values, re-render preserves ids |
| Full vs patches            | identical `screen.text` after the same script; patches mode emits patch frames          |
| Resize in patch mode       | resize forces full frame; patches resume; focus/state preserved                         |
| Richer keys                | home/delete/f12/page keys, ctrl+enter, viewport metadata                                |
| Pointer columns            | grid button activated by `pointer` row/col                                              |
| Live `update`              | progress widget reaches 100% via bounded patches; requires `update` capability          |
| Document mutations         | append patches reconstruct exactly; replace/remove full frames resynchronize            |

Run headlessly — no TTY required for protocol tests.

## 10. Example application

Ship one interactive demo (account/incident handoff) that:

- loads a shared `view.html` — byte-identical to the other hosts' example views,
  which is the whole thesis made checkable with `shasum`;
- drives it through the handler driver, not a hand-written loop;
- validates on submit in host code;
- re-renders the same view with an inline error on failure (preserve widget ids);
- prints collected values on success.

Document engine resolution and how to run against a built CLI.

## 11. Platform matrix (honest)

| Concern        | Unix tty           | Windows console                     |
| -------------- | ------------------ | ----------------------------------- |
| Raw mode       | widely consistent  | use `x/term`; test ConPTY vs legacy |
| Mouse          | xterm SGR          | terminal-dependent                  |
| Resize signals | async events       | check terminal size API             |
| UTF-8          | set input encoding | verify console UTF-8 code page      |

## 12. Non-goals

- Do not embed a TeML parser/layout engine in the host.
- Do not auto-download unpinned engine binaries.
- Do not passthrough arbitrary escape sequences to the engine.
- Do not couple to a specific CLI framework (Cobra, Click, etc.) — keep the library thin.

## Reference artifacts (informative)

| Artifact                                                                                                   | Role                                           |
| ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [`src/interactive/protocol.ts`](https://github.com/fogha/teML/blob/main/src/interactive/protocol.ts)       | Canonical wire types                           |
| [`examples/interactive/interactive-frame.mjs`](https://github.com/fogha/teML/blob/main/examples/interactive/interactive-frame.mjs) | Frame reconstruction algorithm                 |
| [`examples/rust-host/`](https://github.com/fogha/teML/tree/main/examples/rust-host)                        | First reference host                           |
| [`hosts/go/`](https://github.com/fogha/teML/tree/main/hosts/go)                                            | Second reference host (this playbook's source) |
| [`hosts/python/`](https://github.com/fogha/teML/tree/main/hosts/python)                                    | Third reference host                           |
| [`docs/interactive-protocol.md`](interactive-protocol.md)                                                  | Protocol narrative                             |

When the wire format changes, update the TypeScript module first, then port
the delta to every host library and rerun contract tests against a pinned engine
version.

# TeML CLI reference

Install the prebuilt package from the latest GitHub Release:

```bash
pnpm add --global https://github.com/fogha/teML/releases/latest/download/teml.tgz
```

This downloads the packaged runtime only, not the repository or development
dependencies. Requires Node 20 or newer and pnpm 10 or newer.

After installation, `teml --help` gives an overview and
`teml help <command>` gives detailed behavior and examples for one command.

## Commands

| Command | Description |
| --- | --- |
| `teml demo` | Render the built-in showcase; no input file or network needed |
| `teml [file]` | Default: same as `view` |
| `teml view [file]` | One-shot render to stdout (ANSI when capable; pipe-safe) |
| `teml read <file\|directory>` | Full-screen Reader: scroll, links, search, TOC, and confined file browsing (TTY required) |
| `teml convert [file]` | Convert to another format (`--to`) |
| `teml inspect [file]` | Dump AST, tokens, or render tokens |
| `teml render [file]` | Deterministic plain snapshot (`--width`) |
| `teml run [file]` | Run an interactive session: NDJSON commands in on stdin, NDJSON events out on stdout — see `docs/interactive-protocol.md` |

For commands other than `read`, `file` may be `-` or omitted to read
**stdin**. Reader reserves stdin for keyboard input and therefore requires a
file or directory path plus a controlling TTY.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Read/parse failure |
| 2 | Invalid flags or usage |

**stdout** carries rendered or converted output only. **stderr** carries `teml: warning:` diagnostics and `teml: debug:` timings.

## Input / output

| Flag | Values | Default |
| --- | --- | --- |
| `--from` | `teml`, `markdown`, `html` | By extension, else sniff |
| `--to` | `teml`, `markdown`, `text`, `speech`, `json` | `teml` (convert only) |

## Layout & terminal

| Flag | Description |
| --- | --- |
| `--width N` | Layout width in columns |
| `--theme NAME\|PATH` | `dark`, `light`, `mono`, `auto`, or JSON path |
| `--no-color` | Disable ANSI colors |
| `--color` | Force colors even when piped |
| `--ascii` | ASCII borders and decoration glyphs |
| `--ambiguous-wide` | Treat ambiguous-width Unicode as 2 cells |
| `--wrap-code` | Wrap code block lines instead of truncating |
| `--show-urls` | Always show link URLs in visible text |
| `--profile NAME\|PATH` | HTML profile (`bootstrap` built-in) |
| `--base URL\|PATH` | Base for relative link resolution |
| `--allow-file-links` | Allow `file:` scheme links |
| `--debug` | Print stage timings to stderr |

## Inspect modes

| Flag | Output |
| --- | --- |
| `--ast` | Normalized AST JSON (default) |
| `--tokens` | AST token stream (`heading_start level=1`) |
| `--render-tokens` | Layout token stream after layout |

## App runtime

`teml run` is headless: a host process owns the TTY and exchanges NDJSON
commands/events over standard input/output.

`--frames ansi|plain|both` selects the frame payload, `--mode full|patches`
selects delivery, and `--height N` seeds the terminal-content viewport at
process startup. Without them, the backward-compatible defaults are `both`,
`full`, and no viewport. Production hosts should pass all three (plus
`--width`) so frame 1 is already bounded and needs no negotiation round trip.
Hosts can instead send
`{"type":"configure","frames":"ansi","mode":"patches"}` as their first
command to negotiate one payload plus row-level patches. See
[interactive-protocol.md](interactive-protocol.md) for the wire shapes,
sequence checks, capability discovery, and patch application algorithm.

Hosts should also forward debounced terminal size changes as
`{"type":"resize","width":100,"height":30}`. TeML reflows at the new width,
preserves widget state, and returns a complete resynchronization frame before
patch delivery resumes.

Interactive documents may contain buttons, single-line inputs, checkboxes,
radio groups, fixed-height textareas, and bounded `:::scroll` regions. Hosts
forward wheel/trackpad movement as coalesced
`{"type":"scroll","rows":3}` commands (positive down); reference hosts fall
back to PageUp/PageDown when an older engine does not advertise `scroll`.
Protocol 1.3 hosts may also send capability-gated `replace`, `append`, and
`remove` commands for addressable containers; these are document mutations,
not row patch frames.

## Reader

`teml read` owns the alternate screen and restores terminal modes on normal
exit, SIGINT, SIGTERM, SIGHUP, and catchable failures. SIGKILL cannot be
handled in-process; use `reset`, a new terminal, or an outer tmux/screen
session if recovery is needed.

Reader navigation is confined to the initially selected file's directory,
directory argument, or explicit `--base`. External `http`, `https`, and
`mailto` links require an in-viewer confirmation before the operating-system
opener is invoked. Reader never emits host application events, and interactive
widgets remain inert.

See [reader.md](reader.md) for the complete keymap and security behavior.

## Examples

```bash
# Verify the installation with the built-in showcase
teml demo

# View TeML (default command)
teml report.teml

# Full-screen Reader
teml read README.md
teml read docs/

# Service command-center demo (TeML + synchronized HTML)
teml view examples/service-command-center.teml --theme dark --width 100
teml view examples/service-command-center.html --width 100
pnpm run demo:command-center

# Plain pipe-friendly output
teml examples/demo.teml --no-color | less

# Convert HTML → TeML
teml convert page.html --from html --to teml > page.teml

# Markdown round-trip check
teml convert README.md --from markdown --to teml

# Deterministic snapshot for tests
teml render examples/demo.teml --width 80 > out.txt

# Linear accessibility output
teml convert examples/demo.teml --to speech

# Debug parse/layout timings
teml view examples/demo.teml --debug

# Stdin
curl -sL https://example.com/doc.html | teml view --from html --width 100
cat report.teml | teml --no-color

# Interactive session: NDJSON commands in, NDJSON events out (see docs/interactive-protocol.md)
printf '%s\n' '{"type":"char","char":"hi"}' '{"type":"resize","width":40,"height":20}' \
  '{"type":"key","key":"end"}' '{"type":"key","key":"pageDown"}' \
  '{"type":"key","key":"tab"}' '{"type":"exit"}' \
  | teml run form.teml --width 60 --height 20 --frames plain --mode patches

# Interactive examples (require a real TTY)
pnpm run demo:interactive
pnpm run demo:log-viewer
pnpm run demo:settings
pnpm run demo:rust-host
```

When the document exceeds the reported height, frames carry viewport metadata
and contain only visible rows. Pointer coordinates are frame-relative and
column-precise. Negotiated full frames include protocol/capability metadata;
visible nested regions include `scrollRegions` offsets. See
[interactive-protocol.md](interactive-protocol.md) for the full routing table,
viewport/patch invariants, and host guidance.

## Environment

| Variable | Effect |
| --- | --- |
| `NO_COLOR` | Disables color (also honored when set) |
| `COLORTERM=truecolor` | Prefer 24-bit color |
| `COLUMNS` | Fallback width when not a TTY |

Piped stdout automatically disables color unless `--color` is set — **except**
for `teml run`, whose stdout is always a protocol pipe rather than a
terminal; it assumes the *host's* real terminal supports color/Unicode by
default, so `--no-color`/`NO_COLOR` are the way to opt out there.

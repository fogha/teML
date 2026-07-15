# TeML Reader (`teml read`)

`teml read` is the v1.5 full-screen viewer for TeML, Markdown, and HTML
documents. It is a document reader, not an application host:

- `teml view` remains a one-shot, pipe-safe render to stdout.
- `teml read` owns a real TTY, enters raw mode and the alternate screen, and
  restores both when it exits through a catchable path.
- `teml run` remains the headless NDJSON application protocol described in
  [interactive-protocol.md](interactive-protocol.md).
- `button`, `input`, and `checkbox` controls are visible but inert in Reader
  mode. Reader never emits host-application events.

## Usage

```bash
teml read report.teml
teml read README.md
teml read docs/page.html
teml read docs/
```

Reader requires a controlling TTY on stdin and stdout. Use `teml view` for
stdin documents, pipes, redirected output, snapshots, and automation.

When the argument is a directory, Reader shows a confined browser containing
subdirectories and `.teml`, `.md`, `.markdown`, `.html`, and `.htm` files.

## Keymap

| Key | Action |
| --- | --- |
| `j`, Down | Scroll down one row |
| `k`, Up | Scroll up one row |
| Page Down, Space | Scroll down one page |
| Page Up | Scroll up one page |
| Home, `g` | Start of document |
| End, `G` | End of document |
| Mouse wheel | Scroll |
| Tab / Shift+Tab | Focus next / previous link |
| Enter | Follow the focused link or choose a dialog action |
| `b` | Back in local navigation history |
| `f` | Forward in local navigation history |
| `/` | Start incremental search |
| `n` / `N` | Next / previous search result |
| `t` | Toggle table of contents |
| Backspace | Leave search/TOC/dialog, otherwise navigate back |
| Escape | Cancel the current search/dialog, otherwise quit |
| `q` | Quit |
| `?` | Toggle key help |

All Reader behavior is keyboard-accessible. Mouse input is an optional
convenience, never the only way to perform an action.

## Link security

The Reader session fixes a **document root** when it starts:

- for a file, the file's containing directory;
- for a directory, that directory;
- when `--base` is supplied, the resolved base after validation.

Every activation is re-resolved against that fixed root. Relative local links
may open in Reader only when their normalized target remains at or below the
root. An out-of-root target is rejected with a visible warning; it is not
silently converted into an external open.

`http`, `https`, and `mailto` targets require an in-viewer confirmation before
Reader invokes the platform opener. Cancel is selected by default. Merely
viewing a document can never open a URL or run an application.

`file:` remains disabled unless `--allow-file-links` is explicitly supplied,
and enabled file targets are still subject to document-root confinement.

## Search, TOC, and history

Search is incremental and case-insensitive. Matches are computed from the
plain semantic text after layout; `n` and `N` move between results.

The table of contents is derived from document headings and selecting an item
scrolls to its laid-out row. Local navigation history stores each document's
path, scroll position, and focused link so Back and Forward restore reading
context.

## Terminal restoration

Reader restores raw mode, mouse mode, cursor visibility, and the alternate
screen on:

- normal exit (`q`, Escape, input end);
- SIGINT, SIGTERM, and SIGHUP;
- catchable uncaught errors handled by the Reader boundary.

SIGKILL (`kill -9`) cannot be caught by any in-process program, so automatic
cleanup is impossible. If a terminal is left in an unusual mode after
SIGKILL, run `reset`, open a new terminal, or use an outer tmux/screen session.

## Speech output

`teml convert FILE --to speech` emits deterministic linear UTF-8 text derived
from the semantic AST. It names headings, roles, links, tables, and inert
widgets without ANSI styling. v1.5 does not provide live spoken announcements
while navigating Reader; live focus integration is deferred to the app
runtime.

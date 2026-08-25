// cli/help.ts — detailed, tested help text kept out of the command wiring.

const DOCS_URL = "https://github.com/fogha/teML#readme";

export function shouldShowRootHelp(args: readonly string[], stdinIsTTY: boolean): boolean {
  return args.length === 0 && stdinIsTTY;
}

export function cleanCommanderError(message: string): string {
  return message.trim().replace(/^error:\s*/i, "");
}

export const ROOT_HELP = `
How to use TeML:
  Static output   teml <file>                 Render TeML, Markdown, or HTML once
  Reader          teml read <file|directory>  Browse, search, and follow links in a TTY
  App runtime     teml run <file>             Drive interactive widgets over NDJSON

Start here:
  $ teml demo
  $ teml README.md
  $ teml read docs/
  $ teml convert page.html --to teml

Input:
  File extensions select TeML (.teml), Markdown (.md), or HTML (.html).
  Use '-' or pipe data to stdin for commands with an optional file.
  Piped output is plain text unless --color is explicitly supplied.

More help:
  $ teml help view
  $ teml help read
  $ teml help convert
  $ teml help run

Documentation: ${DOCS_URL}
`;

export const DEMO_HELP = `
Render the built-in TeML showcase. No file or network connection is needed.

Examples:
  $ teml demo
  $ teml demo --theme mono
  $ teml demo --ascii --no-color
  $ teml demo --width 100
`;

export const VIEW_HELP = `
Render one document and exit.

TeML infers the input format from the file extension. Use --from when reading
stdin or when the extension is ambiguous. ANSI color is enabled for capable
terminals and disabled automatically when output is redirected.

Examples:
  $ teml report.teml
  $ teml view README.md --width 100
  $ teml view page.html --theme dark
  $ curl -sL https://example.com/page.html | teml view --from html
  $ teml report.teml --no-color | less
`;

export const READ_HELP = `
Open a document or directory in the full-screen Reader.

Reader requires a real TTY. Navigation stays inside the initial directory (or
--base), and external links require confirmation before the operating-system
opener runs. Interactive form controls are intentionally inert in Reader.

Essential keys:
  Up/Down, j/k       Scroll
  PageUp/PageDown    Move one page
  /                  Search
  n / N              Next / previous match
  t                  Table of contents
  Enter              Open the focused link
  b / f              Back / forward
  ?                  Complete in-Reader help
  q                  Quit

Examples:
  $ teml read README.md
  $ teml read docs/
  $ teml read docs/ --base docs/
`;

export const CONVERT_HELP = `
Convert TeML, Markdown, or HTML to another representation.

Output formats:
  teml       TeML source (default)
  markdown   CommonMark/GFM; TeML-only constructs degrade with diagnostics
  text       Deterministic plain terminal layout
  speech     Linear semantic text for accessibility and automation
  json       Normalized TDoc AST

Examples:
  $ teml convert page.html --to teml > page.teml
  $ teml convert README.md --to json > document.json
  $ teml convert report.teml --to speech
  $ cat page.html | teml convert --from html --to markdown
`;

export const RENDER_HELP = `
Create deterministic plain-text output for snapshots, tests, and generated
artifacts. Render never emits ANSI escape sequences and defaults to width 80.

Examples:
  $ teml render report.teml > report.txt
  $ teml render README.md --width 100
  $ teml render code.teml --wrap-code
`;

export const INSPECT_HELP = `
Inspect TeML's normalized document and layout internals.

Modes:
  --ast             Normalized TDoc JSON (default)
  --tokens          Depth-first AST token stream
  --render-tokens   Token stream after width-aware layout

Examples:
  $ teml inspect report.teml
  $ teml inspect report.teml --tokens
  $ teml inspect report.teml --render-tokens --width 60
`;

export const RUN_HELP = `
Run an interactive document engine over newline-delimited JSON (NDJSON).

This is the language-agnostic integration API: your host owns the TTY, sends
key/character/pointer commands on stdin, and receives semantic events plus
rendered frames on stdout. Node applications should normally use the simpler
runInteractiveApp() API exported by "teml/interactive".

Supported interactive HTML elements include labelled text inputs, textareas,
radio groups, checkboxes, and buttons. TeML also supports fixed-height
:::scroll regions. See the protocol documentation for schemas and key routing.

Every frame carries both a plain and an ANSI rendering by default. Production
hosts should pass --frames, --mode, and --height at startup so the first frame
is already single-format, patch-enabled, and viewport-bounded. Alternatively send
{"type":"configure","frames":"ansi","mode":"patches"} as the first stdin line
to negotiate one payload plus changed-row patches. Use one or the other:
--frames/--mode lock negotiation, so a later configure is rejected and its
settings are not applied (--height alone leaves negotiation open).
Forward live TTY dimensions with
{"type":"resize","width":100,"height":30}; resize preserves widget state and
returns a complete frame before patches resume. Documents taller than the
reported height emit viewport-bounded frames and auto-scroll with focus.
Pointer row/col coordinates resolve exact terminal-cell widget regions.
Keys include arrows, Home/End/Delete, PageUp/PageDown, F1-F12, and optional
Ctrl/Alt/Shift modifiers.
Negotiated full frames advertise protocol 1.3 capabilities. Forward coalesced
wheel input with {"type":"scroll","rows":3}; positive rows move down.
Addressable containers support capability-gated replace/append/remove commands.

Examples:
  $ teml run form.html --width 60
  $ teml run form.teml --frames plain
  $ teml run dashboard.teml --frames ansi --mode patches --height 24
  $ node examples/interactive/interactive-host.mjs examples/interactive/log-viewer.teml
  $ pnpm run demo:interactive

Protocol: https://github.com/fogha/teML/blob/main/docs/interactive-protocol.md
`;

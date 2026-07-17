# Changelog

All notable changes to this project are documented in this file. Public
versioning starts at 0.1.0; the v1.0 and v1.5 labels below are earlier internal
development milestones, not published package versions.

## v0.1.0 — Initial public preview (2026-07-17)

- Added `LICENSE` (MIT) and package metadata (`author`, `keywords`,
  `prepublishOnly`) so the package is ready for a real `npm publish` when
  that time comes.
- Unified CLI versioning on `readVersion()` (reads `package.json` once,
  cached) instead of a second hardcoded version string in `src/cli/main.ts`
  that could drift from `package.json`.
- The build now `chmod`s `dist/cli/main.js` explicitly so the bin script is
  executable immediately after `npm run build`, without depending on
  install-time behavior.
- Added ESLint (flat config, `typescript-eslint` recommended rules) and
  Prettier, wired up as `lint`, `lint:fix`, `format`, and `format:check`
  scripts; fixed everything both tools flagged across `src/`, `tests/`,
  `scripts/`, and `examples/`.
- CI now runs functional tests on Windows, Ubuntu, and macOS; package and
  performance verification run as dedicated Linux jobs.
- Added this changelog and `CONTRIBUTING.md` (dev setup, test layout, code
  style, PR expectations); reframed the README's quick start so the first
  thing a stranger sees works today (clone + build) rather than assuming an
  npm publish that hasn't happened yet.
- Added a prebuilt `teml.tgz` GitHub Release artifact, a built-in `teml demo`,
  detailed root/subcommand help, and GitHub-only installation docs.
- Running `teml` with no arguments in an interactive terminal now shows help
  instead of silently waiting for stdin; piped stdin behavior is unchanged.

## v1.5 — Reader, shared terminal client, and security hardening

- Added `teml read`: a full-screen Reader (scrolling, incremental search,
  table of contents, link navigation with external-link confirmation,
  history, directory browsing) built on a new shared terminal client
  (`src/terminal/client/`: input decoding, raw-mode/alt-screen lifecycle,
  damage-diff screen rendering) also used by `teml run`.
- Added semantic layout regions (`src/layout/regions.ts`) so the Reader can
  hit-test headings and links against the laid-out document.
- Added a `--to speech` output format (`src/render/speech.ts`) that renders a
  linear, non-ANSI semantic text form of a document for accessibility and
  scripting use cases.
- Documented the three-way interactivity split (Static / Reader / App modes)
  and the Reader's security boundary in `docs/spec.md`, `docs/reader.md`,
  and two new ADRs (`docs/adr/001-terminal-client-ownership.md`,
  `docs/adr/002-read-command-and-mode-boundary.md`).
- Security fixes found in a full-codebase audit:
  - Windows command injection in the Reader's "open external link" path
    (switched from `cmd /c start` to `explorer.exe`).
  - A `--base` confinement bypass for `http(s)` links that let a sibling
    path with a shared prefix (e.g. `docs-secret` vs. `docs`) escape the
    configured base.
  - Theme injection / local file probing via document frontmatter (stricter
    decoration-glyph validation; frontmatter `theme:` is now restricted to
    built-in theme names).
  - Invalid-color-triggered malformed ANSI SGR sequences (strict hex-color
    validation in both frontmatter parsing and the ANSI renderer).
  - Two CPU-exhaustion denial-of-service vectors: pathologically deep `:::`
    container nesting in TeML, and pathologically deep list/blockquote
    nesting in Markdown/TeML — both now degrade to a plain-text fallback
    with a diagnostic warning instead of costing superlinear parse time.
  - A crash-safety gap in `teml read` where an uncaught exception could
    leave the terminal in raw mode / the alternate screen; the Reader now
    guarantees terminal-state restoration via global `uncaughtException`/
    `unhandledRejection` handlers for the lifetime of the session.
  - Reader overlay bugs: pointer/wheel input could reach the hidden
    document while an overlay (TOC, help, external-link confirmation) was
    open; malformed percent-encoded URIs in links crashed the session
    instead of being rejected gracefully.

## v1.0 — Initial implementation

- TeML, Markdown, and HTML frontends into a shared `TDoc` AST; width-aware
  layout; ANSI and plain renderers; JSON themes (`dark`, `light`, `mono`,
  `auto`); the `teml` CLI (`view`, `convert`, `inspect`, `render`, `run`);
  the NDJSON interactive protocol and in-process `runInteractiveApp` API;
  the initial security posture (single ANSI-emitter invariant, sanitize-at-
  ingestion, link-scheme allowlisting).

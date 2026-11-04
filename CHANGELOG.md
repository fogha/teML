# Changelog

All notable changes to this project are documented in this file. Public
versioning starts at 0.1.0; the v1.0 and v1.5 labels below are earlier internal
development milestones, not published package versions.

## Unreleased — Error completion and host correctness (protocol 1.5)

- Added `frame` to `error` events and the `errorCompletion` capability. Semantic
  rejections retain their unchanged following frame (`frame:true`); malformed
  input completes without one (`frame:false`). Python, Go, and Rust consume the
  correct completion event, preventing rejected commands from dropping later input.

- Python terminal input now preserves fragmented UTF-8, consecutive mouse and
  keyboard sequences, bare Escape, Shift+Tab, Delete, and page navigation.

- TeML and Markdown serialization preserves inline-code backticks/backslashes and
  link destinations containing spaces or parentheses. Reader opens absolute
  directory-entry paths literally, including filenames with `#`, `%`, and `%20`.

## Unreleased — Forms, validation, and masked input (protocol 1.4)

- Added `:::form{id label}` grouping and `::button{submit}`. Activating a submit
  control in a form whose fields are all valid emits one atomic
  `{"type":"submit","form":…,"values":…}` event **instead of** `click`, with the
  same value scope as `click.values`, so a host learns no second scoping rule and
  cannot double-fire. Protocol minor 1.3 → 1.4; the command set is unchanged and
  the new capabilities (`mask`, `validation`, `formSubmit`) are advertised
  separately, so a host can adopt masking without validation. Forms nest nowhere:
  a nested form, or one inside `:::scroll`, is flattened with a
  `form-nested-form` diagnostic.

- Added `::input`/`::textarea` validation: `required`, `pattern`, `minLength`,
  `maxLength`, and `count`. `pattern` is anchored to the whole value so a partial
  match cannot pass, and a pattern that fails to compile is dropped with a
  warning rather than silently never matching. Length counts **Unicode code
  points** by default, matching JSON Schema, so the engine cannot accept a value
  the server rejects; `count="graphemes"` opts into user-perceived characters.
  Constraints are inert outside a form. A failing field renders one `role=error`
  line and blocks the submit; the message appears only after a failed submit and
  clears when the field is edited. The session is the sole validator — layout
  only draws the messages it is given.

- Added `mask` on `::input`/`::textarea`, rendering one `•` (`*` without
  Unicode) per grapheme and preserving the caret position. **This fixed a
  cleartext-password defect**: the HTML frontend mapped `<input type="password">`
  to an ordinary `::input`, so a password value was rendered verbatim in every
  frame. That now maps to `mask="password"`. Masking is a display transform — the
  real value still reaches hosts in `change`/`submit`/`click` payloads — and a
  test asserts it never appears in `plain`, `ansi`, or patch frames.

- Added `schemaToTeml` and `valuesToResponse` (exported from the package root) for
  MCP elicitation form mode, as pure functions requiring no protocol change.
  `schemaToTeml` emits a form for the constraints this engine can actually
  enforce and **refuses** the rest — `minimum`/`maximum`/`multipleOf`,
  multi-select arrays, and secret-bearing schemas — with a diagnostic rather than
  silently dropping a constraint the server would then enforce against input the
  form accepted. `valuesToResponse` coerces by schema type, drops control-button
  ids, and omits untouched optionals instead of sending `""`.

- Added form, masking, and constraint support to the HTML frontend (`<form>` →
  `:::form`, submit controls → `submit`, `required`/`minlength`/`maxlength`/
  `pattern` carried across, `type="password"` masked).

- Added `submit`/`on_submit` to all four host libraries. Fixing the Go and Python
  loops surfaced a forward-compatibility bug: Go's event `switch` had no
  `default`, so an event type it did not recognize was dropped *and* skipped the
  step that completes the command. All three subprocess hosts (Rust, Go, Python)
  now complete the command an unknown event answers, and every library surfaces
  the event (`on_error`/stderr with the preserved wire type) instead of
  discarding it — the Rust loop previously did neither and would have waited
  forever for a frame that a newer engine considered already delivered; the
  Node host keeps dispatching, as an in-process host has no frame-wait to
  abandon. App-level dispatch is regression-tested in every subprocess host
  against a scripted fake engine (`fixtures/engine/fake-engine.mjs`) for both
  `submit` and unknown events, which the real engine cannot produce on demand.

- The form-id namespace is now enforced, not just documented: the
  addressability walk registers `:::form` ids in the same `seen` set as widget
  ids, so a form/field collision or a duplicate form id warns
  (`form-duplicate-id` / `focus-duplicate-id`) and the later duplicate loses its
  id — a duplicate form's fields stop belonging to any form rather than
  silently merging under one submit target.

- The reference example host handles `submit` (it previously fell through to
  `default` and showed nothing), `examples/interactive/interactive-form.teml`
  now demonstrates a real form (radio, `required`, `pattern`, `mask`,
  `maxLength`, submit), and `pnpm run demo:elicitation` runs a new
  schema→form→engine→response elicitation example.

- Documentation: restored the product direction as `docs/product.md` (milestones,
  non-goals, and adoption metrics only — no normative syntax, so it cannot drift
  from the spec); corrected the fence rule in `docs/spec.md`, which read as
  depth-from-inside and produced silently mis-nested documents; corrected the
  focusable-widget list in `docs/interactive-protocol.md`, which omitted
  `textarea`, `radio`, and `scroll`; added an adoption-ladder section to
  `docs/maintenance.md` recording that none of the program metrics is measured.

## v0.3.0 — Handler-driven hosts, registry publishing (2026-07-29)

- Added registry publishing. `teml` was a 404 on npm and `teml-host` a 404 on both
  crates.io and PyPI, while the Rust README told readers to depend on
  `teml-host = "0.1"` regardless; the only installable host was Go, because Go
  modules resolve straight from the repository. Nothing had ever published them —
  the release workflow only created a GitHub Release. Publishing now runs on a tag
  after every gate passes, and each package's version is independent of the tag, so
  a job is a no-op unless that version is new. The packages therefore become
  installable when this version is tagged and released; until then the GitHub
  Release tarball and the Go module remain the only working installs.

  Three packaging defects surfaced while dry-running the artifacts. The crate
  shipped integration tests that read a view from a sibling example directory
  outside the package and need a running engine, so `cargo test` on the published
  crate could only fail. The Python package had no project URLs, leaving its PyPI
  page with no link to the source, and shipped no license text while the crate
  ships one. Building the Go example dropped an untracked binary in `hosts/go`.

- Added a handler-style driver to the Rust, Go, and Python host libraries, so an
  application supplies `on_change`/`on_toggle`/`on_click`/`on_error` handlers
  instead of hand-writing the NDJSON event loop. `teml_host::run`,
  `app.Run`, and `teml_host.run` each spawn the engine, hold raw mode, paint every
  frame, restore the terminal even on failure, and return the final widget values;
  a handler acts on the session through the same six context actions the Node
  host already exposed (`exit`, `render`, `replace`, `append`, `remove`,
  `values`). Each library also gained a headless variant with an injected input
  source for testing.

  Only Node had this ergonomic before, which meant the polyglot hosts — the
  reason the protocol exists — were the least pleasant way to use it. Every
  application repeated the same loop, including a subtle exit path that had to
  keep draining events after sending `exit`. The three example applications lost
  roughly half their code (Rust 117 → 67, Go 190 → 96, Python 204 → 49
  non-comment lines) and no longer contain any terminal or loop plumbing, while
  the lower-level session stays public for applications that need unusual
  control.

- `SessionOptions::for_terminal` (Rust) and `app.ForTerminal` (Go) read the
  terminal size, so a host application no longer needs its own terminal
  dependency just to seed the first frame; the Rust example dropped its direct
  crossterm dependency entirely.

- Made the pathological-input guards' wall-clock budgets overridable with
  `TEML_NESTING_PARSE_BUDGET_MS`, matching the performance suite. Six of them sat
  in the invariants suite with fixed budgets, so a loaded machine could fail a
  must-pass gate — and that gate now blocks publishing. Each guard still asserts
  semantically that the hostile input is neutralized; only the timing canary
  beside it moves. CI allows 5000 ms, which still fails decisively on the
  multi-second blowups these exist to catch.

## v0.2.1 — Windows correctness (2026-07-29)

- Fixed `teml read` on Windows, where every entry of a directory listing was
  rejected as `unsupported link scheme 'c:'`, making directory browsing
  impossible. A drive letter is also a syntactically valid URL scheme, so the
  absolute hrefs a listing builds were parsed as URLs; they now resolve as
  filesystem paths, still confined to the document root. `--base C:\docs` was
  refused for the same reason and is now accepted. Document href sanitization
  deliberately continues to reject drive-qualified paths, so an untrusted
  document cannot address the local filesystem.
- Fixed the S-2 escape-sequence invariants, which compared filesystem paths
  spelled with `/` and therefore did not hold on Windows. The adversarial-corpus
  check silently dropped every hostile HTML fixture and passed without ever
  loading it; the corpus now refuses to report success when a fixture kind is
  missing.
- Fixed `pnpm pack` invocation in the packaging and release scripts, which could
  not launch pnpm's `.cmd` shim on Windows and so failed before exercising the
  installed CLI.
- Stopped the host-engine conformance install from writing the committed
  lockfile, where it recorded an integrity hash that changed on every
  `release:pack`.
- Made the bundled-asset tests assert that their assets exist instead of
  skipping when absent, and replaced a tick-counting Reader test with one that
  waits for the expected output.

The CI matrix now passes on Linux, macOS, and Windows. It had never been green
before this release, which is what allowed the Windows defects above to ship.

## v0.2.0 — Interactive protocol 1.3 and polyglot hosts (2026-07-29)

- Added frame-format negotiation to the `teml run` host protocol: an
  optional first-command `configure` command (or `teml run --frames
ansi|plain|both`) trims every frame to a single payload, with the dropped
  field sent as `null` so existing host decoders keep working. Sessions
  that never negotiate are byte-identical to the v1 wire format. See
  `docs/interactive-protocol.md` (including a new versioning note).
- Added opt-in row-level patch frames with `configure.mode: "patches"`.
  Routine updates transmit only changed rows while initial, document
  replacement, and recovery frames remain complete resynchronization points.
  The JavaScript and Rust reference hosts reconstruct patch frames and reject
  sequence gaps rather than painting potentially desynchronized output.
- Added the interactive `resize` command. Node and Rust hosts now forward
  coalesced live terminal dimensions; sessions reflow at the new width while
  preserving values, focus, input cursors, checkbox state, and negotiation.
  Resize frames are complete patch-mode resynchronization points.
- Added viewport-bounded interactive rendering when terminal height is known.
  Oversized documents emit `viewport: {offset,height,total}`, focus movement
  keeps widgets visible, PageUp/PageDown scroll cached physical rows, and a
  10,000-line input benchmark remains below the 5 ms p95 budget.
- Added terminal-cell column hit-testing for widgets. Side-by-side grid
  controls now resolve the intended pointer target, including after viewport
  scrolling, while clicks in gutters remain harmless no-ops.
- Expanded interactive keys with Up/Down, Home/End/Delete, PageUp/PageDown,
  F1–F12, and optional Ctrl/Alt/Shift modifiers. The shared Node decoder and
  Rust crossterm host now forward those keys without lossy Tab synthesis.
- Added protocol 1.1 discovery metadata with a finite capability vocabulary.
  Pre-negotiated frame 1 (or a valid `configure` acknowledgement) lets
  independently versioned hosts feature-gate additions while the default v1
  transcript remains byte-identical.
- Added protocol 1.2 live `update` commands for addressable `progress` and
  `metric` widgets. A typed mutable-attribute allowlist, shared identity
  registry, and block-level layout cache preserve focus, scroll, and bounded
  patches without re-parsing markup.
- Added protocol 1.3 targeted `replace`, `append`, and `remove` document
  mutations for addressable containers. Fragments pass the normal
  parse/sanitize/normalize pipeline, surviving interactive state is preserved,
  structural uncertainty resynchronizes with full frames, and bounded scroll
  appends use incremental tail layout.
- Added signed, row-granular `scroll` commands with viewport clamping,
  empty-patch no-ops at bounds, and coalesced wheel handling in both reference
  hosts.
- Added contextual input routing so radio groups, textareas, and scroll
  containers consume documented local keys before global focus/document
  behavior, including exact residual scroll bubbling.
- Added structured `:::radio`/`::option` groups, fixed-height multiline
  `::textarea` fields, native HTML radio/textarea mapping, selection/value
  preservation, and terminal-cell pointer behavior.
- Added focusable fixed-height `:::scroll` regions over cached static content,
  optional `scrollRegions` frame metadata, bounded patches, and a log-viewer
  example. Nested interactive controls remain intentionally unsupported.
- Rebuilt the interactive examples around distinct end-to-end journeys:
  TeML composite widgets, bounded log navigation, an in-process HTML workspace
  profile, and a Rust-hosted incident handoff with capability-aware scrolling.
- Added `teml run --mode full|patches` and `--height N` startup flags. The
  reference hosts now pre-negotiate format/mode and seed terminal dimensions,
  so frame 1 is viewport-bounded and cannot race early user input.
- Hardened the NDJSON runtime with UTF-8-safe chunk decoding, 8 MiB line,
  4 MiB render, and 64 KiB character-command limits, plus stdout backpressure
  and broken-pipe handling. Oversized lines are discarded recoverably.
- Package verification now runs an installed `teml run` protocol session and
  the public `teml/interactive` API exports wire codecs/types as well as the
  in-process host.
- Added demand-gated Rust, Go, and Python host libraries with a shared v1
  conformance transcript, capability-aware input fallback, artifact-neutral
  engine discovery, and release-tier tests against the installed `teml.tgz`.
- Completed the Node SEA distribution spike with a green macOS arm64 smoke and
  acceptable startup delta. The native-port feasibility RFC is a no-go for now:
  harden optional SEA artifacts first and keep one canonical Node engine.
- Consolidated all 21 completed planning tickets into the protocol,
  specification, host playbook, and ADRs; the active protocol backlog is empty.
  Published artifacts now include stable user-facing docs instead of internal
  planning files.
- Removed an orphaned Vitest configuration, an unused key-value layout stub,
  stale snapshot-directory metadata, and unnecessary fixture placeholders.
- Audited the complete host backlog and added explicit foundations for
  contextual key routing, updatable widget identity, protocol capabilities,
  host/engine distribution, and targeted document mutation. Restored the
  polyglot-host architecture and demand-gate document.
- Reorganized testing around integrated system journeys for the built CLI,
  complete document corpus, NDJSON runtime, patch replay, resize, and
  in-process Node host. Redundant happy-path and per-fixture test cases were
  removed while security, parser-limit, layout, protocol, lifecycle,
  snapshot, package, Rust-host, and performance invariants remain explicit.
- Fixed TeML serialization of literal colon-number text such as timestamps
  (`17:41`), discovered by the new HTML → TeML → terminal corpus journey.
- Hardened link and text sanitization: hrefs are vetted in the exact trimmed
  form a consumer would open (so `" javascript:…"` no longer reads as a
  relative path), a backslash ahead of the scheme separator is rejected,
  U+2028/U+2029 are stripped, code-block languages are sanitized, and footnote
  ids are trimmed identically on both the reference and definition side.
- Added parser guards for pathological input. A long run of emphasis
  delimiters exhausted the stack inside micromark before any TeML recursion
  ran; such documents, and any input that still overflows, now degrade to
  literal text with a diagnostic instead of crashing. The nesting guards also
  apply to `parseInline` and `parseToMdast`.
- Clamped an explicit `--width` to the same upper bound as detected widths, so
  a very large value can no longer make layout allocate for tens of seconds.
- Fixed layout and render correctness: `::kv` pads keys by terminal cells
  rather than UTF-16 length (aligning CJK keys), a grapheme wider than the
  whole line is replaced instead of overflowing the caller's width budget, and
  `warning` spans keep a visible marker when colour is unavailable.
- Fixed scroll-region cache invalidation to compare a snapshot of the laid-out
  children, so mutating the live array in place no longer serves stale rows.
- Enforced the document block budget on `render` and at session construction,
  and applied the markup size limit to in-process callers as well as the wire
  decoder.
- Made an HTML profile survive bad input: an unknown container directive is
  rejected at load time and a malformed `titleFrom` selector is skipped with a
  diagnostic instead of aborting the conversion.
- Hardened process lifecycle and error reporting: a failed terminal setup rolls
  back the modes it already enabled, interactive session failures report to
  stderr and to the host, Reader diagnostics print after the terminal is
  restored, and static command output tolerates a closed pipe.
- A rejected `configure` now names which of the three causes applied and lists
  every requested setting the session is not honoring, instead of always
  reporting an ordering problem.

## v0.1.0 — Initial public preview (2026-07-17)

- Added `LICENSE` (MIT) and package metadata (`author`, `keywords`,
  `prepublishOnly`) so the package is ready for a real `npm publish` when
  that time comes.
- Unified CLI versioning on `readVersion()` (reads `package.json` once,
  cached) instead of a second hardcoded version string in `src/cli/main.ts`
  that could drift from `package.json`.
- The build now `chmod`s `dist/cli/main.js` explicitly so the bin script is
  executable immediately after `pnpm run build`, without depending on
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
  and two new ADRs (001 and 002, now consolidated in
  [architecture.md](docs/architecture.md)).
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

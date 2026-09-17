# Maintenance backlog

Current follow-up to the 7–8 September 2026 code review and architecture work.
This replaces the dated audit and implementation reports. IDs are retained for
the manual probes. Architecture decisions live in [architecture.md](architecture.md);
this backlog is internal and is not bundled with the installed CLI.

## Implemented and verified

- **C02/C05/A01:** shared terminal driver, callback/stream failure cleanup,
  supervised async callback rejection, and no repaint after app completion.
- **C06/C07/A03:** safe special widget-ID snapshots, non-mutating normalization
  of text leaves, and constructor-enforced private document/layout ownership.
- **C08–C10:** search rows rebuilt after relayout, visible TOC selection on short
  terminals, and malformed enabled file URLs rejected rather than thrown.
- **C01:** filesystem paths are navigation targets; every string shown from one
  is now a display label. `sanitizeLabel` strips controls and flattens to one
  line at the Reader status line, the directory-entry label (its href stays the
  raw path), the visible `(url)` text beside a link, and every `link-dropped`
  warning, with a defensive flatten at the `Diagnostics.print` stderr egress.
  The href-display sink was found by the new directory test, not by the probe.
  `stripControlChars` additionally guards `renderAnsiLine` and `renderPlain`, the
  only two consumers of span text, so a missed ingress cannot reach the terminal
  as literal text while the renderer's own SGR still does (S-2).
  Regression tests: `tests/reader/label-safety.test.ts`, `tests/cli/read.test.ts`,
  `tests/html/dashboard-map.test.ts`, `tests/core/diagnostics.test.ts`,
  `tests/core/sanitize.test.ts`, `tests/render/ansi.test.ts`,
  `tests/render/plain.test.ts`.
- **C03:** `error` is the verdict for the command it answers, so it completes
  that command instead of preceding a frame. The Python, Go, and Rust app loops
  now stop waiting for a frame when one arrives, which removes a deadlock that
  any rejected wire line could trigger (the engine itself was correct and
  unchanged). Documented in `docs/interactive-protocol.md`; regression tests:
  `hosts/python/tests/test_app.py`, `hosts/go/app/app_test.go`,
  `crates/teml-host/src/app.rs`.
- **C11/C12/C13:** the Python reader budgets each line rather than the whole
  buffer, so a chunk carrying the newline of a near-limit line plus further valid
  lines is no longer rejected; an oversized line is reported as an `error` event,
  dropped through its newline, and the session stays usable. Python writes loop
  until every byte is sent and fail bounded on no progress. Rust reads lines
  through `take(MAX + 1)` so an unterminated line is rejected instead of growing
  without limit, measuring the line without its terminator. Regression tests:
  `hosts/python/tests/test_ndjson_transport.py`,
  `crates/teml-host/src/session.rs`. A06 (non-atomic frame rejection in all three
  hosts) remains open.
- **C04:** decided, not changed. A `render` is a fresh document, so a value that
  survives is re-marked untouched and the next keystroke replaces it — what a
  browser does when a script re-focuses a pre-filled field. Kept as specified in
  `docs/interactive-protocol.md` rather than redefined; the probe now asserts this
  contract, and `tests/interactive/session.test.ts` adds the same-ID kind-change
  and fresh-id cases the acceptance check named as missing.
- **A06, partial:** frame application is atomic in all three hosts. Patches,
  payloads, viewport metadata and scroll regions are validated against staged
  rows before anything is committed, so a rejected frame leaves the rows and the
  sequence number exactly as they were. Regression tests:
  `hosts/python/tests/test_screen.py`, `hosts/go/screen/buffer_test.go`,
  `crates/teml-host/src/screen.rs`. Two sub-items remain open (see the table).
- **A02, partial:** common full-document/fragment compiler, with lazy CLI and
  synchronous session frontend adapters. Resource policy is not fully unified.
- Repository hygiene: blank test placeholders and an empty example directory
  removed; unused direct `mdast-util-to-string` declaration removed while its
  transitive packages/versions remain; stale parser comment corrected. Cargo
  cleaned 231.2 MiB of rebuildable output. No supported source subtree was removed.

## Robustness sweep (September 2026)

Seven area sweeps drove the built CLI, the library API and the three host
libraries against malformed, huge, unicode, streaming and misbehaving-peer
inputs (~1,500 invocations). Fixed with regression tests:

- **Ragged Markdown tables crashed every command.** `layoutTable` took the column
  count from the widest row and then indexed every row by it, so a table with
  unequal cell counts threw `Cannot read properties of undefined` — including on
  `docs/research/mcp-apps.md`. Tests: `tests/layout/table.test.ts`.
- **A slow stdin producer failed with EAGAIN.** Touching `process.stdin.isTTY`
  before the synchronous read put the pipe in non-blocking mode, breaking the
  documented `curl … | teml view`. Now uses `tty.isatty(0)`.
- **Piped output was silently truncated at the OS pipe buffer.** `writeOutput`
  wrote once and `process.exit()` discarded whatever was still buffered —
  nondeterministically, with exit 0, on every command. It now awaits the flush.
- **`render`/`convert` bypassed the terminal-dimension clamp** that `view`
  applies, so an extreme `--width` stalled for minutes building a giant line.
  Tests: `tests/system/cli-robustness.test.ts`.

Open findings, highest first:

| Area          | Finding                                                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reader/layout | A 100k-line document never reaches a first frame (killed at 105 s); static render is superlinear (10k 1.6 s, 20k 7.8 s, 40k 16.7 s).                                                             |
| Parsing       | 100k nested containers run past 25 s; a run of ≳3.4 MB overflows the stack inside `hasPathologicalDelimiterRun` — the guard itself; 5000 nested `<div>` and a 10 MB line end in `Maximum call stack size exceeded`. |
| Memory        | 10 MB single line → 1638 MB RSS; 100k paragraphs (1.69 MB) → 1586 MB; 20k table rows → 793 MB; a 1 MB attribute → 1318 MB.                                                                     |
| `teml run`    | Allowed payloads stall the session: a 4 MiB `render` takes 12–24 s, and `update` props are unbounded (1 MiB 3.2 s, 7.5 MiB 28.5 s).                                                              |
| Hosts         | No read deadline in any host, so a silent engine hangs forever; Rust `close()` waits without a timeout and its version probe has no deadline; the Python reader peaks ~530 MB on an 8 MiB line.   |
| Width         | Nested list/quote markers exceed the requested width; `--ambiguous-wide` doubles box-rule width; long code-fence language names overrun.                                                        |
| Minor         | FIFO input hangs; a 1-row terminal shows no status line; `q` does not quit from overlays although the keymap says it does; error text echoes 1 MB inputs verbatim; `help <bogus>` exits 0; an absurd `--width` leaks a `RangeError`; Rust accepts a directory or ignores a missing `TEML_CLI`; NUL becomes U+FFFD; `NO_COLOR` overrides `--color`. |

Not covered: the Reader was driven with TTY-shaped streams rather than a real
pty (this sandbox denies `/dev/ptmx`), so post-exit termios and SIGWINCH are
unverified; behaviour is macOS-only; no sustained-load or long-run memory soak.

## Open correctness work

| Priority / ID | Evidence and required change                                                                                                                                                                                                                                    | Acceptance check                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Medium — A06 (remaining) | Two follow-ups after the atomicity fix. (1) No maximum row count is enforced, so a frame declaring an extreme `rows` still allocates proportionally; the bound needs measuring, since a legitimate frame's row count can exceed the document-block limit. (2) The post-rejection policy is undecided: the app currently aborts, and continuing would leave pointer commands computed against a stale screen. | (1) A measured bound rejects only pathological frames. (2) Policy chosen and documented, with a host test either way. |

## Architecture and scalability follow-ups

- **A04:** make mutation, widget-state reconciliation, index rebuilding, and
  cache invalidation one document-transition operation. Deepen the existing
  `WidgetState` rather than creating another store or splitting by line count.
- **A05:** separate semantic navigation targets from layout coordinates. Search
  now preserves a clamped matching-row ordinal, not a text anchor. Add failed
  navigation/history tests; commit history only after successful file loading.
- **A07:** document complete versus observed value snapshots. Node reads live
  session state; subprocess hosts may lack defaults before a click and retain
  removed IDs. Use an executable host parity matrix, not matching method names.
- **A08:** bound retained text, laid-out rows, diagnostics, queued commands, and
  long-lived log retention as well as individual messages. Current input limits
  do not establish bounded total memory. Do not silently drop semantic input.
- Profile nested/widget-dense documents, changing heights near the start,
  repeated resizing, cold startup, and retained logs. Flat-array movement and
  downstream index adjustments can grow even when output is viewport-bounded.
  Measure latency, heap, output bytes, and touched regions before adding caches.
- In `src/cli/commands/read.ts`, separate file loading/confinement and safe display
  metadata from terminal effects; cover symlinks and malformed targets.
- In `src/html/map.ts`, share image source/alt/warning/fallback policy between
  leaf and inline mapping. Preserve HTML semantics and sanitation fixtures.
- Review compatibility before deleting `src/html/convert.ts` or the unused
  `defaultBootstrapProfile()` export/cache. No local callers is not proof that
  external consumers do not exist. Preserve public exports and round trips.

## Dependencies, release, and repository ownership

- The September audit reported 8 advisories (7 high, 1 moderate), mainly in
  development-tool paths. This is historical registry evidence, not proof of
  production exploitability. Retrieve fresh audit JSON, classify reachability,
  update affected locked packages separately, and rerun tests/package checks.
  Reported groups included `brace-expansion`, `js-yaml`, `nanoid`, and `postcss`.
- Build verified artifacts once and promote those exact bytes; distinguish
  registry not-found responses from auth/network/server errors. Make partial
  releases resumable, scope publication permissions, and retain installed-host
  conformance. Keep engine, host, and protocol versions distinct.
- Bound/deduplicate structured diagnostics and add opt-in timing/queue counters
  without logging field values or secrets. Expand build freshness beyond source
  mtimes to configuration and copied assets, or use isolated clean builds.
- Package verification still emits Node DEP0190 for shell argument handling;
  review its subprocess invocation in a separate tooling change.
- Preserve `.staging/teml-chat` and its vendored dependency pending an ownership
  decision. Agree promotion/extraction and root lint/format scope before moving
  or ignoring it. Four staging source files had existing formatting failures.
- Keep independent frontend fixtures, width/capability snapshots, host example
  views, licenses, and test configurations despite identical content. Preserve
  `pnpm-workspace.yaml` for its install-script setting. Add concise example run
  guidance and keep the package's explicit documentation inventory deliberate.

## Verification and probes

The last architecture verification passed build, lint, strict unused-symbol
TypeScript checks, package verification, and **597 tests** (574 invariant + 23
system); after the C01, C03, C11–C13 and A06 slices the same gates pass with **609
tests** (586 invariant + 23 system), plus the 8/8 performance budgets. Tests used
`TEML_NESTING_PARSE_BUDGET_MS=5000`; default
nesting timing was not demonstrated. The final performance run passed **8/8
default budgets**: parse/layout/render median 71.38 ms; interactive key p95
0.151 ms; scroll p95 2.197 ms; append p95 1.989 ms. An earlier parse run measured
367.45 ms, so these are variable local measurements, not a controlled speedup
claim.

The original audit passed Rust library 28 tests, Rust example 4 tests, all seven
Go packages, and Python 37 tests. The C03, C11–C13 and A06 slices reran those
suites with `gofmt`/`go vet` and `cargo fmt`/`clippy -D warnings`: Rust 26 library
+ 8 integration tests, all seven Go packages, Python 47 tests. Real PTYs and SEA
were not rerun for the architecture tranche. No deployment, publication, history
rewrite, full secret scan, or complete exploitability assessment was performed.

Manual probes use captured/in-memory streams and are **not CI gates**:

```sh
pnpm run build
node scripts/diagnostics/audit-probes.mjs
PYTHONPATH=hosts/python/src python3 scripts/diagnostics/audit-host-probes.py
```

Node now passes 12/12. C01a/C01b are duplicated by ordinary regression tests, C03
was rewritten to assert the agreed contract (a rejected command must not consume
the next command's response) with the host loops covered by their own suites, and
C04 now asserts the decided select-on-render contract, so all four can be retired
on the next probe cleanup. Python now passes all three of its probes (C11, C12,
A06). The near-limit fixture allocates about 8 MiB and may be slow; run it
separately from benchmarks. Promote cases to ordinary regression tests as fixes
land, then retire duplicate manual cases. Test failure, cleanup, and ownership at
each boundary before introducing another consumer.

## Open administrative item: Cursor contributor display

On 7 September 2026, `fogha/teML`'s sidebar listed `cursoragent`, but the
contributors API returned only `fogha` (32 contributions). Inspected history
at `ec0390487aa7dcabbf2d1b0db4d548fd7e67ee51` and tags `v0.2.0`/`v0.2.1`
contained no Cursor author/committer identities or coauthor trailers. No
remaining repository attribution was identified to remove.

Recheck before acting. If the discrepancy persists, the owner should ask GitHub
Support to refresh the contributor display or identify its remaining source.
Suggested subject: **Stale Cursor Agent entry in fogha/teML contributor sidebar**.
No request has been sent; this item is not resolved by code or docs cleanup.

# ADR 004: Defer a native engine port

## Status

Accepted — July 2026. Revisit only when a trigger below is met.

## Context

TeML's TypeScript engine owns parsing, normalization, sanitization, layout,
rendering, interactive state, and the Reader. Rust, Go, and Python hosts remain
thin subprocess adapters around `teml run`.

A native engine could reduce artifact size and remove Node from the runtime,
but it would create a permanent second implementation. ADR 003 records that
the Node SEA spike already satisfies the host-spawn use case with a +9.88 ms
cold-start delta and a passing macOS arm64 protocol smoke. Its ~109 MiB size
and incomplete Linux/Windows release validation are distribution-hardening
concerns, not sufficient reasons to duplicate the engine.

## Decision

Do not start a native engine port now. Keep the Node implementation canonical
and harden optional SEA release artifacts first.

If a future trigger requires a port, Rust is the preferred candidate because
it aligns with `crates/teml-host`, has mature parsing/layout dependencies, and
can eventually support one-process host embedding. A port must cover the
static CLI, `run`, and Reader surfaces; a core-only rewrite would leave Node in
the shipped path and would not solve the distribution problem.

## Reopen triggers

Reconsider this decision only when at least one necessity trigger and the
maintenance trigger are satisfied:

1. Linux or Windows cannot pass `sea:verify` after reasonable hardening.
2. A product requirement imposes an engine artifact below 20 MiB and SEA
   cannot meet it within one release cycle.
3. SEA startup exceeds the +100 ms budget on all tier-1 platforms.
4. A supported host needs in-process engine linking for measured latency or
   isolation reasons.
5. A deployment environment forbids both an external Node runtime and an
   embedded Node SEA executable.
6. A named maintainer and CI budget commit to dual-engine conformance and
   security updates for at least 12 months.

Absent these conditions, Node plus SEA remains the supported architecture.

## Feasibility evidence

The July 2026 engine contains approximately 10,619 non-blank,
non-comment-only production lines across 71 TypeScript files:

| Surface                               |  SLOC | Risk                                  |
| ------------------------------------- | ----: | ------------------------------------- |
| Core AST, normalization, sanitization |   876 | Low; pure data transforms             |
| TeML frontend and directives          |   882 | High; custom `:::` grammar            |
| Markdown frontend                     |   366 | Medium; event-model differences       |
| HTML extraction and mapping           | 1,004 | High; Readability parity              |
| Layout and hit testing                | 2,048 | Medium; width-sensitive algorithms    |
| Rendering                             |   490 | Medium; single-ANSI-emitter invariant |
| Interactive protocol/session/cache    | 2,171 | High; largest state machine           |
| Reader model                          |   662 | Medium                                |
| Terminal client/themes/capabilities   |   824 | Medium-high; platform behavior        |
| CLI wiring                            | 1,207 | Low-medium                            |
| SEA runtime and public exports        |    89 | Low                                   |

Most Node runtime dependencies have credible Rust replacements:

| Current role        | Rust candidate                                     | Main risk                        |
| ------------------- | -------------------------------------------------- | -------------------------------- |
| CommonMark/GFM      | [`pulldown-cmark`](https://docs.rs/pulldown-cmark) | mdast/event parity               |
| Frontmatter YAML    | [`yaml_serde`](https://docs.rs/yaml_serde)         | delimiter compatibility          |
| TeML directives     | Custom parser                                      | No equivalent for TeML's grammar |
| HTML5 parsing       | [`html5ever`](https://docs.rs/html5ever)           | DOM/serialization drift          |
| DOM selection       | [`scraper`](https://docs.rs/scraper)               | mapping rewrite                  |
| Article extraction  | [`libreadability`](https://docs.rs/libreadability) | scoring/output parity            |
| Terminal cell width | [`unicode-width`](https://docs.rs/unicode-width)   | CJK/emoji edge cases             |
| CLI parsing         | [`clap`](https://docs.rs/clap)                     | Low                              |
| Reader terminal I/O | [`crossterm`](https://docs.rs/crossterm)           | platform and TTY testing         |

The port is therefore technically feasible, but the HTML frontend, custom
directive parser, interactive state machine, Unicode width behavior, and
Reader terminal lifecycle make full parity a multi-month project.

## Required conformance model

A native engine cannot define behavior independently. Spec changes must land
with shared fixtures, and both engines must pass the same gates:

1. Plain render snapshots at widths 20, 40, 80, and 120.
2. Complete TeML, Markdown, HTML, and adversarial pipeline journeys.
3. TeML/Markdown structural round trips.
4. Single-emitter security tests with no foreign escape bytes.
5. Interactive NDJSON event and frame replay, including the v1 golden.
6. Installed CLI and executable smoke tests.
7. Rust, Go, and Python host contracts via `TEML_CLI`.

The fixture corpus is repository-local and intentionally excluded from the
Node package. Before a port starts it needs an explicit corpus version and a
release artifact or pinned repository revision so two engines cannot silently
test against different inputs.

The Node engine remains the reference until a separately reviewed decision
flips ownership. No port starts without a maintainer responsible for shared
fixture CI, protocol updates, dependency security work, and cross-platform
releases.

## Conditional implementation sequence

If this decision changes:

1. Build the differential fixture runner and version the corpus.
2. Port core AST, normalization, sanitization, and diagnostics.
3. Port layout, rendering, themes, and terminal-width behavior.
4. Implement the TeML directive frontend.
5. Add Markdown, then HTML and Readability extraction.
6. Port interactive protocol, session state, layout cache, and hit testing.
7. Port Reader terminal behavior and CLI commands.
8. Add static artifacts, host conformance, signing, and the platform matrix.

Estimated effort for full parity is 4–8 maintainer-months, followed by an
ongoing dual-engine maintenance cost.

## Alternatives considered

- **Go port:** comparable binary distribution, but weaker alignment with the
  existing Rust host investment.
- **WASM embedded per host language:** adds per-language FFI and packaging
  complexity at the seam the subprocess protocol intentionally avoids.
- **SEA embedded in every host package:** rejected by ADR 003 because it
  duplicates large artifacts and couples every ecosystem release to Node
  security updates.
- **Optional SEA release artifacts:** selected; one canonical engine, no global
  Node installation for end users, and no host-interface change.

## Consequences

- TeML maintains one canonical engine and one protocol conformance target.
- Native-only users depend on successful SEA release hardening.
- Artifact size remains roughly the size of an embedded Node runtime.
- A future port has explicit necessity, ownership, fixture, and parity gates
  instead of beginning as an open-ended rewrite.

# Contributing to TeML

Thanks for taking a look. TeML release tarballs are distributed through
GitHub rather than a package registry; contributions happen against this git
repository directly.

## Dev setup

```bash
git clone https://github.com/fogha/teML.git && cd teML
pnpm install
pnpm run build
pnpm test
```

Requires **Node ≥ 20** and **pnpm ≥ 10** (the CI matrix covers Node 20 and 22
on Ubuntu, macOS, and Windows).

pnpm 10 blocks dependency install scripts by default. The checked-in
`pnpm-workspace.yaml` trusts only the lockfile-pinned esbuild builds needed by
the development runner and SEA spike. Review any proposed addition (or run
`pnpm approve-builds`) before allowing another package's lifecycle scripts.

## Everyday commands

```bash
pnpm run build          # tsc + copy runtime assets and user-facing docs into dist/
pnpm test                # critical invariants followed by integrated system journeys
pnpm run test:invariants # focused parser, security, layout, protocol, and lifecycle contracts
pnpm run test:system     # built CLI, corpus pipeline, NDJSON, and in-process host journeys
pnpm run test:all        # functional tests followed by local performance targets
pnpm run test:watch      # focused invariant tests in watch mode
pnpm run test:perf       # perf/benchmark gates only
pnpm run test:hosts      # Rust, Go, and Python host contract suites
pnpm run test:rust-host  # Rust library + reference-app tests
pnpm run test:go-host    # Go host unit and protocol tests
pnpm run test:python-host # Python host unit and protocol tests (install hosts/python[dev])
pnpm run lint            # eslint .
pnpm run lint:fix        # eslint . --fix
pnpm run format          # prettier --write .
pnpm run format:check    # prettier --check .
pnpm run pack:verify     # pnpm pack, install the tarball in a scratch dir, smoke-test it
pnpm run sea:build       # build the platform-local Node SEA spike
pnpm run sea:verify      # smoke-test the SEA command and run protocol
pnpm run sea:bench       # record SEA size and startup/memory metrics
```

The platform-local full-screen Reader smoke cannot run in ordinary CI. After
`sea:verify`, run `./.sea/teml read examples/markup/demo.teml` and
`./.sea/teml read docs/` in a real terminal before promoting a SEA artifact.
Measured spike results and platform release gates are recorded in
`docs/adr/003-host-engine-distribution.md`.

`pnpm run dev` runs the CLI straight from TypeScript via `tsx` (no build step),
useful while iterating: `pnpm run dev -- view examples/markup/demo.teml`.
After building, `demo:interactive`, `demo:log-viewer`, `demo:live-progress`,
`demo:settings`, and the `demo:{rust,go,python}-host` scripts exercise the TeML
widget catalog, nested scrolling, live updates, the in-process HTML API, and
polyglot protocol hosts.

## How tests are organized

- `tests/system/*.test.ts` — integrated user journeys across the built CLI,
  format conversion, the complete fixture corpus, NDJSON sessions, patch
  replay, resize, callbacks, rerendering, and terminal cleanup.
- The remaining `tests/{core,layout,interactive,reader,render,terminal,…}/`
  files protect narrow invariants that system journeys cannot diagnose
  reliably: sanitization, parser limits, cell geometry, protocol validation,
  frame sequencing, terminal lifecycle, and stable snapshots.
- Run `pnpm run build` before either suite. A build-freshness guard rejects
  missing or stale `dist/` output so source-level tests cannot pass while CLI
  journeys exercise an older binary. CI builds once, then runs invariant and
  system suites separately.
- `tests/perf/benchmark.test.ts` — timing budgets (parse+layout+render
  throughput, CLI startup overhead, Reader input-to-frame latency). These can
  be sensitive to machine load; if one fails locally under a busy machine but
  the change isn't performance-related, re-run in isolation before assuming a
  regression.
- `crates/teml-host/`, `hosts/go/`, and `hosts/python/` — the polyglot host
  libraries and contract suites. They require stable Rust, Go 1.23, and Python
  3.11 respectively, plus a current `pnpm run build`. CI also runs each
  language's formatter/static checks and package build.
- `fixtures/{teml,markdown,html,adversarial}/` — the conformance corpus.
  Snapshots live under `tests/**/snapshots/`; when a fixture or renderer change
  is intentional, regenerate snapshots rather than hand-editing them (see the
  test file's `describe` block for the update mechanism it uses).
- `tests/system/snapshots/interactive-v1.ndjson` is the byte-level default
  protocol compatibility golden. Regenerate it only for an intentional wire
  compatibility decision, using fixture 36, `--width 40 --no-color`, and a
  single `{"type":"exit"}` command; review the raw diff.

## Code style

- ESLint (flat config, `typescript-eslint` recommended rules) + Prettier own
  formatting and basic correctness lint. Run `pnpm run lint` and
  `pnpm run format:check` before opening a PR — CI runs both on every push.
- `no-control-regex` is intentionally disabled project-wide: this is a
  terminal-markup library that legitimately matches raw control/escape bytes
  (ANSI sequences, C0 control-code sanitization) as its actual job.
- Keep the **single ANSI emitter invariant**: only `src/render/ansi.ts` may
  emit raw escape sequences. `tests/security/single-emitter.test.ts` enforces
  this — if you need new terminal control sequences, add them to
  `src/render/ansi.ts`'s `TERMINAL_CONTROL` exports and import from there.
- Every string entering the AST must pass through `src/core/sanitize.ts`
  (the ingestion chokepoint). If you add a new frontend/parser, route text
  through it.

## PR expectations

- Add or update tests for behavior changes; a bug fix without a regression
  test is much more likely to regress again.
- Run `pnpm run build && pnpm test && pnpm run lint && pnpm run format:check`
  locally before opening a PR. CI also runs package verification, performance
  gates, polyglot host checks, and the SEA spike where applicable.
- Keep commits focused; prefer several small, reviewable commits over one
  large one when a change touches unrelated areas.
- If you touch anything security-relevant (parsing, link resolution, theme
  loading, the Reader's directory confinement), call that out explicitly in
  the PR description — those paths have deliberately narrow security
  invariants documented in `docs/spec.md`'s Security section.

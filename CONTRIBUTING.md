# Contributing to TeML

Thanks for taking a look. TeML isn't published yet, so contributions happen
against this git repository directly.

## Dev setup

```bash
git clone <this repo> && cd teml
npm install
npm run build
npm test
```

Requires **Node ≥ 20** (the CI matrix covers Node 20 and 22 on Ubuntu, macOS,
and Windows).

## Everyday commands

```bash
npm run build          # tsc + copy non-TS assets (themes, HTML profiles, docs) into dist/
npm test                # vitest (functional + fixtures) then the perf suite
npm run test:watch      # vitest in watch mode, functional tests only
npm run test:perf       # perf/benchmark gates only
npm run lint            # eslint .
npm run lint:fix        # eslint . --fix
npm run format          # prettier --write .
npm run format:check    # prettier --check .
npm run pack:verify     # npm pack, install the tarball in a scratch dir, smoke-test it
```

`npm run dev` runs the CLI straight from TypeScript via `tsx` (no build step),
useful while iterating: `npm run dev -- view examples/demo.teml`.

## How tests are organized

- `tests/**/*.test.ts` — unit and integration tests (vitest), mirroring the
  `src/` layout (`tests/layout/`, `tests/render/`, `tests/reader/`, …).
- `tests/cli/*.test.ts` — spawn the built CLI as a subprocess and assert on
  stdout/stderr/exit codes; these need `npm run build` to have run first if
  you're not using `npm test` (which builds nothing itself — CI runs
  `npm run build` before `npm test`).
- `tests/perf/benchmark.test.ts` — timing budgets (parse+layout+render
  throughput, CLI startup overhead, Reader input-to-frame latency). These can
  be sensitive to machine load; if one fails locally under a busy machine but
  the change isn't performance-related, re-run in isolation before assuming a
  regression.
- `fixtures/{teml,markdown,html,adversarial}/` — the conformance corpus.
  Snapshots live under `tests/**/snapshots/` and `snapshots/`; when a fixture
  or renderer change is intentional, regenerate snapshots rather than
  hand-editing them (see the test file's `describe` block for the update
  mechanism it uses).

## Code style

- ESLint (flat config, `typescript-eslint` recommended rules) + Prettier own
  formatting and basic correctness lint. Run `npm run lint` and
  `npm run format:check` before opening a PR — CI runs both on every push.
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
- Run `npm run build && npm test && npm run lint && npm run format:check`
  locally before opening a PR — this is exactly what CI runs (plus
  `npm run pack:verify` and the Windows leg of the matrix).
- Keep commits focused; prefer several small, reviewable commits over one
  large one when a change touches unrelated areas.
- If you touch anything security-relevant (parsing, link resolution, theme
  loading, the Reader's directory confinement), call that out explicitly in
  the PR description — those paths have deliberately narrow security
  invariants documented in `docs/spec.md`'s Security section.

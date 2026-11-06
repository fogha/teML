# Maintenance backlog

This file tracks unresolved work. Current contracts belong in [spec.md](spec.md),
[interactive-protocol.md](interactive-protocol.md), and [architecture.md](architecture.md).
Run instructions and verification commands live in [CONTRIBUTING.md](../CONTRIBUTING.md).
Historical audit measurements are not current guarantees.

## Correctness and scalability

- **A06:** choose the host policy after a rejected frame. Continuing with a stale
  screen can misdirect pointer input; current app loops abort. Test the chosen policy.
- **A05:** separate semantic navigation targets from layout coordinates. Reader search
  preserves a matching-row ordinal; it does not yet preserve a text anchor across edits.
- **A07:** document complete versus observed value snapshots. Node reads current session
  state; subprocess hosts may lack defaults or retain removed IDs. Add a host parity matrix.
- **A08:** bound retained text, laid-out rows, diagnostics, queued commands, and log
  history. Per-command limits alone do not bound a long-lived session's memory.
- Remeasure very large paragraphs, deeply nested containers, long attributes, and
  large tables through public parser/CLI seams. Keep first-frame latency and peak
  memory separate from incremental navigation performance.
- Investigate remaining narrow-width cases: nested list/quote gutters, ambiguous-wide
  box rules, and long code-fence language labels. Preserve Unicode width semantics.
- Verify Reader FIFO handling, one-row terminals, overlay quit behavior, and very
  large diagnostic payloads. Retain controlled failure artifacts for regressions.
- Rust engine discovery still needs a bounded version probe and consistent rejection
  of directories/missing explicit engine paths. Session read and close deadlines are
  separately covered by public-session tests.

## Architecture and release

- Keep document changes behind `InteractiveSession.transitionDocument`: render resets
  selection defaults and scroll; mutations preserve surviving editing state; safe
  appends retain incremental layout. Canvas buffers reconcile only after transitions.
- Profile widget-dense documents, changing heights near the beginning, resizing, and
  retained logs before introducing another cache or index.
- Separate file loading/confinement from terminal effects in `src/cli/commands/read.ts`.
  Retain symlink and malformed-target coverage.
- Share image source/alt/warning/fallback policy inside `src/html/map.ts` without
  weakening sanitization or HTML semantics.
- Review external compatibility before removing `src/html/convert.ts` or the unused
  `defaultBootstrapProfile()` export. Lack of repository callers is insufficient.
- Refresh dependency audit data separately and classify reachability before upgrading.
- Promote verified artifact bytes, make partial releases resumable, and distinguish
  missing registry versions from authentication/network/server failures.
- Extend build-freshness checks to configuration and copied documentation/assets.
- Review package subprocess invocation to remove Node DEP0190 shell-argument warnings.
- Preserve independent frontend fixtures, host example views, licenses, snapshots,
  and the workspace install-script policy. Rust directory relocation is deferred.
- Adoption metrics remain unmeasured; record dated installation/embedding evidence
  separately from test counts and performance measurements.

## Retired manual probes

The duplicate `scripts/diagnostics/` runners were retired after matching their
cases to normal regression suites. Unique command-recovery and rejected-image
stderr checks were included before retirement.

| Former probes | Maintained coverage |
| --- | --- |
| C01a/b | `tests/reader/label-safety.test.ts`, `tests/system/cli-journey.test.ts` |
| C02/C05 | `tests/interactive/host-lifecycle.test.ts` |
| C03 | `tests/interactive/run-stream.test.ts`, each host's app tests |
| C04/C06/A03 | `tests/interactive/session.test.ts` |
| C07 | `tests/teml/normalizer.test.ts` |
| C08–C10 | `tests/reader/session.test.ts` |
| C11/C12 | `hosts/python/tests/test_ndjson_transport.py` |
| A06 | `hosts/python/tests/test_screen.py` and corresponding Go/Rust screen tests |

## Repository administration

The previously reported stale contributor sidebar entry needs an owner-side recheck
and, if still present, a GitHub Support request. No history rewrite is warranted by
that display alone; no request has been sent.

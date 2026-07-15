# ADR-001: Runtime-owned shared Terminal Client

## Status

Accepted for v1.5.

## Context

Static commands write one result to stdout. `teml run` is deliberately a
headless NDJSON transform whose host owns the real terminal, while the early
Node `runInteractiveApp` helper contains its own raw-mode, key-decoding, mouse,
and repaint implementation.

Reader needs an alternate screen, scrolling, resize handling, link navigation,
and damage-only repaint. Duplicating that machinery in Reader would create
incompatible terminal stacks before Panel and Wire are implemented.

## Decision

Create one reusable **Terminal Client** layer responsible for:

- incremental terminal-input decoding;
- raw mode and alternate-screen lifecycle;
- mouse and resize events;
- crash-safe, idempotent cleanup for catchable exits;
- screen-frame damage diff and repaint.

`teml read` owns and uses this client directly. The existing `teml run`
protocol remains headless and host-owned. The Node in-process app helper will
be migrated to the shared decoder/lifecycle after Reader is stable. A future
remote `teml connect` client must reuse the same Terminal Client.

Screen operations remain abstract data until encoded by `src/render/ansi.ts`,
preserving the single-ANSI-emitter invariant.

## Alternatives Considered

### Keep Reader as an external NDJSON host

This preserves a single headless engine, but makes a first-party reader depend
on a second process and exposes low-level input/render traffic over the
application protocol. It also leaves no reusable local client for Wire.

### Build a Reader-only terminal loop

This is initially faster, but duplicates the existing Node host and guarantees
divergence in decoding, cleanup, resize, and repaint behavior.

## Consequences

- Reader, local in-process apps, and remote connect can converge on one client.
- `teml view` remains one-shot and byte-compatible.
- `teml run` continues to make no claim that it owns a terminal.
- Terminal Client APIs need injectable streams and pure state boundaries for
  deterministic tests.
- SIGKILL cannot be cleaned up in-process and remains explicitly unsupported.

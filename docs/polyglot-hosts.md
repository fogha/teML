# Polyglot hosts: architecture and roadmap

This document records the cross-language host strategy behind
[`teml run`](interactive-protocol.md). Shipped behavior belongs in the protocol,
specification, playbook, and ADRs; proposed work is tracked as GitHub issues.

## 1. Current audience and adoption boundary

TeML can be used today in two ways:

- Node applications use the published `teml/interactive`
  `runInteractiveApp()` API in-process.
- Any language can spawn `teml run` and exchange NDJSON over stdio. The host
  owns terminal modes, input decoding, frame reconstruction, painting, and
  cleanup; TeML owns parsing, state, layout, hit-testing, and rendering.

The JavaScript example and in-repo Rust, Go, and Python host libraries prove
the subprocess contract. The host packages are not published yet. The released
engine artifact is currently the Node/GitHub tarball and requires Node 20 or
newer; [ADR 003](adr/003-host-engine-distribution.md) records the CI-gated SEA
artifact outcome and release requirements.

## 2. Publication demand gate

The Rust, Go, and Python reference libraries are implemented in this monorepo,
but publishing any ecosystem package still requires evidence that copied
reference code is blocking real users. A useful signal is any one of:

- two independent downstream applications in that language;
- three concrete requests/issues asking for a supported host package; or
- a maintainer willing to own releases and compatibility for that ecosystem.

The compatibility policy lives in
[`interactive-protocol.md`](interactive-protocol.md); engine discovery and
release ownership live in [ADR 003](adr/003-host-engine-distribution.md).
Publishing a wrapper without those contracts and a named owner would turn TeML
package changes into unbounded cross-language breakage.

## 3. Stable architecture boundary

```text
host terminal/input
        │ normalized commands
        ▼
teml run ── parse/state/layout/render ──► semantic events + full/patch frames
        ▲                                      │
        └──────────── NDJSON over stdio ───────┘
```

The subprocess boundary is intentional:

- language-neutral and debuggable;
- crash/isolation boundary around parsing and rendering;
- one canonical engine instead of a partial port per language;
- no raw terminal control emitted by the engine protocol process.

Host SDKs should remain thin: typed wire messages, engine discovery/spawn,
backpressure-safe NDJSON, frame reconstruction, terminal lifecycle helpers,
and an example.

Thin does not mean the event loop belongs in application code. Every host also
ships a handler driver (`run` + `on_change`/`on_toggle`/`on_click`/`on_error`,
specified in [docs/host-porting-playbook.md](host-porting-playbook.md)) with a
contract identical across Node, Rust, Go, and Python, because a loop each
application rewrites is a loop each application gets subtly wrong. The
lower-level session stays public for applications that need unusual control.

## 4. Performance and conformance

The checked-in performance suite measures complete layout/render baselines,
Reader navigation, and 10,000-line interactive input. Interactive key-to-frame
p95 must remain below 5 ms with viewport-bounded output; local results are
typically far below that threshold, while CI uses explicit budgets for shared
runners.

Correctness is more important than a language-specific abstraction. Every
host implementation must run the same scripted contracts:

- negotiated payloads and patch reconstruction;
- sequence-gap handling and full-frame resynchronization;
- resize/viewport metadata and column-precise pointers;
- richer key/modifier mapping;
- terminal cleanup on success, error, and signals.

The Node package verification installs the packed artifact and runs an actual
interactive protocol smoke. Future host packages should consume the same
conformance scenario rather than inventing separate examples.

## 5. Distribution choices

ADR 003 defines engine discovery as an explicit API option, `TEML_CLI`, a
package-managed path, then `teml` on `PATH`. JavaScript entry paths run through
Node; native/SEA paths run directly. Host packages must pass ordinary CI
against the built engine and release-tier CI against the installed `teml.tgz`.

[ADR 003](adr/003-host-engine-distribution.md) selects optional Node SEA
binaries as additional per-platform release artifacts.
[ADR 004](adr/004-native-engine-port-decision.md) defers a native engine port
unless distribution evidence shows SEA/Node is inadequate. A native port would
be a permanent second engine and is acceptable only with shared fixtures,
differential tests, and a credible long-term maintenance owner.

## 6. Scope and non-goals

In scope:

- forms and document-oriented terminal applications;
- semantic widgets, bounded scrolling, live state updates;
- Node in-process apps and polyglot subprocess hosts;
- full/patch terminal-cell frames with accessibility fallbacks.

Out of scope:

- pixel canvases, high-frame-rate animation, or general game rendering;
- host-provided executable scripts or raw escape-sequence passthrough;
- duplicating TeML's parser/layout engine inside every host SDK;
- publishing Ruby or further language packages without a demand signal.

Proposed backlog items remain changeable until selected. Shipped behavior must
stay synchronized across the protocol, specification, tests, and reference
hosts.

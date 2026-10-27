# Product direction

> **Status: design intent, not shipped state.** This document records *what TeML
> is trying to be and in what order* — release themes, priorities, non-goals, and
> program metrics. It deliberately contains **no normative syntax**. Wire formats,
> directive tables, and attribute rules live in
> [spec.md](spec.md), [interactive-protocol.md](interactive-protocol.md), and
> [architecture.md](architecture.md); when this document and those disagree about
> behavior, the normative documents win.
>
> It was distilled from the original product requirements document (see the
> repository history) after that document drifted from the implementation. The
> release themes and the adoption ladder are retained; the duplicated requirement
> tables were not, because a second copy of a rule is how the two copies diverge.

## Mission and vision

**Mission (12–18 months):** make TeML the easiest way to produce beautiful,
structured terminal output and simple terminal applications from any language.

**Vision (3–5 years):** a "terminal web" — an ecosystem where documents,
dashboards, and applications are served to terminals locally or over the network
in one open format; where AI agents render live interfaces instead of prose
walls; where `teml connect ops.internal` is as natural as opening a browser tab.

**North star:** _the terminal is the display surface; TeML is the document
language; the AST is the core; the runtime is the engine._

## Who this is for

| Persona                   | Wants                                                                 | Today's answer                                              |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| CLI tool author           | Professional help pages, reports, and status output without hand-rolled ANSI or a heavyweight TUI framework | `teml view` / `render` + the format spec        |
| Platform / DevOps engineer | Deploy reports, runbooks, and approval panels usable over SSH          | `teml run` + a host library in any language                 |
| Agent / agent-platform dev | An agent that streams structured, interactive UI rather than prose     | Protocol 1.4 forms + the elicitation round-trip helpers      |
| Docs / content owner       | Existing HTML/Markdown readable natively in a terminal                 | HTML and Markdown frontends, `teml read`                     |
| End user (never authors)   | Output readable in *their* terminal, safe, pipe-friendly               | Capability tiers, `NO_COLOR`, plain fallback                 |

## Product principles

1. **Semantic over visual.** Authors state meaning; the renderer and theme decide
   appearance. This is what makes one document work on every terminal.
2. **Input formats are frontends; the AST is the core; rendering is a backend.**
   Every feature must be locatable in that pipeline or it does not ship.
3. **Safe by default.** Documents are data, never code. No execution, no
   unsanitized escape byte, links vetted, viewing a file can never trigger actions.
4. **Graceful degradation, always.** Every feature has a defined fallback down to
   ASCII, monochrome, non-TTY. A feature without a fallback rung is incomplete.
5. **Be a good Unix citizen.** stdin/stdout, pipes, `NO_COLOR`, isatty, stderr for
   diagnostics, deterministic snapshots, meaningful exit codes.
6. **Adopt, don't invent.** CommonMark + community directive syntax; existing
   conventions (OSC 8, half-block/Braille tiers) over new ones.
7. **Language-agnostic by contract.** The product's API is documents and JSON
   events over a stream — never a library in one language.
8. **Incremental value.** Every release must be independently useful.

## Release map

| Release | Codename    | Theme                      | Headline capability                                                |
| ------- | ----------- | -------------------------- | ------------------------------------------------------------------ |
| v1.0    | **Paper**   | Static document engine     | Render TeML/HTML beautifully; convert HTML→TeML and Markdown↔TeML  |
| v1.5    | **Reader**  | Interactive viewer         | Full-screen viewing, scrolling, link navigation                    |
| v2.0    | **Panel**   | Application runtime        | Forms, buttons, events; host apps in any language                  |
| v2.5    | **Session** | Stateful interfaces        | Widget state, data bindings, persistence, component library        |
| v3.0    | **Stream**  | AI-native / live documents | Streaming ingestion, incremental rendering, agent UX kit           |
| v4.0    | **Wire**    | Remote TeML                | Networked apps: one server, any terminal, zero installs            |
| v5.0    | **Commons** | Ecosystem                  | Package/registry, profiles marketplace, embedding in other tools   |
| v6.0+   | **Web**     | The terminal web           | Browsing, identity, capability security at ecosystem scale         |

Priorities inside a release are P0 (must ship), P1 (should ship), P2 (stretch).
The priority of a *specific* requirement belongs to the issue tracker, not here.

### Non-goals (permanent unless deliberately revisited)

- **Client-side scripting of any kind.** The format has no execution semantics.
- **A general reactive expression language.** Formatting hints at most.
- **A CSS layout engine.** Vertical flow plus simple columns and grids.
- **Multiple concurrent documents/windows.**
- **Model integrations or API calls in the runtime.** Hosts do AI; the runtime renders.
- **Plugin code execution.** Extensions are data — themes, profiles, compositions.
- **RTL/bidi layout** until a dedicated investigation; controls are stripped rather
  than rendering broken.
- **Unsanitized images by default.** Image protocols are opt-in and never fetched
  by the engine.

### Known outstanding areas

These are direction, not commitments, and none is scheduled by this document:

- **Widget breadth.** `::select`, a checkbox group with `minItems`/`maxItems`,
  `::range`, and numeric input remain unimplemented.
- **Session persistence and detach/reattach.** Would also give the protocol a
  path for engine-initiated messages (streaming, animation).
- **Component library.** Data table, wizard/stepper, confirm/toast, list picker,
  sparkline/gauge, log-follow pane.
- **Remote TeML.** Needs a security design (auth, isolation, quotas, untrusted
  remote output) — a boundary change, not a protocol minor.
- **Cold start.** The 50 ms target is not met and may not be reachable on the
  current runtime; the project should either retire it or fund the work.

## Program-level success metrics

The adoption ladder is the leading indicator rung to rung:

**CLI installs → tools embedding TeML output → apps on the protocol → agent
products streaming TeML → organizations serving remote endpoints → registry
packages.**

Each rung funds the next. As of this writing **none of these is measured**; the
repository has historically tracked engineering quality (test counts, performance
budgets) rather than adoption, which is how a gap between the protocol work and
the user-facing work can go unnoticed. See
[maintenance.md](maintenance.md) for the tracking stub.

Health and ecosystem targets:

- **Security:** zero escape-injection or mode-boundary breaches, ever.
- **Stability:** zero protocol-breaking changes without version negotiation.
- **Ecosystem:** at least two independent runtime or host implementations passing
  conformance — the true test that the *format*, not this codebase, is the product.

## Risks

| Risk                                                     | Severity | Mitigation                                                                                             |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------ |
| "Nice renderer, so what" — undifferentiated vs Glow/Rich | High     | Lead with HTML conversion, the format spec, and the polyglot protocol, not rendering alone             |
| Scope creep toward an Electron-of-terminals              | High     | The permanent non-goals above; the pipeline principle as a review gate                                  |
| Protocol churn breaking early adopters                   | High     | Frame-first version/capability discovery, conformance fixtures, additive-only minors                    |
| Terminal fragmentation (emoji widths, image protocols)   | Medium   | Capability tiers, honest documented limits, per-tier snapshot testing                                   |
| Incumbent ships a competing format                       | Medium   | Move on the language-agnostic wire layer where a library business is structurally unlikely to follow    |
| A security incident in app or remote mode                | Critical | The mode boundary and capability model stay P0 features, not a hardening pass                           |
| Single-maintainer risk                                   | Medium   | Spec + conformance fixtures make the project forkable                                                   |

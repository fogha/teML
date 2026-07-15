# Product Requirements Document: TeML

**Product:** TeML — the terminal document engine and application runtime
**Doc version:** 1.0
**Status:** Draft for review
**Scope:** v1 (document engine) through v6+ (the terminal web)

---

## 1. Product summary

TeML is a semantic document format and runtime for terminals. It lets anyone — a developer, a shell script, an AI agent, or a remote server — produce rich, structured, styled, and eventually interactive terminal interfaces by emitting *documents* instead of writing UI code.

The product has three faces that share one core:

1. **A format** (`.teml`): CommonMark plus generic directives and frontmatter, expressing terminal-native semantics — cards, alerts, status roles, key-value blocks, tables, forms, buttons.
2. **A converter**: HTML→TeML plus Markdown↔TeML. Existing web content and web-authoring habits carry over to the terminal, while TeML documents can degrade back to portable Markdown when terminal-only semantics are not available.
3. **A runtime** (`teml`): renders documents beautifully in any ANSI terminal, and — in app mode — turns documents into working applications by exchanging JSON events with a host program in any language.

The one-line pitch: **write markup, get a terminal app.** The web's model — documents, links, forms, a client that renders and a server that decides — rebuilt for the cell grid instead of the pixel grid.

## 2. Problem and opportunity

### 2.1 The problem

Terminals are where developers, operators, and increasingly AI agents live, but producing good terminal output is disproportionately hard:

- Plain `printf` output is unstructured and unstyled; every CLI reinvents ad-hoc formatting.
- Rich TUI frameworks (Textual, Ink, Bubble Tea, Ratatui) produce excellent results but lock the author into one programming language and a code-first UI model. A Python service can't use Ink; a shell script can't use Ratatui; an AI model can't "write a Bubble Tea program" mid-response.
- HTML — the world's largest corpus of structured documents and the format every developer already knows — has no faithful semantic path into the terminal. Text browsers mimic visual layout lossily; nothing converts HTML *meaning* into terminal-native components.
- There is no portable, language-agnostic way for a program to say "render this interface" to a terminal and receive "the user pressed this button" back.

### 2.2 The opportunity

Three market currents converge on this gap:

- **The TUI renaissance.** GPU-accelerated terminals, truecolor, hyperlinks, and image protocols have made terminals a serious application surface again; major engineering organizations are building in-house TUI frameworks because the terminal is winning on speed and portability.
- **Agentic AI in the terminal.** AI coding agents live in the terminal and currently stream plain markdown. An agent that could stream a *checklist that ticks itself*, a *diff card with approve/reject buttons*, or a *form requesting missing parameters* needs exactly a document-plus-events protocol — which no incumbent framework provides, because they are all libraries, not wire formats.
- **Protocol vacuum.** The TUI space has frameworks per language but no shared format or protocol layer. Whoever defines a good one defines the category.

### 2.3 Why us / why this shape

The differentiated position is the *combination* no one holds: a semantic document format + honest HTML conversion + a language-agnostic runtime and event protocol. Rendering polish alone loses to Glow and Rich; a new framework alone loses to Textual and Ratatui. The format-and-protocol play sidesteps both by making incumbents potential frontends and distribution channels rather than competitors.

## 3. Vision and mission

**Mission (12–18 months):** make TeML the easiest way to produce beautiful, structured terminal output and simple terminal applications from any language.

**Vision (3–5 years):** a "terminal web" — an ecosystem where documents, dashboards, and applications are served to terminals locally or over the network in one open format; where AI agents render live interfaces instead of prose walls; where `teml connect ops.internal` is as natural as opening a browser tab.

**North-star statement:** *the terminal is the display surface; TeML is the document language; the AST is the core; the runtime is the engine.*

## 4. Users and personas

**P1 — CLI tool author ("Dana").** Builds developer tools in Go/Rust/Python. Wants help pages, reports, and status output that look professional without hand-rolling ANSI codes or adopting a heavyweight TUI framework. Success looks like: replaces her custom formatter with `teml` in an afternoon; her tool's `--report` output gains cards, tables, and status colors.

**P2 — Platform / DevOps engineer ("Marcus").** Runs deploy pipelines and internal tooling. Wants deploy reports, runbooks, and eventually interactive approval panels usable over SSH by the whole team. Success looks like: CI emits `.teml` reports readable in any terminal; later, a deploy-approval app served from one host with zero client installs.

**P3 — AI agent / agent-platform developer ("Priya").** Builds agentic CLI products. Wants the agent to stream structured, interactive UI — plans, diffs, confirmations — into the terminal session. Success looks like: her agent emits a TeML token stream; users approve actions with Tab+Enter instead of typing "yes".

**P4 — Documentation & content owner ("Sam").** Maintains docs sites in HTML/Markdown. Wants the same content readable natively in the terminal (`man`-page-quality, but from existing sources) and wants TeML reports exportable to ordinary Markdown for existing publishing systems. Success looks like: `teml view https://docs.internal/page.html` produces clean, readable output with working links, and `teml convert report.teml --to markdown` produces a portable fallback.

**P5 — End user / operator (implicit persona).** Never writes TeML; consumes it. Requirements they impose: output must be readable in *their* terminal (colors, width, Unicode support all vary), degrade gracefully, respect `NO_COLOR`, work in pipes and pagers, never do anything unsafe.

## 5. Product principles

1. **Semantic over visual.** Authors state meaning (`role=success`); the renderer and theme decide appearance. This is what makes one document work on every terminal.
2. **Input formats are frontends; the AST is the core; rendering is a backend.** Every feature must be locatable in this pipeline or it doesn't ship.
3. **Safe by default.** Documents are data, never code. No execution, no unsanitized escape byte ever reaches the terminal, links are vetted, viewing a file can never trigger actions.
4. **Graceful degradation, always.** Every feature has a defined fallback down to ASCII, monochrome, non-TTY. A feature without a fallback rung is incomplete.
5. **Be a good Unix citizen.** stdin/stdout, pipes, `NO_COLOR`, isatty, stderr for diagnostics, deterministic snapshots, meaningful exit codes.
6. **Adopt, don't invent.** CommonMark + community directive syntax, not a proprietary grammar. Existing conventions (Nerd Fonts, OSC 8, kitty protocol) over new ones.
7. **Language-agnostic by contract.** The product's API is documents and JSON events over a stream — never a library in one language. SDKs are conveniences, not requirements.
8. **Incremental value.** Every release must be independently useful; no release exists only to enable a later one.

## 6. Release map

| Release | Codename | Theme | Headline capability |
| --- | --- | --- | --- |
| v1.0 | **Paper** | Static document engine | Render TeML/HTML beautifully; convert HTML→TeML and Markdown↔TeML |
| v1.5 | **Reader** | Interactive viewer | Full-screen viewing, scrolling, link navigation |
| v2.0 | **Panel** | Application runtime | Forms, buttons, events; host apps in any language |
| v2.5 | **Session** | Stateful interfaces | Widget state, data bindings, persistence, component library |
| v3.0 | **Stream** | AI-native / live documents | Streaming ingestion, incremental rendering, agent UX kit |
| v4.0 | **Wire** | Remote TeML | Networked apps: one server, any terminal, zero installs |
| v5.0 | **Commons** | Ecosystem | Package/registry, profiles marketplace, embeddings in other tools |
| v6.0+ | **Web** | The terminal web | Browsing, identity, capability security at ecosystem scale |

Each release below is specified with goals, requirements (P0 = must ship, P1 = should ship, P2 = stretch), explicit non-goals, acceptance criteria, and success metrics.

---

## 7. v1.0 "Paper" — the static document engine

### 7.1 Goals

Prove the core thesis at the document level: TeML documents and converted HTML render more beautifully and more portably than anything an author could hand-roll, with zero runtime dependencies and perfect Unix behavior. Establish the AST, the security model, and the testing discipline everything later builds on.

### 7.2 Functional requirements

**Format (F-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| F-1 | P0 | TeML is defined as CommonMark + GFM tables/strikethrough + generic directives (`:::container`, `::leaf`, `:inline[...]`) + flat YAML frontmatter; published as a written spec with escaping, nesting (fence-length colons), and attribute grammar pinned. |
| F-2 | P0 | v1 directive registry: containers `card`(title), `info`, `success`, `warning`, `error`, `note`; leafs `kv`, `image`, `break`; inline `status{role}` plus shorthands `:success/:warning/:error/:info/:muted/:kbd`. |
| F-3 | P0 | Unknown directives degrade to generic blocks/plain content with a stderr warning; they never error. |
| F-4 | P1 | Document-defined custom roles in frontmatter (`roles:` map merging into the theme). |
| F-5 | P2 | Raw style escape hatch `:style[text]{fg=... bold}` (stripped under fallback modes). |

**Rendering (R-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| R-1 | P0 | Line-oriented static renderer: headings, paragraphs, bold/italic/underline, inline code, links, ordered/unordered lists, blockquotes, thematic breaks, fenced code blocks, tables, all v1 directives. |
| R-2 | P0 | Unicode borders with ASCII fallback; role glyph decorations (✓/⚠/✗) with text fallbacks ([OK]/[WARN]/[FAIL]); no VS16, safe-glyph set only in theme chrome. |
| R-3 | P0 | Themes as JSON role→style maps; built-ins `dark`, `light`, `mono`, and a dual-background-safe `auto` default; `--theme` and frontmatter override. |
| R-4 | P0 | Capability handling: `NO_COLOR`, non-TTY auto-plain + width 80, `--no-color/--color=always/--ascii/--width`, terminal width detection, `$COLORTERM`-based color depth. |
| R-5 | P0 | Correct Unicode cell-width layout (grapheme clusters, CJK wide, combining marks); `--ambiguous-wide` flag; documented emoji-alignment limits. |
| R-6 | P0 | Word wrapping with defined overflow policy (prose wraps; code truncates with marker unless `--wrap-code`; tables use min/max column algorithm). |
| R-7 | P0 | OSC 8 hyperlinks where supported, with sanitized URIs and `--show-urls` fallback. |
| R-8 | P1 | Plain-text backend (`--to text`) rendering styles as conventions, for snapshots and non-ANSI sinks. |

**HTML conversion (H-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| H-1 | P0 | Element-level semantic mapping: h1–h6, p, a, strong/b, em/i, u, code, pre, ul/ol/li, blockquote, hr, table (colspan/rowspan flattened with warning), img→placeholder, dl→kv, title→frontmatter; script/style dropped; hidden/aria-hidden/display:none dropped. |
| H-2 | P0 | Readability-style main-content extraction for full pages (strip nav/chrome/footers), wrapper flattening. |
| H-3 | P0 | `teml convert page.html > page.teml` and `teml view page.html`, including stdin and URL-piped input. |
| H-4 | P1 | Profile system: declarative JSON class-heuristic maps, `--profile`; built-in `bootstrap` profile (card/alert/badge/text-role classes). |
| H-5 | P2 | User-supplied profile files for internal design systems. |

**Markdown interoperability (M-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| M-1 | P0 | Markdown→TeML: `teml convert README.md --from markdown --to teml` parses CommonMark + the supported GFM subset through the same mdast→TDoc frontend used by TeML, then emits canonical `.teml`; `.md`/`.markdown` extension inference and stdin are supported. |
| M-2 | P0 | TeML→Markdown: `teml convert report.teml --from teml --to markdown` emits portable CommonMark/GFM. Standard Markdown nodes are preserved; TeML-only semantics use the deterministic degradation mapping below. |
| M-3 | P0 | TeML-only degradation is content-preserving and explicit: alerts/notes→blockquotes with bold labels; cards→a heading plus body; `kv`→GFM table; `image`→safe Markdown image or alt-text placeholder; `break`→thematic break; `kbd`→inline code; status/custom-role spans→plain text. Unknown or lossy constructs retain readable content and emit `markdown-lossy-conversion` diagnostics to stderr. |
| M-4 | P0 | CommonMark/GFM fixtures are semantically stable through Markdown→TeML→Markdown. TeML→Markdown→TeML is not required to preserve terminal-only styling, but must preserve readable content, remain deterministic, and never introduce unsafe links or terminal escape bytes. |

**CLI (C-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| C-1 | P0 | Commands: default view, `view`, `convert`, `inspect --ast/--tokens`, `render --width N` (deterministic snapshot). |
| C-2 | P0 | stdout = output only; stderr = all diagnostics; exit codes 0/1/2; stdin supported everywhere. |
| C-3 | P1 | `--to json` (AST dump), `--base` for relative-link roots, `--debug`. |

**Security (S-series) — all P0**

| ID | Requirement |
| --- | --- |
| S-1 | All text entering the AST is sanitized: C0 (except \n; \t expanded), DEL, C1 controls stripped; bidi and zero-width controls filtered (ZWJ preserved only within emoji sequences). |
| S-2 | Single-emitter invariant: only the ANSI backend produces escape sequences; enforced by adversarial test fixtures asserting no foreign ESC bytes in output. |
| S-3 | Href/URI sanitization: control chars rejected; scheme allowlist http/https/mailto/relative; `file:` behind `--allow-file-links`. |
| S-4 | No execution semantics exist in the format; code blocks are display-only; nesting-depth and input-size limits prevent parser resource exhaustion. |

### 7.3 Non-functional requirements

- **Performance:** render a 1,000-block document in <100 ms on commodity hardware; startup <50 ms (matters for CLI adoption); memory O(document size).
- **Portability:** Linux, macOS, Windows Terminal; correct behavior inside tmux and over SSH; single-binary or single-`npx` install.
- **Quality:** snapshot, security, round-trip (parse→serialize→parse), and fuzz suites in CI; width-sweep snapshots at 20/40/80/120 columns.
- **Docs:** format spec, CLI reference, theming guide, "convert your first page" tutorial.

### 7.4 Non-goals for v1

Interactivity of any kind; screen buffer/alternate screen; images beyond placeholders; Markdown dialects beyond CommonMark and the explicitly supported GFM subset; lossless preservation of TeML-only semantics when exporting to Markdown; CSS interpretation beyond `display:none`; RTL/bidi layout; Windows legacy console (pre-Windows-Terminal).

### 7.5 Acceptance criteria

The fixture corpus (≥30 TeML documents, ≥20 real-world HTML pages, and ≥10 Markdown documents) renders correctly at four widths in all four theme modes; all adversarial security fixtures render inert; `curl -sL <url> | teml view` produces readable output for the top documentation-site archetypes; native TeML round-trip is AST-stable; Markdown↔TeML conversion satisfies M-4; a first-time user goes from install to converted page in under five minutes following the tutorial.

### 7.6 Success metrics

Adoption: 1k GitHub stars / 5k monthly CLI installs within 6 months as a leading indicator; ≥3 external CLI tools embedding TeML output. Quality: zero escape-injection reports; snapshot-diff regressions caught pre-release. Qualitative: unsolicited "I replaced my formatter with this" reports.

---

## 8. v1.5 "Reader" — the interactive viewer

### 8.1 Goals

Turn rendered documents into a navigable reading experience — the `less`/`man` replacement tier — and introduce the screen-buffer machinery the app runtime will reuse, now that it has a customer.

### 8.2 Functional requirements

| ID | Pri | Requirement |
| --- | --- | --- |
| V-1 | P0 | `teml read FILE` full-screen viewer: alternate screen, raw mode, resize handling, and clean restore on normal exit, SIGINT, SIGTERM, SIGHUP, and catchable failures. `teml view` remains one-shot and pipe-safe. SIGKILL cannot be handled in-process; recovery is `reset`, a new terminal, or an outer tmux/screen session. |
| V-2 | P0 | Scrolling (j/k, arrows, PgUp/PgDn, Home/End, mouse wheel where supported); position indicator in status bar. |
| V-3 | P0 | Link focus and activation: Tab/Shift+Tab cycle, Enter follows; local `.teml`/converted links open in-viewer with history (`b`/`f` back/forward); external `http`/`https`/`mailto` links hand off to the OS opener only after an in-viewer confirmation whose default action is Cancel. |
| V-4 | P0 | Screen buffer + damage-diff repaint (introduced here per design doc §9.3); flicker-free on scroll and resize. |
| V-5 | P0 | Document-root confinement: runtime navigation re-resolves links against the initial file's directory or explicit `--base` and cannot escape that root (S-series continues to apply). Out-of-root targets are rejected, not opened externally. |
| V-6 | P1 | In-document search (`/` incremental, n/N), table of contents pane from headings (`t`). |
| V-7 | P1 | `teml read dir/` confined file browser for `.teml`, `.md`/`.markdown`, and `.html`/`.htm` collections (Glow-style discovery). |
| V-8 | P2 | Reader preferences persisted (theme, width cap, last position per file). |

### 8.3 Non-goals

Forms, buttons, and any host-app events (that is v2); editing; multi-pane layouts.

### 8.4 Acceptance criteria & metrics

A 10,000-line document scrolls with bounded viewport work and damage-only repaint in mainstream emulators; normal exit, SIGINT, SIGTERM, SIGHUP, and catchable failures restore raw mode, cursor visibility, mouse mode, and alternate-screen state; docs sites converted from HTML are navigable end-to-end by keyboard alone. SIGKILL is explicitly outside the in-process restoration guarantee. Metric: viewer sessions >2 min median (reading, not bouncing); adoption as a pager (`teml` set as `$PAGER`-adjacent tool) reported in the wild.

---

## 9. v2.0 "Panel" — the application runtime

### 9.1 Goals

Deliver the category-defining capability: documents become applications. A host program in any language emits TeML and receives JSON events; the runtime owns rendering, focus, and input. "Write your HTML/TeML, get a CLI interface."

### 9.2 The mode boundary (P0, security-critical)

- **Document mode** (`teml view file` or full-screen `teml read file`): interactive widgets render but are inert. Reader links may navigate only within the confined document root, and external links require confirmation. A downloaded file can never trigger host-app actions. This boundary is permanent and non-configurable.
- **App mode** (`teml app -- ./my-host`, or host launches runtime): events flow only to the host process that supplied the document. The runtime itself never executes anything; it is a pure renderer/multiplexer.

### 9.3 Functional requirements

**Widget directives (W-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| W-1 | P0 | `::button{id label role submit}`; focus ring, press states, keyboard (Enter/Space) and mouse activation. |
| W-2 | P0 | `::input{name value placeholder mask}` single-line text (mask for passwords); full cursor editing, unicode-width-correct. |
| W-3 | P0 | `::select{name options value}` and `::checkbox{name label}`; `:::form{id}` grouping with value collection. |
| W-4 | P1 | `::textarea`, `::radio-group`, `::progress{value label}`, `::spinner`. |
| W-5 | P1 | HTML conversion maps `<form>/<button>/<input>/<select>/<textarea>` to these widgets (inert in document mode). |
| W-6 | P2 | Validation attributes (`required`, `pattern`) enforced client-side with role=error feedback before submit events fire. |

**Event & patch protocol (E-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| E-1 | P0 | Versioned handshake (`hello` exchange: protocol version, capabilities, viewport). NDJSON over stdio as the v2 transport; transport abstracted for v4. |
| E-2 | P0 | Events: `press`, `submit` (with form values), `change`, `focus`, `key` (opt-in subscription), `resize`, `close`. Every interactive node carries a stable `id`. |
| E-3 | P0 | Host→runtime ops: `document` (full swap), `replace{target}`, `append{target}`, `remove{target}`, `status{text}`; all fragments pass the full parse→sanitize→normalize pipeline (S-series applies to hosts too). |
| E-4 | P0 | Diff-and-repaint: patches update only damaged regions; focus is preserved across patches when the focused id survives. |
| E-5 | P1 | `error` frames with recoverable/fatal classes; runtime survives malformed host frames with visible diagnostics. |
| E-6 | P1 | Reference SDK shims (~100 lines each) in Python, Go, TypeScript, and bash — proving the protocol, not wrapping it. |

### 9.4 Non-functional

Input-to-paint latency <16 ms for local widget interaction, <50 ms for a host round-trip patch on the same machine; protocol spec published as a standalone document with conformance fixtures so third-party runtimes/hosts can implement it.

### 9.5 Non-goals

Client-side scripting of any kind (permanent non-goal); layout beyond vertical flow + simple columns; multiple concurrent documents/windows.

### 9.6 Acceptance criteria & metrics

The four SDK examples (deploy panel, log triage, config wizard, quiz) run identically from Python, Go, TS, and bash; a hostile host cannot inject escape bytes or navigate outside the mode boundary; document mode provably never emits events. Metrics: ≥10 third-party apps built on the protocol within 6 months; time-to-first-app (tutorial) under 30 minutes.

---

## 10. v2.5 "Session" — stateful interfaces and the component library

### 10.1 Goals

Make v2 apps feel native, not laggy, and make them fast to build: local widget state, live data bindings, session persistence, and a standard component library.

### 10.2 Functional requirements

**State layers (ST-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| ST-1 | P0 | Runtime-owned widget state: `collapsible/collapsed` cards, `:::tabs`, input drafts, scroll positions — zero host round-trips; values reported with the next host-relevant event. |
| ST-2 | P0 | Value bindings: host op `set{id value}` updates bound widgets (gauge, progress, text slot, table cell) without re-sending markup; supports ≥10 Hz update streams without flicker. |
| ST-3 | P0 | Session persistence: snapshot (AST + widget state + form drafts) keyed by app identity; resume after quit/crash; tmux-style detach/reattach for app-mode sessions. |
| ST-4 | P1 | Optimistic UI hints: a button may declare `pending-label`, shown instantly while awaiting the host. |
| ST-5 | P2 | Declared client-side derivations limited to formatting (e.g. `format=bytes|duration|percent`) — explicitly not expressions or scripting. |

**Component library (CL-series)**

| ID | Pri | Requirement |
| --- | --- | --- |
| CL-1 | P0 | Data table component: column sort, filter box, row selection as widget state; row-activate events to host. |
| CL-2 | P0 | Wizard/stepper container with per-step validation and progress. |
| CL-3 | P0 | Confirm dialog, toast/status notifications, list picker with fuzzy filter. |
| CL-4 | P1 | Sparkline/gauge/bar-meter bound-value components; log-follow pane with follow/pause. |
| CL-5 | P1 | Sprite support (`::sprite`, half-block/Braille tiers, size limits, alt fallback) per design doc; safe-glyph appendix shipped. |
| CL-6 | P2 | Nerd Fonts icon tier behind `--nerd-fonts` with mandatory fallbacks. |

### 10.3 Non-goals

A general reactive expression language; arbitrary custom components via plugins (deferred to v5 packaging); pixel image protocols (v3+).

### 10.4 Acceptance criteria & metrics

A live dashboard driven at 10 Hz by a bash script using `set` ops renders flicker-free; killing and re-running a wizard resumes on the same step with drafts intact; the "afternoon app" test — a competent developer builds a real internal tool in ≤4 hours using only components. Metric: median host round-trips per session drops materially vs v2 (local state doing its job).

---

## 11. v3.0 "Stream" — AI-native and live documents

### 11.1 Goals

Make TeML the native UI layer for AI agents and live systems: documents that render as they are generated, and an agent UX kit for the patterns agentic tools need.

### 11.2 Functional requirements

| ID | Pri | Requirement |
| --- | --- | --- |
| AI-1 | P0 | Streaming ingestion: the token serialization (design doc §8) promoted to a wire format with open/close balancing, partial-block rendering rules, and graceful handling of truncated streams (auto-close with visual "interrupted" marker). |
| AI-2 | P0 | Incremental layout: appended content lays out without reflowing the completed region above; smooth reading during generation. |
| AI-3 | P0 | Markdown-stream compatibility mode: plain streamed markdown (what models emit today) upgrades transparently, so adoption requires no model-side changes on day one. |
| AI-4 | P0 | Agent UX kit built on v2/v2.5 primitives: plan checklist (host ticks items via `set`), diff card with approve/reject/edit events, tool-call card (collapsed args, expandable), confirmation gate, streaming code block with copy affordance. |
| AI-5 | P1 | Interruption semantics: user events (e.g. "stop") deliverable to the host mid-stream; stream and event channels multiplexed. |
| AI-6 | P1 | Terminal image protocols (kitty, iTerm2, sixel) behind `::image`/`::sprite render=auto`, with the full degradation chain. |
| AI-7 | P2 | Transcript export: a completed streamed session serializes back to a static `.teml` document (session → shareable artifact). |

### 11.3 Non-goals

Model integrations or API calls in the runtime (hosts do AI; the runtime renders); multi-agent window management.

### 11.4 Acceptance criteria & metrics

A reference agent host streams a plan → executes with live tick-offs → presents a diff card → acts on approve, entirely over the protocol; a 50k-token streamed document stays smooth and memory-bounded. Metrics: ≥1 notable agent product adopting the stream format; "approve via button vs typed yes" appearing in third-party UX.

---

## 12. v4.0 "Wire" — remote TeML

### 12.1 Goals

Detach host from terminal: serve TeML apps over the network. One deployment, every user's terminal, zero client installs beyond `teml` itself.

### 12.2 Functional requirements

| ID | Pri | Requirement |
| --- | --- | --- |
| N-1 | P0 | `teml connect <endpoint>`: the v2 protocol over TLS (and over SSH channels via an sshd-embeddable server library), with reconnect + session resume (ST-3 extended server-side). |
| N-2 | P0 | Trust & capability model: remote apps are untrusted by default; first-connect origin prompt with fingerprint pinning; capabilities (open external links, read local file for upload, persist session) granted per-origin, per-capability, revocable. |
| N-3 | P0 | Server library (host-side): multiplex many client sessions; per-session document instances; auth hook points (delegating to SSH auth or bearer tokens — TeML does not invent identity in v4). |
| N-4 | P1 | Latency adaptations: patch batching, client-side widget state (ST-1) doing more work, protocol-level compression. |
| N-5 | P1 | `teml://` URL scheme and link-following between remote documents/apps under the same origin rules. |
| N-6 | P2 | Read-only broadcast mode: one live document, many viewers (incident dashboards, live demos). |

### 12.3 Non-goals

A public browsing ecosystem (v6); federation/discovery; TeML-native identity; running untrusted *logic* client-side (there is none — that's the point).

### 12.4 Acceptance criteria & metrics

The v2 example apps run unmodified over `teml connect` with only transport config changed; a capability denied is a capability that provably cannot occur; usable at 200 ms RTT for form-based apps. Metrics: internal-tools deployments at ≥5 organizations; "we replaced an internal web dashboard with a TeML endpoint" case study.

---

## 13. v5.0 "Commons" — ecosystem

### 13.1 Goals

Make TeML something people build *on* and *with*: distribution, extension, and embedding.

### 13.2 Requirement themes

- **Packaging & registry (P0):** single-file app bundles (`.temla`: manifest + documents + assets + declared capabilities); `teml install/run`; a registry with signing and capability disclosure at install time.
- **Profiles & themes marketplace (P1):** shareable HTML-conversion profiles and theme packs; organization-level defaults.
- **Embedding (P0):** the renderer as a library (Rust core with C ABI + TS build) so other tools — shells, multiplexers, editors, agent frameworks — embed TeML rendering; the runtime embeddable as a pane.
- **Interop bridges (P1):** adapters rendering TeML fragments inside Textual/Ink/Ratatui apps, and emitting TeML from their component trees — incumbents as channels, not rivals.
- **Alternate backends (P1):** HTML export (terminal-styled web preview of any TeML doc — closing the loop with the web), typed-text/PDF export for reports.
- **Conformance program (P0):** the format and protocol specs versioned with public conformance fixtures; third-party implementations certifiable.

### 13.3 Non-goals

Monetized store mechanics; plugin code execution inside the runtime (extensions are data — themes, profiles, component *compositions* — never code).

---

## 14. v6.0+ "Web" — the terminal web (horizon)

The farthest credible extent of the vision, deliberately sketched rather than specified:

- **Browsing:** history, bookmarks, an address bar in the runtime; public TeML endpoints; search/indexing of `.teml` corpora (trivially indexable — it's semantic text).
- **Identity:** portable client identity (likely SSH-key-derived) presented to origins under user control; capability grants roaming with identity.
- **Composition:** documents embedding regions served by other origins (the iframe problem, solved with capabilities from day one rather than retrofitted).
- **AI symbiosis:** agents as first-class citizens — an agent browsing TeML endpoints reads *semantics*, not scraped pixels; the same interface serves humans and models. TeML becomes the machine-and-human-readable UI layer.
- **Standardization:** the format/protocol handed to a neutral body once multiple independent implementations exist.

Everything in v6 is optional to the mission; nothing before v6 depends on it. Its role in this PRD is directional: every earlier design decision (transport abstraction, capability model, semantic purity, conformance fixtures) is made so that v6 remains *possible*.

---

## 15. Cross-cutting requirements (all releases)

**Security (permanent, P0).** The invariants from v1 never relax: sanitize-at-ingestion, single ANSI emitter, scheme allowlists, no execution, document/app mode boundary, capability prompts for anything beyond rendering. Every release adds adversarial fixtures for its new surface (v2: hostile hosts; v3: hostile streams; v4: hostile origins; v5: hostile packages). A published threat model and a security-report process ship with v2.

**Accessibility (grows from P1 to P0 by v2).** The semantic AST enables a screen-reader-oriented linear backend ("warning: one replica restarting. Button: Deploy") — shipped as deterministic, non-ANSI `teml convert --to speech` output in v1.5, then integrated with live focus announcements in the interactive runtime by v2. Keyboard-complete operation is P0 everywhere; color is never the sole carrier of meaning (role glyphs guarantee this).

**Performance budgets.** Startup <50 ms; static render <100 ms/1k blocks; interaction paint <16 ms; patch apply <50 ms; streaming memory bounded by viewport + retained AST, not by stream length. Budgets are CI-enforced from the release that introduces each path.

**Compatibility matrix.** Tier 1 (tested every release): recent Kitty, WezTerm, iTerm2, Windows Terminal, GNOME/Konsole, Alacritty, tmux, plain SSH. Tier 2 (fallback-correct): anything ANSI. Explicitly documented degradation per tier.

**Internationalization.** Unicode-correct from v1; CJK first-class; RTL/bidi remains explicitly out of scope with stripped controls until a dedicated post-v3 investigation (it is a research project in cell grids, and pretending otherwise would ship broken output).

**Documentation as product.** Each release ships spec + tutorial + reference + at least two runnable examples; the protocol and format specs are normative documents with conformance fixtures, versioned independently of the implementation.

## 16. Success metrics summary (program level)

- **Adoption ladder:** CLI installs → tools embedding TeML output (v1) → apps on the protocol (v2) → agent products streaming TeML (v3) → organizations serving remote endpoints (v4) → registry packages (v5). Each rung is the leading indicator for funding the next.
- **Health:** security incidents (target: zero escape/mode-boundary breaches ever), snapshot-regression escape rate, protocol-breaking changes after v2 (target: zero without version negotiation).
- **Ecosystem:** independent runtime or host implementations passing conformance (target: ≥2 by v5) — the true test that the format, not the codebase, is the product.

## 17. Risks and mitigations

| Risk | Severity | Mitigation |
| --- | --- | --- |
| "Nice renderer, so what" — v1 undifferentiated vs Glow/Rich | High | Ship HTML conversion + the format spec at v1 (the differentiators), not just rendering; keep v2 close behind. |
| Scope creep toward a browser/Electron-of-terminals | High | Permanent non-goals (no scripting, no CSS layout engine); the pipeline principle as review gate for every feature. |
| Protocol churn breaking early adopters | High | Version negotiation from the first handshake; conformance fixtures; protocol changes require published RFC after v2. |
| Terminal fragmentation (emoji widths, image protocols) | Medium | Capability tiers + honest documented limits + snapshot testing per tier; never promise pixel-perfection. |
| Incumbent response (Textual/Charm ship a format) | Medium | Move fast on the protocol layer where they're structurally unlikely to go (language-agnostic wire format cannibalizes a library business); build bridges to them early. |
| Security incident in app/remote mode destroys trust | Critical | The mode boundary and capability model are P0 features, not hardening passes; external audit before v4 GA. |
| Single-maintainer risk / burnout | Medium | Rust core + spec + fixtures make the project forkable and contributable; conformance program decentralizes correctness. |

## 18. Open questions

1. Name/trademark check: "TeML" vs TOML phonetic collision — decide before public launch.
2. TypeScript-first with Rust hardening (per design doc) vs Rust-first given the v2+ performance budgets — revisit at v1.5 planning with v1 profiling data.
3. License: permissive (adoption-maximizing) vs weak-copyleft for the runtime with permissive spec — decide before v1 release.
4. Governance: at what rung does a spec working group form? (Proposed: when the second independent implementation appears.)
5. Should the v2 transport also support a socket from day one (needed for detach/reattach in ST-3) or is stdio-only acceptable for v2.0?

## 19. Glossary

**TeML** — the format (CommonMark profile + directives + frontmatter). **AST** — Terminal Document AST, the canonical internal model. **Directive** — container (`:::`), leaf (`::`), or inline (`:x[...]`) semantic extension. **Role** — a semantic style identity (success, warning, error, info, muted) resolved by themes. **Document mode / app mode** — inert viewing vs event-connected application operation; a security boundary. **Host** — the program (any language) that supplies documents and receives events in app mode. **Patch** — a host→runtime operation mutating the live document. **Binding** — a widget slot updatable by `set` ops without markup. **Profile** — a declarative HTML-class→semantics mapping. **Sprite** — a document-defined multi-cell composite glyph. **Capability** — a per-origin, user-granted permission in remote mode.

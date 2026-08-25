# TeML — Terminal Markup Language

[![Discord](https://img.shields.io/badge/Discord-Join_the_server-5865F2?logo=discord&logoColor=white)](https://discord.gg/Q5ZqPf98t)

Build readable terminal documents and interactive CLI interfaces from **TeML**,
**Markdown**, or semantic **HTML**.

## Install

Install the small prebuilt package attached to the latest GitHub Release—not the
repository or its development dependencies:

```bash
pnpm add --global https://github.com/fogha/teML/releases/latest/download/teml.tgz
teml --version
```

Requires **Node ≥ 20**. Replace `latest` with a tag (for example
`download/v0.2.1/teml.tgz`) to pin an exact build.

> **Not on npm yet.** Registry publishing landed in v0.3.0 and runs on a release
> tag, so `npm install --global teml` starts working with the v0.3.0 release. Until
> then the Release tarball above is the supported install.

### Host libraries

To drive a terminal interface from your own program, add the host library for your
language. Each one speaks the same protocol to the same engine, so the same
document works from any of them:

```bash
go get github.com/fogha/teml/hosts/go            # Go — resolves from the repository
```

The Rust and Python libraries are complete and tested in-repo but are not on
crates.io or PyPI until the v0.3.0 release publishes them. Until then, depend on
them from a checkout—see [`crates/teml-host`](crates/teml-host/README.md) and
[`hosts/python`](hosts/python/README.md).

Node programs need no extra package: `teml/interactive` exports
`runInteractiveApp` for in-process use. A host library locates the engine
installed above, so install `teml` too — see
[docs/interactive-protocol.md](docs/interactive-protocol.md).

## Quick start

```bash
teml demo                         # built-in showcase; no files or network needed
teml path/to/document.md          # render TeML, Markdown, or HTML once
teml read path/to/docs/           # full-screen Reader: search, links, and TOC
```

Run `teml --help` for an overview or `teml help <command>` for detailed
behavior, options, keys, and examples. The complete reference is in
[docs/cli.md](docs/cli.md).

## Library API

Install the same GitHub Release locally in your application:

```bash
pnpm add https://github.com/fogha/teML/releases/latest/download/teml.tgz
```

```ts
import { Diagnostics, parseTeml, serializeTeml } from "teml";

const document = parseTeml("# Deploy report\n", new Diagnostics());
console.log(serializeTeml(document));
```

The package root also exports Markdown/HTML frontends, the shared `TDoc` types,
layout, renderers, capabilities, and themes. A separate `teml/interactive`
entry point exports `runInteractiveApp` for building interactive
(button/input/checkbox/radio/textarea/scroll-region) CLI apps in Node without
a subprocess — see
[docs/interactive-protocol.md](docs/interactive-protocol.md#in-process-node-alternative-runinteractiveapp).

`teml/interactive` also exports `bindings()` — an id-keyed binding object that
lets the host reflect a variable change into a live `::metric`/`::progress`
widget just by assigning to it:

```ts
import { bindings, runInteractiveApp } from "teml/interactive";

const state = bindings();
runInteractiveApp('::metric{id="cpu" value="0%"}', {
  format: "teml",
  state,
  handlers: {
    onClick(id, _values, ctx) {
      if (id === "refresh") state.cpu = "99%"; // → update{id:"cpu", props:{value:"99%"}}
    },
  },
});
```

## Build a CLI interface with HTML

Use semantic HTML as the view, ordinary JavaScript as the controller, and TeML
as the terminal runtime:

```js
import { runInteractiveApp } from "teml/interactive";

const values = await runInteractiveApp(
  `<h2>Release note</h2>
   <label for="stable">Stable</label>
   <input id="stable" type="radio" name="channel" value="stable" checked>
   <label for="preview">Preview</label>
   <input id="preview" type="radio" name="channel" value="preview">
   <label for="notes">Notes</label>
   <textarea id="notes" rows="3"></textarea>
   <button id="save">Save release note</button>`,
  {
    handlers: {
      onClick(id, _values, ctx) {
        if (id === "save") ctx.exit();
      },
    },
  },
);

console.log(`Saved ${values.channel}: ${values.notes}`);
```

Inputs, textareas, radio groups, checkboxes, buttons, bounded scroll regions,
validation rerenders, contextual keyboard focus, mouse
clicks, and terminal cleanup are handled by TeML. See
[`examples/apps/settings-app.mjs`](examples/apps/settings-app.mjs) for a complete app.

## Explore the examples

After `pnpm run build`:

```bash
pnpm run demo:go-host       # a Go program driving a terminal form (also :python-host, :rust-host)
pnpm run demo:chat --mock   # LLM replies rendered as cards, alerts, and metrics
pnpm run demo:settings      # semantic HTML app with validation rerenders, in-process
pnpm run demo:command-center # an existing HTML dashboard as a terminal document
pnpm run demo:interactive   # widget mechanics: radio, textarea, bounded scroll
```

The Go, Python, and Rust hosts all render the *same*
[28-line HTML view](hosts/go/examples/incident-handoff/view.html) — a labelled
input, a radio group, a textarea, a bounded scroll region, a checkbox, and two
buttons — with no UI code and no TeML-specific markup in any of the three. Each
host only decides what happens when an event arrives. `demo:chat` needs no API
key with `--mock`; set `DEEPSEEK_API_KEY` to talk to a real model.

The interactive host displays negotiated protocol/version state and switches
its key hints when a bounded scroll region has focus.

## Documentation

| Doc                                                                                        | Contents                                                              |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| [docs/spec.md](docs/spec.md)                                                               | Format specification (directives, security, conformance)              |
| [docs/cli.md](docs/cli.md)                                                                 | CLI reference (commands, flags, exit codes)                           |
| [docs/reader.md](docs/reader.md)                                                           | Full-screen Reader keymap, navigation security, and terminal recovery |
| [docs/interactive-protocol.md](docs/interactive-protocol.md)                               | App-host commands, events, frame negotiation, and patches             |
| [docs/polyglot-hosts.md](docs/polyglot-hosts.md)                                           | Cross-language host model and measured roadmap                        |
| [docs/host-porting-playbook.md](docs/host-porting-playbook.md)                             | Contract and conformance steps for porting a host to a new language   |
| [docs/adr/003-host-engine-distribution.md](docs/adr/003-host-engine-distribution.md)       | Host discovery, release artifacts, and SEA outcome                    |
| [docs/adr/004-native-engine-port-decision.md](docs/adr/004-native-engine-port-decision.md) | Native-port no-go decision and reopen triggers                        |
| [docs/theming.md](docs/theming.md)                                                         | Themes, roles, ASCII/color fallbacks                                  |
| [docs/tutorial.md](docs/tutorial.md)                                                       | 5-minute first conversion walkthrough                                 |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                                         | Dev setup, testing, and PR expectations                               |
| [CHANGELOG.md](CHANGELOG.md)                                                               | Release history                                                       |

## Pipeline

```text
.teml ──► remark/unified ──┐
.md   ──► remark/gfm     ├──► TDoc AST ──► normalize ──► layout ──► ansi / plain ──► stdout
.html ──► parse5/readability ┘              ▲
                                            └── sanitize.ts at every ingestion point
```

## Features (v1)

**TeML:** YAML frontmatter · CommonMark + GFM · `:success/:warning/:error/:info/:muted/:highlight/:kbd` spans · GFM `~~strike~~` · `:::card`, alerts, `:::grid`, `:::details`, `:::figure` · `::kv`, `::metric`, `::progress`, `::event`, `::image`, `::break` · footnotes · definition lists · nested directives · custom frontmatter roles.

**Markdown:** CommonMark + GFM import/export with documented lossy mapping for TeML-only constructs.

**HTML:** Readability extraction · semantic element map · `data-teml` bridge for grid/metric/progress/event · native `<progress>`, `<details>`, `<figure>`, `<mark>`, `<del>`, `<kbd>` · Bootstrap profile · hostile content stripped · `teml view page.html` and stdin.

**Terminal:** JSON themes (`dark`, `light`, `mono`, `auto`) · Unicode/ASCII borders · OSC 8 hyperlinks with `--show-urls` fallback · `NO_COLOR` · piped auto-plain · width 20–∞ · CJK/emoji cell widths.

## Security

1. All strings sanitized at ingestion (`src/core/sanitize.ts`).
2. Only `src/render/ansi.ts` emits escape sequences (CI enforced).
3. Links: `http`/`https`/`mailto`/relative; `file:` only with `--allow-file-links`; `--base` confinement.
4. No execution semantics in the format.

## Repository layout

```text
teml/
├── src/core/          AST, normalize, sanitize, diagnostics, tokens
├── src/teml/          TeML parse/serialize (remark + directives)
├── src/markdown/      Markdown interop
├── src/html/          HTML parse, extract, map, profiles
├── src/layout/        Width-aware layout (tables, cards, lists, …)
├── src/render/        ansi (sole ESC emitter) + plain
├── src/terminal/      capabilities, themes (JSON)
├── src/cli/           Commander CLI
├── fixtures/          ≥30 TeML, ≥20 HTML, ≥10 Markdown conformance corpus
├── tests/             snapshots, security, CLI subprocess, perf gates
└── docs/              spec, CLI, theming, tutorial
```

## Performance targets

CI benchmarks (see `tests/perf/benchmark.test.ts`):

- 1,000-block parse + layout + render: **< 100 ms** median
- CLI `--version` application overhead above the host Node startup: **< 15 ms**

The intended absolute cold-start target is 50 ms; on hosts where starting an empty
Node process already exceeds that value, the suite reports both the wall time and
baseline rather than attributing runtime startup cost to TeML. Heavy HTML
dependencies are lazy-loaded so TeML-only paths stay fast.

## Community

Join the [TeML Discord server](https://discord.gg/Q5ZqPf98t) for development
discussion, questions, and contributions.

## License

[MIT](LICENSE)

# TeML — Terminal Markup Language

Build readable terminal documents and interactive CLI interfaces from **TeML**,
**Markdown**, or semantic **HTML**.

## Install from GitHub

```bash
npm install --global https://github.com/fogha/teML/releases/latest/download/teml.tgz
teml --version
```

This downloads the small prebuilt package from the latest GitHub Release—not
the repository or development dependencies. Requires **Node ≥ 20**.

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
npm install https://github.com/fogha/teML/releases/latest/download/teml.tgz
```

```ts
import { Diagnostics, parseTeml, serializeTeml } from "teml";

const document = parseTeml("# Deploy report\n", new Diagnostics());
console.log(serializeTeml(document));
```

The package root also exports Markdown/HTML frontends, the shared `TDoc` types,
layout, renderers, capabilities, and themes. A separate `teml/interactive`
entry point exports `runInteractiveApp` for building interactive (button/input/
checkbox) CLI apps in Node without a subprocess — see
[docs/interactive-protocol.md](docs/interactive-protocol.md#in-process-node-alternative-runinteractiveapp).

## Build a CLI interface with HTML

Use semantic HTML as the view, ordinary JavaScript as the controller, and TeML
as the terminal runtime:

```js
import { runInteractiveApp } from "teml/interactive";

const values = await runInteractiveApp(
  `<h2>Account</h2>
   <label for="name">Name</label>
   <input id="name" placeholder="Ada">
   <button id="save">Save</button>`,
  {
    handlers: {
      onClick(id, _values, ctx) {
        if (id === "save") ctx.exit();
      },
    },
  },
);

console.log(`Saved ${values.name}`);
```

Inputs, checkboxes, buttons, validation rerenders, keyboard focus, mouse
clicks, terminal resizing, and cleanup are handled by TeML. See
[`examples/settings-app.mjs`](examples/settings-app.mjs) for a complete app.

## Documentation

| Doc | Contents |
| --- | --- |
| [docs/spec.md](docs/spec.md) | Format specification (directives, security, conformance) |
| [docs/cli.md](docs/cli.md) | CLI reference (commands, flags, exit codes) |
| [docs/reader.md](docs/reader.md) | Full-screen Reader keymap, navigation security, and terminal recovery |
| [docs/theming.md](docs/theming.md) | Themes, roles, ASCII/color fallbacks |
| [docs/tutorial.md](docs/tutorial.md) | 5-minute first conversion walkthrough |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Dev setup, testing, and PR expectations |
| [CHANGELOG.md](CHANGELOG.md) | Release history |

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

## License

[MIT](LICENSE)

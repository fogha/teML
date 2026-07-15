# TeML — Terminal Markup Language (v1.5 Reader)

Semantic documents for terminals: write **TeML**, **Markdown**, or convert **HTML**, get readable terminal output that degrades gracefully everywhere.

Not yet published to npm — clone and build from source (see below). Once
published, the target end-state usage is:

```bash
npm install teml
npx teml examples/demo.teml
npx teml convert page.html --to teml
npx teml view README.md --width 100
npx teml read README.md
```

Requires **Node ≥ 20**.

## Quick start

```bash
git clone https://github.com/<you>/teml.git && cd teml
npm install
npm run build

teml examples/demo.teml                  # styled render (default view command)
teml examples/demo.teml --ascii --no-color
teml view examples/service-command-center.teml --theme dark --width 100
teml view examples/service-command-center.html --width 100
npm run demo:command-center              # built command-center demo
teml convert examples/demo.html --to teml
teml view examples/demo.html             # HTML → terminal directly
teml read README.md                      # full-screen Reader (scroll, links, search, TOC)
teml read docs/                          # confined document browser
teml render examples/demo.teml --width 80  # deterministic plain snapshot
teml convert README.md --to speech       # semantic, non-ANSI accessibility text
teml inspect examples/demo.teml --tokens
cat examples/demo.teml | teml --no-color
npm test                                 # full fixture + security suite
npm run lint                             # eslint
npm run format:check                     # prettier --check
npm run pack:verify                      # npm pack install smoke test

# LLM chat demo: DeepSeek replies in HTML, TeML renders it in your terminal
export DEEPSEEK_API_KEY=sk-...
npm run demo:chat                        # interactive REPL
npm run demo:chat -- --mock              # try it with no API key/network

npm run demo:settings                    # interactive HTML form (validation, no NDJSON)
```

## Library API

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

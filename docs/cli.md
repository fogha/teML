# TeML CLI reference

Install: `npm install teml` or run with `npx teml`.

Build from source: `npm run build` then `node dist/cli/main.js`.

## Commands

| Command | Description |
| --- | --- |
| `teml [file]` | Default: same as `view` |
| `teml view [file]` | Render to the terminal (ANSI when capable) |
| `teml convert [file]` | Convert to another format (`--to`) |
| `teml inspect [file]` | Dump AST, tokens, or render tokens |
| `teml render [file]` | Deterministic plain snapshot (`--width`) |

`file` may be `-` or omitted to read **stdin**.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | Read/parse failure |
| 2 | Invalid flags or usage |

**stdout** carries rendered or converted output only. **stderr** carries `teml: warning:` diagnostics and `teml: debug:` timings.

## Input / output

| Flag | Values | Default |
| --- | --- | --- |
| `--from` | `teml`, `markdown`, `html` | By extension, else sniff |
| `--to` | `teml`, `markdown`, `text`, `json` | `teml` (convert only) |

## Layout & terminal

| Flag | Description |
| --- | --- |
| `--width N` | Layout width in columns |
| `--theme NAME\|PATH` | `dark`, `light`, `mono`, `auto`, or JSON path |
| `--no-color` | Disable ANSI colors |
| `--color` | Force colors even when piped |
| `--ascii` | ASCII borders and decoration glyphs |
| `--ambiguous-wide` | Treat ambiguous-width Unicode as 2 cells |
| `--wrap-code` | Wrap code block lines instead of truncating |
| `--show-urls` | Always show link URLs in visible text |
| `--profile NAME\|PATH` | HTML profile (`bootstrap` built-in) |
| `--base URL\|PATH` | Base for relative link resolution |
| `--allow-file-links` | Allow `file:` scheme links |
| `--debug` | Print stage timings to stderr |

## Inspect modes

| Flag | Output |
| --- | --- |
| `--ast` | Normalized AST JSON (default) |
| `--tokens` | AST token stream (`heading_start level=1`) |
| `--render-tokens` | Layout token stream after layout |

## Examples

```bash
# View TeML (default command)
teml examples/demo.teml

# Service command-center demo (TeML + synchronized HTML)
teml view examples/service-command-center.teml --theme dark --width 100
teml view examples/service-command-center.html --width 100
npm run demo:command-center

# Plain pipe-friendly output
teml examples/demo.teml --no-color | less

# Convert HTML → TeML
teml convert page.html --from html --to teml > page.teml

# Markdown round-trip check
teml convert README.md --from markdown --to teml

# Deterministic snapshot for tests
teml render examples/demo.teml --width 80 > out.txt

# Debug parse/layout timings
teml view examples/demo.teml --debug

# Stdin
curl -sL https://example.com/doc.html | teml view --from html --width 100
cat report.teml | teml --no-color
```

## Environment

| Variable | Effect |
| --- | --- |
| `NO_COLOR` | Disables color (also honored when set) |
| `COLORTERM=truecolor` | Prefer 24-bit color |
| `COLUMNS` | Fallback width when not a TTY |

Piped stdout automatically disables color unless `--color` is set.

# Your first terminal document in 5 minutes

This tutorial uses the prebuilt GitHub Release. You do not need to clone or
build the repository.

## 1. Install (1 min)

Requires Node 20 or newer and pnpm 10 or newer:

```bash
pnpm add --global https://github.com/fogha/teML/releases/latest/download/teml.tgz
teml --version
```

## 2. See TeML immediately (30 sec)

```bash
teml demo
```

The built-in showcase needs no file or network connection. It demonstrates
cards, alerts, key/value summaries, tables, roles, and width-aware layout.

Try the fallback behavior used by logs and pipelines:

```bash
teml demo --ascii --no-color
```

## 3. Render HTML (1 min)

Create a small status page:

```bash
cat > /tmp/status.html <<'HTML'
<h1>Deploy status</h1>
<div class="alert alert-success">Production is healthy.</div>
<div data-teml="metric" data-label="Availability" data-value="99.99%"></div>
HTML

teml /tmp/status.html
```

TeML maps semantic HTML and supported Bootstrap-style classes into terminal
layout. Scripts, unsafe links, and control characters are neutralized.

## 4. Convert instead of render (1 min)

```bash
teml convert /tmp/status.html --to teml > /tmp/status.teml
teml convert /tmp/status.html --to speech
teml inspect /tmp/status.html --tokens
```

`convert` supports TeML, Markdown, plain text, semantic speech text, and the
normalized JSON AST.

## 5. Open the Reader (1 min)

```bash
teml read /tmp/status.teml
```

Use arrow keys or `j`/`k` to scroll, `/` to search, `t` for the table of
contents, `?` for complete help, and `q` to quit. Reader requires a real
terminal.

## Useful help

```bash
teml --help
teml help view
teml help read
teml help convert
teml help run
```

## Next steps

- Read [spec.md](./spec.md) for TeML syntax
- Read [cli.md](./cli.md) for every command and flag
- Read [interactive-protocol.md](./interactive-protocol.md) to build CLI apps
- Read [theming.md](./theming.md) to customize terminal output
